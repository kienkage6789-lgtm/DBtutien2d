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
| `POST` | `/api/accounts/:id/move-to` | Nhận tọa độ `{x,y}` và bắt đầu đi trong map hiện tại |
| `POST` | `/api/accounts/:id/move-to/cancel` | Hủy thao tác đi tay theo `operationId` |
| `POST` | `/api/orchestrator/start-all` | Start tuần tự mọi account |
| `POST` | `/api/orchestrator/stop-all` | Stop mọi vendor session |
| `GET` | `/api/accounts/:id/logs` | Log một account |
| `GET` | `/api/logs` | Log toàn hệ thống |
| `GET` | `/api/maps` | Catalog map read-only |
| `GET` | `/api/maps/:id/geometry` | Bounds/grid/portal marker cho MiniMap |

`POST /auto/start` nhận `{}` hoặc `{ "anchor": { "mapId", "khu?", "x", "y" } }`. Runner vẫn kiểm tra in-game, vitals, downed và map anchor; lỗi trả envelope `{success:false,error,errorCode,retryable}`.

Runtime giữ các nhóm dữ liệu: `engine:"vendor"`, connection/lifecycle, HP/MP/vitals freshness, vị trí/map/khu, marker players/monsters, `vendor.supervisor`, `moveTo`, `hurtCount`/`lastHurtAt`, death/revive/trip counters và packet/error/memory telemetry. Dữ liệu chưa biết là `null`, không thay bằng 0.

## Di chuyển trong map hiện tại

`POST /api/accounts/:id/move-to` chỉ nhận body có đúng hai trường số hữu hạn: `{ "x": 320, "y": 192 }`. Runner gọi `Pathfinder.route(map, x, y, tx, ty, HITBOX_W / 2, HITBOX_H)` rồi `player.setPath(route)`; server không tự dựng packet `move`. Kết quả `data` là `WalkOperation` gồm `operationId`, `target`, `resolvedTarget`, `status`, `requester`, `startedAt` và `updatedAt`.

`resolvedTarget` là waypoint cuối của route, tức tâm ô đi được mà client đã snap trong bán kính 6 ô. Nếu ô snap là ô cổng của map hiện tại, request trả `TARGET_ON_PORTAL` (HTTP 422); bản 1 không đổi map. Các mã lỗi dùng envelope `{success:false,error,errorCode,retryable}`: `NOT_IN_GAME`, `VENDOR_MAP_NOT_READY`, `CHARACTER_DOWN`, `AUTO_ACTIVE`, `OPERATION_IN_PROGRESS` là HTTP 409; `TARGET_INVALID` là 400; `TARGET_UNREACHABLE` và `TARGET_ON_PORTAL` là 422.

`POST /move-to/cancel` nhận `{ "operationId": "..." }` và trả operation đã `cancelled`; thao tác không tồn tại trả HTTP 404. Runtime `moveTo` (đồng thời có trong `vendor` snapshot) giữ trạng thái cuối để dashboard hiển thị đích đã snap, trạng thái và lý do. Vòng lặp runner tự kết thúc khi tới trong bán kính mặc định 20 px, đứng yên quá 5 giây (blocked/stuck), quá timeout theo quãng đường (failed/timeout), gục, chuyển cảnh/đổi map, reconnect, stop runner hoặc Auto được bật; mọi kết thúc đều gọi `player.stop()`.

## Endpoint đã gỡ

Đã xóa `vitals/refresh`, `map/enter`, `action`, toàn bộ `training`, và `GET/PUT /config`. Không còn endpoint gửi lệnh core, combat tự viết, training hay inventory/bag. `move-to` bản 1 là đường đi vendor cùng map qua control-plane; MiniMap chỉ phát request tọa độ hợp lệ và hiển thị runtime.

DB vẫn tương thích file cũ: `botConfigs` legacy được đọc an toàn và khi có ghi sẽ chỉ giữ `engine:"vendor"` cùng `pref` nếu có. Không còn cấu hình chọn engine core.

## WebSocket `/ws`

Server gửi `initial_state`, `account_updated`, `account_log` và `bot_activity`. Client merge snapshot theo timestamp/context, không gửi command ngược qua WS. Runtime không chứa token, self id hoặc dữ liệu credential.
