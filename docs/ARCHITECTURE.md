# Kiến trúc TuTien2D

Cập nhật: 2026-10-08. Mô tả hệ thống **đang chạy trong repo**, không phải kế hoạch (kế hoạch ban đầu ở `PROJECT_PLAN.md`, đã lệch đáng kể: xem mục 12). Nhãn độ tin cậy: **[Code]** đọc từ mã trong repo; **[Live]** đã quan sát trên game thật; **[Chưa biết]** chưa kiểm chứng.

## 1. Tổng quan

Nền tảng điều khiển nhiều tài khoản game TuTien2D bằng cách nói chuyện thẳng với game server qua WebSocket (không chạy client trình duyệt của game). Dashboard web hiển thị và ra lệnh.

```
                       wss://game.tutien2d.online/
                                  ▲   │ gói game (JSON)
                                  │   ▼
┌────────────────────────────────────────────────────────────────────┐
│ packages/core-client  (TuTienClient)                               │
│  SocketClient → guards/snap2 reducer → GameStateStore → events     │
│  + sendMove/attackMob/castSkill/... + OperationLedger + packet tap │
└──────────────▲─────────────────────────────────┬───────────────────┘
               │ lệnh                            │ sự kiện (state, you, snap...)
┌──────────────┴─────────────────────────────────▼───────────────────┐
│ packages/automation-engine (BotController, state machine training, │
│  seller/restocker/quest/farm, auto/target-selection, skill-rotation)│
└──────────────▲─────────────────────────────────┬───────────────────┘
               │ điều khiển                      │ hoạt động, log
┌──────────────┴─────────────────────────────────▼───────────────────┐
│ apps/server  (Express + ws)                                        │
│  worker-pool (ActiveBot/tài khoản) · routes REST · ws hub · db JSON│
│  security (auth, origin, error envelope, crypto) · debug probes    │
└──────────────▲─────────────────────────────────┬───────────────────┘
          REST │ (Bearer)                        │ WS /ws (subprotocol bearer)
┌──────────────┴─────────────────────────────────▼───────────────────┐
│ apps/web  (React + Vite)  useRealtime → merge → components         │
└────────────────────────────────────────────────────────────────────┘
```

Nguồn tham chiếu protocol: `vendor/tutien2d-public-client/2026-10-06` (client chính thức, đã minify, **chỉ đọc**). Dữ liệu tĩnh (bảng quái, kỹ năng, lưới va chạm, bảng vật phẩm) được **sinh** từ vendor bằng `scripts/gen-*.mjs` ra file `*.generated.ts`.

## 2. Các package và trách nhiệm

| Package | Trách nhiệm | File chính |
|---|---|---|
| `packages/core-client` | Kết nối, đăng nhập (Supabase), nhận/parse gói, giữ trạng thái, gửi lệnh | `client.ts` (TuTienClient, hàm gửi lệnh), `connection/socket-client.ts` (socket, hello, ping, reconnect, `processPacket`), `state/game-state.ts` (GameStateStore, `normalizeVitals`), `state/snap2-reducer.ts`, `operation-ledger.ts`, `debug/packet-tap.ts` |
| | Dữ liệu và parser phục vụ auto | `state/auto-data.ts`, `state/combat-packets.ts`, `state/derived-vitals.ts`, `vitals-policy.ts`, `*.generated.ts` |
| `packages/automation-engine` | Vòng lặp bot theo tick, các module nghiệp vụ | `bot-controller.ts`, `training/state-machine.ts`, `inventory/{seller,restocker}.ts`, `quest/quest-runner.ts`, `farm/farm-manager.ts`, `auto/{target-selection,skill-rotation}.ts` |
| `apps/server` | Điều phối nhiều tài khoản, REST, WS cho dashboard, lưu trữ, bảo mật | `orchestrator/worker-pool.ts` (rất lớn), `api/routes.ts`, `ws/hub.ts`, `db/database.ts`, `security/*`, `config.ts` |
| `apps/web` | Dashboard | `App.tsx`, `hooks/useRealtime.ts`, `lib/{api,auth,context,minimap}.ts`, `components/*` |

Phụ thuộc: `web → core-client` (chỉ lấy hằng số chính sách vitals) · `server → core-client, automation-engine` · `automation-engine → core-client`. Không có phụ thuộc ngược.

## 3. Luồng dữ liệu vào (game → dashboard) **[Code]**

