# Nhật ký phiên triển khai

## 2026-10-08 — Spike giai đoạn 3 (offline): cảnh game và Auto của client chạy không hiển thị; kế hoạch bàn giao phiên

Quyết định của người dùng: chạy ngầm mặc định trên server Linux, mở client khi muốn xem theo phương án A (nhả phiên rồi mở trang chính thức); phần này ghi thành kế hoạch làm sau (`PLAN_SESSION_HANDOFF.md`). Trước mắt làm xong di chuyển và auto đánh quái đúng chuẩn client.

Kết quả: khởi động được cảnh game không hiển thị (`scripts/lib/vendor-env.cjs`, `spike-vendor-scene-offline.cjs`), `update(dt)` thủ công nhanh khoảng 130 lần so với thời gian thực, và Auto của client (`Input.pressAutoToggle`) chạy được: trong 45 s mô phỏng đi, đánh 41 đòn, hạ 5 quái, rồi gục ở giây 43 (client Auto không tự tránh nguy hiểm). Hai bẫy: phải tự tăng `Game.time`, và `Assets.ensureMap` phải được thay bằng hàm trả ngay. Chi tiết và việc chưa làm: `AUTO_SPEC.md` mục 15.6. Chưa chạy chế độ online, chưa bật Auto trên game thật.

## 2026-10-08 — Spike giai đoạn 2: client chính thức không hiển thị kết nối thật

`scripts/spike-vendor-client-live.cjs`: lấy phiên bằng mã dự án, nạp client vendor trong `node:vm`, thay `WebSocket` bằng `ws`, `Gateway.connect()`, quan sát 25 s, không bật Auto, không gửi lệnh gameplay. Kết quả: `ready` sau 1014 ms, server chấp nhận, `selfId`/`mapId`/`mapEpoch`/`snapV`/`remotes=9` do chính mã client tính, 246 gói snap2, 0 lỗi trong trình xử lý gói. Cảnh game chưa khởi động (`SceneWorld.player` chưa có). Refresh token xoay vòng đã được lưu lại vào DB; cần kiểm tra bot đăng nhập được ở lần chạy sau. Chi tiết và việc chưa biết: `AUTO_SPEC.md` mục 15.5. Server/bot đã dừng trước khi chạy (cổng 4000 trống); script tự thoát sạch.

## 2026-10-08 — Spike: chạy client chính thức không hiển thị (hướng B)

Người dùng đề xuất dùng thẳng client (bỏ phần vẽ) vì server giao việc auto/di chuyển cho client. Đã thử offline: `scripts/spike-vendor-client-boot.cjs` nạp 241 script trong `node:vm` với đối tượng giả; 239 nạp được (2 lỗi vô hại), `window.PNTT` có 223 module gồm `Game`, `Gateway`, `SceneWorld`, `Skills`, `Targeting`, `Pathfinder`, `Input`; `SceneWorld.update` và `draw` tách biệt. Chưa khởi động được vòng đời (chưa có socket, `Game.scene` null). Chi tiết và các điều chưa biết ở `AUTO_SPEC.md` mục 15. Giai đoạn 2 (kết nối thật bằng phiên tài khoản) cần người dùng đồng ý; chưa chạy.

## 2026-10-08 — Đo hành vi mạng của client thật khi đứng yên (đọc mã)

Kết quả chi tiết ở `AUTO_SPEC.md` mục 14. Tóm tắt: client thật chỉ gửi `move` khi trạng thái đổi (tọa độ lệch hơn 0.5 px, hướng, trạng thái, tư thế, bay, câu cá), tick 10 Hz, nên đứng yên là không gửi gì; `ping` kèm thống kê mạng khoảng 30 s một lần với số liệu thật. Bot khác ở hai điểm: `ping` mỗi 8 s với `ns` hằng số, và `refreshVitals`/probe gửi tới 10 gói `move` giống hệt nhau mà client thật không bao giờ gửi. Chưa biết server có phân biệt các mẫu này không. Chưa đối chiếu bằng bắt gói client thật.

## 2026-10-08 — Kịch bản live P2 (tiếp cận): harness hủy an toàn, và sự cố nhân vật bị tấn công khi đứng yên

Chạy bởi Claude Code với `TUTIEN_PACKET_TAP=300 TUTIEN_PROBE_APPROACH=1`. Evidence đã redact: `docs/evidence/packet-tap-2026-10-08T03-51-44-595Z.json` (không nằm trong git).

### Kết quả

| Quan sát | Giá trị |
|---|---|
| Vị trí | Bot đăng nhập thẳng vào `thanh_truc_lam` (phiên trước để lại), `(286,116)`, khu 1; không cần đi cổng |
| Harness | Hủy với `window_expired:no_safe_target` sau cửa sổ 240 s: không có quái nào đạt mọi điều kiện an toàn |
| Di chuyển do harness | 0 (không có kế hoạch, không đi, không đánh, không dùng kỹ năng) |
| Move đã gửi | 3 move `idle` của `refreshVitals`, ở `(286,116)` |
| Gói `hurt` | **14 gói** trong phiên, đầu tiên ở giây thứ 99, sau đó từng loạt cách nhau khoảng 1,2 s (giây 257 đến 264). Cả 14 gói có `hp=225` |

Lý do `no_safe_target` (suy ra từ vị trí quái, chưa log từng điều kiện): quái ở đây đứng thành cụm (3 con `son_chuot` cách nhau chục px nên vi phạm luật "không có quái khác trong vùng aggro quanh điểm đích"), con `tieu_phu` ở 502 px vượt giới hạn 450 px, và HP đã cũ quá 30 s trong phần lớn thời gian. Các luật an toàn không bị nới.

### Sự cố: nhân vật bị tấn công khi đứng yên mà người vận hành không thấy

- 14 gói `hurt` đều mang `hp=225` (đầy). Gói `hurt` có các trường `bp`, `byId`, `dmg`, `hp`; tap chỉ ghi `hp`, nên chưa xác nhận lớp giáp `bp` có hấp thụ sát thương hay không. Giả thuyết hợp lý nhưng CHƯA XÁC MINH: `bp` hấp thụ trước nên `hp` không đổi.
- Người vận hành (Claude Code) đã báo sai "không bị hurt": script theo dõi không hiển thị `hurt`, và việc tìm chữ "hurt" trong log server không có tác dụng vì server không log gói này. Bot đứng ở chỗ có quái tấn công khoảng 3 phút trước khi dừng.
- Sau khi dừng bot, trạng thái nhân vật trong game (còn lại trong map hay bị gỡ khi ngắt kết nối, `bp`/`hp` thực) CHƯA XÁC MINH; kiểm tra khi đăng nhập lần sau.
- Vitals lần này thành `fresh` qua gói `hurt` (không qua `you`): `hurt` chỉ mang `hp`/`bp`, nên `mp` vẫn `null`.
- Lần `refreshVitals` đầu gửi 3 move rồi dừng (`no_ack`) vì guard phát hiện quái đi vào vùng 300 px giữa chừng; đúng thiết kế.

### Đã sửa

- Runtime có thêm `hurtCount` và `lastHurtAt` (worker-pool); script theo dõi hiển thị `hurtCount` và `lastHurtAgoS`. Build 4/4 và test server liên quan pass.
- `AGENTS.md` và `LIVE_SCENARIO_APPROACH.md`: bắt buộc theo dõi `hurtCount` khi chạy live; `hurtCount` tăng thì dừng bot ngay, không chờ tiêu chí khác.

### Chưa xác minh / cần làm tiếp

- Tiếp cận quái thật chưa chạy được: harness đúng khi từ chối, nhưng ở vị trí này quái dày đặc và tấn công bot ngay cả khi đứng yên. Cần chọn vị trí khác (ít quái, cách xa cụm spawn) hoặc cho phép người vận hành đưa bot tới một điểm cách quái an toàn bằng move-to trước khi harness chạy.
- Ghi `bp`, `dmg`, `byId` của `hurt` vào tap (chỉ số, không ghi id người chơi) để biết sát thương thực và nguồn (quái hay người).
- Quái tự tấn công khi chưa tới gần: cần đo bán kính aggro thực tế so với `aggro` trong ENEMY_DEFS (72 px với `son_chuot`); ở `(286,116)` quái ở 22 đến 27 px từng xuất hiện thoáng qua.

## 2026-10-08 — Nghiệm thu P2 (tiếp cận mục tiêu) của Claude Code

Commit `a6fc5c9`. Codex không build được trong sandbox; Claude Code build và chạy lại.

### Kết quả

| Hạng mục | Kết quả |
|---|---|
| `pnpm build` | 4/4 pass ngay lần đầu (đợt đầu tiên không có lỗi kiểu) |
| Test | automation-engine 4 file, core-client toàn bộ, server TS 9 file, server .mjs 3 file, web Vitest 9/9: pass |
| Phạm vi | Không có route API/UI mới, không có `attack`/`skill`, `vendor/` và `.gitignore` không bị đụng |
| Quét 62 điểm sinh quái của `thanh_truc_lam` | không có đích bị chặn |

### Lỗi thiết kế tìm ra khi review và đã sửa

