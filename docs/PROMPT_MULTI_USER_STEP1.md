# Nhiệm vụ: BƯỚC 1 hệ thống người dùng — SQLite, đăng nhập/phiên, phân quyền theo sở hữu

Đọc kỹ `docs/SPEC_MULTI_USER.md` (đã duyệt; làm đúng mục 1–5, 11 và mục "Bước 1" của mục 10), `AGENTS.md`, `docs/CONTROL_PLANE_API.md`, rồi mã hiện có: `apps/server/src/index.ts`, `security/auth.ts`, `security/errors.ts`, `security/crypto.ts`, `db/database.ts`, `api/routes.ts`, `ws/hub.ts`, `orchestrator/worker-pool.ts`, `apps/web/src/lib/auth.ts`, `lib/api.ts`, `hooks/useRealtime.ts`, `App.tsx`, `components/ApiTokenPanel.tsx`, `components/Navbar.tsx`. Nếu prompt mâu thuẫn với mã thật hoặc đặc tả, báo rõ và chọn phương án an toàn hơn.

KHÔNG chạm game thật, KHÔNG mở mạng, KHÔNG đọc/in nội dung `data/`, `apps/server/data/`, `.env*` (dùng thư mục tạm riêng qua `DATA_DIR` trong test). Không commit. Không sửa `vendor/`, `headless/` (engine vendor, daily, walk, khu, auto-supervisor) trừ khi bắt buộc để nối chủ sở hữu; không đổi hành vi bot. Sandbox của bạn không build được: tự rà kiểu TypeScript, import (đuôi `.js` trong server), chuỗi tiếng Việt UTF-8; người giao việc sẽ chạy `pnpm build` và toàn bộ test.

## BÀI HỌC BẮT BUỘC (đã gặp ở các đợt trước)

1. Test do bạn viết phải chạy được và không phụ thuộc thời gian thực: dùng thư mục dữ liệu tạm cho SQLite (`DATA_DIR` hoặc tham số đường dẫn), đồng hồ/giờ tiêm vào được, không `sleep` dài; chờ có điều kiện bằng thăm dò, cửa sổ vài giây.
2. Tham số có giá trị mặc định phải khai báo kiểu tường minh (ví dụ `message: string = code`).
3. Làm sạch chuỗi từ máy chủ/nhập liệu: đổi ký tự điều khiển thành khoảng trắng RỒI gộp khoảng trắng.
4. Không in/ghi log mật khẩu, token, băm, `selfId`, URL proxy. `/api` lỗi dùng cùng phong bì `{success:false,error,errorCode,requestId,retryable}` hiện có.
5. Test hợp đồng hiện có (`daily.contract`, `khu.contract`, `vendor-auto.contract`, ...) đang gọi route với auth tắt: sửa fixture của chúng cho phù hợp (ví dụ tiêm principal admin giả hoặc dùng helper tạo phiên) mà KHÔNG làm yếu kiểm tra của chúng.
6. Các script đo live ngoài repo (`dlib.cjs`) gọi API không auth trên loopback: bước này SẼ làm chúng cần đăng nhập; không cố giữ tương thích bằng cách mở lỗ hổng.

## Việc cần làm

### 1. Lưu trữ SQLite (`node:sqlite`, `DatabaseSync`)
- Tạo lớp lưu trữ SQLite trong `apps/server/src/db/` (file `tutien_db.sqlite` trong `DATA_DIR`), bật `PRAGMA journal_mode=WAL`, `foreign_keys=ON`; bảng `users`, `sessions`, `game_accounts`, `bot_configs`, `logs` (các bảng `proxies`, `grants`, `audit_log` để bước sau; có thể tạo luôn bảng `audit_log` nếu cần ghi hành động quản trị ở bước này). Đúng cột theo mục 3 của đặc tả (bước này `max_bots` mặc định 3 chỉ lưu, chưa ép; `expires_at` chỉ lưu).
- Giữ API công khai của `DatabaseService` (các hàm tài khoản/log/botConfig đang dùng ở `routes.ts`/`worker-pool.ts`) nhưng chạy trên SQLite; thêm tham số/chỉ mục theo `owner_id` khi cần. Giữ cơ chế mã hóa AES-256-GCM hiện có cho mật khẩu/refresh token/token cũ và `proxyUrl` (mã hóa khi lưu; `PublicGameAccount` vẫn loại bí mật và `proxyUrl`).
- Di chuyển một lần: nếu có `tutien_db.json` và chưa có SQLite → đọc, chuyển tài khoản/botConfigs/logs sang SQLite, gán mọi tài khoản cho admin, đổi tên file JSON thành `tutien_db.json.migrated` (không xoá). Idempotent; hỏng thì không làm mất dữ liệu cũ. `flush()` giữ nguyên chữ ký (shutdown gọi nó) nhưng có thể là no-op/đóng DB an toàn. Log vẫn giới hạn ~2000 dòng gần nhất.

