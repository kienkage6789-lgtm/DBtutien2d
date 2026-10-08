# Bàn giao cho phiên làm việc mới

Ngày: 2026-10-08. HEAD tại thời điểm viết: `31023cb`. Cây git sạch. Đọc file này trước, rồi `AGENTS.md`, rồi mục đầu của `docs/SESSION_LOG.md` (mới nhất ở đầu file).

## 1. Dự án là gì và đang ở đâu

Nền tảng điều khiển nhiều tài khoản game TuTien2D (`wss://game.tutien2d.online/`) bằng cách nói chuyện trực tiếp với game server, kèm dashboard web. Monorepo pnpm: `apps/server` (Express + ws, DB JSON), `apps/web` (React + Vite), `packages/core-client` (client WebSocket tự viết), `packages/automation-engine`. Client chính thức nằm ở `vendor/tutien2d-public-client/2026-10-06` (chỉ đọc, đã minify).

**Hướng đi hiện tại (đã chốt):** KHÔNG viết lại logic auto. Chạy chính client chính thức không hiển thị trong Node (`node:vm`, đối tượng giả cho DOM, không vẽ) và để Auto của chính client đi/đánh/dùng kỹ năng/nhặt đồ. Server chạy ngầm mặc định trên Linux; khi người dùng muốn xem thì "nhả phiên" rồi mở trang game chính thức (phương án A, mới là kế hoạch).

**Hai engine mỗi tài khoản** (`BotConfig.engine`): `core` (mặc định, bot tự viết trên `core-client`) và `vendor` (`VendorRunner`, client chính thức không hiển thị). Mỗi tài khoản chỉ một engine, một phiên đăng nhập.

## 2. Đã xong và đã kiểm chứng (nhãn: [Live] = trên game thật)

- **Bảo mật control-plane:** bind loopback mặc định, `API_TOKEN` bắt buộc khi bind ngoài, Origin, WS subprotocol `bearer`, error envelope.
- **Vitals:** HP chỉ đến qua `you` (mỗi 10 `seq` của luồng `move`), `hurt`, `revived`; `maxHp` là giá trị suy ra từ `state.save.realm` + `state.save.equipment`; cờ gục là `you.dn` (số 0/1). `refreshVitals()` của engine core gửi tối đa 10 move `idle`. [Live]
- **Dữ liệu sinh từ vendor** (`scripts/gen-*.mjs`): bảng quái (62), kỹ năng (27 + Lôi Chưởng), lưới va chạm 16 map, điểm sinh quái, cảnh giới/vật phẩm.
- **Engine vendor** (`apps/server/src/headless/`): `vendor-env.ts`, `auto-supervisor.ts`, `vendor-runner.ts`, `engine-selection.ts`; API `POST /accounts/:id/auto/start|stop`; dashboard hiển thị trạng thái Auto. [Live] Soak 30 phút: 904 quái hạ, 0 gục, 0 lỗi, CPU khoảng 9,9% một lõi, RSS không rò rỉ (xu hướng -1,6 MB/phút).
- **Lớp an toàn của Auto** (`auto-supervisor`): nhớ map + toạ độ nơi bật Auto; chết thì hồi sinh về làng, thiền, đi qua cổng về đúng neo (cách neo khoảng 13 px), bật Auto lại; giới hạn 3 lần chết/600 s. Mới thử OFFLINE; CHƯA thử chết/hồi sinh thật.
- **Di chuyển engine core** đã sửa (`PredictedMover`, 101 px/s, hòa giải theo `you`): [Live] 300 px trong 3,2 s; bản cũ không tới sau 25 s.
- **Hành vi mạng khi đứng yên** (đọc mã): client thật chỉ gửi `move` khi trạng thái đổi; `ping` khoảng 30 s. Engine vendor khớp (khoảng 2 ping/phút).

## 3. Việc còn lại (theo thứ tự đề xuất)

1. **Soak vài giờ** qua server (`scripts/soak-vendor.cjs`): lưu NỘI DUNG `console.error` của client (soak 30 phút có 1 lỗi chưa biết nội dung), đếm `you.fix`, quan sát token hết hạn giữa phiên, kết nối lại thật, và có thể gặp chết tự nhiên để lớp an toàn quay về neo chạy thật.
2. **Đo trên Linux** (mục tiêu chạy liên tục trên server Linux), và với nhiều tài khoản song song. Snapshot runner có `memory.rss` rỗng ở dashboard (đã có `rssBytes` trong API, kiểm tra hiển thị).
3. **Bàn giao phiên sang trình duyệt** (phương án A) theo `docs/PLAN_SESSION_HANDOFF.md`: việc đầu tiên là kiểm chứng quy tắc phiên của server (kết nối thứ hai bị từ chối hay đá kết nối cũ?).
4. **Chọn khu và hồi sinh thật:** giao thức đã đọc từ client (`{op:"khu",act:"xem"|"chon",khu}`, `cmd("revive",{mode:"home"|"spot"})`) nhưng CHƯA thử live; các khóa `KHU_PROTOCOL_UNAVAILABLE`, `RESPAWN_PROTOCOL_UNAVAILABLE` của engine core vẫn giữ.
5. **Kỹ năng ưu tiên / cấu hình Auto** của engine vendor (`pref.thanhChieu`), neo khu (`khu`) chưa ghi.
6. Việc thủ công của người dùng: rotate token game cũ từng nằm trong `test_ws.mjs`/`test_ping.mjs`; đặt `API_TOKEN`/`ENCRYPTION_SECRET` nếu mở ngoài localhost.
7. Điều khoản dịch vụ của game về bot/tự động hóa: người dùng tự cân nhắc; chưa biết server có phân biệt client chạy kiểu này với trình duyệt hay không.

