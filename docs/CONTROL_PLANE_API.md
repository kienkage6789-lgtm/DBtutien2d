# TuTien2D Control-plane API

Cập nhật: 2026-10-09. API này là control-plane nội bộ của dashboard, không phải API game.

## Bảo mật

- Mặc định bind `127.0.0.1`.
- Bind ngoài loopback bắt buộc `API_TOKEN` tối thiểu 32 ký tự và `TRUST_PROXY=1` sau reverse proxy HTTPS.
- `/health` và `POST /api/auth/login` là hai route công khai duy nhất. Mọi `/api/**` khác cần `Authorization: Bearer <session-token>`.
- Session token ngẫu nhiên 32 byte chỉ lưu SHA-256 trong SQLite, hạn 7 ngày trượt theo lần dùng, tối đa 5 session/người.
- WS dùng subprotocol `bearer, <session-token>`, kiểm tra Origin allowlist và đóng khi session bị thu hồi/hết hạn/user bị khóa.
- `API_TOKEN` cũ chỉ được chấp nhận như admin đặc biệt khi request đến từ loopback và server bind loopback; bind ngoài loopback chỉ bật thêm khi đặt `ALLOW_LEGACY_API_TOKEN=1`. Không có `API_TOKEN` thì không có đường vào không auth.
- Không đưa credential vào query string hoặc response/log public.
- Server gửi `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy` hạn chế và `Cross-Origin-Opener-Policy: same-origin`; HTML build có CSP, còn `/api/**` dùng `Cache-Control: no-store`.
- `Strict-Transport-Security: max-age=15552000` chỉ xuất hiện khi `TRUST_PROXY=1` và request đã được reverse proxy đánh dấu HTTPS. `trust proxy` dùng đúng 1 hop, không dùng `true`.
- `PUBLIC_ORIGIN` được tự thêm vào allowlist Origin REST/WS. Không dùng `*`. Tài nguyên `assets/` được cache immutable; `index.html` không cache.

## Xác thực và người dùng

| Method | Path | Ý nghĩa |
|---|---|---|
| `POST` | `/api/auth/login` | `{username,password}` → session token và user public; sai quá 5 lần/15 phút theo IP hoặc username trả `429 TOO_MANY_ATTEMPTS` và `Retry-After`. |
| `POST` | `/api/auth/logout` | Thu hồi session hiện tại. |
| `GET` | `/api/auth/me` | Đọc user public và hạn session hiện tại. |
| `POST` | `/api/auth/password` | Đổi mật khẩu của chính mình; giữ session hiện tại và thu hồi các session khác. |
| `GET` | `/api/admin/users` | Admin xem danh sách user không có hash/token. |
| `POST` | `/api/admin/users` | Admin tạo user `{username,password,maxBots?}`. |
| `PATCH` | `/api/admin/users/:id` | Admin cập nhật `status` (`active`/`disabled`) hoặc `maxBots`. Khóa user dừng runner và thu hồi session. |
| `POST` | `/api/admin/users/:id/password` | Admin đặt lại mật khẩu, thu hồi session và buộc đổi mật khẩu lần sau. |
| `DELETE` | `/api/admin/users/:id` | Dừng runner rồi xóa user cùng game account/config/log/session; không xóa chính mình hoặc admin cuối. |
| `POST` | `/api/admin/users/:id/grant` | Admin cấp thêm `{duration:"1d"|"7d"|"30d"}`; cộng dồn từ hạn còn lại, ghi `grants` và audit `user_granted`. Admin/ user bị khóa trả lỗi riêng. |
| `POST` | `/api/admin/users/:id/expiry` | Admin đặt hạn tuyệt đối `{expiresAt:number|null}`; 
ull`/hạn đã qua là chưa có quyền chạy và kích watcher ngay, audit `user_expiry_set`. |
| `POST` | `/api/admin/users/:id/stop-bots` | Dừng mọi runner của user, kể cả user hết hạn/khóa; trả `{stopped}` và audit `admin_stop_bots`. |
| `POST` | `/api/admin/users/:id/revoke-sessions` | Thu hồi phiên dashboard; khi admin tự chọn mình giữ phiên hiện tại và trả `{revoked,preservedCurrent}`. |
| `GET` | `/api/admin/audit?limit=50&before=<at-ms>` | Nhật ký kiểm toán đã làm sạch, phân trang tối đa 200 dòng; trả `data` và 
extBefore`, không có hash/token/mật khẩu. |

