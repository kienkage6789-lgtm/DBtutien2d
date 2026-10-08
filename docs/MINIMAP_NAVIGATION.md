# Mini-map và click-to-move

## Trạng thái

MVP đã được triển khai cho các map có `WALK_GRIDS`: dashboard thay danh sách quái dài bằng mini-map SVG, lấy geometry từ server và gửi lệnh di chuyển tới tọa độ world. Di chuyển vẫn đi qua collision grid/A*, dùng `PredictedMover` để tính bước theo tốc độ `AUTO_CONSTANTS` (100.98 px/s, xấp xỉ 101 ở walk), và chỉ kết luận arrived/blocked từ vị trí authoritative; không bypass collision hoặc portal.

Vòng gửi giữ nhịp khoảng 100 ms. Prediction giúp không lặp lại vị trí `entry.location`
cũ trong lúc chờ `you` (thường theo seq bội số 10); mỗi bước bị giới hạn bởi tốc độ
và dt thực sau rounding. Khi `you` có correction, mover xử lý queue command còn chờ
theo `seq`/`ep` và ngưỡng client thật. Đây là mô hình đã kiểm thử offline; tốc độ
hiệu dụng và `you.fix` trên game thật **chưa xác minh**.

## REST contract

### Geometry

```http
GET /api/maps/:mapId/geometry
```

Response thành công:

```json
{
  "success": true,
  "data": {
    "mapId": "tan_vien",
    "tileSize": 32,
    "widthPx": 1280,
    "heightPx": 960,
    "bounds": { "minX": 0, "minY": 0, "maxX": 1280, "maxY": 960 },
    "grid": { "width": 40, "height": 30 }
  }
}
```

Map chưa có collision grid trả `404 map_geometry_unavailable`; UI vẫn hiển thị trạng thái nhưng khóa click.
Geometry cũng có thể trả `portals`; mỗi portal dùng `(tx, ty)` theo tile và không được
bypass bằng cách gửi lệnh `enter` trực tiếp.

### Move to coordinate

```http
POST /api/accounts/:accountId/navigation/move-to
Content-Type: application/json
```

```json
{
  "requestId": "client-request-uuid",
  "mapId": "tan_vien",
  "khu": 1,
  "x": 512,
  "y": 928,
  "arrivalRadius": 20
}
```

Server kiểm tra bot đang chạy, kết nối, map/khu authoritative còn fresh tối đa 15 giây, HP còn sống, bounds và tile đích walkable. Response `202` trả `operationId`. `requestId` lặp lại cùng target là idempotent; cùng request ID nhưng khác target bị từ chối.

Các lỗi chính:

- `target_out_of_bounds`
- `target_blocked`
- `world_context_stale_or_mismatch`
- `operation_in_progress`
- `character_not_alive`

`422 target_blocked` là lỗi hợp lệ, không phải lỗi mạng. Server không tự bỏ qua
collision: response có thể kèm `acceptedTarget: {x, y}` (và `nearestTarget` để
tương thích client cũ). Client hiển thị lỗi trên mini-map và chỉ retry khi người
dùng chọn điểm gợi ý. Điểm gợi ý là tile walkable gần click, chưa phải cam kết có
đường đi từ vị trí hiện tại; path planner vẫn phải kiểm tra lại.

UI hiển thị backend error code, message giải thích theo code đã biết và HTTP
status. Nếu backend trả `message`, UI ưu tiên message đó; nếu chỉ có `error`, UI
giữ nguyên error code và dùng mô tả tương ứng khi có mapping.

Mini-map khóa click khi move-to đang `accepted`/`running` hoặc portal navigation
đang `planning`/`moving_to_portal`/`waiting_map_confirmation`. Nút hủy move-to
vẫn khả dụng trong lúc thao tác đang chạy. Tuổi map context được tính từ
`observedAt` và so với TTL 15 giây; trường `fresh` một mình không chứng minh
context còn trong TTL. Click marker quái chỉ di chuyển tới tọa độ marker: API
move-to không nhận `monsterId`, nên hành vi này không chọn hoặc đánh mục tiêu.

Hủy thao tác:

