# Danh mục chức năng giao diện TuTien2D

Ngày rà soát: 2026-10-11. Nguồn tham chiếu protocol vẫn là client chính thức tại `vendor/tutien2d-public-client/2026-10-06`; thư mục vendor không được sửa.

## Linh Thạch và mở trang game — 2026-10-12

AccountPanel có nút **Chơi** mở `https://tutien2d.online/` trong tab mới, chỉ thao tác được khi account đã dừng và không ở trạng thái đang kết nối/nối lại. Chú thích nhắc dừng bot vì mỗi tài khoản chỉ có một phiên đăng nhập. Nút **Sao chép đạo hiệu** chỉ sao chép `accountName`; mật khẩu/token không được đọc hay đưa vào URL. Chức năng không gọi API.

Sidebar hiển thị ví Linh Thạch và số hôm nay/trần. Tab Tổng quan có thẻ **Linh Thạch** với ví, hôm nay từ quái/trần theo cảnh giới và biến động kể từ lúc runner kết nối. Giá trị null hoặc stale hiển thị “—”. `stonesToday`/`stonesCap` do client tính từ cờ quest ngày và cảnh giới; độ khớp với hạch toán máy chủ chưa xác minh.

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

## Character snapshot — giai đoạn 2 (2026-10-12)

Sidebar và tab Tổng quan hiển thị cảnh giới, Thần thức, Giáp và Đạo Hạnh dưới dạng giá trị/tối đa và phần trăm khi character fresh. Null hoặc stale hiển thị “—”; cảnh giới cũng bị ẩn khi snapshot cũ. REST/WS runtime cung cấp `character` theo quyền sở hữu/admin hiện có. `realmName` được ánh xạ từ `REALMS` trong client tham chiếu; id lạ không bị đổi tên.

Nguồn được xác định trong mã client: HUD dùng `player.sp/spMax`, `player.bp/bpMax` và `player.exp/expMax`; `Player.create` lấy `realmId` từ `Progress.realm()` và exp từ `Progress.exp`. Định nghĩa Progress không nằm trong cây client tham chiếu. `spMax/bpMax/expMax` là giá trị mô hình client theo cảnh giới/trang bị. Cách các số hiện tại được cập nhật, tần suất và độ tin cậy trên game thật đều CHƯA XÁC MINH.

## Sidebar tài khoản và bảng chi tiết — giai đoạn 1 (2026-10-12)

Dashboard web có sidebar lọc theo trạng thái/tìm tên và bảng chi tiết bảy tab. Chưa chọn account thì giữ StatsBar tổng cùng nhật ký chung; chọn account thì chuyển sang Tổng quan, Bản đồ, Hằng ngày, Túi đồ, Auto, Nhật ký hoặc Tài khoản. Sidebar hỗ trợ listbox, focus bàn phím và cuộn riêng; dưới 1024 px danh sách nằm phía trên, khi mở chi tiết có nút quay lại. Account đang chọn, bộ lọc và tab được lưu trong localStorage với fallback nếu storage ném lỗi.

HP/MP hiển thị khi vitals fresh và chưa quá hạn; thanh rỗng/“—” biểu thị chưa biết. Cảnh giới, Thần thức, Giáp và Đạo Hạnh vẫn “—” trong giai đoạn 1 vì server chưa có `character`. Chế độ Túi đồ nhúng sử dụng lại InventoryModal; các tab còn lại dùng component hiện có. AccountCard đã xóa sau khi bảng chi tiết nhận lại đầy đủ các thao tác.

Kiểm tra: web 63/63, server 192/192, TypeScript core/server/web và Vite production build pass; năm fault injection bị test bắt và khôi phục. Chưa xác minh trực quan ở 1280/768/334 px vì CUA không có browser khả dụng.
