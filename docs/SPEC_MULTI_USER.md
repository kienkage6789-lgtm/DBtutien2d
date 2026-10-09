# Đặc tả: phân quyền người dùng / admin, thời hạn, hạn mức, proxy (bản nháp để duyệt)

Cập nhật: 2026-10-09. Chưa có mã nào được viết theo đặc tả này.

## 1. Quyết định đã chốt (từ chủ dự án)

1. Chỉ có MỘT tài khoản admin ban đầu (chủ dự án). Không cho tự đăng ký; admin tạo/xoá người dùng. Admin quản lý toàn bộ.
2. Hạn mức: MỘT con số `maxBots` cho mỗi người dùng, mặc định 3 (mức cơ bản) = số tài khoản game được thêm = số bot được chạy cùng lúc. Admin nâng/hạ theo từng người.
3. Hết hạn sử dụng: NGẮT KẾT NỐI toàn bộ bot của người dùng đó (dừng ngay, không ân hạn).
4. Proxy cố định (không xoay), loại `http` hoặc `socks5`.
5. Lưu trữ: SQLite qua `node:sqlite` có sẵn trong Node 24 (đã thử: chạy được ở Node v24.16.0). Giữ nguyên key mã hóa AES-GCM hiện có cho mật khẩu/token/URL proxy.
6. Triển khai trên VPS, nhiều người truy cập qua internet → bắt buộc HTTPS và gia cố (mục 8).

## 2. Hiện trạng (đã kiểm tra trong mã)

- `security/auth.ts`: một `API_TOKEN` dùng chung cho REST (`requireAuth`) và WS (subprotocol `bearer`).
- `db/database.ts`: JSON `tutien_db.json`; `DbUser {id,email,role,createdAt}` và `DbGameAccount.userId` đã có nhưng không dùng để phân quyền; `proxyUrl` có lưu nhưng KHÔNG có mã nào dùng khi đăng nhập hay mở WebSocket (chưa xác minh bằng chạy thật).
- Hai điểm ra mạng cần gắn proxy: `fetch` trong `packages/core-client/src/auth/supabase-auth.ts` (đăng nhập Supabase) và lớp WebSocket `ws` tạo ở `vendor-runner.ts` (`createEnvironment`, đã có điểm tiêm `WebSocketImpl`). Vòng `node:vm` của vendor không có mạng riêng.
- `ws/hub.ts` và `/api/accounts`, `/api/logs` hiện trả dữ liệu mọi tài khoản cho mọi người gọi.

## 3. Mô hình dữ liệu (SQLite)

- `users`: `id`, `username` (duy nhất, chữ thường), `password_hash` (scrypt + salt), `role` (`admin`|`user`), `status` (`active`|`disabled`), `expires_at` (ms, null = chưa cấp/đã hết), `max_bots` (mặc định 3), `must_change_password`, `created_at`, `created_by`, `last_login_at`.
- `sessions`: `id`, `user_id`, `token_hash` (sha256), `created_at`, `expires_at`, `last_seen_at`, `ip`, `user_agent`. Token ngẫu nhiên 32 byte; chỉ lưu băm; thu hồi được (đổi mật khẩu/khóa/xoá người dùng thu hồi hết).
- `proxies`: `id`, `label`, `scheme` (`http`|`socks5`), `url_encrypted`, `max_accounts`, `status` (`unknown`|`ok`|`down`), `last_check_at`, `last_error`, `created_at`.
- `game_accounts`: giữ các cột hiện có; thêm `owner_id` (từ `userId`), `proxy_id`.
- `grants`: lịch sử cấp thời hạn `user_id`, `granted_by`, `duration` (`1d`|`7d`|`30d`|`custom`), `from_at`, `to_at`, `created_at`.
- `audit_log`: `actor_id`, `action`, `target_type`, `target_id`, `detail` (đã làm sạch, không bí mật), `at`.
- `logs`, `bot_configs`: như hiện tại, chuyển bảng; log lọc theo chủ sở hữu tài khoản.
- Di chuyển: lần chạy đầu đọc `tutien_db.json`, chuyển sang SQLite (sao lưu file cũ), tài khoản game cũ gán cho admin. Không xoá file JSON tự động.

