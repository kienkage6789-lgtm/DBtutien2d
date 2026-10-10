# Nhiệm vụ: ARCHITECTURE_V2 Bước 0a — số liệu hiệu năng theo từng bot

Đọc `AGENTS.md`, `docs/ARCHITECTURE_V2.md` (mục 1, 5, 7), `docs/PLAN_ARCHITECTURE_V2.md` (mục "Bước 0a"), `docs/SESSION_LOG.md` (mục đầu), rồi mã: `apps/server/src/headless/vendor-runner.ts` (`frame()`, `loopTimer`, snapshot/runtime), `apps/server/src/orchestrator/worker-pool.ts` (runtime snapshot, `/api/admin/health` ở `api/routes.ts`), `apps/web/src/types/index.ts`, `apps/web/src/components/AdminPanel.tsx` (`AccountAdminCard`), sanitizer runtime ở web nếu có.

Không chạm game thật, không mở mạng ngoài, không đọc `data/`/`.env*`, không sửa `vendor/` hay `headless/auto-supervisor.ts`, không commit. Dùng `DATA_DIR` ở thư mục tạm cho mọi test/server thử.

## Phạm vi (CHỈ quan sát, không đổi hành vi)
- KHÔNG đổi `loopIntervalMs`, thứ tự/logic `frame()`, watchdog hiện có, protocol hay logic nhiệm vụ.
- Overhead của đo đạc phải nhỏ: tối đa vài lệnh đọc đồng hồ mỗi khung, không cấp phát mảng mới mỗi khung (dùng vòng đệm cố định).

## Việc cần làm
1. **Collector thuần** (file mới, ví dụ `apps/server/src/headless/frame-metrics.ts`) nhận đồng hồ tiêm (`now(): number` đơn vị ms độ phân giải cao):
   - ghi `begin()/end()` quanh mỗi khung; vòng đệm cố định (ví dụ 600 khung) cho p95 và max trong cửa sổ; trung bình trượt (EMA); tổng số khung.
   - `busyRatio` = tổng thời gian trong khung / thời gian thực trôi qua trong cửa sổ trượt (giới hạn 0..1+; chia cho 0 → `null`).
   - `snapshot()` trả `{ frames, avgMs, p95Ms, maxMs, busyRatio, windowMs }` với `null` khi chưa đủ dữ liệu (KHÔNG thay bằng 0).
   - `reset()` khi runner stop/start lại.
2. **Nối vào `VendorRunner`**: bọc lời gọi `frame()` bằng collector (dùng try/finally để lỗi trong khung vẫn đóng khung). Không thay đổi giá trị trả về hay ngoại lệ của `frame()`.
3. **Độ trễ vòng lặp và tài nguyên tiến trình** (module riêng, ví dụ `apps/server/src/orchestrator/process-metrics.ts`): `monitorEventLoopDelay` (resolution hợp lý, `enable()` khi server chạy, dọn khi tắt), RSS/heapUsed, số runner đang chạy; có hàm thuần `snapshot()` và hook để test.
4. **Phơi ra API**:
   - Trường `metrics` (frame metrics, `null` nếu runner chưa chạy) trong runtime snapshot của từng account, theo đúng phạm vi quyền hiện có (chủ sở hữu và admin; KHÔNG thêm bí mật, token, đường dẫn, id người chơi khác).
   - `GET /api/admin/health` thêm khối `process` (eventLoopDelay p50/p99/max ms, rssBytes, heapUsedBytes, runningRunners). Admin-only như hiện nay. Không phá hợp đồng cũ (chỉ thêm trường).
5. **Web (tối thiểu)**: kiểu dữ liệu + sanitizer chịu được trường mới (thiếu/sai kiểu → `null`); hiển thị ở `AccountAdminCard` (admin) dòng "Khung: x.x ms (p95 y.y) · chiếm z%" và "chưa biết" khi `null`. Giữ phong cách hiện có, không đổi bố cục khác.
6. **Tài liệu**: bổ sung `docs/CONTROL_PLANE_API.md` (trường mới) và mô tả ngắn cách đọc số liệu.

## Test bắt buộc (không phụ thuộc đồng hồ máy, không `sleep` dài)
- Collector: nhiều khung với đồng hồ giả → avg/p95/max/busyRatio đúng; cửa sổ trượt bỏ khung cũ; chưa có dữ liệu → `null`; `end()` không có `begin()` không ném; reset.
- `VendorRunner`: thêm test (dùng fixture hiện có) xác nhận metrics tăng khi chạy khung và `frame()` vẫn trả/ném như cũ; toàn bộ `vendor-runner.test.ts` cũ pass.
- API: snapshot không rò thông tin; user thường không đọc được health admin; account người khác không lộ metrics.
- Web: sanitizer với dữ liệu thiếu/sai kiểu; hiển thị "chưa biết".
- Cố ý phá thử mã đo (ví dụ lệch đơn vị) và xác nhận test bắt được.

## Kiểm tra trước khi báo xong
- `pnpm build`, `pnpm --filter @tutien2d/web test`, và TỪNG file test server liên quan (`cd apps/server && npx tsx --test <file>`) phải pass; báo số liệu thật. Nếu không chạy được lệnh nào, nói rõ lý do kèm output, không tuyên bố đã xong.
- Chạy server tạm (DB tạm, cổng khác 4000), gọi `GET /api/admin/health` bằng đăng nhập test và dán phần `process` (đã che nếu cần).
- Cập nhật `docs/SESSION_LOG.md` (mục đầu) và checklist cuối `docs/FIX_GUIDE.md`; ghi rõ phần chưa xác minh (chưa đo bot thật trên TV box: thuộc Bước 0b).