### 2. Người dùng, mật khẩu, phiên (`apps/server/src/security/` hoặc `auth/`)
- Băm mật khẩu bằng `crypto.scrypt` (salt ngẫu nhiên, tham số ghi trong chuỗi băm, so sánh `timingSafeEqual`). Không thêm thư viện.
- Phiên: token ngẫu nhiên 32 byte (base64url), chỉ lưu sha256; hạn 7 ngày trượt theo lần dùng; tối đa 5 phiên/người (vượt thì xoá phiên cũ nhất); thu hồi hết khi đổi/đặt lại mật khẩu, khóa hoặc xoá người dùng.
- Admin đầu tiên: nếu chưa có admin khi khởi động → tạo `admin` (hoặc `ADMIN_USERNAME`) với mật khẩu `admin123` (hoặc `ADMIN_PASSWORD`), `must_change_password = true`. Ghi cảnh báo (KHÔNG in mật khẩu) vào console mỗi lần khởi động khi admin còn `must_change_password`.
- Tên đăng nhập: chuẩn hóa (cắt khoảng trắng đầu/cuối, thường hóa để so sánh duy nhất, không rỗng, tối đa 64 ký tự, làm sạch ký tự điều khiển), không giới hạn ký tự khác. Mật khẩu tối thiểu 6 ký tự.
- Chống dò mật khẩu: giới hạn theo IP và theo username (5 lần sai/15 phút → 429 `TOO_MANY_ATTEMPTS`, `Retry-After`), phản hồi sai tên/sai mật khẩu giống nhau (`INVALID_CREDENTIALS`), so sánh băm giả khi không có người dùng để tránh lộ thời gian. Bộ đếm trong bộ nhớ, đồng hồ tiêm được.
- `API_TOKEN` cũ: nếu đặt, chấp nhận như một principal admin đặc biệt CHỈ khi request đến từ loopback và bind loopback (tắt hẳn khi bind ngoài loopback trừ khi `ALLOW_LEGACY_API_TOKEN=1`); không đặt thì không có đường vào không auth: auth LUÔN bắt buộc. Cập nhật `config.ts` tương ứng (giữ kiểm tra: bind ngoài loopback bắt buộc HTTPS qua reverse proxy được ghi trong tài liệu, vẫn giữ rule `API_TOKEN` >= 32 nếu dùng; đọc `ADMIN_*`, `TRUST_PROXY`).

### 3. API xác thực và quản trị tối thiểu
- `POST /api/auth/login {username,password}` (KHÔNG cần auth, giới hạn tần suất) → `{token, user:{id,username,role,expiresAt,maxBots,mustChangePassword}, sessionExpiresAt}`; `POST /api/auth/logout`; `GET /api/auth/me`; `POST /api/auth/password {currentPassword,newPassword}` (đổi mật khẩu của chính mình, bỏ cờ `must_change_password`, thu hồi các phiên khác, giữ phiên hiện tại).
- Quản trị (chỉ admin): `GET/POST /api/admin/users` (tạo kèm `username`, `password`, tùy chọn `maxBots`), `PATCH /api/admin/users/:id` (`status` active/disabled, `maxBots`), `POST /api/admin/users/:id/password` (đặt lại mật khẩu, không cần mật khẩu cũ), `DELETE /api/admin/users/:id` (dừng mọi runner của họ rồi xoá toàn bộ tài khoản game, cấu hình, log, phiên của họ; cấm xoá/khóa chính mình hoặc admin cuối cùng; chặn nếu còn runner không dừng được). Ghi `audit_log` cho các hành động này (đã làm sạch). Phản hồi người dùng không bao giờ chứa băm mật khẩu hay token.
- `/api/auth/login` và `/health` là route công khai duy nhất; mọi `/api/**` khác qua `authenticate` gắn `req.principal` (`userId`, `role`).