## Proxy theo tài khoản

Proxy được lưu trong bảng `proxies`; URL được mã hóa AES-256-GCM và `game_accounts.proxy_id` là liên kết duy nhất. Cột URL proxy legacy không còn được đọc/ghi. Mỗi account chỉ có một proxy và mọi request auth/WebSocket của vendor phải đi qua proxy đó; không có fallback trực tiếp. Proxy private/loopback bị từ chối mặc định.

| Method | Path | Ý nghĩa |
|---|---|---|
| `GET` | `/api/admin/proxies` | Admin xem danh sách proxy đã làm sạch: `endpoint` không có userinfo, `hasAuth`, trạng thái, latency, sức chứa và account được gán. |
| `POST` | `/api/admin/proxies` | Tạo `{label,url,maxAccounts}`; hỗ trợ `http/https/socks5/socks5h`, bắt buộc port và kiểm tra duplicate. |
| `PATCH` | `/api/admin/proxies/:id` | Đổi nhãn/URL/sức chứa/bật-tắt; không cho đổi URL hoặc tắt khi account đang chạy. |
| `DELETE` | `/api/admin/proxies/:id` | Xóa proxy chưa gán account. |
| `POST` | `/api/admin/proxies/:id/check` | Kiểm tra health Supabase và WebSocket game qua chính proxy; trả proxy đã cập nhật với `status:"down"` và lỗi đã làm sạch nếu kiểm tra thất bại. |
| `PUT` | `/api/admin/accounts/:id/proxy` | Gán `{proxyId:"..."}` hoặc bỏ gán bằng `{proxyId:null}`; account phải stopped. |

Khi `AUTO_ASSIGN_PROXY=1` (mặc định), tạo account chọn proxy enabled/không down có ít account nhất và kiểm tra lại sức chứa trong transaction. `REQUIRE_PROXY=1` từ chối tạo/start nếu không có proxy khả dụng. Các lỗi ổn định gồm `NO_PROXY_AVAILABLE`, `PROXY_REQUIRED`, `PROXY_DISABLED`, `PROXY_UNAVAILABLE`, `PROXY_CONNECT_FAILED`, `PROXY_AUTH_FAILED`, `PROXY_TIMEOUT` và `PROXY_PROTOCOL_ERROR`; lỗi transport không trả credential hoặc URL đầy đủ.

`ALLOW_PRIVATE_PROXY=1` chỉ dành cho kiểm thử cục bộ. `PROXY_CHECK_INTERVAL_MS` mặc định 300000 ms, tối thiểu 100 ms; `PROXY_CHECK_TIMEOUT_MS` mặc định 8000 ms, tối thiểu 100 ms. User thường chỉ nhận `hasProxy:boolean`, không nhận endpoint, proxy id hay trạng thái proxy; admin mới nhận dữ liệu đã sanitize.

User thường chỉ thấy và điều khiển game account có `owner_id` của mình. Account của user khác trả `404 ACCOUNT_NOT_FOUND`, kể cả các route con dưới `/api/accounts/:id/**`; gọi `/api/admin/**` trả `403 FORBIDDEN`. `GET /api/orchestrator/start-all|stop-all`, `/api/logs` và `/api/system/status` cũng được giới hạn theo owner; admin vẫn thấy toàn hệ thống.

`GET /api/auth/me` và user public trong login/admin trả `entitlement: { state, expiresAt, remainingMs }`. State của user thường là `active`, `expired`, 
one` hoặc `disabled`; admin luôn là `admin`. User thường còn có `usage: { accounts, running, maxBots }`. `GET /api/admin/users` bổ sung `createdAt`, `lastLoginAt`, `createdBy` (username hoặc 
ull`), `usage` và `activeSessions`; không trả bất kỳ hash nào. `serverNow` ở cấp response là thời gian máy chủ (ms) để dashboard hiệu chỉnh đồng hồ trình duyệt. User hết hạn/chưa cấp/bị khóa vẫn đăng nhập và xem được trạng thái.

