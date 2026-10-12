# Kế hoạch: nút Play mở tab chơi game

Cập nhật: 2026-10-12. Phương án thay thế đã triển khai trong dashboard. Nguồn tham chiếu client chỉ đọc: `vendor/tutien2d-public-client/2026-10-06`.

## Yêu cầu
Nút Play trên dashboard: bấm thì mở một tab để chơi game bằng chính tài khoản đó. Chủ dự án đã chọn: (1) client game phục vụ từ dashboard và tự đăng nhập; (2) chỉ cho Play khi bot của tài khoản đã dừng.

## Điều tra [Client] (đọc mã, chưa thử live)
- Client chính thức là web: `https://tutien2d.online/`. Bản chụp trong `vendor/` chỉ có script/style và 2 logo; **thiếu toàn bộ ảnh sprite/fx/bản đồ** (`assets/sprites/...` được `core/assets.js` nạp lúc chạy). Phục vụ bản chụp từ dashboard sẽ không có hình nếu không lấy ảnh từ site chính thức.
- Đăng nhập dùng **Supabase**: `net/client.js` tạo client với `persistSession:true`, `autoRefreshToken:true`, khoá lưu trong `localStorage` tên `pntt_session_v1`. Sau đó mở WebSocket tới `wss://game.tutien2d.online/` và gửi phiên cho game server.
- Server dự án giữ phiên Supabase của từng tài khoản (mã hoá trong DB, `refreshToken`). Tự đăng nhập đòi ghi phiên đó vào `localStorage` của tab chơi, tức là đưa access/refresh token ra trình duyệt.

## Rào cản của phương án đã chọn
1. **Hình ảnh**: cần lấy sprite từ `tutien2d.online` (nhúng chéo origin hoặc proxy qua dashboard). Chưa biết client có đọc điểm ảnh (cần CORS) hay site có chặn nhúng; proxy cả site chính thức qua server của dự án là vấn đề tải/điều khoản sử dụng, cần chủ dự án quyết định.
2. **Refresh token dùng một lần (rotation)**: Supabase xoay refresh token mỗi lần làm mới. Nếu trình duyệt và server cùng giữ một token, bên nào làm mới trước sẽ làm bên kia mất phiên: sau khi chơi xong, bot có thể không đăng nhập lại được (phải nhập lại mật khẩu). Cần cơ chế "trả phiên" về server khi đóng tab, chưa có.
3. **Token ra trình duyệt**: AGENTS.md cấm in/log token; đưa token qua trang web phải qua HTTPS, không để trong URL, không lưu log. Với cách vào bằng HTTP (`quick-vps.sh`) token đi không mã hoá.
4. **Một phiên mỗi tài khoản**: chơi trong tab sẽ đá phiên của bot; quyết định "chỉ Play khi bot dừng" xử lý được phần này (server cũng phải kiểm lại, không chỉ nút ở giao diện).

## Phương án thay thế gọn, an toàn (đề xuất)
Nút **Play** mở `https://tutien2d.online/` trong tab mới (`rel="noopener noreferrer"`), chỉ bật khi tài khoản đã dừng; kèm nút sao chép tên đăng nhập của tài khoản (KHÔNG sao chép mật khẩu/token); bạn tự đăng nhập trên trang chính thức. Làm được ngay, không đụng token, không phục vụ lại client, không đá phiên vì bot đã dừng.

## Kết quả triển khai (2026-10-12)
- Đã chọn và làm phương án thay thế: nút **Chơi** mở trang chính thức khi `canPlay(account)` cho phép; tài khoản đang chạy/khởi động/nối lại thì link mất `href`, bị chặn thao tác bàn phím và có chú thích dừng bot trước.
- Nút **Sao chép đạo hiệu** chỉ sao chép `accountName`, có Clipboard API và fallback DOM, kèm thông báo trạng thái. Không có API backend và không đưa bí mật vào URL.
- Test helper và markup có trong `apps/web/src/components/account-dashboard.test.ts` và `AccountCharacter.test.tsx`.

## Phương án đầy đủ (nếu vẫn muốn tự đăng nhập)
Cần làm theo thứ tự, mỗi bước kiểm tra riêng:
1. Chốt chuyện hình ảnh (proxy hay nhúng) và chứng minh client chạy được từ origin của dashboard.
2. Thiết kế phiên: cấp cho tab chơi một phiên riêng (đăng nhập Supabase mới bằng mật khẩu đã lưu, phía server, một lần) thay vì dùng chung refresh token với bot; hoặc "mượn" rồi "trả" có kiểm soát.
3. API chỉ trả token cho đúng chủ sở hữu, qua HTTPS, không log, hết hạn ngắn; kiểm bot đã dừng ở phía server.
4. Kiểm thử bằng máy chủ giả, rồi thử live có người giám sát.
Ước lượng: lớn hơn nhiều so với phương án thay thế, và có rủi ro làm mất phiên của bot.
