# Nghiên cứu: đổi khu vực (khu) trong một map

Ngày: 2026-10-08. Phần 1–6 là nghiên cứu từ mã client chính thức (`vendor/tutien2d-public-client/2026-10-06/src`) và mã server của dự án; mục 7 bổ sung kết quả đo game thật. Mọi điều còn ghi "chưa xác minh" vẫn cần đo live trước khi tin.

## 1. "Khu" là gì (đã xác minh bằng đọc mã)

- Một số map được chia thành nhiều khu (bản sao song song của cùng một map, mỗi khu có người chơi/quái riêng). `world/map_khu.js` đặt `khu = 20` (`Khu.SO_KHU = 20`) cho đúng 7 map: `tan_vien`, `mieu_hoang`, `thanh_truc_lam`, `duoc_vien`, `hang_dong_co`, `bai_da_hang_gio`, `mo_linh_thach`. Các map khác không chia khu (`soKhu <= 1`, client báo "Bản đồ này không chia khu").
- Mỗi map chia khu có 1–2 "Bảng Khu" (prop `khu_board`, bán kính tương tác 44 px), ví dụ `tan_vien` ô (17,19), `thanh_truc_lam` ô (10,3) và (15,27), `bai_da_hang_gio` ô (5,26) và (18,12). Tương tác với bảng mở bảng chọn khu (`KhuUI.open`).
- Khu hiện tại và tổng số khu đến từ gói `map` (`khu`, `soKhu`); dự án đã đọc chúng thành `observedKhu`/`observedSoKhu` trong `vendor-runner.ts`.

## 2. Giao thức (đã xác minh bằng đọc mã client, chưa thử live)

| Hướng | Gói | Ý nghĩa |
|---|---|---|
| Client → server | `{op:"khu", act:"xem"}` | xin danh sách khu của map hiện tại (client gửi khi mở bảng) |
| Server → client | `{op:"khu", mapId, khu, dem:[số người mỗi khu], toiDa, tran:[sức chứa từng khu]}` | `KhuUI.onList`: bỏ qua nếu `mapId` khác map hiện tại; `khu` là khu hiện tại |
| Client → server | `{op:"khu", act:"chon", khu:N}` | xin chuyển sang khu N (chỉ gửi nếu `Gateway.connected` và `N` khác khu hiện tại) |
| Server → client | (suy ra) gói `map` mới với cùng `mapId`, `khu` mới, `ep` mới | client xử lý `enterServerMap`: cùng `mapId` thì KHÔNG chuyển cảnh, chỉ đặt lại vị trí, xóa danh sách quái, nhận snap2 mới |

Trạng thái đầy khu: client tô "đầy/đông/vắng" theo `dem[i]` so với `tran[i]` (hoặc `toiDa`); client KHÔNG chặn chọn khu đầy, nên việc server từ chối (và gói trả lời khi từ chối) là chưa xác minh.

## 3. Điều chưa biết (cần đo live)

1. ~~Server có đòi nhân vật đứng gần Bảng Khu khi nhận `act:"chon"` không~~ → **đã đo live ở `tan_vien`: không cần đứng gần** (38–418 px đều thành công). Điều này mâu thuẫn với ghi chú trước đó của chủ dự án; chỉ các map khác, đặc biệt map có quái, vẫn chưa đo.
2. Phản hồi khi chọn khu đầy hoặc không hợp lệ (lỗi, `ack` có `toast`, hay im lặng).
3. Gói trả lời thật sau `chon`: có đúng là gói `map` mới không, vị trí xuất hiện ở khu mới (gần bảng hay giữ tọa độ), độ trễ.
4. Có thời gian hồi, giới hạn số lần đổi, hay trạng thái cấm (đang chiến đấu, đang tổ đội) khi đổi khu.
5. Tác động tới Auto/supervisor: `AutoAnchor.khu` có sẵn nhưng supervisor chưa bao giờ đổi khu (khóa `KHU_PROTOCOL_UNAVAILABLE`); sau hồi sinh nhân vật về làng, khu mặc định có thể khác khu của neo.

## 4. Tương tác với phần đã làm