Harness `approach-probe` chạy một lần duy nhất ở 20 s sau `welcome`, nhưng kịch bản live yêu cầu bot đi cổng sang `thanh_truc_lam` trước. Hệ quả: harness bắn ở `tan_vien` (không có quái), tự hủy và tiêu mất lượt duy nhất. Đã đổi: sau độ trễ ban đầu, thăm dò mỗi giây trong cửa sổ `APPROACH_PROBE_WINDOW_MS = 240000`; lý do tạm thời thì chờ, lý do dứt khoát (`downed_true`, `not_in_game`, mất kết nối) hủy ngay, hết cửa sổ hủy với `window_expired:<lý do cuối>`. Thêm test (chờ rồi chạy, gục hủy ngay, hết cửa sổ). Kịch bản live đã cập nhật.

### Sự cố trong lúc làm (ghi lại để tránh lặp)

- Test cũ của harness dùng đồng hồ cố định nên vòng chờ mới chạy thật và treo hơn 300 s; đã dừng các tiến trình test treo (lọc theo dòng lệnh `approach-probe.test`) và chuyển sang đồng hồ giả.
- Lặp lại lỗi backtick trong chuỗi nháy kép của bash làm hỏng một dòng bản vá (build báo lỗi ngay). Quy tắc: sửa mã bằng công cụ Edit hoặc script ghi ra file, không nhúng mã có backtick vào `node -e "..."`.
- Mọi lệnh test từ nay dùng `timeout`.

### Chưa xác minh (chờ kịch bản live)

Thời gian tới tầm, có bị `hurt` khi lại gần quái có `aggro` không, quái có đuổi theo hay quay về điểm sinh, độ ổn định khi đứng yên trong tầm, và `refreshVitals` ở `thanh_truc_lam` khi chưa có quái trong 300 đơn vị.

## 2026-10-08 — P2 verification addendum (offline)

- Pure approach/tracker: pass; deterministic goal tests include all 62 `thanh_truc_lam` spawn points.
- Target-selection and walk-path regression tests: pass (walk-path reports 19 waypoints).
- Runner/probe tests: pass through offline esbuild transpilation with source-only shims; covers guards, abort cancellation, lock/cleanup, safe filters, one-shot, and no follow-up move after arrival.
- Scoped TypeScript API check: pass for changed P2 and packet-tap/socket-client files; full package build remains blocked by pnpm/Corepack/EPERM tooling.
- Full server-source diagnostic pass with workspace package paths: 18 existing dependency/type-root diagnostics, 0 in the watched P2/worker-pool files.
- `git diff --check`: pass, with only LF/CRLF warnings.
- No server, login, network, live game, or packet transmission was used; live timing, hurt, chase/leash, and stationary stability remain unverified.

## 2026-10-08 — P2 approach: pure goal/tracker, runner và live harness (static-only)

### Thay đổi

- Đọc `AGENTS.md`, `AUTO_SPEC.md` mục 3–5/10–13 và Hướng lệch A3, `ARCHITECTURE.md`, hai mục session mới nhất và checklist `FIX_GUIDE.md` trước khi sửa.
- Thêm `packages/automation-engine/src/auto/approach.ts`: `computeApproachGoal` deterministic với 16 điểm vòng, snap walkable bán kính 4 tile, `pathLength` tùy chọn và `ApproachTracker` với timeout 8 giây, replan 400 ms/24 px, target lost và unreachable hai lần.
- Thêm `apps/server/src/orchestrator/approach-runner.ts`: runner 100 ms có dependency injection, lock một lần/account, vitals/context/connection/downed guard, abort khi hurt/HP giảm và hủy move-to trước replan/kết thúc. Không nối training, attack hoặc skill.
- Thêm `apps/server/src/debug/approach-probe.ts` và wiring sau `welcome`: mặc định tắt, chỉ `TUTIEN_PROBE_APPROACH=1`, one-shot theo process sau 20 giây, lọc mục tiêu an toàn và đứng yên 3 giây sau arrived.
- Mở rộng packet tap bằng record approach đã redact; không thêm packet game, route API, nút UI hay sửa vendor.
- Thêm `docs/LIVE_SCENARIO_APPROACH.md` và cập nhật `AUTO_SPEC.md`, `ARCHITECTURE.md`, checklist này.

### Lệnh đã chạy và kết quả thật

- `pnpm build`: **bị chặn**, `pnpm` không có trong PATH.
- `corepack pnpm --offline build`: **bị chặn**, Corepack cố resolve pnpm từ registry và gặp EACCES mạng; không coi build là pass.
- `node node_modules/typescript/bin/tsc --noEmit -p ...` cho core/automation/server: **bị chặn**, TypeScript dưới `node_modules/.pnpm` gặp EPERM.
- `node --experimental-strip-types --test packages/automation-engine/src/auto/approach.test.mjs`: **pass**, goal/tracker và 62 điểm sinh của `thanh_truc_lam`.
- Chưa chạy server, chưa đăng nhập, chưa dùng mạng game, chưa gửi packet và chưa tạo live evidence.

### Còn chờ xác minh / rủi ro

- Test TypeScript của runner/probe và full build cần chạy lại ở môi trường có toolchain không bị EPERM.
- Live P2 chưa xác minh thời gian tới tầm, `hurt`, quái đuổi/leash và độ ổn định đứng yên trong tầm.
- Vẫn có rủi ro quái `aggro` gây sát thương khi approach; người vận hành phải dừng ngay khi có `hurt`.

## 2026-10-08 — Nghiệm thu của Claude Code sau các đợt Codex, và việc ngoài Codex

Mục này đính chính các mục "build/test bị chặn" bên dưới: sandbox của Codex không build được, nên mọi đợt Codex đều được Claude Code build và chạy lại ngoài sandbox.

### Kết quả nghiệm thu từng đợt Codex

| Đợt | Commit | Lỗi chỉ lộ khi build, đã sửa | Kết quả sau sửa |
|---|---|---|---|
| vitalsAgeMs + refreshVitals | `8bac730` | thiếu import `VITALS_ATTACK_MAX_AGE_MS` trong bot-controller; `exports` của core-client chỉ có điều kiện `import` nên tsx/node --test không nạp được (đã thêm `default`); mock `sendMove` trong test khóa tài khoản bị treo | build 4/4, web Vitest 9/9, test server TS pass |
| P0 dữ liệu/parser auto | `01714c4` | `optionalFinite` không phải type guard; ép kiểu `revived` | build 4/4, test core-client pass, generator sinh lại giống hệt |
| P1 chọn mục tiêu + lưới 16 map | `9116355` | `allowedWeapons` bị suy kiểu `null` nên nhánh `includes` thành `never` | build 4/4; core 11 file, automation 3 file, server TS 7 file, server .mjs 3 file đều pass |

Quy tắc rút ra: không tin "pass" của Codex khi nó báo build bị chặn; luôn chạy `pnpm build` và test lại. `tsc` vẫn xuất file khi có lỗi kiểu nên test có thể pass trong khi build fail.

### Việc Claude Code tự làm (ngoài Codex)

- **Live refreshVitals** (không bật packet tap): `200 refreshed`, 10 move, ACK sau khoảng 1075 đến 1077 ms; lần gọi thứ hai ngay sau đó `409 VITALS_REFRESH_RATE_LIMITED` (retryable). Chưa thử live: quái gần, `no_ack`, gục, training với HP cũ.
- **Lỗi dn**: server gửi `dn: 0` (số) nhưng `updateYou` chỉ nhận boolean nên `downed` không bao giờ được cập nhật từ `you`. Đã sửa (`2a40761`) và xác nhận live: sau refresh `downed=false`. Chưa thấy `downed=true` live (không cố tình làm gục).
- **Probe offset live** (4 rồi 10 move idle): một gói `you` `seq=10` sau move thứ 6 của đợt hai, trễ 91 ms; ủng hộ mô hình ACK theo seq hoặc tổng số move nhận được, bác bỏ "đếm từ đầu luồng". Chi tiết ở mục probe bên dưới.
- **Git và hạ tầng agent**: `git init` (nhánh main); `.gitignore` loại `data/`, `.env*`, `**/docs/evidence/`, dist, node_modules (mẫu `docs/evidence/` ban đầu bỏ sót `apps/server/docs/evidence/`, đã sửa); `AGENTS.md` ở gốc; commit baseline `e1ce3d7`. Quét secret trên nội dung stage: không có credential (một kết quả khớp là thư viện công khai `vendor/.../supabase.js`).
- **apps/server/.env.example**: bản cũ có `HOST=0.0.0.0` và `ENCRYPTION_SECRET` mẫu cố định; copy nguyên file sẽ làm server từ chối khởi động (bind ngoài loopback cần `API_TOKEN`). Đã đổi sang `HOST=127.0.0.1`, để trống secret.
- **Tài liệu mới**: `UI_FEATURE_INVENTORY.md` (94 lệnh `cmd` trong client, đối chiếu core-client), `AUTO_SPEC.md` (đặc tả vòng lặp Tự Động), các file `PROMPT_*.md` ghi lại prompt đã giao.

### Phát hiện về giao thức (đọc từ client, chưa kiểm chứng live)

