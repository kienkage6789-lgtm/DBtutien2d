# Nhiệm vụ: ARCHITECTURE_V2 Bước 5A — `RunnerHandle` (tách WorkerPool khỏi VendorRunner), KHÔNG đổi hành vi

Đọc `AGENTS.md`, `docs/ARCHITECTURE_V2.md` (mục 5), `docs/PLAN_ARCHITECTURE_V2.md`, `docs/SESSION_LOG.md` (mục đầu), rồi mã: `apps/server/src/orchestrator/worker-pool.ts` (toàn bộ chỗ dùng `runner`/`gateway`/`activeVendors`), `apps/server/src/gateway/*` (Bước 1), `apps/server/src/headless/vendor-runner.ts` (các phương thức công khai), `apps/server/src/api/routes.ts` (cách gọi `workerPool.*`), `apps/server/src/index.ts` (tắt server), `apps/server/src/ws/hub.ts`, `apps/server/src/orchestrator/entitlement-watcher.ts`.

Không chạm game thật, không mở mạng ngoài, không đọc `data/`/`.env*`, không sửa `vendor/` hay `headless/auto-supervisor.ts`, không commit. Dùng `DATA_DIR` ở thư mục tạm cho mọi test/server thử.

## Mục tiêu và ranh giới
Mục tiêu cuối (Bước 5B, KHÔNG làm ở bước này) là chạy các `VendorRunner` trong tiến trình con (shard) để dùng nhiều nhân CPU. Muốn vậy `WorkerPool` không được gọi thẳng `VendorRunner` nữa mà qua một "tay cầm" (`RunnerHandle`) có thể là in-process hoặc từ xa. Bước 5A chỉ làm lớp trừu tượng đó và bản in-process.
- Hành vi quan sát được (REST/WS, log, mã lỗi, thứ tự gói gửi, quy tắc an toàn) GIỮ NGUYÊN 100%.
- KHÔNG tạo tiến trình con, KHÔNG đổi `loopIntervalMs`, `frame()`, `AutoSupervisor`, hurt/gục, khoá `KHU_PROTOCOL_UNAVAILABLE`/`RESPAWN_PROTOCOL_UNAVAILABLE`, một phiên một tài khoản.
- KHÔNG đổi API công khai của server (đường dẫn, JSON, mã lỗi). Được phép đổi chữ ký nội bộ của `WorkerPool` (ví dụ biến phương thức đồng bộ thành bất đồng bộ) nếu cần, nhưng mọi nơi gọi phải được cập nhật và phản hồi HTTP/WS không đổi.

## Việc cần làm
1. **Định nghĩa `RunnerHandle`** (file mới, ví dụ `apps/server/src/orchestrator/runner-handle.ts`), tập phương thức mà `WorkerPool` thật sự dùng:
   - Vòng đời: `start`, `stop`, `getLifecycle`.
   - Đọc trạng thái ĐỒNG BỘ từ bộ nhớ đệm (vì runtime snapshot/WS broadcast cần đồng bộ): `getSnapshot`, `getFrameMetrics`, `getReachableMaps`, `getKhuProbe`, `getDailySnapshot`. Mỗi lần đọc có kèm tuổi dữ liệu (`ageMs`) hoặc cờ `stale`; ở bản in-process luôn tươi (age 0).
   - Lệnh BẤT ĐỒNG BỘ (trả `Promise`): `startAuto`, `stopAuto`, `walkTo`, `cancelWalk`, `getKhuInfo`, `requestKhuList`, `changeKhu`, `startDailyCheckin`, `startDailySeed`, `cancelDaily`, `questProbe`, `khuProbe`.
   - Sự kiện: `onDisconnect` (đã có), `onLog`, `onSessionUpdated` (cập nhật refresh token để `WorkerPool` ghi DB).
   - Giữ kiểu dữ liệu trả về hiện có (`WalkOperation`, `DailyOperation`, `KhuInfo`...); dữ liệu phải tuần tự hoá được thành JSON thuần (không hàm, không `Map`/`Set`, không tham chiếu vòng) để Bước 5B truyền qua IPC. Kiểm tra từng kiểu có đáp ứng điều đó; chỗ nào không thì ghi vào báo cáo và đề xuất chuyển đổi.
