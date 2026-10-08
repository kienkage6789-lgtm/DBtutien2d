# TuTien2D Control-plane API

Cập nhật: 2026-10-08. API này là control-plane nội bộ của dashboard, không phải API game.

## Bảo mật

- Mặc định bind `127.0.0.1`.
- Bind ngoài loopback bắt buộc `API_TOKEN` tối thiểu 32 ký tự.
- REST đi qua auth middleware; WS dùng subprotocol `bearer` và kiểm tra Origin allowlist.
- Không đưa credential vào query string hoặc response/log public.

## Endpoint đang giữ

| Method | Path | Ý nghĩa |
|---|---|---|
| `GET` | `/health` | Health check |
| `GET` | `/api/system/status` | Uptime, memory, số account/running |
| `GET` | `/api/accounts` | Runtime snapshot của mọi account |
| `GET` | `/api/accounts/:id` | Runtime snapshot một account |
| `POST` | `/api/accounts` | Verify và tạo account |
| `PUT` | `/api/accounts/:id/password` | Verify và cập nhật password |
| `DELETE` | `/api/accounts/:id` | Dừng rồi xóa account/config/log |
| `POST` | `/api/accounts/:id/start` | Khởi động VendorRunner |
| `POST` | `/api/accounts/:id/stop` | Dừng VendorRunner |
| `POST` | `/api/accounts/:id/restart` | Stop rồi start lại vendor |
| `POST` | `/api/accounts/:id/auto/start` | Bật Auto chính thức, tùy chọn anchor |
| `POST` | `/api/accounts/:id/auto/stop` | Tắt Auto chính thức |
| `GET` | `/api/accounts/:id/khu` | Đọc khu hiện tại và danh sách khu; `?refresh=1` yêu cầu gói `xem` mới |
| `POST` | `/api/accounts/:id/khu` | Đổi sang khu `{ "khu": N }` của map hiện tại |
| `POST` | `/api/accounts/:id/move-to` | Nhận tọa độ `{x,y}` và bắt đầu đi trong map hiện tại |
| `POST` | `/api/accounts/:id/move-to/cancel` | Hủy thao tác đi tay theo `operationId` |
| `GET` | `/api/accounts/:id/daily` | Đọc ngày, điểm danh, lượt seed và nhiệm vụ hiện tại |
| `POST` | `/api/accounts/:id/daily/checkin` | Bắt đầu điểm danh; body rỗng hoặc `{}` |
| `POST` | `/api/accounts/:id/daily/seed` | Bắt đầu `duoc_moc`: `{taskId,runs?,abortOnHurt?,maxHurt?}` |
| `POST` | `/api/accounts/:id/daily/cancel` | Hủy nhiệm vụ theo `{operationId}` |
| `POST` | `/api/orchestrator/start-all` | Start tuần tự mọi account |
| `POST` | `/api/orchestrator/stop-all` | Stop mọi vendor session |
| `GET` | `/api/accounts/:id/logs` | Log một account |
| `GET` | `/api/logs` | Log toàn hệ thống |
| `GET` | `/api/maps` | Catalog map read-only |
| `GET` | `/api/maps/:id/geometry` | Bounds/grid/portal marker cho MiniMap |

`POST /auto/start` nhận `{}` hoặc `{ "anchor": { "mapId", "khu?", "x", "y" } }`. Runner vẫn kiểm tra in-game, vitals, downed và map anchor; lỗi trả envelope `{success:false,error,errorCode,retryable}`.

Runtime giữ các nhóm dữ liệu: `engine:"vendor"`, connection/lifecycle, HP/MP/vitals freshness, vị trí/map/khu, marker players/monsters, `vendor.supervisor`, `moveTo`, `hurtCount`/`lastHurtAt`, death/revive/trip counters và packet/error/memory telemetry. Dữ liệu chưa biết là `null`, không thay bằng 0.

## Danh sách và đổi khu

`GET /api/accounts/:id/khu` trả `{ mapId, khu, soKhu, list }`. `list` là `null` khi chưa nhận danh sách hợp lệ; nếu có thì gồm `{ mapId, khu, dem, toiDa, tran, observedAt }`. `dem[i]` là số người ở khu `i + 1`; dữ liệu được giới hạn và kiểm tra kiểu ở runner/web, chỉ giữ cho map hiện tại. `refresh=1` gửi `{ "op": "khu", "act": "xem" }` qua Gateway chính thức và chờ gói `khu` đúng `mapId`, tối đa 3 giây.

