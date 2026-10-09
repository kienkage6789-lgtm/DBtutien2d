# Nhiệm vụ: BƯỚC 4 hệ thống người dùng — giao diện quản trị (admin)

Đọc kỹ `docs/SPEC_MULTI_USER.md` (mục 9 giao diện, mục 5–6 phân quyền/thời hạn, mục 11), `AGENTS.md`, `docs/CONTROL_PLANE_API.md` (route `/api/admin/*` hiện có), `docs/PROMPT_MULTI_USER_STEP1.md` và `STEP2.md` (đã làm, commit `0a7cf7c`, `343504a`), rồi mã hiện có. Server: `apps/server/src/api/routes.ts` (`requireAdmin`, `GET/POST /admin/users`, `PATCH /admin/users/:id`, `POST /admin/users/:id/password|grant|expiry`, `DELETE /admin/users/:id`), `db/database.ts` (`audit_log`, `addAuditLog`, `getUsers`, usage), `security/entitlement.ts`, `orchestrator/worker-pool.ts` (`stopAccountsForOwner`, `getRuntimeInfo`), `ws/hub.ts`. Web: `App.tsx`, `components/Navbar.tsx`, `AccountCard.tsx`, `UserPasswordModal.tsx`, `AddAccountModal.tsx`, `lib/api.ts`, `lib/auth.ts`, `lib/dialogs.ts` (+`DialogHost`), `lib/entitlement.ts`, `types/index.ts`, `hooks/useRealtime.ts`. Test đầu-cuối: `apps/server/src/api/multi-user.e2e.test.ts`. Nếu prompt mâu thuẫn với mã thật hoặc đặc tả, báo rõ và chọn phương án an toàn hơn.

KHÔNG chạm game thật, KHÔNG mở mạng, KHÔNG đọc/in nội dung `data/`, `apps/server/data/`, `.env*` (test dùng thư mục tạm). Không commit. Không sửa `vendor/`, `headless/`. Chưa làm proxy (bước 3): KHÔNG thêm tab/route/cột proxy. Sandbox của bạn không build được: tự rà kiểu TypeScript, import (đuôi `.js` trong server), chuỗi tiếng Việt UTF-8; người giao việc sẽ chạy `pnpm build` và toàn bộ test.

## BÀI HỌC BẮT BUỘC (đã gặp ở các đợt trước)

1. Trình duyệt nhúng chặn `alert()/confirm()/prompt()` gốc: mọi xác nhận/thông báo dùng `confirmAction`/`notify` trong `lib/dialogs.ts`; mọi nhập liệu (tên, mật khẩu, số) dùng modal/biểu mẫu trong trang.
2. Giao diện không được làm trang tràn ngang ở 334 px (bảng phải cuộn ngang TRONG khung của nó hoặc đổi thành thẻ trên màn hình hẹp; không để `scrollWidth` của trang > chiều rộng viewport). Điều khiển `hidden` kèm class `flex` bị Tailwind đè: dùng `hidden` qua class/điều kiện render, không dùng thuộc tính `hidden` cùng `flex`.
3. Dữ liệu chưa biết hiển thị "chưa biết", không thay bằng 0. Sanitizer trong `useRealtime.ts`/`api.ts` trả `undefined` khi sai kiểu.
4. Không in/ghi log mật khẩu, token, băm. Mật khẩu nhập trong modal không lưu ở nơi nào khác ngoài state tạm, xoá khi đóng. Lỗi `/api` dùng phong bì `{success:false,error,errorCode,requestId,retryable}` qua `sendError`; ánh xạ mã lỗi mới sang tiếng Việt trong `friendlyErrorMessage`.
5. Test do bạn viết không phụ thuộc thời gian thực; tham số mặc định khai báo kiểu tường minh; làm sạch chuỗi (ký tự điều khiển → khoảng trắng RỒI gộp khoảng trắng).
6. Quyền: mọi route mới dưới `/api/admin/**` qua `requireAdmin`; người dùng thường 403, không token 401. Người dùng thường KHÔNG nhận trường của người khác.

## Việc cần làm