1. `SocketClient` nhận chuỗi JSON, `processPacket` phát sự kiện theo `op` (`welcome`, `state`, `map`, `snap2`, `you`, `hurt`, `revived`, `status`, `formation`...). Packet tap (nếu bật) ghi cấu trúc ở đây.
2. `TuTienClient` áp các **guard** (`worldPacketGuard`, `mapPacketGuard`) do server cấp: chỉ nhận gói thế giới khi map/khu/epoch khớp. Gói bị từ chối vẫn được lấy phần vitals chuẩn (`updateVitalsOnly`).
3. `snap2` đi qua `Snap2Reducer` (gói `pf`/`ef` thêm mới, `p`/`e` vá, `gp`/`ge` xóa; `full` đặt lại) và phát `worldSnapshot` nguyên tử `{mapId, khu, contextEpoch, sequence, players, monsters}`.
4. `GameStateStore` giữ trạng thái: vị trí, map/khu và cờ `*Known`, `contextEpoch`, `VitalSnapshot`, `downed`, túi đồ, trang bị, `questSave`...
5. `worker-pool` (mỗi tài khoản một `ActiveBot`) lắng nghe sự kiện, giữ bản **runtime** riêng: `mapContext`, `playersContext`, `monstersContext` (mỗi cái có `observedAt`, `fresh`), `vitals`, `dataStatus`, `moveTo`, `navigation`, `training`.
6. `getRuntimeInfo()` dựng đối tượng runtime gửi đi: tính `mapContextAgeMs`, `mapContextIsCurrent`, `vitalsAgeMs`, `derivedMax`... bằng đồng hồ **backend**.
7. Phát tới dashboard qua `wsHub.broadcastAccountUpdate` (giới hạn 5 Hz cho `worldSnapshot`) và qua `GET /api/accounts`.
8. `useRealtime` **không tin** payload: `mergeAccountRuntime` kiểm tra schema từng trường, đảm bảo `observedAt` không lùi (`isContextNewer`, so epoch), đóng dấu `mapContextReceivedAt` và `vitalsReceivedAt`.
9. UI dùng `resolveMapContext`/`resolveVitalsAge`: tuổi = tuổi backend + thời gian trôi từ lúc nhận (không phụ thuộc đồng hồ máy khác, không bao giờ âm).

## 4. Luồng lệnh ra (dashboard/bot → game) **[Code]**

- **Dashboard → REST → `worker-pool`**: `move-to`, `map/enter` (đi tới cổng rồi mới `enter`), `vitals/refresh`, `start/stop/restart`, `config`... Mọi route nằm sau `requireAuth` và dùng error envelope `{success, error, errorCode, requestId, retryable}`.
- **`BotController` (tick) → state machine training → executor** do `worker-pool` cấp (`setTrainingMovementExecutor`, `setVitalsRefreshRequester`). State machine thuần hàm, các pha: `SYNCING → ENTERING_MAP → WAITING_MAP_CONFIRM → WAITING_KHU → MOVING_TO_AREA → TRAINING → RECOVERING/BLOCKED/STOPPED`.
- **Gói gửi lên game**: `sendMove` (raw, không qua jitter, nhịp 10 Hz), `attackMob`/`castSkill` (raw), `enterMap`, các lệnh RPC `sendCmd` có `rid` và chờ `ack` (bán đồ, ăn, đột phá...). Hành động kiểu người chơi đi qua `antiDetection.enqueue` (trễ ngẫu nhiên).
- **Không có ACK** cho `attack`/`skill`/`enter`; `move` có ACK gián tiếp qua `you` (xem mục 6). `OperationLedger` chặn gửi lặp attack/skill trong cửa sổ chờ; không tự retry.

## 5. Mô hình độ tươi (freshness) **[Code]**

| Dữ liệu | Nguồn tuổi | Ngưỡng |
|---|---|---|
| Map/khu context | `mapContext.observedAt`, `contextEpoch`, `mapContextIsCurrent` | TTL 15 s (`MAP_CONTEXT_TTL_MS`, backend; `lib/context.ts`, web) |
| Người chơi, quái | `playersContext`/`monstersContext.observedAt` | 5 s |
| Vitals | `vitals.observedAt` → `vitalsAgeMs` | hiển thị cũ sau 5 s; cổng tấn công 30 s (đề xuất, chưa xác minh) |

Nguyên tắc: dữ liệu chưa biết hiển thị là chưa biết (`null`/`—`), không thay bằng 0 hay mặc định. Mất kết nối hoặc đổi map làm `fresh=false` và xóa danh sách thực thể.

## 6. Mô hình vitals và trạng thái gục **[Code + Live]**