Khi hết hạn, các route điều khiển sau bị chặn với HTTP 403: `POST /api/accounts/:id/start`, `restart`, `auto/start`, `khu`, `move-to` (kể cả cancel), `daily/checkin`, `daily/seed`, `daily/cancel` và các route điều khiển tương tự; `POST /api/orchestrator/start-all` cũng bị chặn. Các route `GET` chỉ đọc, `POST /stop`, `POST /auto/stop`, `DELETE /api/accounts/:id`, `PUT /api/accounts/:id/password`, log và trạng thái vẫn được qua để người dùng tự dừng/dọn tài khoản. `POST /api/accounts` không yêu cầu còn hạn: user hết hạn vẫn được thêm tài khoản nếu còn chỗ; user bị khóa không được thêm. Hạ `maxBots` dưới số tài khoản hoặc runner hiện có không tự xóa/dừng gì, chỉ chặn thêm tài khoản/chạy thêm.

Các mã lỗi quyền/hạn mức ổn định: `ENTITLEMENT_EXPIRED`, `ENTITLEMENT_NONE`, `USER_DISABLED`, `QUOTA_BOTS` (HTTP 403), `BOT_LIMIT_REACHED` (HTTP 409) và `SERVER_CAPACITY` (HTTP 503, `retryable:true`). Admin có thêm `FORBIDDEN`, `USER_NOT_FOUND`, `MAX_BOTS_INVALID`, `LAST_ADMIN_FORBIDDEN`, `SELF_MODIFICATION_FORBIDDEN`, `ADMIN_NOT_EXPIRING`, `RUNNER_NOT_STOPPED`, `AUDIT_LIMIT_INVALID` và `AUDIT_CURSOR_INVALID`. Lỗi dùng envelope `{success:false,error,errorCode,requestId,retryable}`.

Khuyến nghị: đăng nhập giao diện, mở `Quản trị` → `Người dùng`, chọn menu của user rồi dùng `+1 ngày/+1 tuần/+1 tháng` hoặc form đặt hạn tuyệt đối. Giao diện có xác nhận, khóa nút khi đang xử lý và hiển thị kết quả; mật khẩu reset chỉ nằm trong modal.

Phương án phụ cho script nội bộ (thay `<user-id>`; không đặt token vào URL và không ghi token vào log):

```sh
curl -X POST http://127.0.0.1:4000/api/admin/users/<user-id>/grant \
  -H 'Authorization: Bearer <session-token>' \
  -H 'Content-Type: application/json' \
  --data '{"duration":"1d"}'
```

Trần runner toàn máy chủ cấu hình bằng `MAX_TOTAL_RUNNERS` trong môi trường; mặc định `0` là không giới hạn. `ENTITLEMENT_SWEEP_MS` cấu hình chu kỳ `EntitlementWatcher`, mặc định 30.000 ms và bị kẹp tối thiểu 100 ms. Watcher chạy ngay một lượt lúc khởi động và sau grant/expiry/status/maxBots/delete; với user thường ở state bị chặn, nó dừng toàn bộ runner, audit `entitlement_stop`, ghi log từng account và gửi `system_alert` riêng cho owner. Kết nối WS không bị đóng vì hết hạn. Khi khởi động lại, các account persisted ở `running` được đặt lại `stopped`; bot không tự chạy lại.

SQLite nằm ở `DATA_DIR/tutien_db.sqlite`, bật WAL và foreign keys. Khi có `tutien_db.json` mà chưa có dữ liệu SQLite, server nhập account/config/log vào owner admin trong transaction rồi đổi tên file cũ thành `.migrated`; nếu nhập lỗi file cũ được giữ nguyên. Password game, refresh token, token cũ và proxy URL vẫn mã hóa AES-256-GCM; response public không chứa chúng.

## Endpoint đang giữ

