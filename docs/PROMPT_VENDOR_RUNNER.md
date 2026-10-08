Đọc AGENTS.md trước, rồi docs/AUTO_SPEC.md (mục 14 và 15, đặc biệt 15.5 đến 15.8), docs/ARCHITECTURE.md, docs/PLAN_SESSION_HANDOFF.md và docs/SESSION_LOG.md (các mục mới nhất). Repo có git, working tree sạch; KHÔNG commit, để thay đổi trong working tree.

MỤC TIÊU: tích hợp "chạy ngầm bằng client chính thức" vào apps/server
Các spike đã chứng minh (offline và online trên game thật) rằng client chính thức trong `vendor/tutien2d-public-client/2026-10-06` chạy được trong Node (`node:vm`, đối tượng giả cho DOM, không vẽ), kết nối game thật, và Auto của chính client tự đi/đánh/dùng kỹ năng/nhặt đồ. Có thêm bộ giám sát nhớ map + toạ độ nơi bật Auto, chết thì hồi sinh, hồi phục, đi về đúng chỗ rồi tiếp tục. Việc của bạn: biến các spike (script) thành module chính thức của server, có test, nối vào worker-pool, API và dashboard.

MÃ THAM CHIẾU (đọc kỹ, đây là hành vi đã được kiểm chứng; đừng chép nguyên cấu trúc script mà hãy viết lại thành module TypeScript sạch)
- scripts/lib/vendor-env.cjs: dựng môi trường giả, nạp 241 script theo thứ tự index.html, `flushRaf`, đồng hồ giả tùy chọn.
- scripts/lib/auto-supervisor.cjs: bộ giám sát (pha farming, down_wait, reviving, recovering, traveling, resuming, halted).
- scripts/spike-vendor-auto-online.cjs: kết nối thật + vòng lặp thời gian thật + lớp an toàn + đếm gói.
- scripts/spike-vendor-supervisor-offline.cjs, scripts/spike-vendor-scene-offline.cjs, scripts/spike-vendor-auto-offline.cjs: bài thử offline.

NHỮNG BẪY ĐÃ GẶP (bắt buộc xử lý đúng, mỗi cái cần test)
1. `Game.time` do vòng lặp chính của Game cập nhật; ta bỏ qua vòng đó nên PHẢI tự `Game.time += dt` mỗi khung, nếu không Auto đứng yên mãi.
2. Hàng đợi `requestAnimationFrame` của môi trường giả phải được chạy mỗi khung (`flushRaf`), nếu không `SceneWorld.transitioning` kẹt `true` sau khi đổi map.
3. `Assets.ensureMap` phải được thay bằng hàm trả ngay (ảnh giả không bao giờ báo đã tải); `Assets.idle(cb)` gọi cb ngay.
4. Lệnh bật/tắt Auto được xếp hàng (`Input._autoToggle`) và xử lý ở khung sau: không bấm khi còn lệnh chờ, nếu không hai lệnh triệt tiêu nhau. Dùng `setAuto(desired)` như supervisor.
5. Auto PHẢI TẮT trong mọi pha hồi sinh, hồi phục, đi về; nếu bật, nhân vật lao đi đuổi quái. Ép tắt ở mỗi tick của các pha đó.
6. Bộ tìm đường (`Pathfinder.route`) không trả đường cho khoảng cách dưới một ô: nếu không có đường mà đã trong 1 ô quanh neo thì coi là đã tới.
7. Online: gọi `Gateway.login()` (đợi phản hồi) rồi mới dựng cảnh (`Game.init`, `SceneWorld.nuongNenDau(startMapData())`, `Game.changeScene(SceneWorld, null, true)`), cấp phiên cho client bằng `Net.online = true` và `Net.client = { auth: { getSession: async () => ({ data: { session: { access_token } } }) } }`. Không giả Origin/User-Agent. Client chỉ gửi `hello` khi đứng yên, `move` khi trạng thái đổi, `ping` kèm thống kê khoảng 30 s.
8. Client online dùng `Date.now()` và `performance.now()` thật; KHÔNG dùng đồng hồ giả tăng nhanh khi đã online (đồng hồ giả chỉ cho test/mô phỏng offline).
9. `process.chdir` trong spike chỉ để tìm DATA_DIR: KHÔNG dùng trong server; dùng CONFIG/db sẵn có.
10. `console.error` của client bị nuốt trong môi trường giả: thu thập (có giới hạn) để hiện trong runtime/log.

