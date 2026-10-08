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
| `POST` | `/api/orchestrator/start-all` | Start tuần tự mọi account |
| `POST` | `/api/orchestrator/stop-all` | Stop mọi vendor session |
| `GET` | `/api/accounts/:id/logs` | Log một account |
| `GET` | `/api/logs` | Log toàn hệ thống |
| `GET` | `/api/maps` | Catalog map read-only |
| `GET` | `/api/maps/:id/geometry` | Bounds/grid/portal marker cho MiniMap |

`POST /auto/start` nhận `{}` hoặc `{ "anchor": { "mapId", "khu?", "x", "y" } }`. Runner vẫn kiểm tra in-game, vitals, downed và map anchor; lỗi trả envelope `{success:false,error,errorCode,retryable}`.

Runtime giữ các nhóm dữ liệu: `engine:"vendor"`, connection/lifecycle, HP/MP/vitals freshness, vị trí/map/khu, marker players/monsters, `vendor.supervisor`, `hurtCount`/`lastHurtAt`, death/revive/trip counters và packet/error/memory telemetry. Dữ liệu chưa biết là `null`, không thay bằng 0.

## Endpoint đã gỡ

Đã xóa `vitals/refresh`, `map/enter`, `navigation/move-to` và cancel, `action`, toàn bộ `training`, và `GET/PUT /config`. Không còn endpoint gửi lệnh core, di chuyển tự viết, combat tự viết, training hay inventory/bag. MiniMap chỉ đọc geometry/runtime.

DB vẫn tương thích file cũ: `botConfigs` legacy được đọc an toàn và khi có ghi sẽ chỉ giữ `engine:"vendor"` cùng `pref` nếu có. Không còn cấu hình chọn engine core.

## WebSocket `/ws`

Server gửi `initial_state`, `account_updated`, `account_log` và `bot_activity`. Client merge snapshot theo timestamp/context, không gửi command ngược qua WS. Runtime không chứa token, self id hoặc dữ liệu credential.