```http
POST /api/accounts/:accountId/navigation/move-to/cancel
Content-Type: application/json
```

```json
{ "operationId": "..." }
```

## Realtime runtime

`account_updated.data.moveTo` có các trạng thái `accepted`, `running`, `arrived`, `blocked`, `failed`, `cancelled`. Map/khu đổi, mất freshness, disconnect, chết hoặc stop bot sẽ hủy operation đang chạy.

### Vị trí quái theo thời gian thực

Public client phát opcode `snap2` gồm snapshot đầy đủ hoặc delta. Contract live đã
được đối chiếu với `SnapDelta.apply`:

- `pf`/`ef`: upsert entity người chơi/quái; full baseline thường dùng hai field này;
- `p`/`e`: patch field người chơi/quái, giá trị `null` xóa field;
- `gp`/`ge`: xóa entity người chơi/quái;
- `full`: server có thể gửi boolean hoặc giá trị compact `1`;
- `sq`: full baseline có thể bắt đầu ở `-1`; delta sau đó phải tăng liền kề;
- `ep`: map epoch tùy chọn, nếu có thì phải khớp context hiện tại.

`core-client` giảm packet thành snapshot nguyên tử rồi phát `worldSnapshot` cho
worker. Packet stale, sai map/khu/context hoặc bị gap không được áp dụng; khi gap,
client gửi `resync` tối đa một lần/giây và chờ full snapshot kế tiếp. Nếu full đến
trước map/khu, client giữ lại và apply sau khi context sẵn sàng. Worker chỉ nhận
entity có `id`, `x`, `y` hữu lệ, kiểm tra lại map/khu/freshness, sau đó phát
`account_updated`.
Wire state vẫn cập nhật theo cadence của game; fan-out dashboard được giới hạn tối
đa 5 lần/giây để tránh làm nghẽn WS. Nếu không có snapshot mới trong 5 giây, API
trả danh sách quái rỗng và `monstersContext.fresh=false`; UI không giữ ghost marker.

`account_updated.data.worldSync` chỉ là telemetry không nhạy cảm (`received`,
`accepted`, `fullReceived`, `resyncs`, sequence cuối và lý do reject) để phân biệt
server không phát entity với lỗi reducer; không chứa token hoặc raw payload.

Đây là realtime theo snapshot authoritative, không phải client tự đoán vị trí. UI
mini-map chỉ hiển thị marker khi context khớp và snapshot còn fresh; click marker
vẫn đi qua `move-to` và collision-aware path.

Move-to REST hiện vẫn dùng `mapId`/`khu` authoritative và không nhận field `epoch`;
`ep` ở trên chỉ bảo vệ việc reduce `snap2` trong client. Không được tự suy diễn
`observedAt` thành epoch hoặc dùng snapshot cũ cho context mới.

## Projection

Mini-map giữ tỉ lệ bằng `preserveAspectRatio="xMidYMid meet"`, loại phần letterbox khỏi phép nghịch đảo và dùng hệ tọa độ game Y-down. Portal catalog lưu tile nên renderer đổi portal `(tx, ty)` thành tâm pixel `(tx * 32 + 16, ty * 32 + 16)`.

## Verification

- `minimap-navigation.contract.test.mjs`: projection, bounds, stale context, blocked tile, deterministic path và cancel lifecycle — fixture/contract test.
- `walk-path.test.mjs`: collision-aware path hiện tại.
- `portal-navigation.test.ts`: state machine chuyển map qua portal.
- `snap2-replay.test.mjs`: full/delta, patch/remove, stale sequence, gap/resync và reset context.
- `snap2-resync.test.mjs`: full đến trước map/khu, full compact và resync có rate-limit.
- Live smoke 2026-10-07: `IN_GAME`; sau portal `tan_vien → mieu_hoang`, `snap2` accepted liên tục, `monstersContext.fresh=true`, marker quái quan sát được thay đổi tọa độ theo sequence.
- Live smoke này xác nhận luồng account/map đã chọn; chưa coi đó là bằng chứng mọi map/khu đều có spawn quái hoặc mọi portal đều đã được kiểm thử live.

Không ghi token, refresh token, mật khẩu hoặc proxy credential vào log/evidence.