| Method | Path | Ý nghĩa |
|---|---|---|
| `GET` | `/health` | Health check |
| `GET` | `/api/system/status` | Admin nhận uptime/memory/số account/running; user thường chỉ nhận số liệu account của mình |
| `GET` | `/api/admin/health` | Admin xem uptime, Node, RSS/heap, load average, RAM khả dụng, runner/cap, kích thước SQLite, số user/account và backup gần nhất; `process` bổ sung độ trễ vòng lặp, RSS/heap bytes và runner đang chạy; `shards` thêm `{id,pid,runners,rssBytes,eventLoop,stale,ignoredPackets}`; không trả path/env/secret |
| `GET` | `/api/accounts` | Runtime snapshot theo owner; admin nhận mọi account |
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
| `POST` | `/api/accounts/:id/daily/seed` | Bắt đầu `duoc_moc`, `linh_chi`, `truc_gia`, `cau_ca` hoặc `ho_tong_chau`: `{taskId,runs?,abortOnHurt?,maxHurt?}` |
| `POST` | `/api/accounts/:id/daily/cancel` | Hủy nhiệm vụ theo `{operationId}` |
| `POST` | `/api/orchestrator/start-all` | Start tuần tự mọi account |
| `POST` | `/api/orchestrator/stop-all` | Stop mọi vendor session |
| `GET` | `/api/accounts/:id/logs` | Log một account |
| `GET` | `/api/logs` | Log toàn hệ thống |
| `GET` | `/api/maps` | Catalog map read-only |
| `GET` | `/api/maps/:id/geometry` | Bounds/grid/portal marker cho MiniMap |

`POST /auto/start` nhận `{}` hoặc `{ "anchor": { "mapId", "khu?", "x", "y" } }`. Runner vẫn kiểm tra in-game, vitals, downed và map anchor; lỗi trả envelope `{success:false,error,errorCode,retryable}`.

API đã xác thực có rate-limit trong bộ nhớ theo IP và user: mặc định `1200` request/phút/IP và `600` request/phút/user, trả `429 RATE_LIMITED` cùng `Retry-After`. `/health`, login và tài nguyên tĩnh không dùng limiter này; login vẫn có limiter dò mật khẩu riêng. Có thể chỉnh bằng `API_RATE_LIMIT_IP_PER_MIN` và `API_RATE_LIMIT_USER_PER_MIN`.

WebSocket `/ws` giới hạn mặc định 10 kết nối/user, 500 kết nối toàn máy và 60 message/client/phút; payload tối đa 64 KiB. Hub ping/pong mỗi 30 giây, dọn kết nối không phản hồi và đóng khi vượt giới hạn. Biến tương ứng: `WS_MAX_CONNECTIONS_PER_USER`, `WS_MAX_CONNECTIONS_TOTAL`, `WS_MAX_MESSAGES_PER_MIN`.

Gate start/restart/auto/start-all kiểm tra `MAX_TOTAL_RUNNERS` và `MIN_FREE_MEM_MB` (mặc định 300 MB khả dụng; `0` tắt). Thiếu RAM trả `503 SERVER_CAPACITY` với `retryable:true`, không dừng runner đang chạy.

Biến triển khai chính: `HOST`, `PORT`, `DATA_DIR`, `BACKUP_DIR`, `TRUST_PROXY`, `PUBLIC_ORIGIN`, `MAX_TOTAL_RUNNERS`, `MIN_FREE_MEM_MB`, `BACKUP_KEEP`, các biến rate-limit/WS ở trên. `BACKUP_DIR` mặc định là `DATA_DIR/backups`.

Runtime giữ các nhóm dữ liệu: `ownerId`/`ownerUsername`, `engine:"vendor"`, connection/lifecycle, HP/MP/vitals freshness, vị trí/map/khu, marker players/monsters, `vendor.supervisor`, `moveTo`, `hurtCount`/`lastHurtAt`, death/revive/trip counters, packet/error/memory telemetry và `metrics` theo từng account. `metrics` có `frames`, `avgMs` (EMA), `p95Ms`, `maxMs`, `busyRatio` và `windowMs`; khi runner chưa chạy toàn trường này là 
ull`, còn các trị số trong lúc chưa có mẫu cũng không được thay bằng 0. `busyRatio` là tổng thời gian xử lý khung chia cho thời gian thực của cửa sổ trượt; giá trị 0.25 tương ứng khoảng 25% một lõi trong cửa sổ đó. Đây là số liệu runtime, không đo CPU hệ điều hành theo từng bot.

`GET /api/admin/health` thêm `data.process`: `eventLoopDelay` gồm `p50Ms`, `p99Ms`, `maxMs` từ `monitorEventLoopDelay`, đã trừ chu kỳ lấy mẫu 20 ms và kẹp tối thiểu 0; sàn đo còn cộng độ phân giải bộ định thời của hệ điều hành nên tiến trình rảnh vẫn có thể báo vài ms. `rssBytes`, `heapUsedBytes` là bộ nhớ toàn tiến trình; `runningRunners` là số runner hiện chạy. Độ trễ trả 
ull` trước khi histogram có mẫu. Khi sharding bật, `data.shards` liệt kê `id`, `pid`, số runner, RSS, độ trễ event loop, cờ stale và số packet IPC bị bỏ qua. Cùng xem số liệu tiến trình và từng bot để phân biệt tải tổng với thời gian chiếm vòng lặp của mỗi runner; không suy ra số bot tối đa chỉ từ một cửa sổ ngắn. API account và WS chỉ đưa metrics cho account mà principal được phép xem (chủ sở hữu hoặc admin); `/api/admin/health` vẫn chỉ admin.