`POST /api/accounts/:id/khu` chỉ nhận đúng body `{ "khu": N }`. Runner chỉ gửi `{ "op": "khu", "act": "chon", "khu": N }` khi đang `IN_GAME`, map đã sẵn sàng, nhân vật không gục, Auto/supervisor và `walkTo` đều idle, map có `soKhu > 1`, đích hợp lệ, không trùng khu hiện tại và không trong bảo vệ hồi 5 giây phía client. Thành công được xác nhận bởi gói `map` cùng `mapId` và `khu` mới; toast thành công không được dùng làm ACK. Từ chối được nhận từ toast: cooldown `Vừa đổi khu, chờ N giây nữa.` → `KHU_COOLDOWN` với `retryAfterSec=N`, `Đang ở khu này rồi.` → `KHU_ALREADY_HERE`, toast khác → `KHU_REJECTED` và message đã làm sạch tối đa 120 ký tự; không có phản hồi trong khoảng 4 giây → `KHU_TIMEOUT`.

Ánh xạ lỗi: `INVALID_REQUEST` là HTTP 400; `TARGET_INVALID` là 400; các gate `NOT_IN_GAME`, `VENDOR_MAP_NOT_READY`, `CHARACTER_DOWN`, `AUTO_ACTIVE`, `OPERATION_IN_PROGRESS`, `KHU_IN_PROGRESS`, `KHU_ALREADY_HERE` là 409; `MAP_NOT_SPLIT` và `KHU_REJECTED` là 422; `KHU_COOLDOWN` là 429 và có `Retry-After`; `KHU_TIMEOUT` là 504. `retryable` là `true` cho `VENDOR_MAP_NOT_READY`, `KHU_IN_PROGRESS`, `KHU_COOLDOWN`, `KHU_TIMEOUT`.

Khi gói `map` cùng `mapId` nhưng `khu` đổi đến từ bất kỳ nguồn nào, runner hủy `walkTo` đang chạy với lý do `khu_changed`, vì client có thể làm mới entity/epoch tại khu mới. Không có bước tự đi tới Bảng Khu trong bản này; kết quả live ở `docs/RESEARCH_KHU_CHANGE.md` cho thấy server chấp nhận đổi khu ngoài bán kính bảng ở `tan_vien`.

## Di chuyển trong map hiện tại

`POST /api/accounts/:id/move-to` chỉ nhận body có đúng hai trường số hữu hạn: `{ "x": 320, "y": 192 }`. Runner gọi `Pathfinder.route(map, x, y, tx, ty, HITBOX_W / 2, HITBOX_H)` rồi `player.setPath(route)`; server không tự dựng packet `move`. Kết quả `data` là `WalkOperation` gồm `operationId`, `target`, `resolvedTarget`, `status`, `requester`, `startedAt` và `updatedAt`.

`resolvedTarget` là waypoint cuối của route, tức tâm ô đi được mà client đã snap trong bán kính 6 ô. Nếu ô snap là ô cổng của map hiện tại, request trả `TARGET_ON_PORTAL` (HTTP 422); bản 1 không đổi map. Các mã lỗi dùng envelope `{success:false,error,errorCode,retryable}`: `NOT_IN_GAME`, `VENDOR_MAP_NOT_READY`, `CHARACTER_DOWN`, `AUTO_ACTIVE`, `OPERATION_IN_PROGRESS` là HTTP 409; `TARGET_INVALID` là 400; `TARGET_UNREACHABLE` và `TARGET_ON_PORTAL` là 422.

`POST /move-to/cancel` nhận `{ "operationId": "..." }` và trả operation đã `cancelled`; thao tác không tồn tại trả HTTP 404. Runtime `moveTo` (đồng thời có trong `vendor` snapshot) giữ trạng thái cuối để dashboard hiển thị đích đã snap, trạng thái và lý do. Vòng lặp runner tự kết thúc khi tới trong bán kính mặc định 20 px, đứng yên quá 5 giây (blocked/stuck), quá timeout theo quãng đường (failed/timeout), gục, chuyển cảnh/đổi map, reconnect, stop runner hoặc Auto được bật; mọi kết thúc đều gọi `player.stop()`.