## 4. Cách chạy và kiểm tra

```bash
pnpm install
pnpm build                                          # BẮT BUỘC pass; tsc vẫn xuất file khi có lỗi kiểu nên test có thể pass trong khi build fail
pnpm --filter @tutien2d/web test                    # Vitest (9)
(cd apps/server && npx tsx --test src/headless/vendor-runner.test.ts)   # test TS của server: tsx; mỗi file một lệnh, có timeout
node --test packages/core-client/test/predicted-mover.test.mjs          # test .mjs của core/automation: nạp từ dist, build trước
cd apps/server && node dist/index.js                # server (cổng 4000), PHẢI chạy trong apps/server (DATA_DIR = data)
```

Script live (đều cần biến môi trường chỉ định, tự dọn dẹp): `scripts/soak-vendor.cjs` (`TUTIEN_SOAK_LIVE=1`), `scripts/measure-moveto.cjs` (`TUTIEN_MEASURE_LIVE=1`), `scripts/spike-vendor-auto-online.cjs` (`TUTIEN_SPIKE_LIVE=1`, tùy chọn `TUTIEN_SPIKE_SUPERVISE=1`). Spike offline (không mạng): `spike-vendor-auto-offline.cjs`, `spike-vendor-supervisor-offline.cjs`.

Đặt engine cho tài khoản: `PUT /api/accounts/:id/config {"engine":"vendor"|"core"}` (không đổi được khi đang chạy). Sau khi thử xong luôn trả về `core`.

## 5. Quy trình làm việc đã dùng (giữ nguyên)

- **Codex** làm phần lớn việc viết mã: `codex exec -s workspace-write -C <repo> -o <file> --json "$(cat docs/PROMPT_*.md)" < /dev/null`, bọc `timeout`. BẮT BUỘC `< /dev/null` (thiếu thì treo hàng giờ). Mỗi đợt bắt đầu từ cây git sạch; prompt lưu ở `docs/PROMPT_*.md`.
- **Sandbox của Codex không build được.** Sau mỗi đợt PHẢI tự: `pnpm build`, chạy toàn bộ test, xem diff, rồi mới commit. Sáu đợt liên tiếp Codex đều để lại lỗi chỉ lộ khi build hoặc lỗi hành vi mà test của nó không bắt được (ví dụ socket giả phát sẵn `you`, `localStorage` giả không lưu gì). Không tin "pass" của Codex.
- Commit sau khi nghiệm thu, kèm dòng `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Ghi `docs/SESSION_LOG.md` (mục mới ở ĐẦU file) sau mỗi đợt.
- Chạy live: một phiên đăng nhập mỗi tài khoản, dừng server/bot trước khi chạy spike, theo dõi `hurtCount` (server không log gói `hurt`), không in token/tên/id, luôn dọn dẹp.

## 6. Bẫy kỹ thuật đã gặp (đừng lặp lại)

- Chạy client chính thức trong vm: phải tự `Game.time += dt` mỗi khung; chạy hàng đợi `requestAnimationFrame` (`env.flushRaf()`), nếu không `SceneWorld.transitioning` kẹt; thay `Assets.ensureMap` bằng hàm trả ngay; `localStorage` giả PHẢI lưu thật (client ghi `state.save` vào đó rồi `Quest.load()` đọc lại: nếu không thì `hpMax` 100 và mất kỹ năng); lệnh bật/tắt Auto được xếp hàng (`Input._autoToggle`), không bấm khi còn lệnh chờ; Auto phải TẮT trong lúc đi về neo.
- `startAuto` không được đòi gói vitals chính thức trước khi bật (nhân vật đứng yên không nhận `you`); thay bằng mô hình HP của client và tự dừng Auto nếu quá 10 s chưa có xác nhận.
- Nhân vật bị quái tấn công ngay cả khi đứng yên (HP thật có thể thấp hơn con số client giả định đầy lúc đăng nhập).
- Shell: KHÔNG nhúng văn bản có dấu backtick trong chuỗi nháy kép của bash (bị chạy như lệnh); ghi ra file rồi xử lý. Sửa mã bằng công cụ Edit hoặc script ghi từ file, không dùng `node -e "..."` chứa backtick. Mọi lệnh test dùng `timeout`.
- `lệnh sed` chèn xuống dòng dễ làm hỏng file; dùng Edit.
- Cổng 3000 có thể đang bị một tiến trình `node.exe` khác giữ (thông báo `preview_start` lần cuối); `.claude/launch.json` chưa được cấu hình trong repo. Chưa rõ tiến trình đó là gì; hỏi người dùng trước khi dừng. Dashboard thật chạy ở cổng 4000 (bản build `apps/web/dist` do server phục vụ).

## 7. Tài liệu chính

`AGENTS.md` (hợp đồng chung) · `docs/ARCHITECTURE.md` · `docs/AUTO_SPEC.md` (mục 14 đến 15: hành vi mạng, spike vendor, supervisor) · `docs/SESSION_LOG.md` · `docs/PLAN_SESSION_HANDOFF.md` · `docs/UI_FEATURE_INVENTORY.md` · `docs/CONTROL_PLANE_API.md` · `docs/TRAINING_PROTOCOL_GAPS.md` · `docs/FIX_GUIDE.md`. Evidence packet (đã redact) ở `docs/evidence/` và `apps/server/docs/evidence/` (không nằm trong git).
