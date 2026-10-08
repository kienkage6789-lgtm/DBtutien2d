# Kịch bản live P2 — tiếp cận một quái, không đánh

Kịch bản này chỉ kiểm tra bot đi tới một điểm walkable trong tầm đánh thường. Harness không gửi `attack`, không gửi `skill`, không đi tiếp sau khi tới tầm và không tự rút lui.

## Điều kiện tiên quyết

- Đã build lại repo trong môi trường có toolchain hoạt động và đã chạy các test liên quan.
- Chỉ dùng một phiên đăng nhập cho tài khoản game. Không mở client game thứ hai bằng cùng tài khoản.
- Bot đang chạy ở `tan_vien`, không gục, kết nối ở `IN_GAME`, map/khu đã được xác nhận và vị trí hiện tại hợp lệ.
- Có vitals fresh. Chỉ gọi `vitals/refresh` khi không có quái trong bán kính 300 px.
- Không có `move-to`, điều hướng portal hoặc thao tác combat đang chạy.
- Người vận hành biết quái có `aggro` có thể gây sát thương khi bot đi gần; phải dừng ngay khi nhận `hurt`.

## Các bước chạy

1. Chạy server với packet tap và harness approach bật:

   ```text
   TUTIEN_PACKET_TAP=150 TUTIEN_PROBE_APPROACH=1
   ```

   Packet tap mặc định tắt. Bản ghi approach chỉ chứa thời gian tương đối, loại quái từ `ENEMY_DEFS` và số liệu khoảng cách/đường/replan; không chứa token, tên nhân vật, `selfId` hay id người chơi.

2. Để bot đăng nhập và đứng ở `tan_vien`. Xác nhận trạng thái là `IN_GAME` và map hiện hành là `tan_vien`.

3. Dùng API `map/enter` đã có để đi qua portal sang `thanh_truc_lam`. Không bypass portal. Chờ API/runtime xác nhận map mới trước bước tiếp theo.

4. Harness chờ 20 giây sau `welcome`, rồi THĂM DÒ mỗi giây trong cửa sổ 240 giây (`APPROACH_PROBE_WINDOW_MS`) cho tới khi mọi điều kiện an toàn đạt. Các lý do tạm thời (đang điều hướng qua cổng, chưa sang map có quái, danh sách quái chưa tươi, vitals cũ, chưa có mục tiêu hợp lệ) chỉ làm nó chờ tiếp; lý do dứt khoát (`downed_true`, `not_in_game`, mất kết nối) hủy ngay. Hết cửa sổ thì hủy với `window_expired:<lý do cuối>` và KHÔNG chạy muộn. Nghĩa là bạn có thể đi cổng sang `thanh_truc_lam` sau khi harness đã bắt đầu chờ, miễn là hoàn tất trong cửa sổ; nếu chậm hơn thì phải khởi động lại tiến trình để có lượt mới. Không tự gọi lại harness.
5. Nếu chưa có quái trong 300 px, gọi API `vitals/refresh` hiện có và chờ vitals fresh. Không gọi refresh khi quái ở gần.

6. Để `TUTIEN_PROBE_APPROACH=1` tự chọn một quái không phải boss, không phải `human`/`tuSi`, có contact damage thấp theo ngưỡng trong mã, cách ban đầu 120–450 px, có đường tới goal dài không quá 480 px và không có quái khác trong vùng `aggro` quanh goal.

7. Harness gọi `runApproach`. Bộ chạy gửi move `st:"walk"` qua `sendMove` hiện có, tối đa một operation tại một thời điểm; mỗi lần lập kế hoạch lại cách nhau ít nhất 400 ms và chỉ lập lại khi quái dịch từ 24 px trở lên.

8. Khi tới tầm, harness hủy move-to còn lại nếu có, đứng yên 3 giây rồi kết thúc. Trong 3 giây này không gửi move, attack hoặc skill.

## Kết quả mong đợi

- Kết quả là `arrived`, hoặc harness tự hủy an toàn với một lý do cụ thể như `target_too_far`, `no_walk_path`, `other_monster_in_aggro`, `vitals_stale_or_unknown`, `move_to_active`.
- Nếu `arrived`, bot tới tầm trong tối đa 8 giây; khoảng cách cuối không lớn hơn `reachLimit = 26 + weaponReachBonus + bodyRadius`.
- Điểm đích cuối là điểm walkable theo grid hitbox 16×12; đường không đi xuyên vật cản.
- Không có `hurt`, không có packet attack/skill và không có move nào sau khi giai đoạn đứng yên bắt đầu.

Thời gian chọn đường tối đa 480 px có dư địa so với giới hạn lý thuyết của `runMoveTo`: tốc độ walk là 68 px/s, nên 8 giây đi được khoảng `68 × 8 = 544 px`; 480 px giữ lại khoảng 64 px cho rẽ, dừng và sai số quan sát.

## Tiêu chí thành công

| Kiểm tra | Tiêu chí |
|---|---|
| Tới mục tiêu | `status=arrived` trong ≤ 8 giây |
| Tầm cuối | `finalDistance ≤ reachLimit` |
| An toàn | Không có `hurt`, không gục, không mất context/kết nối |
| Va chạm | Không đi xuyên vật cản; goal và vị trí cuối đều walkable |
| Bề mặt lệnh | Không có attack, skill, packet mới hoặc move sau khi arrived |
| Evidence | Packet tap có plan/result đã redact và lý do nếu hủy |

## Dừng khẩn cấp và dừng bình thường

Dừng ngay bot qua cơ chế `stop` hiện có khi thấy `hurt`, HP giảm, `downed`, quái khác xuất hiện trong vùng nguy hiểm, map/context sai, kết nối chập chờn hoặc vị trí đi lệch. Runner sẽ hủy move-to đang chạy khi quan sát các điều kiện này; người vận hành vẫn phải dừng bot ngay, không chờ retry.

Sau khi harness đã `arrived` và đứng yên đủ 3 giây, dừng bot bình thường bằng API stop hiện có nếu không muốn giữ phiên. Không mở thêm phiên game để quan sát cùng tài khoản.

## Những gì cần ghi lại

- Thời điểm bắt đầu/kết thúc, map/khu đã xác nhận và trạng thái kết quả.
- `status`, `reason`, `elapsedMs`, `replans`, `finalDistance`.
- Các plan record: thời gian tương đối, khóa loại quái, khoảng cách Euclid, độ dài đường, action/replan.
- Số move quan sát được từ packet tap và xác nhận không có attack/skill.
- Có/không có `hurt`, `downed`, mất context, cancel move-to hoặc target lost.
- Nếu hủy: điều kiện cụ thể và thời điểm người vận hành dừng bot.

Không ghi token, mật khẩu, tên nhân vật, `selfId`, id người chơi hoặc raw packet.

## Việc chưa làm trong kịch bản này

| Hạng mục | Trạng thái |
|---|---|
| Đánh thường | Chưa làm trong P2 |
| Kỹ năng | Chưa làm trong P2 |
| Rút lui tự động | Chưa làm; người vận hành dừng bot |
| Nhiều quái/target switching | Chưa làm trong P2 |
| Quái đuổi theo/leash và độ ổn định đứng yên lâu trong tầm | Chưa xác minh live |