## Nhiệm vụ hằng ngày bản 1

`GET /daily` trả `DailyStatus` cùng `current`. `POST /daily/checkin` và `/daily/seed` trả HTTP 202 với `DailyOperation`; `/daily/cancel` trả operation đã `cancelled`. Bản 1 chỉ hỗ trợ `duoc_moc`; các seed task khác vẫn được đọc và hiển thị nhưng trả `TASK_NOT_SUPPORTED` (422). Lỗi gate dùng envelope `{success:false,error,errorCode,retryable}`: map chưa sẵn sàng có `retryable:true`; các gate runtime là 409, `STAGE_TOO_LOW`/`TASK_NOT_SUPPORTED` là 422, body sai là 400 và operation không tồn tại là 404.

Runner lấy prop `manh_shopt1`, `dai_phu`, `co_thu_linh_moc` từ `MapData`/`SceneWorld.map` lúc chạy. Với `duoc_moc`, nó gọi `Quest.startSeedQuest`, đặt `SceneWorld.chopping = { prop, swing: 0, t: 10 }` theo `ea()` đã đo, để client tự nhặt cành và phát `seed.collect`, rồi gọi `Quest.completeSeedQuest`. ACK được ghép theo `cmd` (`diemdanh`, `seed.start`, `seed.collect`, `seed.complete`) trước khi chờ tối đa 5 giây; `state ...:refused` chỉ để client đồng bộ và `ack.why` được giữ trong operation, không retry mù.

Thao tác daily giữ quyền lái với `walkTo`/đổi khu/Auto; gục, reconnect, stop và Auto bật sẽ hủy. Mặc định `abortOnHurt=false` theo yêu cầu; có thể bật ở request seed. Chưa xác minh live ở bản này: ngưỡng NPC chính xác, giới hạn lượt server, các task còn lại và hành vi rời việc giữa chừng.

## Endpoint đã gỡ

Đã xóa `vitals/refresh`, `map/enter`, `action`, toàn bộ `training`, và `GET/PUT /config`. Không còn endpoint gửi lệnh core, combat tự viết, training hay inventory/bag. `move-to` bản 1 là đường đi vendor cùng map qua control-plane; MiniMap chỉ phát request tọa độ hợp lệ và hiển thị runtime.

DB vẫn tương thích file cũ: `botConfigs` legacy được đọc an toàn và khi có ghi sẽ chỉ giữ `engine:"vendor"` cùng `pref` nếu có. Không còn cấu hình chọn engine core.

## Bản 2a: đi tới map qua cổng

`POST /api/accounts/:id/move-to` nhận `{x,y}` cho cùng map, hoặc `{mapId}` cho map khác. Khi `mapId` khác map hiện tại, `x,y` tùy chọn và thao tác dừng tại điểm spawn sau cổng; khi cùng map, `x,y` vẫn bắt buộc. `abortOnHurt` là boolean, mặc định `true` cho đi nhiều map; `maxHurt` là số nguyên 1–50, mặc định 1.

`GET /api/accounts/:id/reachable-maps` trả `{ currentMapId, maps: [{ mapId, name?, hops, route }] }`. Đồ thị lấy từ `P.MapData` của client vendor và chỉ dùng `map.portals`. `byHand`, `cooldownSec > 0`, `cooldownGroup`, `warps` và cấu trúc không xác minh bị loại. Account không tồn tại trả 404; chưa biết map hiện tại trả 409 `NOT_IN_GAME` hoặc `VENDOR_MAP_NOT_READY`.

`WalkOperation` có thêm `route` và `leg`; `target` có thể là `null` với request map-only. Các lỗi `ROUTE_UNAVAILABLE` và `PATH_CROSSES_PORTAL` trả HTTP 422, dùng cùng envelope `success/error/errorCode/retryable`.

## WebSocket `/ws`

Server gửi `initial_state`, `account_updated`, `account_log` và `bot_activity`. Client merge snapshot theo timestamp/context, không gửi command ngược qua WS. Runtime không chứa token, self id hoặc dữ liệu credential.