## Danh sách và đổi khu

`GET /api/accounts/:id/khu` trả `{ mapId, khu, soKhu, list }`. `list` là 
ull` khi chưa nhận danh sách hợp lệ; nếu có thì gồm `{ mapId, khu, dem, toiDa, tran, observedAt }`. `dem[i]` là số người ở khu `i + 1`; dữ liệu được giới hạn và kiểm tra kiểu ở runner/web, chỉ giữ cho map hiện tại. `refresh=1` gửi `{ "op": "khu", "act": "xem" }` qua Gateway chính thức và chờ gói `khu` đúng `mapId`, tối đa 3 giây.

`POST /api/accounts/:id/khu` chỉ nhận đúng body `{ "khu": N }`. Runner chỉ gửi `{ "op": "khu", "act": "chon", "khu": N }` khi đang `IN_GAME`, map đã sẵn sàng, nhân vật không gục, Auto/supervisor và `walkTo` đều idle, map có `soKhu > 1`, đích hợp lệ, không trùng khu hiện tại và không trong bảo vệ hồi 5 giây phía client. Thành công được xác nhận bởi gói `map` cùng `mapId` và `khu` mới; toast thành công không được dùng làm ACK. Từ chối được nhận từ toast: cooldown `Vừa đổi khu, chờ N giây nữa.` → `KHU_COOLDOWN` với `retryAfterSec=N`, `Đang ở khu này rồi.` → `KHU_ALREADY_HERE`, toast khác → `KHU_REJECTED` và message đã làm sạch tối đa 120 ký tự; không có phản hồi trong khoảng 4 giây → `KHU_TIMEOUT`.

Ánh xạ lỗi: `INVALID_REQUEST` là HTTP 400; `TARGET_INVALID` là 400; các gate `NOT_IN_GAME`, `VENDOR_MAP_NOT_READY`, `CHARACTER_DOWN`, `AUTO_ACTIVE`, `OPERATION_IN_PROGRESS`, `KHU_IN_PROGRESS`, `KHU_ALREADY_HERE` là 409; `MAP_NOT_SPLIT` và `KHU_REJECTED` là 422; `KHU_COOLDOWN` là 429 và có `Retry-After`; `KHU_TIMEOUT` là 504. `retryable` là `true` cho `VENDOR_MAP_NOT_READY`, `KHU_IN_PROGRESS`, `KHU_COOLDOWN`, `KHU_TIMEOUT`.

Khi gói `map` cùng `mapId` nhưng `khu` đổi đến từ bất kỳ nguồn nào, runner hủy `walkTo` đang chạy với lý do `khu_changed`, vì client có thể làm mới entity/epoch tại khu mới. Không có bước tự đi tới Bảng Khu trong bản này; kết quả live ở `docs/RESEARCH_KHU_CHANGE.md` cho thấy server chấp nhận đổi khu ngoài bán kính bảng ở `tan_vien`.

## Di chuyển trong map hiện tại

`POST /api/accounts/:id/move-to` chỉ nhận body có đúng hai trường số hữu hạn: `{ "x": 320, "y": 192 }`. Runner gọi `Pathfinder.route(map, x, y, tx, ty, HITBOX_W / 2, HITBOX_H)` rồi `player.setPath(route)`; server không tự dựng packet `move`. Kết quả `data` là `WalkOperation` gồm `operationId`, `target`, `resolvedTarget`, `status`, `requester`, `startedAt` và `updatedAt`.

`resolvedTarget` là waypoint cuối của route, tức tâm ô đi được mà client đã snap trong bán kính 6 ô. Nếu ô snap là ô cổng của map hiện tại, request trả `TARGET_ON_PORTAL` (HTTP 422); bản 1 không đổi map. Các mã lỗi dùng envelope `{success:false,error,errorCode,retryable}`: `NOT_IN_GAME`, `VENDOR_MAP_NOT_READY`, `CHARACTER_DOWN`, `AUTO_ACTIVE`, `OPERATION_IN_PROGRESS` là HTTP 409; `TARGET_INVALID` là 400; `TARGET_UNREACHABLE` và `TARGET_ON_PORTAL` là 422.

`POST /move-to/cancel` nhận `{ "operationId": "..." }` và trả operation đã `cancelled`; thao tác không tồn tại trả HTTP 404. Runtime `moveTo` (đồng thời có trong `vendor` snapshot) giữ trạng thái cuối để dashboard hiển thị đích đã snap, trạng thái và lý do. Vòng lặp runner tự kết thúc khi tới trong bán kính mặc định 20 px, đứng yên quá 5 giây (blocked/stuck), quá timeout theo quãng đường (failed/timeout), gục, chuyển cảnh/đổi map, reconnect, stop runner hoặc Auto được bật; mọi kết thúc đều gọi `player.stop()`.

## Nhiệm vụ hằng ngày bản 1

`POST /api/accounts/:id/daily/seed` hiện hỗ trợ `taskId: "ho_tong_chau"` cùng `duoc_moc`, `linh_chi`, `truc_gia` và `cau_ca`; `runs` vẫn nằm trong khoảng 1–3 và phản hồi trả `runsLeft` trong `GET /daily`.

`GET /daily` trả `DailyStatus` cùng `current`. `POST /daily/checkin` và `/daily/seed` trả HTTP 202 với `DailyOperation`; `/daily/cancel` trả operation đã `cancelled`. Hiện hỗ trợ `duoc_moc`, `linh_chi`, `truc_gia`, `cau_ca` và `ho_tong_chau`; các seed task khác vẫn được đọc và hiển thị nhưng trả `TASK_NOT_SUPPORTED` (422). Lỗi gate dùng envelope `{success:false,error,errorCode,retryable}`: map chưa sẵn sàng có `retryable:true`; các gate runtime là 409, `STAGE_TOO_LOW`/`TASK_NOT_SUPPORTED` là 422, body sai là 400 và operation không tồn tại là 404.

`DailyStatus.fishInBag` là tổng `Inventory.count('ca_song') + Inventory.count('linh_ngu')`, hoặc 
ull` khi client chưa cung cấp; operation `cau_ca` dùng progress `{itemId:"ca",collected,required:3}`.