KIẾN TRÚC YÊU CẦU
- Module mới, đặt trong apps/server/src/headless/ (hoặc package riêng nếu bạn thấy tách sạch hơn; giải thích lựa chọn): `vendor-env.ts` (môi trường giả), `vendor-runner.ts` (một runner cho một tài khoản), `auto-supervisor.ts` (chuyển từ spike sang TypeScript), kèm kiểu dữ liệu và test. Đường dẫn vendor lấy từ cấu hình (`VENDOR_CLIENT_DIR`, mặc định tương đối so với repo); báo lỗi rõ nếu thiếu thư mục. KHÔNG sửa vendor. Cập nhật vendor/.../README.md ghi rõ nó nay được nạp lúc chạy ở chế độ chỉ đọc (README cũ ghi "không import vào bot build").
- `VendorRunner` (một tài khoản = một runner = một phiên đăng nhập):
  - Vòng đời: starting → connecting → in_game → (farming | recovering | traveling) → halted | stopped | error. Có `start()`, `stop()`, `startAuto(anchor?)`, `stopAuto()`, `getSnapshot()`.
  - Lấy access token qua `TokenManager` của core-client (đã có) với thông tin từ DB (`db.getCredentials`), lưu refresh token xoay vòng vào DB (như worker-pool đang làm với `sessionUpdated`), làm mới trước khi hết hạn; KHÔNG in/log token.
  - WebSocket thật bằng gói `ws` đã có, chỉ cho phép URL của game server cấu hình (`CONFIG.GAME_SERVER_URL`); `fetch`/XHR trong vm bị chặn; không cho mã vendor truy cập `require`, `process`, hệ thống tệp.
  - Vòng lặp thời gian thật (setInterval ~16 ms, `dt` kẹp tối đa 0,05 s) gọi `Game.scene.update(dt)`, KHÔNG gọi `draw`. Dừng sạch mọi timer khi `stop()`.
  - Tự kết nối lại khi rớt kết nối với backoff có trần (ví dụ 1, 2, 4, ... 30 s, tối đa N lần rồi `error`); sau khi vào lại game, nếu đang ở chế độ Auto thì supervisor đưa nhân vật về neo (map khác hoặc xa neo) trước khi bật Auto lại.
  - Đếm và cung cấp: số gói vào/ra theo `op`, số `move`/`attack`/`skill`/`cmd` gửi (kèm tên `cmd`), `hurtCount`, `lastHurtAt`, số quái do nhân vật hạ (`kill` có `by` là chính mình), số lỗi xử lý gói và `console.error` của client (có giới hạn), số khung hình/giây thực, uptime, bộ nhớ tiến trình.
  - Watchdog: nếu vòng lặp bị trễ quá ngưỡng, hoặc RSS tăng vượt ngưỡng cấu hình, ghi cảnh báo và có tùy chọn tự khởi động lại runner.
- `AutoSupervisor` TypeScript giữ nguyên hành vi đã kiểm chứng ở scripts/lib/auto-supervisor.cjs, thêm: cấu hình qua tham số (reviveMode 'home'|'spot', recoverRatio, arrivalRadius, maxDeaths, deathWindowSec, các timeout), phát sự kiện/ghi log có cấu trúc (không chuỗi tự do), `onHalt` có hai chế độ: 'disconnect' (mặc định: tắt Auto và ngắt phiên) và 'stay' (tắt Auto, giữ phiên). Neo ghi `{mapId, khu?, x, y}`.
- Tích hợp worker-pool: mỗi tài khoản có cấu hình `engine: 'core' | 'vendor'` (mặc định 'core' để KHÔNG đổi hành vi hiện tại). Một tài khoản chỉ chạy MỘT engine tại một thời điểm (một phiên đăng nhập): từ chối khởi động engine thứ hai với lỗi rõ ràng. Runtime trả `engine` và, với engine vendor, đối tượng `vendor` (snapshot ở trên) và điền các trường sẵn có cho dashboard (connection, mapId, khu nếu biết, x, y, hp/maxHp/mp/maxMp lấy từ mô hình `SceneWorld.player` của client với `source: 'client'`, vitals `fresh` khi nhận gói `you`/`hurt`; không bịa dữ liệu khi chưa có).
- API (đi qua `requireAuth`, error envelope sẵn có, không thêm bề mặt không xác thực): `PUT` cấu hình engine/auto (qua route config sẵn có nếu hợp lý), `POST /api/accounts/:id/auto/start` (ghi neo = vị trí hiện tại hoặc neo cho trước đã kiểm tra hợp lệ, bật Auto qua supervisor), `POST /api/accounts/:id/auto/stop`. Mã lỗi riêng, `retryable` đúng nghĩa. Cập nhật docs/CONTROL_PLANE_API.md.
- Dashboard (React, nhỏ gọn): với tài khoản engine vendor hiển thị trạng thái Auto, pha supervisor, neo (map + toạ độ), số lần chết/chuyến về, `hurtCount`, nút "Bật Auto tại vị trí này" và "Dừng Auto", cảnh báo khi `halted` kèm lý do. Không làm vỡ giao diện cho engine 'core'.
- An toàn: Auto chỉ bật khi người dùng yêu cầu rõ ràng qua API/UI (không tự bật khi khởi động server). Dừng khẩn: `stop()` luôn tắt Auto, dừng nhân vật, ngắt phiên. Giám sát `hurt` (đếm, thời điểm cuối) và chặn bật Auto khi vitals chưa rõ hoặc nhân vật đang gục. Đúng các giới hạn của supervisor (số lần chết, timeout). Ghi log sự kiện quan trọng (bật/tắt Auto, chết, hồi sinh, về neo, halted) qua cơ chế log tài khoản sẵn có, không chứa token/tên/id.

