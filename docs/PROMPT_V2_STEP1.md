# Nhiệm vụ: ARCHITECTURE_V2 Bước 1 — `GameGateway` + `VendorGateway` (refactor KHÔNG đổi hành vi)

Đọc `AGENTS.md`, `docs/ARCHITECTURE_V2.md` (mục 3, 4.1, 4.2, 4.8), `docs/PLAN_ARCHITECTURE_V2.md`, `docs/SESSION_LOG.md` (mục đầu), rồi mã: `apps/server/src/headless/daily-quests.ts` (interface `DailyClient`, `DailyQuests`), `apps/server/src/headless/vendor-runner.ts` (nơi hiện thực `DailyClient`, `getSnapshot`, `moveTo`, `startAuto`, `getKhuInfo`...), `apps/server/src/orchestrator/worker-pool.ts` (cách dùng runner), `apps/server/src/headless/vendor-runner.test.ts`, `daily-quests.test.ts`, `api/routes.ts`.

Không chạm game thật, không mở mạng ngoài, không đọc `data/`/`.env*`, không sửa `vendor/` hay `headless/auto-supervisor.ts`, không commit. Dùng `DATA_DIR` ở thư mục tạm cho mọi test/server thử.

## Mục tiêu và ranh giới
Mục tiêu cuối (các bước sau, KHÔNG làm ở bước này) là có thêm một `ProtocolGateway` (client nhẹ) cắm vào cùng giao diện. Bước 1 chỉ chuẩn bị mối nối:
- Hành vi quan sát được (REST/WS/dashboard, log, mã lỗi, thời điểm gửi gói) phải GIỮ NGUYÊN 100%.
- KHÔNG đổi `loopIntervalMs`, logic `frame()`, `AutoSupervisor`, quy tắc an toàn (hurt, gục, một phiên một tài khoản, khoá `KHU_PROTOCOL_UNAVAILABLE`, `RESPAWN_PROTOCOL_UNAVAILABLE`).
- KHÔNG viết `ProtocolGateway`. KHÔNG đổi API công khai của server.

## Việc cần làm
1. **Định nghĩa `GameGateway`** (file mới, ví dụ `apps/server/src/gateway/game-gateway.ts`). Gom theo nhóm, KHÔNG dùng tên hay kiểu của client minify:
   - Phiên/vòng đời: `start`, `stop`, `getLifecycle`, sự kiện ngắt kết nối.
   - Trạng thái chỉ đọc: vị trí/map, vitals (giá trị chưa biết = `null`, KHÔNG thay bằng 0), gục (`isDown`), `hurtCount`, có Auto hay không, map/khu hiện tại, danh sách map đi được.
   - Di chuyển: `walkTo`, `cancelWalk`, theo dõi `WalkOperation`.
   - Tương tác dùng cho việc hằng ngày: toàn bộ thao tác hiện nằm trong `DailyClient` (chặt cây, câu cá, thu hoạch, điểm danh, seed quest, ACK theo `cmd`...). Có thể giữ `DailyClient` như một phần/kiểu con của `GameGateway` (khuyến khích: `DailyClient` thành tập con được `GameGateway` mở rộng hoặc chứa), miễn `DailyQuests` không phải đổi logic.
   - Auto/khu: `startAuto`, `stopAuto`, `getKhuInfo`, `requestKhuList`, `changeKhu` (giữ nguyên các khoá an toàn hiện có).
   - Quan sát: `getFrameMetrics` (Bước 0a) nếu có nghĩa với gateway, trả `null` nếu không.
   - Tài liệu từng phương thức bằng một dòng; ghi rõ phương thức nào gate mềm, phương thức nào gate nghiêm theo `AGENTS.md`.
2. **`VendorGateway`**: bọc `VendorRunner` (adapter mỏng, ưu tiên composition) để triển khai `GameGateway`. Không sao chép logic; chỉ uỷ quyền. `VendorRunner` có thể tiếp tục tồn tại và được test trực tiếp như cũ.
3. **Chuyển người dùng sang giao diện**: `DailyQuests` nhận `GameGateway`/`DailyClient` thay vì phụ thuộc cụ thể (nếu đã dùng interface thì giữ); `WorkerPool` giữ tham chiếu qua `GameGateway` thay vì `VendorRunner` ở những chỗ có thể mà không đổi hành vi (khởi tạo vẫn tạo `VendorGateway`). Nếu một chỗ không thể chuyển mà không đổi hành vi, để nguyên và ghi chú lý do vào `docs/SESSION_LOG.md`.
4. **Bộ test hợp đồng (contract)** dùng chung (file mới, ví dụ `gateway/game-gateway.contract.ts` + test chạy trên các hiện thực): kiểm các bất biến mà MỌI hiện thực phải thoả — giá trị chưa biết là `null` chứ không phải 0; gate mềm/nghiêm; `hurtCount` không giảm; `stop()` idempotent và dọn trạng thái; khi gục thì thao tác bị từ chối đúng mã; ACK theo `cmd`; huỷ walk dọn waiter. Chạy bộ này trên (a) `VendorGateway` với fixture/fake vendor hiện có, và (b) một `FakeGateway` đơn giản trong test (chứng minh hợp đồng đủ chặt để `ProtocolGateway` sau này dùng lại). Mục đích: về sau `ProtocolGateway` chỉ cần chạy lại bộ này.
5. **Tài liệu**: bổ sung mục "GameGateway" ngắn vào `docs/ARCHITECTURE.md` (trạng thái: mới có giao diện + VendorGateway), cập nhật `docs/ARCHITECTURE_V2.md` nếu giao diện thực tế khác phác thảo, và ghi báo cáo vào đầu `docs/SESSION_LOG.md` + checklist cuối `docs/FIX_GUIDE.md`.

## Ràng buộc chất lượng
- Thay đổi nhỏ, tập trung; giữ phong cách code sẵn có; không refactor ngoài phạm vi; không đổi tên công khai đang được test hoặc API dùng.
- Không thêm phụ thuộc mới.
- Mọi `import` trong server dùng đuôi `.js` như hiện có.

## Test và kiểm tra bắt buộc (không phụ thuộc đồng hồ máy, không `sleep` dài)
- Mốc hiện tại để so sánh: toàn bộ test server 120/120 pass, web 48/48. KHÔNG được tụt.
- `pnpm build`, `pnpm --filter @tutien2d/web test`, và TỪNG file test server liên quan (`cd apps/server && npx tsx --test <file>`), sau đó toàn bộ test server. Báo số liệu thật; lệnh nào không chạy được thì nói rõ kèm output, không tuyên bố đã xong.
- Cố ý phá thử: (a) làm `VendorGateway` trả `0` thay vì `null` cho một giá trị chưa biết, (b) bỏ việc dọn waiter khi huỷ walk → bộ hợp đồng phải fail; rồi khôi phục.
- Kiểm tra hành vi không đổi: chạy lại `vendor-runner.test.ts`, `daily-quests.test.ts`, `daily.contract.test.ts` và các contract test vendor khác; so khối kết quả cũ/mới.
- Chạy server tạm (DB tạm, cổng khác 4000), đăng nhập test, gọi `GET /api/accounts` và `GET /api/admin/health` để xác nhận API không đổi hình dạng.
- Ghi rõ phần chưa xác minh: chưa chạy bot thật (không thuộc bước này).