- "Tự Động" là cờ `autoOn` phía client, server không có lệnh auto; bot phải tự sinh gói `move`/`attack`/`skill`.
- Chọn khu: `{op:"khu", act:"xem"}` và `{op:"khu", act:"chon", khu:N}`. Hồi sinh: `cmd("revive", {mode:"home"|"spot"})`. Khóa `KHU_PROTOCOL_UNAVAILABLE` và `RESPAWN_PROTOCOL_UNAVAILABLE` chưa gỡ.
- Trong gói move, `fs` là trạng thái câu cá (đi cùng `fx`/`fy`), không phải bay; bay là `fly:1`. Code `sendMove` hiện gán cứng `fly:0, fs:0`.
- Nhân vật đang mặc đồ bay Phi Diệp (ô `phi_hanh`, cảnh giới tối thiểu luyen_khi_4); chưa thử bay.

### Quy trình chạy Codex từ Claude Code

- Cài `@openai/codex` (bản 0.160.1, đăng nhập ChatGPT). Bản này không có chế độ MCP server; gọi bằng `codex exec`.
- Lệnh chuẩn: `timeout 3300 codex exec -s workspace-write -C <repo> -o <file> --json "$(cat prompt)" < /dev/null > events.jsonl 2> stderr.txt`. **Bắt buộc `< /dev/null`** và `timeout`: một lần chạy thiếu stdin đã treo hơn 7 giờ chỉ với dòng `Reading additional input from stdin...`, 0 sự kiện, không gửi gì vào game.
- Bật mạng (`-c sandbox_workspace_write.network_access=true`) chỉ khi thật sự cần; các đợt thuần mã/tĩnh chạy không mạng.
- Trước mỗi đợt: cây git sạch để diff tách bạch. Sau mỗi đợt: build, test, xem diff, rồi mới commit.
- Khi viết lệnh shell chứa văn bản có dấu backtick, không đặt trong chuỗi nháy kép (shell sẽ chạy phần trong backtick như lệnh); ghi văn bản ra file trước rồi xử lý.

### Còn nợ

- Rotate token game từng nằm trong `test_ws.mjs`/`test_ping.mjs`; đặt `API_TOKEN`/`ENCRYPTION_SECRET` nếu mở ngoài localhost (việc của người dùng).
- ~~8 truy vấn A3 lệch chưa rõ hướng~~ Đã làm rõ: cả 8 là truy vấn cố ý không hợp lệ (6 đích bị chặn, 2 ngoài bản đồ), vendor hít đích còn dự án trả null; truy vấn hợp lệ không lệch; đường dự án dài hơn 3 đến 7 %. Chi tiết ở AUTO_SPEC.md.
- Các điều [Chưa biết] trong `AUTO_SPEC.md` mục 13.

## 2026-10-08 — P1 target + collision grid/spawn từ vendor (static-only)

### Thay đổi

- Đọc `AGENTS.md`, `docs/AUTO_SPEC.md` mục 3–5/10–13, session log mới nhất và `docs/PORTAL_NAVIGATION.md`; không chạy server, không đăng nhập, không dùng mạng, không sửa vendor.
- Thêm `scripts/gen-walk-grids.mjs`: VM `TileMap.load` với shim tối thiểu, sinh grid `blockedRows` + metadata cho đủ 16/16 map catalog và sinh `map-spawns.generated.ts` gồm type/count/tọa độ/wander/leash/respawn.
- Chuyển `apps/server/src/config/walk-grid.ts` thành facade giữ API cũ, nguồn dữ liệu dùng chung từ core-client. Thêm test hồi quy 6 map; 5 map khớp tuyệt đối, `dong_mach_ngam (20,14)` được vendor xác định là ô chặn do `hu_thien_cuc_lac`.
- Thêm `selectTarget`, `inMeleeReach`, `inSkillRange`; thêm `pickAutoSkill`, `SkillCooldowns` và hằng số auto sinh từ `core/config.js`. Chưa nối vào state machine.
- Thêm audit `Pathfinder.route` vendor vs `findWalkPath`: 20 truy vấn/map cho 11 map có spawn, kiểm tra presence/độ dài/rectangle `16×12`.

### Lệnh đã chạy và kết quả thật

- `node scripts/gen-walk-grids.mjs`: **pass**, 16 map, 37 dòng map/loại, 187 spawn; báo cáo 1 spawn nằm trên ô chặn (`mo_linh_thach/tm_tru`, `(22,14)`).
- `node scripts/gen-skill-defs.mjs`: **pass**, 27 DEFS/28 slot; thêm `AUTO_CONSTANTS`.
- `node --experimental-strip-types packages/automation-engine/src/auto/target-selection.test.mjs`: **pass**.
- `node --experimental-strip-types packages/automation-engine/src/auto/skill-rotation.test.mjs`: **pass**.
- `node --experimental-strip-types packages/core-client/test/walk-grids.test.mjs`: **pass**, 16 map/6 đối chiếu/187 spawn.
- `node --experimental-strip-types apps/server/src/orchestrator/walk-path.test.mjs`: **pass**, test portal/move-to cũ.
- `node --experimental-strip-types packages/core-client/test/walk-path-audit.test.mjs`: **pass**, 11 map/220 truy vấn, 0 lỗi rectangle; có mismatch presence/độ dài do khác biệt snap/compression, không sửa thuật toán.

### Còn chờ xác minh

- Chưa chạy full build và toàn bộ test server; cần chạy trong môi trường có thể mở TypeScript/node_modules. Không tuyên bố build pass.
- `pnpm build`: **bị chặn**, `pnpm` không có trong PATH. `corepack pnpm --offline build`: **bị chặn**, Corepack vẫn cố resolve `pnpm` từ registry và gặp `EACCES` mạng. `node node_modules/typescript/bin/tsc --noEmit -p` cho core-client/automation-engine/server: **bị chặn** bởi `EPERM` khi mở TypeScript dưới `node_modules/.pnpm`.
- `npx --no-install tsx --test ...`: **bị chặn**, `tsx` không được nhận diện; test TypeScript server trực tiếp bằng Node cũng dừng ở `.js` source remapping (`ERR_MODULE_NOT_FOUND`).
- Spawn/respawn/leash thực tế, prop ẩn theo trạng thái runtime, cooldown server và các mismatch route cần đo live trước P2/P3/P4.

## 2026-10-08 — P0 lớp dữ liệu/parser auto từ vendor (build/test TypeScript bị chặn)

### Thay đổi

- Đọc tĩnh `AGENTS.md`, `docs/AUTO_SPEC.md` (mục 7, 10, 12, 13), `docs/UI_FEATURE_INVENTORY.md`, mục mới nhất của session log và checklist `FIX_GUIDE`; không chạy server, không đăng nhập, không gửi packet, không sửa vendor.
- Thêm `scripts/gen-enemy-defs.mjs`: nạp `core/config.js` và `entities/enemy.js` bằng `node:vm` với shim tối thiểu, sinh `packages/core-client/src/state/enemy-defs.generated.ts` gồm 62 loại; kiểm tra chéo một quái thường, một boss và một `human`.
- Thêm `scripts/gen-skill-defs.mjs`: nạp `core/config.js`, `systems/items.js`, `systems/skills.js`, sinh 27 `DEFS` + 28 slot (gồm Thunder), kiểm tra mọi `book` có trong `ITEMS` và kiểm tra chéo ba kỹ năng.
- Thêm `auto-data.ts` với `deriveLearnedSkills(save)`: chỉ kết luận book-known từ `state.save.bag`, giữ thứ tự `SLOTS`, không nối vào `GameStateStore` và không suy đoán `lockReason`/preference.
- Thêm kiểu và parser thuần trong `types.ts`/`state/combat-packets.ts` cho `kill`, `skill_res`, `down`, `hurt`, `act`, `loot`, `loot_gone`, `join`, `leave`, `bosses`, `revived`; thêm fixture tổng hợp và test node.
- Cập nhật `docs/AUTO_SPEC.md` mục 7.4/7.5/10/12/13 và hai phụ lục P0; sửa mô tả tầm chọn mục tiêu để không khẳng định `bodyRadius` được cộng vào `Player.reach`. Cập nhật checklist cuối `docs/FIX_GUIDE.md`.

### Lệnh đã chạy và kết quả thật

- `node scripts/gen-enemy-defs.mjs`: **pass**, sinh 62 loại và cross-check `sau_truc`, `linh_ho_tran_son`, `tieu_phu`.
- `node scripts/gen-skill-defs.mjs`: **pass**, sinh 27 `DEFS`/28 slot và cross-check `hoa_cau`, `xich_chan`, `loi_chuong`; mọi sách đều tồn tại trong bảng item vendor.
- `node --check` trên hai generator, fixture và test `.mjs`: **pass**.
- `node --experimental-strip-types --check` trên `types.ts`, `auto-data.ts`, `combat-packets.ts` và hai file generated: **pass**; đây chỉ là kiểm tra cú pháp, không thay thế type-check/build.
- `node .../typescript/bin/tsc --noEmit -p packages/core-client` và `node .../typescript/lib/tsc.js --noEmit -p packages/core-client`: **bị chặn** với `EPERM` khi mở TypeScript bên dưới `node_modules/.pnpm`.
- `corepack pnpm` trước đó: **bị chặn** vì Corepack cố resolve package manager từ registry và gặp `EACCES`; không dùng mạng để tiếp tục.
- `node --test packages/core-client/test/auto-data.test.mjs`: **fail do môi trường** với `ERR_MODULE_NOT_FOUND` vì test nhập `packages/core-client/dist/state/auto-data.js` nhưng core-client chưa thể build trong sandbox; không phải kết quả pass/fail của các assertion source.

