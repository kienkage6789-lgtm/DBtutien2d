# Nhiệm vụ: sửa bố cục form thêm proxy (tab Proxy trong khu quản trị)

Đọc `AGENTS.md`, `docs/SESSION_LOG.md` (mục đầu), rồi `apps/web/src/components/AdminPanel.tsx` (hàm `ProxyTab`) và `apps/web/src/lib/admin.ts` (`parseProxyLine`, `PROXY_KINDS`).

Không chạm game thật, không đọc `data/`/`.env*`, không sửa `vendor/`/`headless/`, không commit. Chỉ sửa giao diện web; không đổi API và không đổi hành vi `parseProxyLine`.

## Bối cảnh

Form thêm proxy đã đổi: droplist loại (`http|https|socks5|socks5h`), ô dán nhiều dòng (`host:port:user:pass`, `user:pass@host:port`, `host:port`, `scheme://...`), sức chứa, nhãn tuỳ chọn. Chức năng đã kiểm tra trên trình duyệt thật (server tạm, DB tạm): dán 2 dòng khác định dạng thì tạo được cả 2 proxy (`POST /api/admin/proxies` 201 ×2, endpoint đúng, không lộ user/pass).

## Lỗi giao diện đã thấy (viewport 1024×768)

1. Lưới `md:grid-cols-[8rem_1fr_8rem_auto]` quá chật: cột phải (ô sức chứa + ô nhãn) bị nút "Thêm proxy" đè lên/cắt chữ ("1" và "Nhãn (tuỳ chọn)" chỉ thấy một nửa).
2. Ô sức chứa không có nhãn nhìn thấy được (chỉ có `aria-label`/`title`), người dùng không biết số đó là gì.
3. Chưa có dòng gợi ý định dạng ngoài placeholder (placeholder biến mất khi gõ).

## Việc cần làm

- Sắp lại bố cục để không đè/cắt ở 1024 px, 768 px và 334 px (điện thoại hẹp): ví dụ hàng 1 = droplist + ô dán (ô dán chiếm hết bề ngang còn lại); hàng 2 = sức chứa (có nhãn "Sức chứa (số tài khoản)") + nhãn tuỳ chọn + nút Thêm. Không để thanh cuộn ngang.
- Thêm dòng chú thích nhỏ dưới ô dán liệt kê các định dạng nhận được và nói rõ "mỗi dòng một proxy; dòng có `scheme://` thì ưu tiên hơn droplist".
- Giữ nguyên style hiện có (`inputClass`, `buttonClass`, màu slate/emerald), tiếng Việt UTF-8, không thêm thư viện.
- Giữ nút Thêm vô hiệu khi đang gửi (`working`).

## Kiểm tra

- `pnpm build` và `pnpm --filter @tutien2d/web test` phải pass.
- Mở bản build bằng server tạm với `DATA_DIR` ở thư mục tạm, cổng khác 4000, `ADMIN_PASSWORD` tự đặt cho test; đăng nhập admin, vào Quản trị → Proxy, chụp màn hình ở 1024, 768 và 334 px. Dán 2 proxy giả (ví dụ `203.0.113.5:1080:u:p`, `u2:p2@203.0.113.6:1081`) để kiểm tra luồng thêm. Dừng server tạm sau khi xong. KHÔNG dùng `data/` thật và KHÔNG nhập proxy thật.
- Ghi báo cáo vào đầu `docs/SESSION_LOG.md` và checklist cuối `docs/FIX_GUIDE.md`; ghi rõ phần chưa xác minh.

## Ghi chú thêm (điều tra riêng, không bắt buộc sửa)

Khi thử bằng trình duyệt tích hợp, phiên đăng nhập của dashboard bị đẩy về màn hình đăng nhập (`401`, WebSocket `/ws` lỗi lặp lại) vài lần sau khi đăng nhập ~30–60 s, trong khi gọi `GET /api/auth/me` bằng curl suốt ~1 phút vẫn `200`. Nguyên nhân chưa xác định (chưa kết luận là lỗi của app hay của trình duyệt tích hợp). Nếu tái hiện được, báo nguyên nhân kèm bằng chứng; không đoán.

Lưu ý: UI ở `:4000` chỉ đổi sau `pnpm build` và khởi động lại server; hoặc xem ở `:3000` bằng `pnpm dev`.