## 4. Xác thực và phiên

- `POST /api/auth/login {username,password}` → `{token, user, expiresAt}`; `POST /api/auth/logout`; `GET /api/auth/me`; `POST /api/auth/password` (đổi mật khẩu của chính mình).
- Token gửi `Authorization: Bearer ...` (REST) và subprotocol `bearer` (WS), giữ cách hiện tại; không đưa vào query string.
- Hạn phiên 7 ngày, trượt theo lần dùng; tối đa 5 phiên/người.
- Admin đầu tiên: khi khởi động lần đầu mà chưa có admin, tự tạo `admin` / `admin123` (theo yêu cầu chủ dự án), đặt `must_change_password = true`. RỦI RO: mật khẩu mặc định yếu trên VPS công khai; giảm thiểu: giao diện hiện banner đỏ cố định cho tới khi đổi, máy chủ ghi cảnh báo khi còn mật khẩu mặc định, rate-limit đăng nhập (dưới đây) vẫn áp dụng; khuyến nghị đổi ngay trước khi mở ra internet. Có thể đặt `ADMIN_USERNAME`/`ADMIN_PASSWORD` qua biến môi trường để ghi đè mặc định. Không in mật khẩu ra log.
- `API_TOKEN` cũ: chỉ còn dùng cho script nội bộ/đo live trên loopback (tương đương admin), tắt được bằng cấu hình; bị TỪ CHỐI khi bind ngoài loopback trừ khi đặt cờ rõ ràng.
- Tên đăng nhập không giới hạn ký tự; chỉ chuẩn hóa (cắt khoảng trắng đầu/cuối, so sánh không phân biệt hoa thường, không rỗng, tối đa 64 ký tự để chặn dữ liệu rác). Mật khẩu: người dùng/admin ĐỔI được mật khẩu của chính mình; admin đặt lại mật khẩu của người dùng; mật khẩu mới tối thiểu 6 ký tự (admin đặt mật khẩu đơn giản được, đổi sau).
- Chống dò mật khẩu: giới hạn theo IP + theo username (ví dụ 5 lần sai/15 phút → khóa tạm), phản hồi lỗi giống nhau cho sai tên/sai mật khẩu.

## 5. Phân quyền

- Middleware `authenticate` gắn `req.principal = {userId, role}`; WS gắn principal theo kết nối.
- `loadOwnedAccount(:id)`: admin truy cập mọi tài khoản; người dùng chỉ tài khoản có `owner_id` của mình, ngược lại trả 404 (không lộ sự tồn tại).
- Mọi route `/api/accounts/**`, `/api/orchestrator/*`, `/api/logs` được lọc/giới hạn theo principal (`start-all`/`stop-all` của người dùng chỉ tác động tài khoản của họ).
- Hub WS: mỗi kết nối chỉ nhận runtime/log của tài khoản mình sở hữu; admin nhận tất cả. Có test hợp đồng cho mọi route (người dùng A không đọc/ghi/điều khiển được tài khoản B).
- `/api/admin/**` chỉ `role=admin`. Người dùng không bao giờ nhận `proxy`, `proxy_id`, URL proxy hay dữ liệu bí mật; admin cũng KHÔNG có API giải mã mật khẩu game.

## 6. Thời hạn và hạn mức