### Còn chờ xác minh

- Cần chạy `pnpm build`/test core-client trong môi trường có thể đọc TypeScript và rebuild `dist`; hiện chưa có bằng chứng compile runtime cho parser mới.
- Chưa có raw packet combat trong evidence: fixture chỉ là dữ liệu tổng hợp theo mã client; miền giá trị server, biến thể `act`, nguồn thực của `hurt.byId`, thứ tự `kill`/loot và payload trường phụ vẫn cần đo live ở P1–P3.
- `deriveLearnedSkills` chưa thay thế `Skills.known`: `lockReason`, preference `pntt.thanhChieu.v1` và việc server có đưa preference vào `state.save` vẫn chưa xác minh.

## 2026-10-08 — Triển khai vitalsAgeMs và refreshVitals (build/test sandbox bị chặn)

### Thay đổi

- Backend thêm `vitalsAgeMs` chỉ khi `VitalSnapshot.status === "fresh"`, có policy chung `VITALS_DISPLAY_STALE_MS=5_000`, `VITALS_ATTACK_MAX_AGE_MS=30_000`, `VITALS_REFRESH_MIN_INTERVAL_MS=30_000`; các ngưỡng này là đề xuất, chưa xác minh live.
- Tách `apps/server/src/orchestrator/vitals-refresh.ts`: tối đa 10 move `idle`, nhịp 100ms, listener `you` đăng ký trước khi gửi, chờ ACK cuối tối đa 1500ms, không retry `no_ack`, khóa và rate-limit theo account. Guard dùng chung với stationary probe; mode `1`/`offset` không đổi.
- Nối `POST /api/accounts/:id/vitals/refresh` sau middleware `requireAuth`, error envelope/409 mapping, web merge + `resolveVitalsAge`, AccountCard hiển thị tuổi và nút `Làm mới HP`.
- OperationLedger có `hasPendingCombat`; training giữ pha `TRAINING`, chỉ chặn attack bằng `VITALS_UNKNOWN`/`VITALS_STALE`, hook refresh tối đa một lần mỗi 30 giây.
- Thêm test fixture cho refresh guards/lock/rate-limit/listener/ACK, API error mapping, web age/merge và training stale. Không đọc `data/`/`.env`, không chạy server, không login hoặc gửi packet live.
- Rà soát source sau đó sửa freshness guard còn sót trong `BotController`, fail-closed lỗi refresh thành `no_ack`, và không render thanh HP/MP có độ rộng `0` khi tỉ lệ chưa biết.

### Lệnh đã chạy và kết quả thật

- `corepack pnpm --version`: **bị chặn**; Corepack cố truy cập registry và gặp `EACCES` mạng.
- `corepack pnpm --offline build`: **bị chặn cùng nguyên nhân**; Corepack vẫn cố resolve pnpm từ registry và gặp `EACCES`.
- `node node_modules/typescript/bin/tsc -p packages/core-client/tsconfig.json`: **bị chặn** với `EPERM` khi mở TypeScript trong `.pnpm`.
- `node node_modules/vitest/vitest.mjs run src/lib/context.test.ts src/hooks/useRealtime.test.ts` (tại `apps/web`): **bị chặn** với `EPERM` khi mở Vitest trong `.pnpm`.
- `node --experimental-strip-types apps/server/src/orchestrator/vitals-refresh.test.ts`: **bị chặn** với `EPERM` khi mở `ws` trong `.pnpm`.
- `node --experimental-strip-types apps/server/src/api/vitals-refresh.contract.test.ts`: **chưa chạy được** vì source test import `routes.js` nhưng dist/server chưa được build (`ERR_MODULE_NOT_FOUND`).
- `node --experimental-strip-types packages/automation-engine/src/training/state-machine.test.mjs`: **fail** vì test nạp `dist` cũ chưa rebuild, nhận `VITALS_UNKNOWN` thay vì assertion mới `VITALS_STALE`; không dùng kết quả này để tuyên bố source test pass.
- `node --experimental-strip-types --check` trên các file TypeScript nguồn/test đã sửa: **pass**; Node không hỗ trợ kiểm tra trực tiếp `.tsx` bằng cờ này (`ERR_UNKNOWN_FILE_EXTENSION`), nên vẫn cần build web thật.

### Còn chờ xác minh

- Full `pnpm build` và test liên quan chưa chạy được trong sandbox; source/dist cần build lại trước khi đánh giá pass.
- Chưa xác minh live: refresh đứng yên không quái nhận `you` và cập nhật HP/MP; rate limit; khóa khi có move-to/navigation/attack; mặc định quái trong 300 bị skip; `no_ack` không retry; training refresh thành công và blocker stale.
- Chưa xác minh live ý nghĩa số move tối thiểu để server phát `you` trong mọi seq/st/quái/map; thiết kế vẫn giữ tối đa 10 theo probe đã có và không khẳng định protocol mạnh hơn evidence.

## 2026-10-08 — Kết quả live probe offset (4 + 10 move đứng yên)

Chạy bởi Claude Code sau khi Codex sửa harness (Codex không chạy được build/live trong sandbox). Build 4/4 package pass; test harness và packet tap pass. Evidence redacted: `docs/evidence/packet-tap-2026-10-07T23-14-12-695Z.json` (thư mục evidence không nằm trong git).

| Quan sát | Giá trị |
|---|---|
| Đợt `offset-0` | 4 move `idle`, seq 1..4, tại (246,695); 0 gói `you`, 0 gói `you` trong 3 giây nghỉ |
| Đợt `offset-1` | 10 move `idle`, seq 5..14, cùng tọa độ |
| Gói `you` | đúng 1 gói, `seq=10`, tại 24777ms; move seq 10 gửi lúc 24686ms, trễ 91ms |
| Thời điểm `you` | sau move thứ 6 của đợt `offset-1`, 0.63 giây kể từ move đầu của đợt đó |
| Nội dung `you` | hp 225, mp 188, sp 78, bp 115, dn 0, fix 0; vị trí không đổi |

| Mô hình | Kết luận | Lý do |
|---|---|---|
| M1: server dựa vào seq (bội số 10) hoặc đếm tổng số move nhận được | **Ủng hộ** | `you` mang đúng `seq=10`, sau 6 move của đợt thứ hai |
| M2: đếm 10 move kể từ đầu luồng sau khoảng nghỉ | **Bác bỏ** | Sẽ cho `you` ở seq 14; thực tế `you` đến ở seq 10 và không có `you` nào sau seq 14 |
| M3: theo thời gian ~1 giây kể từ đầu luồng | **Bác bỏ (có lưu ý)** | `you` đến sau 0.63 giây, không phải ~1 giây; nhưng chỉ có một mẫu |

Chưa phân biệt được: "seq do client gửi % 10" và "tổng số move server đã nhận % 10" (cần gửi seq lệch, nên không thử). Một mẫu duy nhất, tiến trình mới khởi động, seq bắt đầu từ 1.

Hệ quả thiết kế `refreshVitals()`: gửi tối đa 10 move `idle` liên tiếp (khoảng 1 giây) tại tọa độ hiện tại sẽ chắc chắn đi qua một bội số của 10 nếu M1 đúng. Điều kiện an toàn vẫn như harness: không gục, không có quái trong 300 đơn vị, không move-to/điều hướng, context hiện hành, giới hạn tần suất (đề xuất khoảng 30 giây).

Trạng thái sau khi chạy: bot đã dừng bằng `POST /accounts/:id/stop`, server đã dừng, cổng 4000 giải phóng.

## 2026-10-08 — Mở rộng stationary probe offset (live chưa xác minh)

### Thay đổi

- Mở rộng `apps/server/src/debug/stationary-probe.ts` với mode `TUTIEN_PROBE_STATIONARY=offset`; mode mới gửi đúng hai đợt `4 + 10` move `idle`, cùng tọa độ/dir, nhịp 100ms, giữ guard và thời gian chờ 20 giây sau `IN_GAME` như harness cũ.
- Mode cũ `TUTIEN_PROBE_STATIONARY=1` giữ luồng A/B `10 idle + 10 walk` và short-circuit cũ; giá trị env khác `1`/`offset` tắt harness.
- Packet tap giữ dữ liệu redacted; đợt mới dùng nhãn `offset-0`/`offset-1`, ghi seq đầu/cuối, vị trí trước/sau, `you` với `seq/hp/mp/sp/bp/dn/fix/at/delayMs`, và thêm `youDuringPostMoveWait` để nhận biết `you` trong 3 giây nghỉ sau đợt 0.
- Test harness bao phủ 14 move, đúng hai đợt, guard hủy giữa chừng, env lạ tắt, env `1` giữ hành vi cũ; packet-tap test bao phủ trường nghỉ mới và redaction.

### Lệnh và kết quả thật