Runner lấy prop `manh_shopt1`, `dai_phu`, `co_thu_linh_moc` từ `MapData`/`SceneWorld.map` lúc chạy. Với `duoc_moc`, nó gọi `Quest.startSeedQuest`, đặt `SceneWorld.chopping = { prop, swing: 0, t: 10 }` theo `ea()` đã đo, để client tự nhặt cành và phát `seed.collect`, rồi gọi `Quest.completeSeedQuest`. ACK được ghép theo `cmd` (`diemdanh`, `seed.start`, `seed.collect`, `seed.complete`) trước khi chờ tối đa 5 giây; `state ...:refused` chỉ để client đồng bộ và `ack.why` được giữ trong operation, không retry mù. Với `linh_chi`, runner đọc các prop `ling_chi_prop` hiện có ở `tan_vien`, đi tới gần nhất, gọi `Gateway.cmd("resource.harvest", {propId})` và dùng `Inventory.count('nam_linh_chi')`/`ack.du` để biết đã đủ 3 nấm. Prop trả `chưa mọc lại` được đánh dấu hồi theo `retryAfter`; chỉ khi không còn prop dùng được mới chờ, tối đa 15 giây mỗi lượt chờ.

Với `cau_ca`, runner gọi `Quest.startSeedQuest` ở Đại Phu, đọc `fishInBag`; nếu thiếu 3 thì đi theo map tới `duoc_vien`, dùng `ho_bich_thuy_cong` trong `interactables`, gọi `startFishing` và chờ ACK `fishing.catch` theo `cmd` trong thời gian bounded. ACK `itemId` tăng tiến độ, `missed` tiếp tục lượt kế; lỗi đứng xa mặt nước chỉ cho phép một lần đi sát lại. `DailyStatus` trả `fishInBag`; cancel/stop/reconnect/Auto xóa trạng thái câu.