- Cấp thời hạn: `POST /api/admin/users/:id/grant {duration: "1d"|"7d"|"30d"}`. `to_at = max(now, expires_at) + duration` (cộng dồn khi gia hạn sớm). Người dùng mới tạo có `expires_at = null` (chưa được chạy bot) cho tới khi admin cấp.
- Bộ quét `EntitlementWatcher` (mỗi 30 s và khi có thay đổi): với người dùng hết hạn hoặc `disabled` → dừng mọi runner của họ (`stop`), ghi `audit_log` + nhật ký tài khoản, đặt trạng thái hiển thị "hết hạn". Người dùng hết hạn vẫn đăng nhập xem được, không bật được bot (`403 ENTITLEMENT_EXPIRED`).
- Hạn mức: `POST /accounts` kiểm `max_bots` (`403 QUOTA_BOTS`: số tài khoản của người dùng đã bằng `max_bots`); vì số tài khoản ≤ `max_bots` nên số bot chạy cùng lúc cũng ≤ `max_bots`; `start`/`auto/start`/`start-all` kiểm hết hạn/khóa. Trần toàn máy chủ `MAX_TOTAL_RUNNERS` (mặc định đặt theo RAM VPS sau khi đo) → `503 SERVER_CAPACITY`.
- Giờ chuẩn: thời gian máy chủ (UTC), lưu ms; giao diện hiển thị theo giờ trình duyệt kèm đếm ngược.
- Xoá người dùng: dừng runner → xoá tài khoản game, cấu hình, log, phiên, bí mật của người đó trong một giao dịch; cần xác nhận hai bước trong giao diện; khuyến nghị dùng "khóa" thay vì "xoá". Admin không tự xoá/khóa chính mình, luôn còn ít nhất một admin.

## 7. Proxy

- Admin CRUD proxy: `POST/GET/PUT/DELETE /api/admin/proxies`, `POST /api/admin/proxies/:id/check` (kiểm tra kết nối thật: gọi qua proxy tới đích kiểm tra và tới `GAME_SERVER_URL` handshake, đo độ trễ).
- Gán: `PUT /api/admin/accounts/:id/proxy {proxyId|null}`, hoặc tự gán proxy ít tải nhất còn chỗ (`max_accounts`) khi tạo tài khoản (cấu hình bật/tắt). Gán cố định (sticky), đổi proxy cần dừng bot.
- Bắt buộc hay tuỳ chọn: cấu hình `REQUIRE_PROXY` (mặc định bật trên VPS): tài khoản chưa có proxy → không cho chạy (`409 PROXY_REQUIRED`).
- Gắn proxy vào CẢ hai điểm ra mạng của MỘT tài khoản: (a) `fetch` đăng nhập/refresh Supabase qua `undici` `ProxyAgent` (http) hoặc đại lý socks tương ứng, nhận `dispatcher`/`fetch` tiêm vào `SupabaseAuth`; (b) lớp WebSocket tiêm qua `WebSocketImpl` truyền `agent` (`https-proxy-agent` cho http, `socks-proxy-agent` cho socks5). Thêm các phụ thuộc này.
- Fail-closed: tài khoản đã gán proxy mà proxy `down`/không kết nối được → bot KHÔNG chạy và KHÔNG tự đi thẳng bằng IP máy chủ; mã lỗi `PROXY_UNAVAILABLE`; kiểm tra proxy định kỳ (5 phút) và trước khi start.
- Một proxy có thể phục vụ nhiều tài khoản (tới `max_accounts`); quy tắc "mỗi tài khoản game chỉ một phiên đăng nhập" của AGENTS.md giữ nguyên.
- Chưa xác minh (cần đo live): game server/Supabase có chấp nhận IP proxy; độ trễ qua proxy ảnh hưởng nhịp vendor; socks5 với WebSocket TLS ổn định.

## 8. Gia cố cho VPS