- `corepack pnpm build`: **bị chặn**; Corepack ban đầu không tạo được cache mặc định (`EPERM`), sau khi chuyển cache vào workspace thì script root gọi `pnpm` con không có trong PATH.
- `corepack pnpm --filter "@tutien2d/*" build`: **fail** tại `typescript@5.9.3/bin/tsc` trong `.pnpm` với `EPERM`.
- `corepack pnpm install --offline --frozen-lockfile` và thử store riêng: **bị chặn** với `ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK` / Access denied.
- Test source harness bằng Node 24 type-transform: **pass** (`server stationary-probe tests passed`). Packet-tap source test bằng Node 24 transform-types: **pass** (`core-client packet tap tests passed`).
- `node --test apps/server/src/debug/stationary-probe.test.mjs` và `node --test packages/core-client/test/packet-tap.test.mjs`: **chưa pass** vì `dist` chưa rebuild; lần lượt dùng artifact cũ nên mode offset không được nhận và trường `youDuringPostMoveWait` chưa có.
- Chưa restart server, chưa đăng nhập game, chưa gửi move thật và chưa tạo evidence mới vì build không pass. Kiểm tra port 4000 không có listener trong lần kiểm tra này.

### Còn chờ xác minh

- Live probe `offset` với đúng một phiên game và `TUTIEN_PACKET_TAP=90` chưa chạy; `S`, `T`, `N`, seq đầu/cuối, HP/MP, `dn/fix`, vị trí trước/sau và việc có `you` trong khoảng nghỉ đều **chưa xác minh**.
- Không có evidence mới được tạo; không suy đoán kết luận M1/M2/M3 từ các lần probe trước.
- Thiết kế `refreshVitals()` chưa đổi trong nhiệm vụ này. Cần giữ nó phụ thuộc vào `you` authoritative, không phụ thuộc giả định server theo seq hay theo thời gian; số move tối thiểu bảo đảm `you` theo mô hình thực tế vẫn **chưa xác minh**.

## 2026-10-07 — Stationary move probe: `you` sau 10 move đứng yên

### Thay đổi

- Thêm harness debug một lần tại `apps/server/src/debug/stationary-probe.ts`, tắt mặc định và chỉ schedule khi `TUTIEN_PROBE_STATIONARY=1` và account vào `IN_GAME`. Harness chờ 20 giây, kiểm tra `downed`, quái gần, move-to, navigation, context và vị trí; nếu không an toàn thì ghi lý do và không gửi move.
- Đợt A gửi tối đa 10 move qua `TuTienClient.sendMove`, cùng kênh và callback `shouldSend` của move thường, nhịp 100ms, tọa độ làm tròn, `dir` hiện tại, `st: idle`. Đợt B `st: walk` chỉ chạy sau 15 giây nếu A không có `you`; live run không cần B.
- Packet tap lọc key cấu trúc `selfId`; không ghi token, tên, giá trị ID hay raw packet. Test tap kiểm tra batch, `st`, seq span, `you` và redaction.

### Đối chiếu protocol

- `vendor/tutien2d-public-client/2026-10-06/src/net/gateway.js` gửi `st:o.state`.
- `vendor/tutien2d-public-client/2026-10-06/src/entities/player.js` khởi tạo `state:"idle"` và trả về `idle` khi không có vector di chuyển. Đây là căn cứ để dùng `idle`, không phải giả định chưa xác minh.

### Lệnh và kết quả thật

- Live server dùng `TUTIEN_PACKET_TAP=90`, `TUTIEN_PROBE_STATIONARY=1`, một account duy nhất, không MiniMap, attack hay skill. Đã dùng route start/stop có sẵn; sau khi tap flush đã stop server, port `4000` không còn listen.
- Evidence redacted: [`docs/evidence/packet-tap-2026-10-07T15-34-28-827Z.json`](evidence/packet-tap-2026-10-07T15-34-28-827Z.json). Tap `durationMs=90021`, `outboundMoves=10`, `youPackets=1`, không có cancellation.
- Đợt A: `seqStart=1`, `seqEnd=10`, `st=idle`, tọa độ gửi `(246,695)`, `atStart=21344`, `atEnd=25312`; `you` duy nhất `seq=10` lúc `at=22414`, HP/MP/SP/BP `225/188/78/115`, `dn=0`, `fix=0`, delay `106ms` so với move gần nhất. Vì A đã có `you`, B không chạy.
- Vị trí runtime trước/sau A đều `(246,695)`, delta `0`; HP/MP `225/188` trùng `derivedMax` đã biết cho `luyen_khi_8`; không suy luận nguyên nhân.
- Test pass: stationary harness (guard, env off, one-shot/20 move bound/A short-circuit), packet tap, các JS test core không chạm `ws`, automation state-machine và server `.mjs` tests.
- Full workspace build/test chưa pass trong môi trường này: `pnpm` không có trên PATH; Corepack build bị script con `pnpm` không tìm thấy; TypeScript full server thiếu symlink `express`/kiểu; các test cần `ws`/`vitest` bị sandbox từ chối `EPERM`. Không ghi các ca này là pass.

### Kết luận probe

| Giả thuyết | Kết luận | Bằng chứng redacted |
|---|---|---|
| H1. `you` mỗi bội số seq 10, không cần dịch chuyển | **XÁC NHẬN** cho run này | A `seq 1..10`, `st=idle`, đúng 1 `you seq=10`; khoảng 1.07s từ đầu đợt, delay 106ms sau move cuối |
| H2. `st` idle/walk có ảnh hưởng | **CHƯA XÁC MINH** | A đã có `you` nên B `st=walk` không được chạy theo thiết kế |
| H3. `you` không đổi vị trí | **XÁC NHẬN** cho run này | `fix=0`, `dn=0`, `(246,695)` → `(246,695)`, delta 0 |

### Đề xuất thiết kế, chưa code

- Thêm `vitalsAgeMs` ở runtime, tính từ `vitals.observedAt`; khi chưa có authoritative snapshot thì để `null`, không thay bằng 0.
- Khi đánh quái đứng yên, đề xuất TTL HP nghiêm 5 giây; `hurt` là nguồn cập nhật duy nhất trong khoảng đó. Quá TTL thì gate attack/skill phải chặn và hiển thị stale, không suy ra HP.
- Nếu có thêm evidence xác nhận H1, thiết kế `refreshVitals()` dùng batch 10 move `idle`, chỉ khi không có quái trong 300, không attack/skill, không move-to/navigation, context/vị trí fresh, và rate-limit ví dụ 30 giây.

### Việc người dùng phải làm tay và rủi ro còn lại

- Nếu lặp lại: restart server với hai env trên, start đúng một account, không bấm MiniMap/attack/skill, chờ file tap flush rồi stop server.
- H2 `walk` chưa xác minh; một run A thành công không chứng minh mọi map, epoch, phiên bản server hay account khác. Move đứng yên vẫn là side effect có giới hạn và có thể bị server thay đổi quy tắc.

## 2026-10-07 — Training gate probe: gate mềm và `you` sau move thật

### Thay đổi

- `moveToTrainingArea` dùng `moveVitalErrorForEntry`: vitals unknown hoặc
  `downed=null` vẫn được di chuyển; chỉ `downed=true` hoặc HP 0 fresh từ nguồn
  `you`/`hurt` mới trả `character_down`.
- Training state machine vẫn giữ gate nghiêm cho tấn công: khi chưa có HP
  authoritative thì có thể phát `MOVE_TO_AREA`, nhưng không phát `ATTACK` và
  trả blocker `VITALS_UNKNOWN`. HP 0 từ `state` không đủ để kết luận gục.
- Packet tap được mở rộng thêm `outboundMoves`, chỉ ghi sau `sendRaw` thành công:
  `seq`, `x`, `y` đã làm tròn, `at` tương đối và `ep`; không ghi packet thô,
  token, selfId, tên nhân vật hay ID người chơi.

### Lệnh và kết quả thật

- `pnpm build`: pass cả 4 package.
- `pnpm --filter @tutien2d/web test`: 6/6 pass.
- Bộ test JavaScript core/automation/server: pass; test TypeScript server: 5/5
  pass. Test mới bao phủ gate di chuyển mềm, gate nghiêm tấn công và redaction
  outbound move.
- Live command dùng server foreground với
  `$env:TUTIEN_PACKET_TAP='150'`, `$env:TUTIEN_PACKET_TAP_DIR='docs/evidence'`
  rồi `node apps/server/dist/index.js`; sau đó dùng các route sẵn có
  `POST /api/accounts/:id/start` và
  `POST /api/accounts/:id/navigation/move-to`. Target được chọn bằng
  `findWalkPath`/`isWalkSegmentClear` từ walk-grid đã build, không tự viết game
  packet.
- Có một lần setup live ban đầu bị process server cũ giữ port `4000`; hai
  request move khi đó `arrived` nhưng không có tap file mới, nên không dùng làm
  bằng chứng. Sau đó đã dừng đúng process workspace, chạy server foreground
  với `TUTIEN_PACKET_TAP=150` trong cùng shell và thực hiện lại một probe sạch.
