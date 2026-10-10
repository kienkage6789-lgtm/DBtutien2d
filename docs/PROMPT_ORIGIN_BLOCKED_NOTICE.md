# Nhiệm vụ: báo rõ khi bị chặn do Origin/cấu hình, và hoàn thiện `deploy/env.example`

Đọc `AGENTS.md`, `docs/SESSION_LOG.md` (mục đầu), `docs/DEPLOY_VPS.md`, `deploy/env.example`, rồi `apps/server/src/config.ts` (`ALLOWED_ORIGINS`, `PUBLIC_ORIGIN`, `TRUST_PROXY_HOPS`), `apps/server/src/index.ts` (cors, `trust proxy`), `apps/server/src/security/auth.ts` (kiểm Origin), `apps/server/src/ws/hub.ts`, `apps/web/src/lib/api.ts` (`notifyAuthRequired`), `apps/web/src/hooks/useRealtime.ts`.

Không chạm game thật, không đọc `data/`/`.env*` thật, không sửa `vendor/`/`headless/`, không commit, không nới allowlist origin, không dùng `*`, không tắt auth.

## Bối cảnh (đã gặp thật trên VPS)

Chạy sau tên miền riêng mà chưa có `.env` (thiếu `PUBLIC_ORIGIN`/`TRUST_PROXY`) thì dashboard bị đẩy ra màn hình đăng nhập liên tục; thêm `.env` thì hết. Người dùng không có cách nào biết nguyên nhân: giao diện chỉ hiện đăng nhập lại, WebSocket `/ws` lỗi lặp lại trong console. Nguyên nhân gần như chắc chắn là Origin của tên miền không nằm trong `ALLOWED_ORIGINS` (chưa kiểm chứng trực tiếp trên server thật).

`TRUST_PROXY` nay nhận số hop 1..10 (`TRUST_PROXY_HOPS`), đã sửa và build pass; không làm lại phần này.

## Việc cần làm

### 1. Server: lý do bị từ chối phải rõ ràng nhưng không lộ thông tin
- Khi request REST/WS bị từ chối vì Origin không nằm trong allowlist, trả mã lỗi ổn định `ORIGIN_NOT_ALLOWED` (phong bì lỗi `sendError` hiện có; WS thì đóng/từ chối kèm lý do ngắn nếu giao thức cho phép) thay vì 401/lỗi chung gây hiểu nhầm là hết phiên. Không trả danh sách origin được phép cho client.
- Ghi MỘT dòng log server (giới hạn tần suất, ví dụ tối đa 1 lần/phút/origin) có Origin bị từ chối đã làm sạch và gợi ý "đặt PUBLIC_ORIGIN/ALLOWED_ORIGINS". Không log token/cookie/mật khẩu.
- Lúc khởi động, nếu `HOST` là loopback và `TRUST_PROXY_HOPS > 0` mà `PUBLIC_ORIGIN` trống (dấu hiệu chạy sau domain nhưng thiếu cấu hình), in cảnh báo rõ ràng một lần. Không làm server dừng.
- Không thay đổi logic cho phép/chặn Origin: chỉ thêm mã lỗi, log và cảnh báo.

### 2. Web: phân biệt "hết phiên" với "bị chặn Origin/mạng"
- `api.ts`: khi gặp `ORIGIN_NOT_ALLOWED`, KHÔNG gọi `notifyAuthRequired()`; hiện thông báo tiếng Việt rõ ràng (ví dụ "Tên miền này chưa được cho phép trên máy chủ. Quản trị viên cần đặt PUBLIC_ORIGIN/ALLOWED_ORIGINS trong .env rồi khởi động lại"). Màn hình đăng nhập cũng hiện thông báo này nếu đăng nhập thất bại vì lý do đó.
- `useRealtime.ts`: khi WS lỗi lặp lại do bị từ chối, hiện trạng thái kết nối realtime lỗi kèm gợi ý, không tự đăng xuất và không vòng lặp kết nối vô hạn quá dày (giữ backoff hiện có).
- Giữ nguyên hành vi 401 thật (phiên hết hạn/thu hồi) như cũ.
- Ánh xạ mã lỗi mới sang tiếng Việt cùng chỗ với các mã lỗi hiện có.

### 3. `deploy/env.example` và tài liệu
- `deploy/env.example`: đánh dấu `PUBLIC_ORIGIN` và `TRUST_PROXY` là BẮT BUỘC khi chạy sau tên miền, kèm ví dụ (`PUBLIC_ORIGIN=https://bot.example.com`, `TRUST_PROXY=1` cho Nginx/Caddy một mình, `2` khi có Cloudflare phía trước), nhắc đặt đúng số hop thật.
- `docs/DEPLOY_VPS.md`: thêm mục "Triệu chứng thường gặp": dashboard bị đẩy về đăng nhập/WS lỗi lặp lại → kiểm `PUBLIC_ORIGIN`, `ALLOWED_ORIGINS`, `TRUST_PROXY`, xem log cảnh báo mới.
- Nếu `scripts/vps-preflight.mjs` chưa kiểm `PUBLIC_ORIGIN` ↔ `ALLOWED_ORIGINS` nhất quán thì bổ sung và thêm test thuần.

## Kiểm tra

- Test tự động (không phụ thuộc đồng hồ máy): Origin lạ → `ORIGIN_NOT_ALLOWED` (REST và WS), Origin hợp lệ → như cũ, log chống spam, web không gọi `notifyAuthRequired` với mã mới, vẫn gọi với 401 thật.
- `pnpm build`, `pnpm --filter @tutien2d/web test`, và các test server liên quan (`cd apps/server && npx tsx --test <file>`) phải pass. Báo thẳng nếu fail kèm output.
- Thử bằng server tạm: `DATA_DIR` ở thư mục tạm, cổng khác 4000, `ADMIN_PASSWORD` tự đặt, gọi API với `Origin` giả (curl) để thấy mã lỗi; không dùng `data/` thật.
- Ghi báo cáo vào đầu `docs/SESSION_LOG.md` và checklist cuối `docs/FIX_GUIDE.md`; ghi rõ phần chưa xác minh (chưa chạy sau Cloudflare/Nginx thật).
