# Nhiệm vụ: ARCHITECTURE_V2 Bước 5B — shard đa tiến trình (`child_process`) để dùng nhiều nhân CPU

Chỉ làm sau khi Bước 5A (`docs/PROMPT_V2_STEP5A.md`) đã được nghiệm thu. Đọc `AGENTS.md`, `docs/ARCHITECTURE_V2.md` (mục 5), `docs/PLAN_ARCHITECTURE_V2.md`, `docs/SESSION_LOG.md`, và mã: `apps/server/src/orchestrator/runner-handle.ts` + `InProcessRunnerHandle` (5A), `worker-pool.ts`, `headless/vendor-runner.ts`, `network/proxy-transport.ts`, `index.ts` (tắt server), `orchestrator/process-metrics.ts`.

Không chạm game thật, không mở mạng ngoài, không đọc `data/`/`.env*`, không sửa `vendor/` hay `auto-supervisor.ts`, không commit. Test dùng `DATA_DIR` tạm và socket giả.

## Bối cảnh
Server chạy mọi bot trong MỘT tiến trình Node (một luồng) nên chỉ dùng được một nhân CPU. Đo trên Cortex-A53: một bot rảnh ~45% một nhân; mục tiêu: tối đa số bot trên 2 nhân/2 GB. Giải pháp: `N` tiến trình con (shard), mỗi shard chứa nhiều `VendorRunner`; tiến trình chính giữ API/DB/WS/auth/entitlement/proxy checker và nói chuyện với shard qua IPC (`child_process.fork`).

## Ràng buộc bất biến (từ `AGENTS.md`)
- Mỗi tài khoản chỉ MỘT phiên: tiến trình chính giữ bản ghi duy nhất (accountId -> shard); không bao giờ để hai shard (hay một shard và một runner in-process) chạy cùng một tài khoản, kể cả khi shard chết và khởi động lại.
- Dừng khẩn cấp phải đáng tin: `POST /api/accounts/:id/stop` và entitlement watcher phải dừng được bot kể cả khi shard đang bận/treo (xem mục lỗi).
- Server không tự bật Auto/bot khi khởi động; shard chết thì đánh dấu các tài khoản `stopped`, KHÔNG tự bật lại bot.
- Không in/ghi log mật khẩu, token, `selfId`, tên nhân vật, URL proxy có thông tin xác thực, khoá `.secret`. Thông tin đăng nhập game và URL proxy truyền qua IPC chỉ ở bộ nhớ, không ghi đĩa, không đưa vào log/nhật ký lỗi.
- Hành vi mặc định KHÔNG đổi: `VENDOR_SHARDS=0` (mặc định) = chạy in-process như hiện nay.

## Việc cần làm
1. **Cấu hình** (`config.ts`, `.env.example`, `docs/DEPLOY_VPS.md`): `VENDOR_SHARDS` (số nguyên 0..16, 0 = in-process mặc định; N>=1 = N shard), `SHARD_MAX_RUNNERS` (0 = không giới hạn), `SHARD_RPC_TIMEOUT_MS` (mặc định 15000), `SHARD_STOP_GRACE_MS` (mặc định 5000). Giá trị sai kiểu quay về mặc định, kẹp khoảng hợp lý, có test đọc cấu hình.
2. **Giao thức IPC** (file mới, có kiểu TypeScript dùng chung hai phía, mọi gói là JSON thuần có `v` phiên bản giao thức):
   - Cha -> con: `start {accountId, credentials, gameServerUrl, proxyUrl|null, options}`, `stop {accountId}`, và một lệnh RPC chung `call {rid, accountId, method, args}` cho các lệnh của `RunnerHandle` (danh sách trắng phương thức, từ chối tên lạ).
   - Con -> cha: `ready`, `reply {rid, ok, result|error{code,message}}`, `snapshot {accountId, snapshot, metrics, at}` (đẩy định kỳ ~500 ms và NGAY khi lifecycle/hurt/down/revived/ngắt kết nối thay đổi), `log {accountId, event}`, `session {accountId, refreshToken}` (để cha ghi DB), `proc {rssBytes, eventLoop, runners}` (số liệu tiến trình shard), `fatal`.
   - `RemoteRunnerHandle` (bản `RunnerHandle` từ xa): đọc đồng bộ từ bộ đệm snapshot đẩy lên; nếu dữ liệu cũ quá `3 * khoảng đẩy` thì báo `stale` và runtime hiển thị giá trị chưa biết (`null`), KHÔNG dùng số cũ như thể còn tươi (quy tắc "chưa biết là chưa biết"). Lệnh là RPC bất đồng bộ có timeout; mã lỗi từ runner được giữ nguyên để API trả cùng mã như in-process.
   - Con tạo `transport` proxy từ `proxyUrl` ngay trong shard (socket nằm ở shard), đóng khi stop.