- Probe sạch dùng đúng một account, không attack/skill, không quái trong bán
  kính 300 và `downed` không phải `true`. Sau 20 giây idle, walk-grid/A* chọn
  điểm `(272,720)` cách vị trí đầu `(241,691)` `42.45px`; hai move high-level
  duy nhất là đi tới điểm này rồi quay lại điểm đầu. Cả hai request trả `202`
  `running` và kết thúc `arrived` sau 8 giây quan sát.
- Evidence redacted mới:
  [`docs/evidence/packet-tap-2026-10-07T14-59-31-958Z.json`](evidence/packet-tap-2026-10-07T14-59-31-958Z.json),
  `durationMs=150090`, `outboundMoves=90`, `youPackets=9`. Chín gói `you` có
  seq `10,20,30,40,50,60,70,80,90`, đều khớp move outbound gần nhất; độ trễ
  `98–113ms`; mọi gói có `hp=225`, `mp=188`, `dn=0`, `fix=0`, `sp=78`,
  `bp=115`. Không có `hurt`/`revived`; tap không chứa token/password/refresh
  token/selfId value.
- Runtime sau probe: `vitals.status=fresh`, `vitals.source=you`,
  `hp=225`, `mp=188`, `derivedMax=225/188 complete`, không có quái gần. Server
  đã dừng, port `4000` free.

### Kết luận và phần còn chờ

- Gate training: **xong**; unknown chỉ chặn combat, không chặn movement.
- Điểm A sau move có dịch chuyển thật: **xác nhận**. `you` là ACK/đồng bộ gắn
  với move khi có dịch chuyển; seq khớp và latency quan sát được `98–113ms`.
  Probe này chỉ chứng minh với quãng đường `42.45px`; chưa suy ra ngưỡng tối
  thiểu kích `you`.
- Cách chủ động đáng tin để lấy HP đã được kiểm chứng trong phạm vi này là một
  move ngắn có dịch chuyển thật qua cơ chế move-to; move về đúng tọa độ khi
  đứng yên của capture 120 giây trước vẫn **bác bỏ** cho trường hợp đứng yên.
- Hiệu ứng làm đổi `hpMax` theo thời gian: **chưa xác minh**; probe không dùng
  vật phẩm, không đổi trang bị, không vào chiến đấu và không có `hurt`/`revived`.

## 2026-10-07 — HP fix: downed gate, save fallback, derived maxima và live move

### Thay đổi

- BƯỚC 1: giữ `downed: boolean | null` xuyên core/runtime/web; reset ở
  `welcome` và đổi map/khu; `you.dn`, `down`, `revived` là nguồn cập nhật duy
  nhất. Move-to cho phép vitals chưa biết hoặc `downed=null`; chỉ chặn
  `character_down` khi có tín hiệu gục đáng tin (`downed=true` hoặc HP 0 từ
  `you`/`hurt`). Training/attack vẫn giữ gate nghiêm và trả
  `vitals_unknown`/`character_down` đúng nghĩa.
- BƯỚC 2: worker đọc realm từ `packet.realm` hoặc `packet.save.realm` với
  top-level thắng; core đọc equipment từ `state.save.equipment` khi không có
  top-level hợp lệ. Live runtime đã có `dataStatus.realm=true`.
- BƯỚC 4: sinh bảng realm/item từ vendor bằng
  `node scripts/gen-derived-vitals.mjs`; thêm `deriveMaxima`, `derivedMax`
  tách khỏi `VitalSnapshot`, cảnh báo một lần khi HP/MP quan sát vượt max suy ra,
  UI và automation chỉ dùng tỷ lệ khi `derivedMax.complete=true`.
- Thêm Vitest cho web theo mục A.8 và test gate/realm/derived maxima.

### Lệnh và kết quả thật

- `node scripts/gen-derived-vitals.mjs`: pass, đọc 16 realm và 235 item từ
  `vendor/tutien2d-public-client/2026-10-06/src`; bảng Luyện Khí 8 là HP 225,
  MP 188.
- `pnpm --filter @tutien2d/web add -D vitest`: pass; `pnpm --filter
  @tutien2d/web test`: 1 file, 6 test pass.
- Bộ test JavaScript core/automation/server: 26 test pass; 5 test TypeScript
  server (contract, realm, gate): pass.
- `pnpm build`: pass cả 4 package.
- Live chạy server với `TUTIEN_PACKET_TAP=120`, đúng một account đã lưu. Sau
  login: `dataStatus.realm=true`, realm `luyen_khi_8`,
  `derivedMax={maxHp:225,maxMp:188,complete:true}`, vitals `unknown`, downed
  `null`.
- Chờ yên 20 giây, gửi đúng một move-to về tọa độ hiện tại. Request trả `202`
  với trạng thái `running`, sau 5 giây kết thúc `arrived`; không retry.
  Runtime vẫn `vitals.status=unknown`, `vitals.source=null`, không có `you`.
- Evidence redacted mới:
  [`docs/evidence/packet-tap-2026-10-07T14-28-11-588Z.json`](evidence/packet-tap-2026-10-07T14-28-11-588Z.json),
  `durationMs=120102`, `youPackets=[]`, `ops.you=0`, `ops.hurt=0`,
  `ops.revived=0`, không có raw packet. Login trong capture là
  `welcome@874ms → map@932ms → state@935ms → snap2@948ms`; realm và equipment
  vẫn nằm ở `state.save`.

### Kết luận và phần còn chờ

- BƯỚC 1, 2, 4: **xong**, đã build/test; live xác nhận realm và derived max.
- BƯỚC 3: **xong với kết luận bác bỏ giả thuyết** “move về đúng tọa độ khi
  đứng yên chủ động trả `you` để lấy HP”: move đã `arrived` nhưng 120 giây
  không có `you`. Không đo được seq/độ trễ/hp/mp/dn vì gói không đến.
- Hiệu ứng buff/thức ăn/trận pháp làm đổi max theo thời gian: **chưa xác minh**;
  live không có `you`/`hurt`/`revived` và không được chủ động dùng hiệu ứng.
- Server đã dừng sau capture; không còn listener ở port `4000`.

## 2026-10-07 — Live packet tap xác minh nguồn HP/MP

### Thay đổi trong phiên

- Chỉ sửa `packages/core-client/src/debug/packet-tap.ts`: tap giữ chế độ opt-in
  qua `TUTIEN_PACKET_TAP`, ghi tập key cấp op, 30 packet đầu theo thời điểm tương
  đối, metadata `state/save/equipment/realm`, các trường số allowlist và packet
  `you`; không ghi packet thô, token, selfId, tên nhân vật hoặc ID người chơi.
- Bổ sung đọc equipment nằm trong `state.save.equipment` (không chỉ
  `state.equipment`). Không sửa vitals, state machine, gate move-to, worker hay
  reducer nghiệp vụ.
- Evidence redacted mới:
  [`docs/evidence/packet-tap-2026-10-07T13-58-34-898Z.json`](evidence/packet-tap-2026-10-07T13-58-34-898Z.json).

### Lệnh và kết quả thật

- `pnpm --filter @tutien2d/core-client build`: pass sau khi chạy ngoài sandbox;
  lần chạy trong sandbox gặp `EPERM` khi runtime TypeScript đọc `node_modules`.
- `node --test packages/core-client/test/packet-tap.test.mjs`: pass.
- `pnpm build`: pass cả 4 package.
- Bộ 10 file test JavaScript hiện có của core/automation/server: pass (15 test
  cases). Lần chạy trong sandbox bị `EPERM` khi đọc module `ws`, chạy lại ngoài
  sandbox đã pass. `pnpm --filter @tutien2d/web exec vitest run` chưa chạy được vì
  workspace web không có executable `vitest`.
- Chạy server bằng `TUTIEN_PACKET_TAP=120` và thư mục evidence đã chỉ định; dùng
  đúng một account đã lưu. Runtime đạt `IN_GAME` và
  `mapContextIsCurrent=true`.
- Giữ yên 20 giây: connection vẫn `IN_GAME`, vitals vẫn `unknown`, tọa độ không
  đổi. Sau đó gửi đúng một request qua route move-to có sẵn, về đúng tọa độ hiện
  tại; server trả `409 character_not_alive`, tức bị chặn trước khi transmit move
  packet. Chờ thêm 5 giây không có `you`; không retry.
- Tap chạy đủ `durationMs=120006`. Trình tự packet đầu quan sát được:
  `welcome@778ms → map@831ms → state@836ms → snap2@845ms`; giữa các mốc có
  `status`, `bosses`, `formation`, `hon`, `khoiloi` và các packet khác.
- `state` có key cấp trên `op, reason, save`, không có `state.realm`.
  Realm nằm chính xác ở `state.save.realm=luyen_khi_8`. Equipment cũng nằm trong
  `state.save.equipment`: `ao=bach_y`, `giap=null`, `giay=null`, `mu=null`,
  `nhan=null`, `phap_boi=truc_diep_boi`, `phi_hanh=phi_diep`,
  `vu_khi=thiet_kiem`.
- Runtime sau capture xác nhận `dataStatus.realm=false`, `runtime.realm` rỗng.
  Đây là hành vi khớp code hiện tại: listener `state` của worker chỉ bật cờ khi
  `packet.realm` cấp trên là chuỗi; nó không xét `packet.save.realm`. Vì vậy
  `save.realm` có thật nhưng chưa được phản ánh vào cờ dataStatus.