Với `ho_tong_chau`, runner nhận việc ở Đại Phu, đi theo map tới `tan_vien`, đọc NPC `su_phu` từ map đã tải rồi gọi `Quest.completeEscortSeedQuest`; kết quả chờ ACK `seed.escortComplete` theo `cmd`. Việc không có tiến độ vật phẩm (`activeRequired: 0`, operation không bịa `progress`); nếu server từ chối vì chưa đứng cạnh Thầy Ông Nội, runner chỉ đi sát lại một lần rồi giữ `why` khi thất bại.

Thao tác daily giữ quyền lái với `walkTo`/đổi khu/Auto; gục, reconnect, stop và Auto bật sẽ hủy. Mặc định `abortOnHurt=false` theo yêu cầu; có thể bật ở request seed. `DailyStatus` có thêm 
amLinhChi`; operation linh chi có thể có `progress {itemId,collected,required}`. Chưa xác minh live lại trong bản triển khai: ngưỡng NPC/prop chính xác, khi mọi prop cùng hồi, giới hạn lượt server, các task còn lại và hành vi rời việc giữa chừng.

## Endpoint đã gỡ

Đã xóa `vitals/refresh`, `map/enter`, `action`, toàn bộ `training`, và `GET/PUT /config`. Không còn endpoint gửi lệnh core, combat tự viết, training hay inventory/bag. `move-to` bản 1 là đường đi vendor cùng map qua control-plane; MiniMap chỉ phát request tọa độ hợp lệ và hiển thị runtime.

DB vẫn tương thích file cũ: `botConfigs` legacy được đọc an toàn và khi có ghi sẽ chỉ giữ `engine:"vendor"` cùng `pref` nếu có. Không còn cấu hình chọn engine core.

## Bản 2a: đi tới map qua cổng

`POST /api/accounts/:id/move-to` nhận `{x,y}` cho cùng map, hoặc `{mapId}` cho map khác. Khi `mapId` khác map hiện tại, `x,y` tùy chọn và thao tác dừng tại điểm spawn sau cổng; khi cùng map, `x,y` vẫn bắt buộc. `abortOnHurt` là boolean, mặc định `true` cho đi nhiều map; `maxHurt` là số nguyên 1–50, mặc định 1.

`GET /api/accounts/:id/reachable-maps` trả `{ currentMapId, maps: [{ mapId, name?, hops, route }] }`. Đồ thị lấy từ `P.MapData` của client vendor và chỉ dùng `map.portals`. `byHand`, `cooldownSec > 0`, `cooldownGroup`, `warps` và cấu trúc không xác minh bị loại. Account không tồn tại trả 404; chưa biết map hiện tại trả 409 `NOT_IN_GAME` hoặc `VENDOR_MAP_NOT_READY`.

`WalkOperation` có thêm `route` và `leg`; `target` có thể là 
ull` với request map-only. Các lỗi `ROUTE_UNAVAILABLE` và `PATH_CROSSES_PORTAL` trả HTTP 422, dùng cùng envelope `success/error/errorCode/retryable`.

## WebSocket `/ws`

Server gửi `initial_state`, `account_updated`, `account_log` và `bot_activity`. Client merge snapshot theo timestamp/context, không gửi command ngược qua WS. Runtime không chứa token, self id hoặc dữ liệu credential.

### Shard runtime freshness

Runtime includes boolean dataStale. When true, HP/MP, map/location/khu and downed state are unknown (null); hurtCount and lastHurtAt retain the last observed values and are explicitly marked as potentially old. The dashboard displays a stale-data badge.