- `VitalSnapshot {hp, maxHp, mp, maxMp, status: unknown|fresh|stale|invalid|conflict, source, observedAt}`; chuẩn hóa bởi `normalizeVitals`. Nguồn hợp lệ: `state`/`state.save`, `you`, `hurt`, `revived`. `status` (gói hiệu ứng) **không** phải vitals.
- **[Live]** HP tuyệt đối của chính mình **không** có trong `welcome`/`state`; chỉ đến qua `you` (phản hồi gói `move`), `hurt`, `revived`. `you` đến theo `seq` bội số của 10 của luồng move, kể cả khi đứng yên (ủng hộ bởi hai probe, mỗi kiểu một mẫu). Vì vậy HP chỉ làm mới khi bot đang gửi move: `refreshVitals()` gửi tối đa 10 move `idle` tại chỗ (giới hạn 30 s/tài khoản, bỏ qua khi gục, đang đi, có quái trong 300 đơn vị).
- `maxHp/maxMp` **không có trên wire**: là `derivedMax` suy ra từ `state.save.realm` và `state.save.equipment` bằng bảng cảnh giới và bonus trang bị; tách riêng, không ghi vào `VitalSnapshot`, có cờ `complete`.
- Gục: `downed` từ `you.dn` (số 0/1), gói `down`, `revived`. Không dùng `hp <= 0` một mình.
- Cổng: **mềm** cho di chuyển (chỉ chặn khi gục), **nghiêm** cho tấn công/skill (cần vitals `fresh` và tuổi trong ngưỡng).
- `selfPresence` (tín hiệu từ mục của chính mình trong danh sách người chơi) hiện không có nguồn: **[Live]** nhân vật mình không nằm trong `p`/`pf`. Giữ trong mã nhưng không dựa vào.

## 7. Bản đồ, di chuyển, điều hướng **[Code + Live]**

- Chuyển map chỉ qua cổng: `portal-navigation.ts` lập tuyến theo `portal-catalog.ts`, đi bộ (A\* `walk-path.ts` trên lưới va chạm, hitbox 16×12), rồi gửi `enter` và chờ gói `map` xác nhận.
- Lưới va chạm: `core-client/src/state/walk-grids.generated.ts` (16/16 map, sinh từ vendor); `apps/server/src/config/walk-grid.ts` là facade giữ API cũ. Điểm sinh quái: `map-spawns.generated.ts`.
- Chọn khu và hồi sinh: giao thức **đã thấy trong client chính thức** (`{op:"khu",act:"xem"|"chon"}`, `cmd("revive",{mode:"home"|"spot"})`) nhưng **chưa kiểm chứng live** nên các khóa `KHU_PROTOCOL_UNAVAILABLE`, `RESPAWN_PROTOCOL_UNAVAILABLE` vẫn giữ.
- Bay: trong gói `move`, `fly:1` là bay còn `fs` là trạng thái câu cá; `sendMove` hiện gán cứng `fly:0, fs:0`. Chưa thử.

## 8. Lưu trữ và bảo mật

- **DB** [Code]: một file JSON (`<DATA_DIR>/tutien_db.json`) giữ trong bộ nhớ, ghi nguyên tử (file tạm rồi đổi tên) có debounce, `flush()` khi tắt máy. Mật khẩu và refresh token mã hóa AES-256-GCM; khóa từ `ENCRYPTION_SECRET` hoặc tệp `data/.secret` tự sinh. Thư mục `data/` không vào git.
- **Control-plane** [Code]: bind `127.0.0.1` mặc định; bind ngoài loopback bắt buộc `API_TOKEN` >= 32 ký tự (nếu thiếu, server không khởi động). REST dùng Bearer; WebSocket dashboard dùng subprotocol `bearer` và kiểm tra `Origin` theo `ALLOWED_ORIGINS`. Có `X-Request-Id`, giới hạn JSON 100 KB, giới hạn phân trang log (tối đa 500).
- **Chưa làm** [Code]: RBAC/nhiều người dùng, rate limit đăng nhập, schema zod cho gói game (hiện chỉ có parser thuần hàm cho vài gói chiến đấu), rotate token game cũ (việc thủ công).

## 9. Dữ liệu sinh từ vendor và công cụ

| Script | Sinh ra | Nội dung |
|---|---|---|
| `scripts/gen-derived-vitals.mjs` | `derived-vitals.generated.ts` | cảnh giới (`REALM_MAX`) + bonus trang bị (`ITEM_BONUS`) |
| `scripts/gen-enemy-defs.mjs` | `enemy-defs.generated.ts` | 62 loại quái |
| `scripts/gen-skill-defs.mjs` | `skill-defs.generated.ts` | 27 DEFS + 28 ô (cả Lôi Chưởng) |
| `scripts/gen-walk-grids.mjs` | `walk-grids.generated.ts`, `map-spawns.generated.ts` | 16 map, 187 điểm sinh quái |