- Evidence có `youPackets=[]`, không có `hurt` hoặc `revived`. Do move bị gate
  chặn, chưa đo được độ trễ gửi–nhận, seq khớp, hay hp/mp/dn trong `you`.
  Không có cơ hội an toàn để so sánh HP/MP trước–sau hiệu ứng; phần hpMax theo
  thời gian vẫn là **chưa xác minh**.
- Sau khi flush evidence và kiểm tra xong, đã dừng server; port `4000` không còn
  ở trạng thái listen.

### Kết luận đối chiếu giả thuyết

- A — **chưa xác minh**: không thể suy ra move đứng yên sẽ tạo `you` khi request
  còn bị `character_not_alive` chặn trước transmit. Chưa có bằng chứng để coi
  đây là cách chủ động đáng tin lấy HP.
- B — **xác nhận một phần**: thứ tự login và nguồn realm đã xác nhận; key đúng là
  `state.save.realm`, không phải `state.realm`. Equipment có các slot/ID nêu
  trên. Lý do `dataStatus.realm=false` đã xác định theo nhánh worker nói trên.
- C — **chưa xác minh**: 120 giây không có `hurt`/`revived` và không có hiệu ứng
  thụ động quan sát được, nên không có cặp giá trị để kết luận hpMax thay đổi.

## 2026-10-07 — Điều phối và nghiệm thu bộ fix FIX_GUIDE

### Đã triển khai

- Điều phối 3 sub-agent Luna mức suy luận vừa theo ba phạm vi không chồng lấn:
  frontend A/E.4, server security/API E.1–E.6 và core/automation B–D.
- Frontend sửa freshness/map context, merge theo timestamp, MiniMap click,
  geometry backoff; thêm API token qua `sessionStorage`, Bearer REST và WebSocket
  subprotocol `bearer`.
- Server mặc định bind loopback; bind public bắt buộc `API_TOKEN` tối thiểu 32
  ký tự; thêm origin/auth WS, request ID, giới hạn JSON/pagination và error envelope.
- Core/automation sửa vitals lấy từ `state.save`, thêm `selfPresence` tách khỏi
  HP authoritative, policy liveness an toàn, packet tap redacted, monster counters
  và operation ledger chống retry mù attack/skill.
- Bổ sung truyền `selfPresence` qua worker/dashboard và cập nhật checklist trong
  [`FIX_GUIDE.md`](FIX_GUIDE.md).

### Nghiệm thu

- `pnpm build`: 4/4 package pass.
- 25 test JavaScript và 3 contract test TypeScript pass.
- Public bind thiếu token bị từ chối; loopback không token vẫn hoạt động.
- Packet tap mặc định tắt; không ghi packet thô, token, ID hoặc tên nhân vật.

### Live UI smoke — 2026-10-07

- `http://127.0.0.1:3000/` render dashboard thành công; dữ liệu tài khoản/catalog
  từ REST hiển thị và trạng thái WebSocket chuyển sang `Realtime Kết Nối`.
- Mở/đóng panel API token và modal `Thêm Tài Khoản` thành công; không nhập hoặc
  gửi token/mật khẩu trong smoke test.
- `http://127.0.0.1:3001/` hiển thị UI nhưng WebSocket bị từ chối do origin mặc
  định chưa allow port `3001`; cổng chuẩn `3000` hoạt động đúng.
- Wrapper `pnpm dev` hiện lỗi môi trường cục bộ do thiếu dependency `yargs` của
  `concurrently`; live test đã chạy qua các service đang lắng nghe cổng chuẩn.

### Còn chờ xác minh live

- Chạy packet tap 90 giây để xác định nguồn HP thực tế.
- Thử map có quái để kết luận parser hay protocol không gửi monster.
- Chưa xác nhận ACK/observation cho attack/skill; không tự retry.
- Schema packet E.8 chưa bật vì protocol còn biến thể chưa capture.
- Smoke click MiniMap đã được chạy ở mục live verification 2026-10-07 bên dưới;
  chuỗi move-to thành công vẫn còn chờ vì backend chặn khi vitals chưa fresh.

## 2026-10-07 — Live verification MiniMap, vitals, monsters và reconnect

### Thay đổi trong phiên

- Restart server và build lại web; bổ sung thông báo reconnect đúng yêu cầu:
  `Kết nối realtime bị từ chối: kiểm tra API token và origin được phép.`
- Không sửa parser vitals hoặc reducer quái sau capture: giữ nguyên nguyên tắc
  chỉ sửa khi packet evidence chứng minh nguồn dữ liệu.
- Đưa bản packet tap redacted vào
  [`docs/evidence/packet-tap-2026-10-07T13-19-41-452Z.json`](evidence/packet-tap-2026-10-07T13-19-41-452Z.json).

### Lệnh và kết quả thật

- `pnpm --filter @tutien2d/web build`: pass.
- Restart `pnpm --filter @tutien2d/server dev`, start lại account đã lưu; runtime
  vào `IN_GAME`, `mapContextIsCurrent=true`, context age quan sát được 56–98 ms.
- Hard refresh dashboard tại `http://127.0.0.1:3000/`; MiniMap hiển thị trạng thái
  cho phép click. Click đầu tiên tạo POST `navigation/move-to`, nhưng server trả
  `409 character_not_alive`; `moveTo=null`, vị trí giữ nguyên vì vitals lúc đó
  còn `unknown`. Đây là backend fail-safe, không phải UI chặn request.
- Packet tap `TUTIEN_PACKET_TAP=90` ghi `durationMs=90094`, có `state` nhưng không
  có vital field trong `state.save`/gốc packet; `selfEntries=[]`; `p` và `pf` có
  `hp` nhưng evidence không chứng minh được đó là HP self, cũng không xác minh
  được phần trăm hay tuyệt đối. Sau khi reconnect ổn định, runtime thật đạt
  `vitals.status=fresh`, `vitals.source=you`; UI hiển thị HP `225 / —`, MP
  `188 / —`. Không ghi giá trị `p.hp` vào vitals.
- POST điều hướng portal tới `thanh_truc_lam` trả `202 navigation_started`; state
  kết thúc `arrived` tại `x=240,y=63`. Sau 30 giây: monsters `13 → 12`,
  `monsterRowsSeen 93 → 247`, `monsterPatchRowsSeen 570 → 1622`,
  `lastMonsterRowsAt` được cập nhật và `worldReceived +300`. Kết quả bác bỏ giả
  thuyết worker đang lọc bỏ toàn bộ quái; không sửa id số.
- Kiểm tra reconnect: code dừng sau 5 lần thất bại liên tiếp, reset ở `onopen`
  và khi đổi token; build xác nhận chuỗi cảnh báo mới.
- `pnpm build`: pass cả 4 package; 25 test JavaScript và 3 contract test
  TypeScript pass. `pnpm --filter @tutien2d/web exec vitest run` chưa chạy được vì
  workspace web không có executable Vitest/test script.

### Còn chờ xác minh

- MiniMap chưa đạt chuỗi `accepted/running → arrived|blocked|failed`: click đã
  tạo request nhưng bị chặn có lý do `character_not_alive` trước khi tạo ledger.
- Packet tap hiện không có `you` trong file 90 giây; runtime sau đó xác nhận
  source `you`, nhưng shape packet `you` và quan hệ `selfId` với `p/pf` vẫn cần
  capture riêng nếu muốn kết luận tuyệt đối.
- `selfPresence.hpPercent` vẫn chưa có vì max HP chưa xuất hiện; UI chỉ có HP
  thật và để max là `—`.
- Việc vận hành thủ công chưa thực hiện: rotate token game cũ từng nằm trong
  `test_ws.mjs`/`test_ping.mjs`; đặt `API_TOKEN` và `ENCRYPTION_SECRET` trong
  `.env` nếu mở ngoài localhost; `git init` và thêm `.gitignore` cho `.env`,
  `data/`, `node_modules/`, `apps/web/dist/`, `docs/evidence/`.

## 2026-10-06 — Chuyển map bắt buộc qua portal: triển khai và live smoke

### Phát hiện và nguyên nhân

- Direct `enter(mapId)` từ vị trí bất kỳ không bypass được game server; nhân vật
  phải đi vào ô portal của map hiện tại.
- Packet `move` của public client bắt đầu `seq=1`, gửi stream khoảng 10Hz và
  dùng `ep` của map. Bản cũ bắt đầu từ `seq=2` và đưa movement vào jitter action
  300–700ms.
- A* chỉ trên tile center chưa đủ vì nhân vật có collision rectangle; route cần
  kiểm tra `lineClear` theo rectangle 16×12 và re-plan theo server echo.

### Đã triển khai

- Thêm catalog edge portal đã xác minh, static collision grid và A* collision-aware.
- Thêm state machine `planning → moving_to_portal → waiting_map_confirmation →
  arrived/failed`, retry hữu hạn và authoritative map confirmation.
- Sửa core movement: sequence bắt đầu từ 1, chỉ tăng sau khi transmit thành công,
  làm tròn tọa độ như public client, không qua action jitter.