3. **Shard** (`apps/server/src/shard/shard-main.ts`, được build ra `dist/shard/shard-main.js`): nhận lệnh, tạo/giữ nhiều `VendorRunner`, tự thoát (sau khi dừng sạch mọi runner, có hạn chót rồi `process.exit`) khi kênh IPC đóng (`disconnect`) để không mồ côi khi tiến trình chính chết. Bắt `uncaughtException`/`unhandledRejection`: báo `fatal` rồi thoát, không im lặng. Không import Express/DB/auth của tiến trình chính.
4. **Quản lý shard ở tiến trình chính** (`ShardManager`): sinh shard theo nhu cầu (lười), gán bot vào shard ÍT runner nhất còn chỗ (`SHARD_MAX_RUNNERS`), `MAX_TOTAL_RUNNERS`/`MIN_FREE_MEM_MB`/quota/entitlement vẫn kiểm ở tiến trình chính trước khi gửi `start`. Xác định đường dẫn shard đúng ở cả bản `dist` (`.js`) và khi chạy bằng `tsx` (`.ts`, thừa hưởng `execArgv`). Windows và Linux đều chạy được.
5. **Lỗi và an toàn (phải có test cho từng mục):**
   - Shard chết bất ngờ: toàn bộ tài khoản của nó thành `stopped` (ghi nhật ký tài khoản + audit, `system_alert` cho chủ sở hữu), KHÔNG tự bật lại; chỉ sinh shard mới khi có yêu cầu start kế tiếp, và chỉ sau khi tiến trình cũ đã thật sự thoát (chờ `exit`).
   - RPC `stop` quá `SHARD_STOP_GRACE_MS` mà không có `reply`: tiến trình chính `SIGKILL` shard đó, đánh dấu mọi tài khoản trên shard `stopped` (đây là đường dừng khẩn cấp đáng tin).
   - Các RPC khác quá `SHARD_RPC_TIMEOUT_MS`: trả lỗi ổn định (ví dụ `SHARD_RPC_TIMEOUT`), không treo request HTTP, không retry mù lệnh tấn công/skill.
   - Tắt server (`SIGINT`/`SIGTERM`): gửi stop cho mọi runner, chờ có hạn chót, rồi dừng shard (kill nếu cần); `index.ts` không thoát trước khi dọn xong.
   - Tiến trình chính chết/ngắt kênh: shard tự dừng runner và thoát (test bằng kênh giả đóng).
   - Gói lạ/không đúng phiên bản/phương thức ngoài danh sách trắng: bỏ qua có đếm, không ném, không crash cả hai phía.
6. **Số liệu**: `GET /api/admin/health` thêm danh sách shard (`id`, `pid`, `runners`, `rssBytes`, `eventLoop`, `stale`) cạnh khối `process` của tiến trình chính (chỉ thêm trường, không phá hợp đồng cũ). Thẻ admin hiển thị metrics khung từ shard như in-process.
7. **Công cụ đo** (`apps/server/tools/measure-shards.ts`, chạy `pnpm measure:shards`): khởi động `S` shard x `K` bot dùng socket giả (offline, không mạng), chạy `MEASURE_SECONDS`, in bảng CPU/RSS theo từng tiến trình (đọc `/proc` trên Linux, `process.cpuUsage` ở shard) và tổng; để chạy trên TV box so 1 shard với 2 shard. Biến môi trường `MEASURE_SHARDS`, `MEASURE_BOTS_PER_SHARD`.
8. **Tài liệu**: `docs/ARCHITECTURE.md` (mục shard, sơ đồ), `docs/ARCHITECTURE_V2.md` cập nhật trạng thái, `docs/DEPLOY_VPS.md` (cách bật `VENDOR_SHARDS=2`, ghi chú RAM mỗi shard ~66 MB nền), `docs/CONTROL_PLANE_API.md` (trường health mới), SESSION_LOG (mục đầu) và checklist `docs/FIX_GUIDE.md`.

## Test và kiểm tra bắt buộc
- Mốc trước bước này (sau 5A) để so sánh: ghi lại số test server/web ở đầu báo cáo; KHÔNG được tụt.
- Test đơn vị giao thức với kênh giả (không cần fork thật): phiên bản, danh sách trắng, bộ đệm tuổi dữ liệu -> `stale`, timeout, ánh xạ lỗi, `stop` quá hạn -> kill, shard chết -> `stopped` và không tự bật lại, không hai phiên cùng tài khoản.
- Test tích hợp fork thật: một tệp test khởi động shard thật với móc kiểm thử CHỈ bật khi `TUTIEN_ALLOW_SHARD_TEST_HOOK=1` (cung cấp `WebSocketImpl`/token giả cho shard; KHÔNG được có đường tải mã tuỳ ý trong cấu hình sản xuất, và không mở đường này qua API). Kiểm: start -> vào game giả -> snapshot về cha; hai shard chạy song song; kill shard -> tài khoản `stopped`; tắt cha -> shard thoát (không mồ côi).
- Chạy lại toàn bộ bộ hợp đồng `RunnerHandle` (5A) trên `RemoteRunnerHandle` qua kênh giả; các test cũ vẫn pass với `VENDOR_SHARDS=0` (mặc định) và các test API chính pass với `VENDOR_SHARDS=2`.
- Cố ý phá thử và xác nhận test FAIL gọn (không treo): (i) bỏ kill khi stop quá hạn, (ii) tự bật lại bot khi shard chết, (iii) dùng snapshot cũ như tươi, (iv) cho phép `call` phương thức ngoài danh sách trắng, (v) cho hai shard cùng start một tài khoản, (vi) shard không thoát khi kênh đóng. Khôi phục sau mỗi lần.
- `pnpm build` (3 package), `pnpm --filter @tutien2d/web test`, từng file test liên quan rồi toàn bộ test server; đếm đúng.
- Chạy server tạm (DB tạm, cổng khác 4000) với `VENDOR_SHARDS=2`: đăng nhập test, tạo hai tài khoản giả, kiểm `GET /api/admin/health` thấy 2 shard; dừng sạch, không còn tiến trình con nào (kiểm bằng danh sách tiến trình). KHÔNG đăng nhập game thật.
- Ghi rõ phần chưa xác minh: chưa chạy bot thật qua shard; chưa đo trên TV box (chủ dự án chạy `pnpm measure:shards`); độ trễ IPC khi nhiều bot; hành vi khi shard đầy RAM.
