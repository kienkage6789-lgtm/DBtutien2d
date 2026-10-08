# Danh mục chức năng giao diện TuTien2D

Ngày rà soát: 2026-10-08. Nguồn tham chiếu protocol vẫn là client chính thức tại `vendor/tutien2d-public-client/2026-10-06`; thư mục vendor không được sửa.

## Chức năng dashboard còn giữ

| Khu vực | Trạng thái | Ghi chú |
|---|---|---|
| Tài khoản | Giữ | CRUD tài khoản, mật khẩu, start/stop/restart và logs. |
| HP/MP và trạng thái chết | Giữ | Hiển thị dữ liệu vendor; giá trị chưa biết vẫn hiển thị là chưa biết. |
| Vị trí và MiniMap | Giữ, chỉ đọc | Hiển thị map, tọa độ, portal và entity khi vendor cung cấp; không có click để di chuyển. |
| Auto chính thức | Giữ | Start/stop, phase, anchor, số lần chết/chuyến đi và hurt; vendor client tự điều khiển attack/skill/loot. |
| Bảo mật/control-plane | Giữ | Origin allowlist, bearer subprotocol, API token và bind loopback. |

## Chức năng dashboard đã gỡ cùng engine core

- `MapNavigationPanel`, click di chuyển, cancel move-to, route `move-to` và route đổi map/khu.
- Nút làm mới HP và route vitals refresh; vendor không có thao tác refresh vitals riêng.
- `InventoryModal`, nút Túi, kiểu `bag`/`bagCount` và route inventory; snapshot vendor hiện không cung cấp túi đồ.
- `ConfigModal`, route `GET/PUT /api/accounts/:id/config` và cấu hình chọn engine. Mọi account chạy vendor; DB vẫn đọc/chuẩn hóa bản ghi cấu hình cũ để không lỗi khi mở dữ liệu cũ.
- Các action/training, route điều khiển combat hoặc training, và toàn bộ trạng thái navigation/move-to.

## Phạm vi không phải UI dashboard

Client vendor vẫn có các màn hình game chính thức trong mã tham chiếu, nhưng headless runner không render chúng và dashboard không tự tái tạo combat, inventory, quest hay movement. Dữ liệu sinh bởi `scripts/gen-*.mjs` chỉ được giữ khi còn là nguồn cho geometry, entity hoặc derived vitals.

## Chưa xác minh

- Marker/entity và trường `khu` trên game thật chưa được xác minh live.
- Túi đồ vendor chưa được cung cấp trong snapshot hiện tại; nếu vendor bổ sung dữ liệu sau này cần thiết kế lại API/UI riêng, không khôi phục route core cũ.