- API/UI trả `navigation_started`, `operationId`, route và runtime phase; không
  còn báo thành công chỉ vì raw packet đã được gửi.
- Thêm [PORTAL_NAVIGATION.md](PORTAL_NAVIGATION.md) và evidence đã redact.

### Live verification

- `tan_vien/K4 (252,883)` → portal `(7,29)` → `thanh_truc_lam/K1 (240,63)`:
  `arrived`.
- Chiều ngược `thanh_truc_lam/K1 (240,63)` → portal `(7,0)` →
  `tan_vien/K1 (240,927)`: `arrived`.
- Build và các unit checks liên quan đạt; xem
  [`docs/evidence/2026-10-06-portal-navigation-smoke.json`](evidence/2026-10-06-portal-navigation-smoke.json).

### Giới hạn còn lại

- Protocol chọn `khu` chưa được xác minh; `farmKhu` chưa thể ép server đổi khu.
- Catalog portal hiện là các edge đã kiểm chứng trong public client snapshot;
  map gated hoặc edge chưa có trong catalog sẽ trả `blocked` thay vì bypass.

## 2026-10-06 — Audit protocol và bản đồ theo dữ liệu quan sát

### Audit repo

- Audit xác nhận packet map có `mapId`, `khu`, `soKhu`, `p` và `e`; dữ liệu `state` và `status` là hai nguồn/nhóm packet riêng.
- Trước patch không có catalog map toàn cục trong server; public client snapshot có `WorldMap.LAYOUT`/`MapData` và portal metadata.
- Public game UI chỉ được dùng để xác nhận trải nghiệm bản đồ; UI công khai không tiết lộ protocol nội bộ.

### Đã cập nhật

- Core bổ sung alias HP/MP và `soKhu`; reset entity khi đổi map hoặc khu để tránh giữ người chơi/quái từ context cũ.
- Backend bổ sung catalog map public-client qua `GET /api/maps`, enrich bằng packet live; thao tác chuyển map qua `POST /api/accounts/:id/map/enter`, cùng kiểm tra freshness và context cho runtime snapshot.
- UI liệt kê 16 map có tên hiển thị, đánh dấu `Catalog`/`Đã thấy live`, cho phép chọn map và hiển thị trạng thái chờ packet xác nhận; danh sách khu chỉ để xem vì chưa có command chọn khu. Entity chỉ được hiển thị trong đúng map/khu context.
- [Claim lịch sử — đã superseded bởi audit 2026-10-06] Phân tích nguyên nhân ảnh chụp trạng thái sai từng ghi HP/MP lấy từ `status` và alias. Contract hiện hành không dùng `status` làm vitals: `status` chỉ là effect; vitals lấy từ field chuẩn của `state` hoặc các packet self `you`/`hurt`/`revived` khi thực sự xuất hiện. Giá trị mặc định, snapshot cũ và race từ context map/khu trước có thể khiến giao diện hiển thị thiếu hoặc sai dữ liệu.

### Kiểm tra

- `pnpm build`: đạt.
- Smoke test protocol: đạt.
- `GET /api/maps`: đạt, trả `source=public_client_catalog`, 16 map.
- Smoke direct-enter lịch sử: `enter(thanh_truc_lam)` trả `request_sent`; sau 4 giây chưa có packet đích, runtime vẫn `tan_vien`. Kết quả này đã được supersede bởi live portal smoke ở phần trên; direct-enter vẫn không phải contract hợp lệ.

### Giới hạn còn lại

- Chưa có command protocol để chọn khu.
- Catalog là metadata từ public client snapshot, không phải allowlist server và không chứng minh mọi map đều mở khóa.
- Live portal smoke hai chiều đã được bổ sung ở phần trên; các map/edge khác vẫn cần kiểm chứng riêng trước khi đưa vào catalog.

## 2026-10-06 — Giảm tự động hóa và xác nhận trạng thái game

### Phạm vi phiên

- Team gồm 3 nhánh Luna mức suy luận vừa, lần lượt xử lý automation/core-client, backend/runtime snapshot và giao diện.
- Mục tiêu là giảm số chức năng chạy đồng thời, hiển thị trạng thái có nguồn dữ liệu rõ ràng và để người vận hành bật Auto farm có chủ đích.

### Đã cập nhật

- Nhật ký giao diện mặc định thu gọn (collapsed); người dùng có thể mở để xem log.
- Auto farm là chức năng tự động duy nhất đang được bật hỗ trợ trong luồng chạy hiện tại, có công tắc bật/tắt. Khi chạy, bot chỉ điều hướng về map/điểm farm đã cấu hình và chỉ farm khi snapshot xác nhận đúng vị trí.
- Snapshot bản đồ và giao diện dùng dữ liệu runtime để hiển thị nhân vật, người chơi, quái và điểm farm; không tự đặt marker khi thiếu dữ liệu.
- Trạng thái cảnh giới, HP và MP có cờ `dataStatus` riêng. UI chỉ trình bày chỉ số khi dữ liệu hợp lệ, tránh hiển thị giá trị mặc định như dữ liệu thật.
- Automation legacy tạm khóa: quest ngày, quest chính, hang động, bán đồ, hồi phục và mua vật phẩm. Thao tác bán đồ/điểm danh thủ công cũng tạm khóa trong giao diện.
- Build `pnpm build` đạt sau follow-up và rà soát tích hợp.

### Giới hạn và rủi ro còn lại

- Protocol hiện chưa có lệnh chọn khu (`khu`); nếu nhân vật ở sai khu, việc chuyển khu vẫn cần thao tác ngoài automation.
- Chưa có kiểm thử end-to-end với game server thật. Snapshot, chuyển map và đồng bộ dữ liệu cần được xác nhận khi chạy với phiên game thực tế.
- Danh sách người chơi/quái chỉ có thể hiển thị khi packet tương ứng thực sự cung cấp dữ liệu; khi thiếu packet, UI phải báo chưa có dữ liệu.
- `dataStatus` cho biết packet có dữ liệu hợp lệ theo parser hiện tại, nhưng chưa chứng minh server gửi cập nhật liên tục hoặc đúng nhịp thời gian thực.
- Các automation cũ và thao tác manual đang bị khóa ở luồng giao diện/chạy bot; cần rà soát mọi API hoặc đường gọi khác trước khi khẳng định chúng bị vô hiệu hóa tuyệt đối.
- Rủi ro bảo mật đã ghi ở phiên trước, gồm xác thực/phân quyền API và WebSocket, CORS mở, cùng token hardcode trong script test, chưa được xử lý trong phiên này.

## 2026-10-06 — Tách quest, điều hướng farm và bản đồ xác nhận vị trí

### Mục tiêu

- Tách riêng lựa chọn tự động quest chính tuyến, quest ngày và bí cảnh.
- Cho phép cấu hình điểm farm và tự chuyển map/di chuyển tới điểm đó.
- Hiển thị vị trí nhân vật và điểm farm trên dashboard.
- Sửa các lỗi liên quan được phát hiện trong phiên rà soát trước.

### Đã triển khai

- Thêm `autoMainQuest`, `autoDailyQuest`, `autoCaveQuest` và giữ fallback cho `autoDaily`/`autoCave` cũ.
- Thêm `autoTravelToFarm`, `farmMapId`, `farmKhu`, `farmX`, `farmY`.
- Thêm lệnh client `enterMap()` sử dụng packet `op: "enter"`.
- Điều hướng farm có sai số 3 đơn vị và cooldown 30 giây; khác khu sẽ cảnh báo vì API hiện chưa có lệnh chọn khu.
- Dashboard hiển thị map, khu, tọa độ hiện tại, tọa độ farm và trạng thái đúng/lệch map hoặc điểm.
- Cập nhật cấu hình dạng partial bằng deep merge cho `sellRules`, `minRetain` và `delayRangeMs`.
- Sửa daily check-in: chỉ ghi nhận thành công hoặc đã điểm danh; tự nhận diện lại theo ngày.
- Sửa daily quest: chỉ complete sau khi `seed.start` và `seed.collect` thành công.
- Chống timer cũ của bot chạy tiếp sau chuỗi stop/start.
- Ghi log theo cơ chế debounce và flush database khi shutdown.
- Không phát `proxyUrl` ra public WebSocket snapshot.

### Giới hạn đã biết

- Packet hiện có `enter(mapId)` nhưng chưa có packet chọn `khu`; đổi khu vẫn cần thao tác thủ công.
- Bản đồ dashboard là bản đồ tọa độ minh họa, không phải địa hình game thật.
- Quest chính hiện chỉ thử `quest.turnIn`; chưa có state machine di chuyển, hội thoại và chiến đấu hoàn chỉnh.
- `proxyUrl` đã được loại khỏi snapshot public nhưng luồng kết nối proxy thực tế vẫn cần hoàn thiện/kiểm thử riêng.
- API/WS vẫn cần lớp xác thực và phân quyền độc lập; phiên này chưa mở rộng phạm vi sang hardening toàn hệ thống.

### Kiểm tra

- `pnpm build`: đạt.
- Kiểm tra import runtime workspace package: đạt.
- Chưa có bộ test tự động cho WebSocket/game server; cần bổ sung mock protocol cho các luồng quest và farm.