Các script chạy vendor trong `node:vm` với đối tượng giả, không mạng; sinh lại phải cho kết quả giống hệt (đã kiểm tra). Khi vendor đổi phiên bản phải sinh lại và đối chiếu.

Công cụ chẩn đoán (mặc định tắt): packet tap (`TUTIEN_PACKET_TAP=<giây>`, ghi cấu trúc đã redact vào `docs/evidence/`, không ghi token, tên, id); stationary probe (`TUTIEN_PROBE_STATIONARY=1|offset`, gửi tối đa 10/14 move đứng yên một lần).

## 10. Kiểm thử và quy trình nghiệm thu

- Web: Vitest (`pnpm --filter @tutien2d/web test`). Core/automation: `node --test` trên file `.mjs` (nạp từ `dist`, nên phải build trước). Server: `npx tsx --test` cho file `.ts`, `node --test` cho `.mjs`.
- **Luôn chạy `pnpm build`** trước khi tin test: `tsc` xuất file ngay cả khi có lỗi kiểu, nên test có thể pass trong khi build fail. Ba đợt Codex liên tiếp đã để lại lỗi kiểu loại này.
- Kiểm chứng live theo quy tắc `AGENTS.md`: một phiên đăng nhập mỗi tài khoản, không gửi lệnh ngoài phạm vi, evidence đã redact.

## 11. Quy trình làm việc với agent

`AGENTS.md` là hợp đồng chung. Codex chạy bằng `codex exec` (bắt buộc `< /dev/null` và `timeout`), prompt lưu ở `docs/PROMPT_*.md`, mỗi đợt bắt đầu từ cây git sạch và kết thúc bằng build, test, xem diff, commit. Chi tiết và bài học ở `SESSION_LOG.md`.

## 12. Khác biệt so với kế hoạch ban đầu

| Kế hoạch (`PROJECT_PLAN.md`) | Thực tế |
|---|---|
| Frontend Next.js 15 + Shadcn | React 18 + Vite + Tailwind |
| Backend Fastify, Prisma, SQLite/PostgreSQL, Redis | Express + `ws`, DB JSON một file, không Redis |
| Worker pool tiến trình riêng | `worker-pool.ts` chạy cùng tiến trình, mỗi tài khoản một `ActiveBot` |
| Multi-tenant, RBAC, proxy pool, Docker | Chưa làm; có `proxyUrl` trong DB nhưng luồng proxy chưa hoàn thiện/kiểm thử |
| Tự động hóa 100% (bán đồ, mua thuốc, quest...) | Phần lớn automation cũ **đang khóa** ở luồng chạy; chỉ Auto farm (điều hướng) được bật; auto đánh quái đang ở dạng đặc tả (`AUTO_SPEC.md`) và khối hàm thuần P0/P1 |

## 13. Rủi ro kiến trúc đã biết

1. `worker-pool.ts` (~1800 dòng) gom nhiều trách nhiệm (runtime, vitals, map context, move-to, navigation, probes). Nên tách dần khi vướng, mỗi lần một cụm và có test.
2. Hai bản tính độ tươi (backend và `lib/context.ts` của web) phải giữ ngưỡng đồng bộ thủ công (`MAP_CONTEXT_TTL_MS`).
3. Dữ liệu sinh từ vendor có thể lệch với server thật (ví dụ bảng quái dùng giá trị mặc định của client); chưa kiểm chứng.
4. Tìm đường trong dự án và `Pathfinder.route` của vendor lệch nhỏ (8 trên 220 truy vấn lệch "có/không có đường"); chưa rõ hướng lệch.
5. Server có chống bot/giới hạn tần suất `attack`/`skill` hay không: **[Chưa biết]**.

## 14. Tài liệu liên quan

`AGENTS.md` · `AUTO_SPEC.md` (vòng lặp auto) · `UI_FEATURE_INVENTORY.md` (chức năng client) · `FIX_GUIDE.md` (sửa lỗi và checklist) · `CONTROL_PLANE_API.md`, `API_REFERENCE.md` (API) · `PORTAL_NAVIGATION.md`, `MINIMAP_NAVIGATION.md` · `VITALS_SYNC_FIX.md` · `TRAINING_PROTOCOL_GAPS.md` · `SESSION_LOG.md` (nhật ký, mới nhất ở đầu).