KIỂM THỬ (bắt buộc, không phụ thuộc mạng)
- Môi trường offline làm nền: dùng chính môi trường vm với WebSocket giả để chạy mô phỏng cục bộ của client (như spike offline), có RNG có hạt giống (ghi đè `Math.random` trong vm) để test lặp lại được. Test: nạp client (>= 240/241 script, 2 lỗi vô hại cho phép), dựng cảnh, `update` thủ công, bật Auto và thấy nhân vật di chuyển/đánh; supervisor: chết → hồi sinh về làng → thiền → đi qua cổng → về cách neo <= bán kính → bật Auto lại; giới hạn số lần chết; Auto luôn tắt trong lúc đi về; bẫy 1 đến 6 ở trên có test hồi quy riêng.
- VendorRunner với WebSocket giả: lấy token (TokenManager giả), login → dựng cảnh, nhận gói giả `welcome/state/map/snap2` đủ để vào game, đếm gói, dừng sạch (không timer rò), kết nối lại sau khi socket giả đóng, từ chối khi tài khoản đã có engine khác chạy, `stop()` luôn tắt Auto.
- API: auth bắt buộc, mã lỗi và `retryable`, từ chối bật Auto khi gục/chưa vào game.
- Chạy được bằng `npx tsx --test` (server) hoặc node --test; không làm vỡ test cũ (hiện: core-client 11 file, automation-engine 4 file, server TS 9 file, server .mjs 3 file, web Vitest 9 test).

TÀI LIỆU
- Cập nhật docs/ARCHITECTURE.md (mục mới "Engine vendor: chạy client chính thức không hiển thị"), docs/AUTO_SPEC.md (đánh dấu P2 đến P7 viết tay không còn là đường chính; ghi quyết định), docs/CONTROL_PLANE_API.md, docs/PLAN_SESSION_HANDOFF.md (nối với kế hoạch bàn giao phiên: chủ phiên 'headless' = VendorRunner), AGENTS.md (quy tắc: một engine mỗi tài khoản; Auto chỉ bật khi được yêu cầu; theo dõi hurtCount; bẫy khi dùng vm), docs/SESSION_LOG.md (mục mới ở ĐẦU file), checklist cuối docs/FIX_GUIDE.md.

QUY TẮC AN TOÀN (nhắc lại từ AGENTS.md)
- KHÔNG chạy server thật, KHÔNG đăng nhập game, KHÔNG dùng mạng, KHÔNG gửi bất kỳ packet thật nào trong sandbox của bạn. Kiểm chứng live do người dùng/Claude Code làm sau.
- Không in token, JWT, mật khẩu, selfId, tên nhân vật, id người chơi. Không đọc data/ hay .env. Fixture là dữ liệu tổng hợp.
- Không sửa vendor (trừ README.md của thư mục snapshot), không sửa gate, allowlist origin, .gitignore. Không thêm route không qua requireAuth. Không đổi hành vi engine 'core' hiện tại.
- Không thêm dependency mới nếu không bắt buộc; nếu bắt buộc, nêu lý do trong báo cáo.
- `node:vm` KHÔNG phải sandbox bảo mật: mã vendor là snapshot tin cậy đã được kiểm tra, ghi rõ điều này trong tài liệu và đừng cho vm truy cập thêm năng lực nào ngoài những gì cần thiết.
- Nếu `pnpm` không có trong PATH hoặc build bị chặn (EPERM/EACCES): thử `corepack pnpm`, hoặc chạy tsc trực tiếp từng package bằng node_modules/typescript/bin/tsc, rồi chạy test bằng `npx tsx --test` hoặc `node --test`. Nêu rõ lệnh nào chạy được, lệnh nào bị chặn. KHÔNG tuyên bố build pass nếu chưa chạy. Lưu ý: các đợt trước đều để lại lỗi kiểu chỉ lộ khi build; tôi sẽ tự build và chạy lại, hãy tự rà kỹ kiểu (type guard, thu hẹp kiểu, `readonly`, `null`) khi viết.
- Phần không xác định được ghi "chưa xác minh", không suy đoán thành sự thật.

KẾT QUẢ CẦN GIAO
- Mã module, API, UI, test, tài liệu cập nhật.
- Bảng cuối:

| Hạng mục | Trạng thái (xong / chặn / chưa xác minh) | Bằng chứng ngắn |
|---|---|---|
| vendor-env + auto-supervisor (TS) | | (số test, bẫy 1 đến 6 có test) |
| VendorRunner | | |
| Tích hợp worker-pool + một engine mỗi tài khoản | | |
| API + CONTROL_PLANE_API | | |
| Dashboard | | |
| Test | | (số test pass/fail theo từng lệnh) |
| Build | | |

- Kèm: các quyết định thiết kế bạn đã chọn và lý do, điều chưa kiểm chứng live (kết nối lại thật, token hết hạn giữa phiên, chạy dài, chết/hồi sinh thật), và rủi ro còn lại.
