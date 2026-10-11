# Danh mục chức năng giao diện TuTien2D

Ngày rà soát: 2026-10-11. Nguồn tham chiếu protocol vẫn là client chính thức tại `vendor/tutien2d-public-client/2026-10-06`; thư mục vendor không được sửa.

## Chức năng dashboard còn giữ

| Khu vực | Trạng thái | Ghi chú |
|---|---|---|
| Tài khoản | Giữ | CRUD tài khoản, mật khẩu, start/stop/restart và logs. |
| HP/MP và trạng thái chết | Giữ | Hiển thị dữ liệu vendor; giá trị chưa biết vẫn hiển thị là chưa biết. |
| Vị trí và MiniMap | Giữ, chỉ đọc | Hiển thị map, tọa độ, portal và entity khi vendor cung cấp; không có click để di chuyển. |
| Auto chính thức | Giữ | Start/stop, phase, anchor, số lần chết/chuyến đi và hurt; vendor client tự điều khiển attack/skill/loot. |
| Túi đồ | Giữ, chỉ đọc | Modal dạng lưới; đọc metadata/inventory qua API sở hữu tài khoản. Không gửi lệnh game. |
| Bảo mật/control-plane | Giữ | Origin allowlist, bearer subprotocol, API token và bind loopback. |

## Chức năng dashboard đã gỡ cùng engine core

- `MapNavigationPanel`, click di chuyển, cancel move-to, route `move-to` và route đổi map/khu.
- Nút làm mới HP và route vitals refresh; vendor không có thao tác refresh vitals riêng.
- `ConfigModal`, route `GET/PUT /api/accounts/:id/config` và cấu hình chọn engine. Mọi account chạy vendor; DB vẫn đọc/chuẩn hóa bản ghi cấu hình cũ để không lỗi khi mở dữ liệu cũ.
- Các action/training, route điều khiển combat hoặc training, và toàn bộ trạng thái navigation/move-to.

## Phạm vi không phải UI dashboard

Client vendor vẫn có các màn hình game chính thức trong mã tham chiếu, nhưng headless runner không render chúng và dashboard không tự tái tạo combat, quest hay movement. Dữ liệu sinh bởi `scripts/gen-*.mjs` chỉ được giữ khi còn là nguồn cho geometry, entity hoặc derived vitals.

## Túi đồ dạng lưới — 2026-10-11

Modal Túi đồ hiển thị dữ liệu từ endpoint chỉ đọc `GET /api/accounts/:id/inventory`. Ba tab phân loại là Vật phẩm, Trang bị và Đạo thuật; mục chưa phân loại nằm ở Khác. Số trong tab là số mục sau khi áp dụng ô tìm kiếm. Chọn một ô để đọc tên, phẩm cấp, loại, số lượng, mô tả và ID; dùng mũi tên trái/phải/lên/xuống để đổi lựa chọn trong lưới.

Dung lượng `usedSlots/capacity` áp dụng cho toàn bộ túi. API không cung cấp số ô trống riêng cho từng nhóm, vì thế tab không gán ô trống chung vào một nhóm. Số ô mở rộng và giá mở rộng chỉ hiển thị khi client cung cấp. Ô trang bị đang mặc được liệt kê riêng. `null` được trình bày là “Chưa biết”, không đổi thành số 0. Khi `Market.group(def)` không trả một trong ba nhóm hợp lệ, quy tắc dự phòng là: có `slot` → Trang bị; `type` là `bi_tich` hoặc `phu_chu` → Đạo thuật; có `type` khác → Vật phẩm; thiếu dữ liệu phân loại → Khác.

Ô vật phẩm được vẽ bằng CSS và ký hiệu nội tuyến theo loại, phẩm cấp, hộp mở được và số lượng. Màu phẩm cấp nằm trong `apps/web/src/components/inventory-grade.ts`; phẩm cấp không biết/không hỗ trợ dùng màu trung tính tương phản ở giao diện sáng và tối. Tên, mô tả và ID được React hiển thị như văn bản, không diễn giải thành HTML. Giao diện không tải tài nguyên ngoài và không cung cấp nút hành động game.

**Biểu tượng pixel thật của game chưa có trong dashboard; đó là hạng mục riêng.** Các dấu CSS hiện tại chỉ là ký hiệu tạm để nhận biết loại vật phẩm, không phải hình ảnh game.

## Chưa xác minh

- Marker/entity và trường `khu` trên game thật chưa được xác minh live.
- Túi đồ chưa được xem trực quan ở 1280, 768 hoặc 334 px; không có browser/app khả dụng qua CUA trong lần rà soát này.