2. **`InProcessRunnerHandle`**: bọc `VendorRunner` (và `VendorGateway` ở Bước 1 khi hợp lý) bằng composition, chỉ uỷ quyền. Không sao chép logic.
3. **Chuyển `WorkerPool`** sang chỉ dùng `RunnerHandle`: `activeVendors` lưu `RunnerHandle`; các chỗ gọi `runner.*` trong `worker-pool.ts` đổi thành gọi handle. Phương thức đồng bộ của `WorkerPool` nào buộc phải thành bất đồng bộ thì cập nhật `routes.ts` (và nơi gọi khác) cho đúng, giữ nguyên phản hồi HTTP, mã lỗi và thứ tự kiểm tra.
4. **Khởi tạo qua nhà máy (factory)**: `WorkerPool` nhận một hàm tạo handle (mặc định tạo `InProcessRunnerHandle`), để Bước 5B chỉ việc thêm bản khác. Toàn bộ logic chuẩn bị (giải mã thông tin đăng nhập, proxy, entitlement, quota, `MAX_TOTAL_RUNNERS`, `MIN_FREE_MEM_MB`) ở lại trong `WorkerPool`.
5. **Bộ test hợp đồng cho `RunnerHandle`** (dùng chung, như bộ `GameGateway`): chạy trên `InProcessRunnerHandle` với môi trường giả có sẵn trong `vendor-runner.test.ts` (tái dùng/tách fixture) và trên một `FakeRunnerHandle` đơn giản. Bất biến bắt buộc, mỗi cái một test riêng: (a) giá trị chưa biết là `null`, không phải 0; (b) `stop()` thật sự dừng (lifecycle `stopped`) và gọi lần hai không ném; (c) `start()` hai lần không tạo hai phiên; (d) `cancelWalk` chỉ huỷ đúng thao tác; (e) khi gục, `walkTo`/`startAuto` bị từ chối đúng mã lỗi hiện có; (f) `onDisconnect`/`onSessionUpdated` được gọi, huỷ đăng ký hoạt động; (g) đọc đồng bộ không ném khi chưa start; (h) mọi giá trị trả về qua được `JSON.parse(JSON.stringify(x))` mà không mất thông tin (so sánh sâu).
6. **Tài liệu**: mục "RunnerHandle" ngắn trong `docs/ARCHITECTURE.md`, cập nhật `docs/ARCHITECTURE_V2.md` nếu khác phác thảo, báo cáo đầu `docs/SESSION_LOG.md` + checklist cuối `docs/FIX_GUIDE.md`.

## Test và kiểm tra bắt buộc (không phụ thuộc đồng hồ máy, không `sleep` dài)
- Mốc hiện tại để so sánh: toàn bộ test server 135/135 (27 file `*.test.ts` trong `apps/server/src`), web 48/48. KHÔNG được tụt. Đếm đúng bằng `npx tsx --test` trên mọi file `*.test.ts` trong `apps/server/src`.
- `pnpm build`, `pnpm --filter @tutien2d/web test`, từng file test liên quan rồi toàn bộ test server. Báo số liệu thật; lệnh nào không chạy được thì nói rõ kèm output, không tuyên bố đã xong.
- Cố ý phá thử và xác nhận test FAIL (không treo; nếu `stop()` làm test treo thì thêm timeout để nó FAIL gọn): (i) handle trả 0 cho giá trị chưa biết, (ii) `stop()` không làm gì, (iii) `cancelWalk` bỏ operationId, (iv) `onSessionUpdated` không được chuyển tiếp, (v) một giá trị trả về chứa hàm/`Map`. Sau đó khôi phục.
- Kiểm tra hành vi không đổi: chạy lại `vendor-runner.test.ts`, `daily-quests.test.ts`, `daily.contract.test.ts`, `multi-user.e2e.test.ts` và các test API; chạy server tạm (DB tạm, cổng khác 4000), đăng nhập test, gọi `GET /api/accounts` và `GET /api/admin/health` để xác nhận hình dạng API không đổi.
- Ghi rõ phần chưa xác minh (chưa chạy bot thật; không thuộc bước này).