### 1. Server: bổ sung API cho giao diện admin
- `GET /api/admin/users` trả thêm cho mỗi người: `createdAt`, `lastLoginAt`, `createdBy` (username hoặc null), `usage: { accounts, running, maxBots }`, `entitlement` (đã có), số phiên đang hoạt động (`activeSessions`). Không bao giờ trả băm mật khẩu/token/băm phiên.
- `POST /api/admin/users/:id/stop-bots`: dừng mọi runner của người đó (`stopAccountsForOwner`), `audit_log` (`admin_stop_bots`, số tài khoản đã dừng), trả `{ stopped: number }`; cho phép với người bất kỳ kể cả hết hạn/khóa.
- `POST /api/admin/users/:id/revoke-sessions`: thu hồi mọi phiên của người đó (buộc đăng nhập lại), audit; không tự thu hồi phiên hiện tại của admin nếu chính mình (trả 409 hoặc giữ phiên hiện tại — chọn và ghi rõ).
- `GET /api/admin/audit?limit=50&before=<at ms>`: danh sách nhật ký kiểm toán mới nhất trước, `limit` 1..200, mỗi dòng `{ id, at, action, actor: {id, username}|null, targetType, targetId, targetName?, detail }` (tra tên người dùng nếu còn tồn tại, người đã xoá thì chỉ id), `detail` đã làm sạch/giới hạn độ dài, không chứa bí mật; kèm `nextBefore` để phân trang. Bổ sung ghi `audit_log` cho các hành động quản trị CHƯA có (nếu thiếu): tạo/khóa/mở/xoá người dùng, đặt lại mật khẩu, đổi `maxBots`, cấp hạn/đặt hạn, dừng bot, thu hồi phiên, đăng nhập admin thành công/thất bại (đăng nhập thất bại chỉ ghi tên đã chuẩn hóa và IP, không mật khẩu; giới hạn tần suất ghi để không phình bảng).
- Runtime tài khoản (REST `GET /api/accounts`, WS `account_updated`/`initial_state`): thêm `ownerId` và `ownerUsername` để admin thấy chủ sở hữu; người dùng thường chỉ thấy tài khoản của chính mình nên các trường này không lộ ai khác; cập nhật `AccountRuntimeInfo`, sanitizer web, test hợp đồng liên quan.
- Giới hạn hiện có phải còn nguyên: không xoá/khóa chính mình hay admin cuối cùng; admin không tự đặt hạn cho admin; `PATCH` `maxBots` 0..1000.

### 2. Web: khung và điều hướng
- Với `role === 'admin'`, thêm điều hướng hai mục "Bảng điều khiển" (như hiện nay) và "Quản trị" (state trong `App.tsx`, nhớ lựa chọn trong `sessionStorage` bọc try/catch; không cần router). Người dùng thường không thấy mục Quản trị; nếu cố mở (state/URL) thì không render và server vẫn 403.
- Chiều ngang không tràn ở 334 px; điều hướng dùng được trên điện thoại (cuộn ngang trong khung hoặc xuống dòng).

### 3. Tab "Người dùng"
- Danh sách (bảng trên màn hình rộng, thẻ trên màn hình hẹp): tên, vai trò, trạng thái (Hoạt động/Khóa), hạn dùng (đếm ngược + ngày giờ đầy đủ khi rê chuột/nhấn; "Chưa cấp" / "Hết hạn" / "Admin — không hết hạn"), "Bot đang chạy m · Tài khoản n/maxBots", lần đăng nhập cuối. Tải lại thủ công và tự làm mới mỗi 30 s khi tab đang mở; tìm kiếm theo tên.
- Tạo người dùng: modal (tên đăng nhập, mật khẩu ban đầu có nút hiện/ẩn và nút "Tạo mật khẩu ngẫu nhiên" bằng `crypto.getRandomValues`, `maxBots` mặc định 3); sau khi tạo hiển thị MỘT LẦN mật khẩu vừa tạo kèm nút Sao chép trong modal đóng được (không lưu ở đâu).
- Mỗi dòng có menu hành động: Cấp +1 ngày / +1 tuần / +1 tháng (xác nhận), Đặt hạn tuyệt đối (chọn ngày giờ) / Thu hồi hạn (đặt hết hạn ngay, xác nhận), Sửa `maxBots` (số nguyên 0..1000), Khóa/Mở khóa, Đặt lại mật khẩu (modal; thu hồi phiên theo hành vi server), Dừng toàn bộ bot của người này, Buộc đăng xuất (thu hồi phiên), Xóa người dùng (xác nhận hai bước: gõ lại tên người dùng; nêu rõ sẽ xoá toàn bộ tài khoản game/cấu hình/log của họ; `danger`). Vô hiệu hoá/ẩn các hành động không hợp lệ với chính mình, với admin (không cấp hạn cho admin) và không cho xóa/khóa admin cuối.
- Mọi thao tác: hiển thị trạng thái đang xử lý, khoá nút chống bấm đôi, lỗi qua `notify`, thành công làm mới danh sách; mã lỗi mới ánh xạ tiếng Việt.

