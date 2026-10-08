# Kế hoạch (làm sau): chạy ngầm mặc định và bàn giao phiên sang trình duyệt

Trạng thái: **chỉ là kế hoạch, chưa làm**. Ghi ngày 2026-10-08 theo quyết định của người dùng: ưu tiên làm xong di chuyển và auto đánh quái đúng chuẩn client trước (xem `AUTO_SPEC.md` mục 15), phần này làm sau.

## Quyết định đã chốt

- **Mặc định: chạy ngầm.** Server (Linux) chạy client chính thức không hiển thị (logic trong Node, không vẽ), chạy liên tục.
- **Khi người dùng muốn xem: mở client (phương án A).** Dashboard có nút "Mở client": server **nhả phiên game** của tài khoản đó, rồi người dùng mở trang game chính thức và tự đăng nhập. Không chuyển token cho trình duyệt, không tự phục vụ bản sao client. Khi người dùng xong, bấm "Tiếp tục chạy ngầm" để server lấy lại phiên.
- Loại: (B) nhúng client vào dashboard và (C) phát hình từ server: không làm.

## Mô hình trạng thái

Mỗi tài khoản có đúng một "chủ phiên" tại một thời điểm:

| Chế độ | Chủ phiên | Chuyển sang |
|---|---|---|
| `headless` (mặc định) | Client chạy ngầm trong Node trên server | `viewer` khi người dùng bấm "Mở client"; `stopped` khi tắt tài khoản |
| `viewer` | Trình duyệt của người dùng (ngoài hệ thống) | `headless` khi bấm "Tiếp tục chạy ngầm" (hoặc hết hạn giữ chỗ) |
| `stopped` | Không ai | `headless` khi bật tài khoản |

Bàn giao phải có thứ tự: nhả kết nối, đợi server xác nhận phiên đã giải phóng, rồi mới báo cho người dùng mở trang; khi lấy lại phải kiểm tra người dùng đã đóng trình duyệt hoặc chấp nhận bị đá.

## Việc cần làm (khi tới lượt)

1. **Kiểm chứng quy tắc phiên của server** (một lần, có kiểm soát): kết nối thứ hai bị từ chối hay đá kết nối cũ? Giữ chỗ phiên bao lâu sau khi ngắt? Đây là điều kiện tiên quyết của mọi thiết kế bàn giao.
2. Cơ chế "chủ phiên" trong `worker-pool.ts`: trạng thái `sessionMode`, khóa theo tài khoản, chuyển trạng thái thuần hàm có test (không đụng mạng).
3. API (qua `requireAuth`, error envelope): `POST /accounts/:id/session/release` (vào `viewer`), `POST /accounts/:id/session/resume` (về `headless`); runtime báo `sessionMode`.
4. UI dashboard: nút "Mở client" (hiện hướng dẫn mở trang chính thức), nút "Tiếp tục chạy ngầm", nhãn chế độ hiện tại, cảnh báo khi tài khoản đang ở `viewer`.
5. Xử lý ngoại lệ: người dùng đăng nhập trình duyệt khi chưa nhả (bị đá), mất kết nối giữa chừng, server khởi động lại ở trạng thái `viewer`, giữ chỗ hết hạn.
6. Kiểm thử live bàn giao hai chiều, ghi evidence đã redact.

## Điều chưa biết

- Quy tắc phiên của server (mục 1 ở trên).
- Trạng thái cục bộ của client chạy ngầm (cooldown, hàng đợi) mất khi bàn giao: chưa đánh giá tác hại.
- Chi phí CPU/RAM mỗi tài khoản khi chạy ngầm trên Linux: chưa đo.
- Điều khoản dịch vụ của game về bot/tự động hóa: người dùng tự cân nhắc.