### 4. Phân quyền theo sở hữu (REST và WS)
- Middleware `loadOwnedAccount` cho mọi route `/api/accounts/:id/**`: admin truy cập mọi tài khoản; người dùng chỉ tài khoản có `owner_id` của mình, ngược lại 404 (`ACCOUNT_NOT_FOUND`, không lộ tồn tại). `POST /api/accounts` gán `owner_id` = người gọi. `GET /api/accounts`, `/api/logs`, `GET /api/accounts/:id/logs`, `/api/system/status` (người dùng thường chỉ thấy số liệu của mình, không lộ bộ nhớ/hệ thống chi tiết), `/api/orchestrator/start-all|stop-all` (chỉ tác động tài khoản của người gọi; admin: tất cả) đều lọc theo principal. `/api/maps*` chỉ cần đăng nhập.
- Hub WebSocket: xác thực bằng phiên (subprotocol `bearer`, giữ nguyên cách hiện tại), mỗi kết nối gắn principal; `initial_state` và mọi `broadcast` (`account_updated`, `account_log`, `bot_activity`, `system_alert`) chỉ gửi cho chủ sở hữu tài khoản đó và admin; thông điệp không gắn tài khoản (system_alert chung) chỉ gửi admin hoặc theo quy tắc an toàn bạn nêu rõ. Đóng kết nối WS khi phiên bị thu hồi/hết hạn/người dùng bị khóa hoặc xoá (kiểm tra định kỳ và khi thu hồi). Chốt chặn Origin giữ nguyên.
- Hợp đồng: có test cho MỌI route dưới `/api/accounts/**` rằng người dùng A không đọc/ghi/điều khiển được tài khoản của B (404), người dùng thường gọi `/api/admin/**` nhận 403, không token nhận 401, token hết hạn nhận 401.
- Đổi `getAllRuntimes()`/broadcast ở `worker-pool.ts` tối thiểu cần để biết chủ sở hữu (tra `owner_id` theo `accountId`); không đổi hành vi bot/engine.

### 5. Giao diện web (tối thiểu, bước 4 sẽ làm giao diện admin đầy đủ)
- Màn hình đăng nhập thay `ApiTokenPanel` (tên đăng nhập + mật khẩu, thông báo lỗi tiếng Việt, 429 hiện "thử lại sau N giây"); lưu token như hiện nay ở `sessionStorage` qua `lib/auth.ts`; 401 → về màn hình đăng nhập; WS dùng token phiên.
- Thanh trên: tên người dùng, vai trò, nút Đăng xuất, mục "Quản lý tài khoản" (modal đổi mật khẩu của chính mình, dùng `lib/dialogs.ts`, không `alert/confirm` gốc). Banner đỏ cố định khi `mustChangePassword` (hoặc admin còn mật khẩu mặc định) cho tới khi đổi.
- Không thêm tab quản trị ở bước này. Giữ nguyên bố cục/tính năng hiện có, chiều ngang không tràn ở 334 px (xem `Navbar.tsx` đã sửa). Cập nhật `types/index.ts`, `lib/api.ts`, `useRealtime.ts` (sanitizer trả `undefined` khi sai kiểu). Vitest cho logic mới (`pnpm --filter @tutien2d/web test`, hiện 33 test).

### 6. Test (server)
`cd apps/server && npx tsx --test <file>`, mỗi file một lệnh. Giữ nguyên test hiện có (hiện: `daily-quests` 35, `daily.contract` 1, `vendor-runner` 19, `walk-navigator` 13, `map-route` 3, `vendor-env` 3, `vendor-auto.contract` 2, `auto-supervisor` 2, `khu.contract` 1, `engine-selection` 1). Thêm: băm/kiểm mật khẩu; phiên (tạo, trượt hạn, hết hạn, giới hạn 5, thu hồi); chuẩn hóa tên và trùng tên không phân biệt hoa thường; tạo admin lần đầu và cờ `must_change_password`; rate-limit đăng nhập với đồng hồ giả; di chuyển JSON → SQLite (dữ liệu mẫu tạm, idempotent, đổi tên `.migrated`); mã hóa bí mật vẫn không lộ qua `PublicGameAccount`; hợp đồng phân quyền REST (ma trận admin/A/B/không token); WS chỉ nhận dữ liệu của mình và bị đóng khi thu hồi phiên; xoá người dùng xoá dữ liệu liên quan và cấm xoá admin cuối.

### 7. Tài liệu
Cập nhật `docs/CONTROL_PLANE_API.md` (auth, phân quyền, route mới, lỗi), `docs/SESSION_LOG.md` (mục ĐẦU), checklist cuối `docs/FIX_GUIDE.md`, ghi "bước 1 đã triển khai (offline)" vào `docs/SPEC_MULTI_USER.md`, cập nhật mục Bảo mật của `AGENTS.md` nếu quy tắc xác thực thay đổi (giữ nguyên các quy tắc khác).

## Báo cáo cuối

File sửa/thêm, quyết định thiết kế (nơi lọc WS, cách tra chủ sở hữu, xử lý `API_TOKEN` cũ), những gì CHƯA xác minh (độ bền WAL khi crash, hành vi trên Linux, đóng WS khi phiên hết hạn khi chạy thật, hiệu năng lọc broadcast với nhiều tài khoản), lệnh người giao việc cần chạy. Không tuyên bố build/test pass nếu không chạy được.