- `walkTo` (bản 1/2a): đổi khu không phải đi qua cổng; nhưng thao tác đi nhiều map đang hủy khi map đổi (`mapId` đổi). Gói `map` cùng `mapId` khác `khu` là một sự kiện mới: bản triển khai hủy thao tác đi tay đang chạy với `reason: khu_changed`, vì client có thể làm mới entity/epoch.
- Runner: `observedKhu` đã cập nhật khi nhận `map`/`khu`. `getMapId()` hiện không phụ thuộc khu; cần xác nhận `transitioning`/`isMapReady` hành xử đúng khi nhận gói `map` cùng `mapId`.
- Trước khi có kết quả mục 7, `KHU_PROTOCOL_UNAVAILABLE` vẫn là khóa đúng. Sau khi đã đo live, khóa đó không áp dụng cho API/dashboard đổi khu mới; route thử nghiệm cũ vẫn được giữ.

## 5. Đề xuất thiết kế trước đo live (lịch sử; đã được mục 7 thay thế)

Các mục dưới đây là đề xuất ban đầu, không còn là hợp đồng triển khai khi mâu thuẫn với mục 7.

1. `VendorRunner.changeKhu(khu)`: kiểm tra `IN_GAME`, map sẵn sàng, không gục, map hiện tại có `soKhu > 1`, `1 <= khu <= soKhu`, `khu !== hiện tại`, không có thao tác đi bộ đang chạy, Auto/supervisor `idle`; gửi `{op:"khu", act:"xem"}` rồi `{op:"khu", act:"chon", khu}` qua `Gateway.send`; chờ gói `map` mới có `khu` đúng (hết thời hạn → `failed` kèm lý do, không retry mù).
2. BẮT BUỘC (theo chủ dự án): nếu nhân vật không đứng trong bán kính an toàn của Bảng Khu (dùng ≤ 30 px quanh tâm prop `khu_board`, nhỏ hơn bán kính tương tác 44 px của client), `changeKhu` tự dùng `walkTo` (cùng map, bản 1) đi tới sát bảng rồi mới gửi `xem`/`chon`. Vị trí bảng đọc từ `MapData` của client lúc chạy (các prop `type: "khu_board"` của map hiện tại, chọn bảng gần nhất; không hardcode), vì có map có 2 bảng. Đích đi bộ không được là ô cổng (đã có `TARGET_ON_PORTAL`); nếu không tới được bảng (`TARGET_UNREACHABLE`) thì báo lỗi `KHU_BOARD_UNREACHABLE`, không gửi gói đổi khu.
3. API: `GET /api/accounts/:id/khu` (danh sách `dem/toiDa/tran` từ gói `khu`), `POST /api/accounts/:id/khu` `{khu}`; mã lỗi theo envelope hiện có.
4. Dashboard: danh sách chọn khu cạnh danh sách chọn map (hiện số người mỗi khu, đánh dấu đầy), khóa kèm lý do khi map không chia khu hoặc Auto đang bật.
5. Sau khi đo live ổn: cho supervisor khôi phục khu của neo sau khi hồi sinh/đi về (bước riêng, cần test an toàn trước).

## 6. Kế hoạch đo live đề xuất (ít rủi ro)

Ở `tan_vien` (map chia khu, không có quái): đi sát Bảng Khu (17,19) bằng `walkTo`, gửi `xem` và ghi lại gói `khu` thật; rồi `chon` sang khu vắng (ví dụ khu 2), ghi lại thứ tự gói, tọa độ xuất hiện, độ trễ; đo khoảng cách lớn nhất mà việc đổi khu còn được chấp nhận (thử từ gần ra xa, dừng ở lần bị từ chối đầu tiên và ghi cách server từ chối) để biết ngưỡng thật; thử chọn khu đầy nếu có. Theo dõi `hurtCount`; chỉ một phiên đăng nhập; không bật Auto.

---

## 7. KẾT QUẢ ĐO LIVE (2026-10-08, `tan_vien`, không có quái, hurt 0 suốt đợt)

Công cụ đo: route thử nghiệm `GET|POST /accounts/:id/khu-probe` (gửi `xem`/`chon`, ghi lại gói liên quan). Đã xác minh live:

- `{op:"khu", act:"xem"}` → server trả `{op:"khu", mapId, khu, dem:[20 số], toiDa:20, tran:[20 số]}` sau khoảng 85 ms. `dem[i]` là số người ở khu i+1, sức chứa mỗi khu 20.
- `{op:"khu", act:"chon", khu:N}` thành công → trong khoảng 85–106 ms server gửi lần lượt `map` (cùng `mapId`, `khu` mới, `soKhu` 20, `ep` tăng 1, **cùng tọa độ x/y**), `status`, `bosses`, `formation`, `toast` ("Đã sang khu N."), rồi `khu` (danh sách cập nhật). Vị trí nhân vật KHÔNG đổi.
- **Không đòi đứng gần Bảng Khu (ít nhất ở `tan_vien`)**: đổi khu thành công khi cách bảng 418 px, 164 px, 72 px, 38 px (bảng ở tâm (560,624)). Điều này MÂU THUẪN với lời chủ dự án ("đổi khu cần đứng gần"); có thể quy tắc chỉ nằm ở giao diện client (phải tương tác với bảng), hoặc server chỉ kiểm tra ở map khác (chưa đo `thanh_truc_lam` và các map có quái).
- **Thời gian hồi khoảng 5 giây** giữa hai lần đổi: từ chối bằng gói `toast` "Vừa đổi khu, chờ N giây nữa." (không có gói `map`; danh sách `khu` vẫn được gửi lại). Đã thấy N = 5, 4, 3; lần thử sau đó khoảng 5,3 s thì thành công.
- Chọn khu đang đứng → `toast` "Đang ở khu này rồi." (không đổi).
- Chọn khu đầy: CHƯA đo (không có khu đầy đủ điều kiện an toàn; `dem` thấy khu 1 đầy 20/20).
- Thứ tự khu mặc định khi đăng nhập: lần đầu ở `tan_vien` nhân vật xuất hiện ở khu 3, các lần sau khu 6 (khu cuối cùng đã chọn được server nhớ — chưa xác minh chắc, chỉ thấy khu đăng nhập trùng khu lần trước).
- Đơn vị tọa độ và `ep`: `ep` tăng mỗi lần đổi khu (3,4,5,6 trong đợt đo).

Hệ quả thiết kế (thay phần 5): không cần bắt buộc đi tới Bảng Khu; `changeKhu` gửi thẳng (tùy chọn `approachBoard` để đi tới bảng trước nếu cần), tôn trọng thời gian hồi (không gửi dồn; nếu server báo "chờ N giây" thì chờ rồi báo lỗi, không retry mù), chuyển các `toast` của server thành thông báo cho người dùng, hủy thao tác `walkTo` đang chạy khi khu đổi (tọa độ giữ nguyên nhưng `ep` đổi, quái/người chơi làm mới). Chưa xác minh: quy tắc ở map có quái, khu đầy, giới hạn tần suất dài hạn.

## 8. Trạng thái triển khai control-plane (2026-10-08)

Đã triển khai offline theo kết quả đo ở mục 7: `VendorRunner.changeKhu()` nhận ACK bằng `map` đúng `mapId`/`khu`, nhận từ chối bằng `toast`, có bảo vệ cooldown phía client và timeout có giới hạn; `requestKhuList()` nhận/làm sạch gói `khu` và xóa danh sách khi đổi map hoặc reconnect. API `/api/accounts/:id/khu` và dashboard chọn khu đã nối; route thử nghiệm `GET|POST /khu-probe` và mã thăm dò vẫn được giữ nguyên.

Không cài đi-tới Bảng Khu. Khi gói `map` cùng `mapId` nhưng `khu` đổi, runner hủy `walkTo` đang chạy với lý do `khu_changed` vì khu mới có thể làm client làm mới entity/epoch; việc hủy này áp dụng cả khi gói đến từ nguồn khác ngoài lệnh `changeKhu`.

Chưa xác minh: hành vi khi chọn khu đầy, map có quái, giới hạn tần suất dài hạn, ngưỡng cooldown chính xác ngoài khoảng 5 giây và quy tắc khoảng cách bảng ở các map khác.