- Chạy sau reverse proxy HTTPS (Caddy/Nginx + Let's Encrypt); Node chỉ bind `127.0.0.1`, reverse proxy nhận 443. `ALLOWED_ORIGINS` đúng tên miền thật; không dùng `*`.
- Tôn trọng `X-Forwarded-For` chỉ khi từ reverse proxy tin cậy (`trust proxy`) để rate-limit đúng IP.
- Header bảo mật (HSTS, `X-Content-Type-Options`, CSP cho bản build web); giới hạn kích thước body; log yêu cầu không chứa token/mật khẩu.
- Sao lưu SQLite + khóa `.secret` (mất khóa = mất mật khẩu game đã mã hóa); chạy bằng systemd/pm2 tự khởi động lại; không tự bật Auto khi khởi động (giữ quy tắc AGENTS.md); khi khởi động lại, kiểm hết hạn trước khi cho bot chạy lại.
- Chưa xác minh: vendor runner chạy ổn trên Linux VPS (hiện mới chạy trên Windows), mức RAM/CPU mỗi runner, số runner tối đa mỗi VPS (cần đo soak).

## 9. Giao diện

- Màn hình đăng nhập (thay `ApiTokenPanel`); đăng xuất; mục "Quản lý tài khoản" cho mọi người dùng có đổi mật khẩu.
- Người dùng: danh sách tài khoản của mình như hiện nay, thêm thanh "Hạn dùng còn ... · Bot n/3"; hết hạn thì khóa nút Chạy kèm thông báo.
- Admin: thêm tab "Quản trị" gồm Người dùng (tạo kèm mật khẩu ban đầu do admin đặt, khóa/mở, xoá, +1 ngày/+1 tuần/+1 tháng, sửa `max_bots`, đặt lại mật khẩu), Proxy (thêm/sửa/kiểm tra/gán), Tài khoản toàn hệ thống (xem runtime, buộc dừng, gán proxy), Nhật ký kiểm toán. Chọn chủ sở hữu khi xem tài khoản.
- Dùng lại `lib/dialogs.ts` cho xác nhận; không dùng `alert/confirm` gốc.

## 10. Các bước triển khai (mỗi bước có test, build, tài liệu riêng)

1. SQLite + di chuyển dữ liệu + users/sessions/auth + phân quyền theo sở hữu cho REST và WS + giao diện đăng nhập tối thiểu.
2. Thời hạn + hạn mức + `EntitlementWatcher` + audit.
3. Proxy: CRUD, kiểm tra, gắn vào đăng nhập và WebSocket, fail-closed (đo live riêng, bắt đầu bằng một proxy thật).
4. Giao diện quản trị đầy đủ.
5. Gia cố VPS (HTTPS, rate-limit, sao lưu, tài liệu triển khai), đo soak trên Linux.

## 11. Đã chốt thêm (2026-10-09)

- Tên đăng nhập không giới hạn ký tự (chỉ chuẩn hóa như mục 4). Admin đặt mật khẩu ban đầu cho người dùng; có chức năng đổi mật khẩu trong quản lý tài khoản. Gia hạn chỉ admin cấp tay. Mỗi người dùng mặc định 3 bot, admin mở thêm.
- Còn mở (không chặn bước 1): giới hạn số phiên dashboard đồng thời của một người (đề xuất 5).

## Trạng thái bước 1 (2026-10-09)

Bước 1 đã triển khai offline trong repo: SQLite/WAL và migration JSON một lần, users/sessions/password scrypt, login/logout/me/đổi mật khẩu, admin user tối thiểu, ownership REST/WS và giao diện đăng nhập tối thiểu. Chưa triển khai ở bước này: entitlement/quota enforcement, proxy CRUD/kiểm tra/gắn vào network, EntitlementWatcher và giao diện quản trị đầy đủ.

## Trạng thái bước 2 (2026-10-09)

Bước 2 đã triển khai offline trong repo: tính/cộng dồn grant, bảng `grants`, trạng thái entitlement và usage, quota tài khoản, gate quyền chạy, `MAX_TOTAL_RUNNERS`, `EntitlementWatcher` dừng runner/audit/system alert, endpoint admin cấp/đặt hạn và dashboard hiển thị hạn mức/khóa điều khiển. Người hết hạn vẫn được thêm tài khoản nếu còn quota; hạ `maxBots` không tự dừng runner đang chạy. Chưa xác minh live: lệch đồng hồ server/trình duyệt, tải watcher với nhiều trăm user, dừng runner giữa nhiệm vụ và giới hạn runner theo RAM VPS.