### 4. Tab "Tài khoản toàn hệ thống"
- Lưới/bảng mọi tài khoản game: chủ sở hữu, tên tài khoản, trạng thái (đang chạy/dừng/lỗi), map, HP nếu có, `hurtCount`, Auto bật/tắt, kết nối; lọc theo chủ sở hữu và theo trạng thái; cập nhật theo realtime sẵn có (dùng cùng nguồn `accounts` của `App.tsx`, không mở WebSocket thứ hai).
- Hành động admin: Dừng (nút buộc dừng tài khoản, xác nhận), mở nhanh nhật ký của tài khoản đó. KHÔNG hiển thị mật khẩu/token/proxy; KHÔNG thêm điều khiển game mới ở tab này (đi map/đổi khu/nhiệm vụ vẫn nằm ở thẻ tài khoản ở Bảng điều khiển như hiện nay; admin thấy mọi thẻ như cũ, có thêm nhãn chủ sở hữu trên thẻ nếu khác admin).

### 5. Tab "Nhật ký kiểm toán"
- Bảng thời gian (giờ trình duyệt) / người thực hiện / hành động (nhãn tiếng Việt cho từng `action`) / đối tượng / chi tiết; nút "Tải thêm" theo `nextBefore`; lọc nhanh theo hành động hoặc theo người dùng (phía client trên dữ liệu đã tải là đủ). Mã hành động lạ hiển thị nguyên văn đã làm sạch.

### 6. Thanh trên và các chỗ nhỏ
- Admin: hiển thị rõ "quản trị" (đã có); banner mật khẩu mặc định giữ nguyên. Với người dùng thường, thanh hạn dùng/"Bot n/m" giữ như bước 2.
- Dọn: `ApiTokenPanel.tsx` nếu không còn được dùng thì xoá (kiểm tra import) hoặc ghi rõ lý do giữ.

### 7. Test
- Server (`cd apps/server && npx tsx --test <file>`, mỗi file một lệnh): giữ nguyên test hiện có; thêm hợp đồng cho `GET /admin/users` (usage, không lộ băm), `stop-bots`, `revoke-sessions`, `GET /admin/audit` (phân trang `before`, `limit` biên, làm sạch `detail`, người đã xoá), quyền (người dùng thường 403, không token 401), audit được ghi cho mỗi hành động quản trị; mở rộng `multi-user.e2e.test.ts` (chạy máy chủ thật với dữ liệu tạm) bao quát các route mới và việc runtime có `ownerUsername` chỉ ở phạm vi cho phép; thêm mutation nhỏ nếu hữu ích (bỏ `requireAdmin` thì test phải fail).
- Web (`pnpm --filter @tutien2d/web test`, hiện 38 test): logic thuần đưa vào `lib/` và có Vitest: định dạng hạn dùng/đếm ngược, quyết định hành động nào được phép với từng người (chính mình, admin, admin cuối), bộ lọc/tìm kiếm danh sách, ánh xạ nhãn hành động kiểm toán, tạo mật khẩu ngẫu nhiên (độ dài, tập ký tự), sanitizer mới (`undefined` khi sai kiểu).

### 8. Tài liệu
Cập nhật `docs/CONTROL_PLANE_API.md` (route admin mới, `ownerUsername`, mã lỗi), `docs/SESSION_LOG.md` (mục ĐẦU), checklist cuối `docs/FIX_GUIDE.md`, mục trạng thái của `docs/SPEC_MULTI_USER.md` ("bước 4 đã triển khai offline; proxy còn ở bước 3"); thay phần ví dụ `curl` cấp hạn bằng hướng dẫn dùng giao diện (giữ `curl` như phương án phụ).

## Báo cáo cuối

File sửa/thêm, quyết định thiết kế (cách xử lý `revoke-sessions` với chính admin, danh sách hành động audit, cách chia bảng/thẻ trên màn hình hẹp), những gì CHƯA xác minh (hiển thị thật trên trình duyệt ở 334 px và màn hình rộng, hiệu năng danh sách lớn, hành vi phân trang audit với nhiều dòng), lệnh người giao việc cần chạy. Không tuyên bố build/test pass nếu không chạy được; người giao việc sẽ kiểm tra bằng trình duyệt thật.
