# TuTien2D Control-plane API

> Tài liệu này mô tả backend dashboard trong `apps/server`, không phải game server.
> Cập nhật: 2026-10-08.

## 1. Base URL, transport và security hiện tại

- HTTP base mặc định: `http://localhost:4000`.
- REST prefix: `/api`.
- Dashboard WebSocket: `ws://<host>:4000/ws` hoặc `wss://<host>/ws` khi reverse proxy TLS.
- Health: `GET /health`.
- Server mặc định bind `127.0.0.1`; bind ngoài loopback bắt buộc `API_TOKEN` có ít
  nhất 32 ký tự.
- CORS dùng allowlist `ALLOWED_ORIGINS`; không dùng `*`.
- `/api` đi qua `requireAuth`; khi `API_TOKEN` được đặt, HTTP dùng
  `Authorization: Bearer <API_TOKEN>`. Dashboard WebSocket dùng subprotocol
  `bearer` và kiểm tra origin allowlist.

API vẫn là control-plane nội bộ; không expose trực tiếp ra Internet nếu chưa có
reverse proxy và biện pháp authorization phù hợp.

## 2. Response envelope

Vendor Auto routes use the stable machine-readable form `{success:false,error,errorCode,retryable}`; authenticated requests also retain the existing request-id behavior from the control-plane middleware.

Thành công thường có:

```json
{ "success": true, "data": {} }
```

Một số action dùng `result` hoặc `message` thay cho `data`:

```json
{ "success": true, "result": {} }
```

Thất bại hiện có:

```json
{ "success": false, "error": "human-readable message" }
```

> Error schema chưa ổn định và chưa có `errorCode`, `requestId` hay schema version.

## 3. REST endpoints

### 3.1. System và discovery

| Method | Path | Request | Current response |
| --- | --- | --- | --- |
| `GET` | `/health` | none | `{status: "ok", time: ISO}` |
| `GET` | `/api/system/status` | none | uptime, memory, account counts, timestamp |
| `GET` | `/api/maps` | none | `{success, source: "public_client_catalog", status, data[]}` |
| `GET` | `/api/logs?limit=100` | query `limit` | log entries mới nhất; hiện chưa giới hạn/validate chặt `limit` |

`/api/maps` chỉ trả map đã được packet game quan sát trong process hiện tại; không
phải catalog đầy đủ toàn game.

### 3.2. Account lifecycle

| Method | Path | Body | Status/behavior |
| --- | --- | --- | --- |
| `GET` | `/api/accounts` | none | Danh sách runtime account, không trả secret |
| `GET` | `/api/accounts/:id` | none | Runtime + bot config; `404` nếu không tồn tại |
| `POST` | `/api/accounts` | `accountName`, `password` hoặc legacy `token`, optional `proxyUrl` | Verify password trước khi lưu; `400` auth/input, `500` unexpected |
| `PUT` | `/api/accounts/:id/password` | `password` | Verify password mới rồi lưu encrypted password/refresh token; `404/400` |
| `DELETE` | `/api/accounts/:id` | none | Stop bot, xóa account/config/log; `404/500` |
| `POST` | `/api/accounts/:id/start` | none | Khởi động bot; lỗi hiện map nhiều trường hợp thành `500` |
| `POST` | `/api/accounts/:id/stop` | none | Dừng bot; trả runtime |
| `POST` | `/api/accounts/:id/restart` | none | Stop, chờ 1 giây, start lại |

Ví dụ tạo account, không dùng JWT thật trong tài liệu:

```json
{
  "accountName": "dao_hieu",
  "password": "<PASSWORD_FROM_SECRET_INPUT>"
}
```

`password`, access token, refresh token và `proxyUrl` không được đưa vào response
public. Server lưu credential dưới dạng encrypted secret; encryption key phải được
bảo vệ riêng.

`GET /api/accounts` trả danh sách runtime account; mỗi account có `training`.
`GET /api/accounts/:id` trả runtime và `config` trong `data`. Trường
`AccountRuntime.training` có dạng:

```json
{
  "enabled": true,
  "phase": "TRAINING",
  "sessionId": "account-id:1",
  "reason": null,
  "pending": { "type": "ATTACK", "operationId": "account-id:1:4" },
  "target": {
    "mapId": "tan_vien", "khu": 1, "x": 756, "y": 498,
    "radius": 80, "attackIntervalMs": 1000, "monsterType": "Sơn Tặc"
  },
  "protocol": { "khuSelectionSupported": false, "respawnSupported": false }
}
```

`sessionId` nullable; `reason` nullable; `pending` nullable and otherwise includes
operation `type` cùng `operationId`; target `x`/`y` nullable khi chưa cấu hình.
`target.monsterType` nullable; `null` biểu thị không lọc loại quái.
Khi bot chưa chạy, session là `null`; nếu training đang bật, runtime báo phase
`SYNCING` và reason `BOT_STOPPED_NO_AUTHORITATIVE_SNAPSHOT`.

Runtime account cũng có trường `vitals` canonical. Block dưới đây là
`ILLUSTRATIVE`; các con số không phải response live:

```json
{
  "hp": 100,
  "maxHp": 100,
  "mp": 50,
  "maxMp": 50,
  "vitals": {
    "hp": 100,
    "maxHp": 100,
    "mp": 50,
    "maxMp": 50,
    "status": "fresh",
    "source": "state",
    "observedAt": 1791288000000
  }
}
```

Linh thạch dùng contract tương tự để tránh coi giá trị mặc định `0` là dữ liệu
thật. Block dưới đây cũng là `ILLUSTRATIVE`:

```json
{
  "stones": 1234,
  "stonesSnapshot": {
    "value": 1234,
    "status": "fresh",
    "source": "formation",
    "observedAt": 1791288000000
  }
}
```

`stones` là `null` khi chưa nhận snapshot hợp lệ. Client công khai xác nhận
`formation.balance.stones`; `state.stones` hiện chỉ là parser capability tương
thích, chưa có live evidence độc lập để gọi là nguồn authoritative. Dashboard
chỉ render số HP/MP/linh thạch khi snapshot fresh/valid; các thay đổi mới được
phát qua `account_updated` trên `/ws` và được UI merge theo realtime. HTTP
snapshot không được phép ghi đè một frame WebSocket mới hơn.

`vitals.status` là một trong `unknown`, `fresh`, `stale`, `invalid`, `conflict`.
`vitalsAgeMs` là tuổi backend tính tại thời điểm broadcast, chỉ là số hữu hạn không âm
khi `vitals.status === "fresh"` và `vitals.observedAt` có giá trị; ngược lại là `null`.
`vitals.source` trong type tương thích có thể là `state`, `you`, `hurt`, `revived`,
`status` hoặc `null`; tuy nhiên `status` effect-only không tạo snapshot fresh và
không phải nguồn vitals authoritative. Không dùng các alias hiệu ứng
`ht/hm/sh/slm` làm HP/MP.
Các field top-level HP/MP là `null` khi snapshot chưa fresh/valid; consumer không
được coi `null` là HP bằng không. Xem thêm
[VITALS_SYNC_FIX.md](VITALS_SYNC_FIX.md).

`stonesSnapshot.source` có thể là `state`, `formation` hoặc `null`.

#### `POST /api/accounts/:id/vitals/refresh`

Endpoint này chạy qua `requireAuth` cùng toàn bộ `/api`. Body tùy chọn là
`{ "allowNearMonsters": false }`; mặc định là `false`. Worker chỉ gửi tối đa
10 move `idle` tại tọa độ/dir hiện tại, cách nhau khoảng 100ms, dừng ngay khi
nhận `you` mới và không retry khi hết thời gian chờ.

Response thành công (`200`): `{ success: true, data: { status, movesSent, ackLatencyMs? } }`,
trong đó `status` là `refreshed` hoặc `no_ack`. Điều kiện không an toàn trả `409`
với envelope `{ success:false, error, errorCode, requestId, retryable }`.

| Reason | errorCode | retryable |
| --- | --- | --- |
| `refresh_rate_limited` | `VITALS_REFRESH_RATE_LIMITED` | `true` |
| `refresh_in_progress` | `VITALS_REFRESH_IN_PROGRESS` | `true` |
| disconnected | `VITALS_REFRESH_NOT_CONNECTED` | `true` |
| downed, move/navigation/combat/quái gần/thiếu context hoặc vị trí | `VITALS_REFRESH_NOT_ALLOWED` | `false` |

Các ngưỡng `5s`, `30s`, `30s` trong policy chung là đề xuất, **chưa xác minh
live**. HP/MP vẫn chỉ được cập nhật qua snapshot canonical, không phải move.

### 3.3. Map và manual action

#### `GET /api/maps`

Trả danh sách map dùng cho UI chọn map. `source` là
`"public_client_catalog"`; dữ liệu kết hợp metadata public client với packet
map đã quan sát trong process hiện tại.

```json
{
  "success": true,
  "source": "public_client_catalog",
  "status": "available",
  "data": [
    {
      "mapId": "tan_vien",
      "name": "Chân Núi Tản Viên",
      "scope": "shared",
      "soKhu": 20,
      "lastSeenAt": 1791298582034,
      "observed": true,
      "catalogSource": "observed_packet"
    }
  ]
}
```

`observed=false` nghĩa là chỉ có metadata từ public client, chưa có packet live
cho map đó. Endpoint không khẳng định map đó được mở khóa hoặc server chấp nhận
điều hướng trực tiếp.

#### `POST /api/accounts/:id/map/enter`

Body:

```json
{ "mapId": "tan_vien" }
```

Contract hiện tại:

- `mapId` phải khớp `[a-zA-Z0-9_-]{1,64}`;
- gửi `khu` bị từ chối vì game protocol chưa có selector khu;
- yêu cầu hợp lệ trả `202` và `data.status: "navigation_started"`, kèm
  `operationId` và `route` các portal sẽ đi qua; nếu đã ở map đích thì trả
  `data.status: "already_at_destination"`;
- worker không gửi packet `enter` ngay: nó phải đi tới tile portal bằng luồng
  `move` nhỏ, đúng tốc độ/collision của public client, sau đó mới gửi `enter`;
- `202` chỉ nghĩa là route đã bắt đầu, không phải đã vào map;
- hoàn tất chỉ khi runtime nhận packet `map` mới đúng `mapId` đích; UI nên theo
  dõi `AccountRuntime.navigation` qua `/ws`;
- cooldown backend hiện là 5 giây/account.

Smoke live 2026-10-06: catalog trả 16 map. Tuyến hai chiều đã được xác nhận:
`tan_vien/K4 (252,883)` → portal `(7,29)` →
`thanh_truc_lam/K1 (240,63)`, rồi quay lại qua portal `(7,0)` tới
`tan_vien/K1 (240,927)`. Direct `enter` từ vị trí không đứng trên portal vẫn
không được coi là thành công.

Ví dụ response bắt đầu điều hướng:

```json
{
  "success": true,
  "data": {
    "status": "navigation_started",
    "operationId": "nav_<opaque-id>",
    "mapId": "thanh_truc_lam",
    "route": [
      { "portalId": "tan-vien-to-truc-7-29", "fromMapId": "tan_vien",
        "toMapId": "thanh_truc_lam", "tx": 7, "ty": 29 }
    ],
    "khuSupported": false
  }
}
```

#### `POST /api/accounts/:id/action`

```json
{ "action": "farm" }
```

Chỉ `farm` đang được phép trong route. `sell` và `checkin` cố ý trả `400` là
disabled; action khác cũng trả `400`.

### 3.4. Bot configuration

| Method | Path | Body/response |
| --- | --- | --- |
| `GET` | `/api/accounts/:id/config` | Trả `BotConfig` đã merge default |
| `PUT` | `/api/accounts/:id/config` | Nhận partial config; trả `{success, data: config đã merge, runtime}` |

Các field training trong `BotConfig`:

| Field | Kiểu | Validation/ý nghĩa |
| --- | --- | --- |
| `autoTraining` | boolean | Bật/tắt training; mặc định `false` |
| `trainingRadius` | number | Bán kính bãi, `1..100000`; mặc định `80` |
| `trainingAttackIntervalMs` | number | Chu kỳ đánh, `100..3600000` ms; mặc định `1000` |
| `trainingMonsterType` | string | Trim khoảng trắng, tối đa 128 ký tự; chuỗi rỗng nghĩa là đánh mọi loại quái |
| `farmMapId` | string | Map đích; khi bật phải khớp `[a-zA-Z0-9_-]{1,64}` |
| `farmKhu` | integer | Khu đích, số nguyên `>=1`; không có nghĩa API có thể chọn khu |
| `farmX`, `farmY` | finite number | Tọa độ bãi; khi bật cần cấu hình cả hai |

PUT từ chối account không tồn tại (`404`), body không phải object, field không hỗ
trợ, kiểu/range sai hoặc bật `autoTraining` mà không có `farmMapId`, `farmX`,
`farmY` hợp lệ (`400`). Các field còn lại trong config được cập nhật dạng partial.
`trainingMonsterType` phải là string và sau trim không dài quá 128 ký tự; giá trị
rỗng được chấp nhận để bỏ lọc. Khi có giá trị, runtime trả lại loại đã cấu hình
trong `target.monsterType`.
Validation này là kiểm tra input ở route, không phải xác nhận server game chấp nhận
map/tọa độ/khu. Training không cam kết tự chọn khu hoặc tự hồi sinh.

Evidence: [`routes.ts`](../apps/server/src/api/routes.ts),
[`worker-pool.ts`](../apps/server/src/orchestrator/worker-pool.ts),
[`types.ts`](../packages/automation-engine/src/types.ts).

### 3.5. Logs

| Method | Path | Behavior |
| --- | --- | --- |
| `GET` | `/api/accounts/:id/logs?limit=100` | Log của một account |
| `GET` | `/api/logs?limit=100` | Log toàn hệ thống |

`limit` cần được giới hạn ở lớp API trước khi expose public. Log message phải được
redact token/password trước khi ghi.

### 3.6. Orchestrator

| Method | Path | Behavior |
| --- | --- | --- |
| `POST` | `/api/orchestrator/start-all` | Start tuần tự, stagger login theo config |
| `POST` | `/api/orchestrator/stop-all` | Stop tất cả active bots |

## 4. Dashboard WebSocket `/ws`

Server gửi JSON message một chiều; client hiện không có command inbound.

### `initial_state`

```json
{
  "type": "initial_state",
  "data": { "accounts": [], "logs": [] }
}
```

### Các message runtime

| `type` | `data` |
| --- | --- |
| `account_updated` | Account runtime snapshot |
| `account_log` | `{id, accountId, timestamp, level, module, message}` |
| `bot_activity` | `{accountId, activity}` |
| `system_alert` | reserved; chưa có producer rõ ràng trong code hiện tại |

WS này hiện không xác thực client, không kiểm tra `Origin`, và broadcast snapshot
cho mọi client kết nối. Không gửi credential qua kênh này.

## 5. Current status/error mapping

| Tình huống | HTTP hiện tại | Ý nghĩa vận hành |
| --- | --- | --- |
| Input thiếu/sai | `400` | Sửa request; không retry mù |
| Account không tồn tại | `404` ở một số route | Kiểm tra resource |
| Bot chưa chạy/chưa kết nối khi enter map | `409` | Start/đợi connection |
| Cooldown enter map | `429` | Chờ theo `Retry-After` được khuyến nghị; hiện server chưa trả header này |
| Lỗi bất ngờ | thường `500` | Cần correlation ID và log server-side |

## 6. Required hardening before public exposure

1. Thêm auth middleware và RBAC theo user/tenant; không mặc định user đầu tiên trong DB.
2. Chuyển CORS từ wildcard sang allowlist; kiểm tra Origin cho `/ws`.
3. Bind localhost/private interface hoặc đặt reverse proxy có TLS/firewall.
4. Validate body/query/params bằng schema và giới hạn kích thước JSON.
5. Chuẩn hóa `{errorCode, message, requestId, retryable}` và status mapping.
6. Thêm idempotency key cho start/stop/restart/action và mọi mutation.
7. Thêm rate limit, timeout, cancellation và metrics cho các route/action.
8. Redact credential trong log; revoke mọi token từng commit vào repo.
### 3.5. Vendor engine va Auto headless

Moi route `/api` deu nam sau `requireAuth`; khong co route public rieng cho vendor. `BotConfig.engine` nhan `core` (mac dinh, giu hanh vi hien tai) hoac `vendor`. Khong the doi engine khi account dang co phien; account chi co mot engine mot luc.

| Method | Path | Body | Thanh cong | Loi chinh |
| --- | --- | --- | --- | --- |
| `PUT` | `/api/accounts/:id/config` | `{ "engine": "core" | "vendor" }` hoac partial config | `200`, tra `data` config merge va `runtime` | `400 INVALID_ENGINE`, `409 ENGINE_ALREADY_RUNNING` (`retryable:false`) |
| `POST` | `/api/accounts/:id/auto/start` | `{}` de lay neo vi tri hien tai, hoac `{ "anchor": { "mapId", "khu?", "x", "y" } }` | `200`, runtime co `engine:"vendor"` va `vendor` snapshot | `404 ACCOUNT_NOT_FOUND`; `409` neu chua chay vendor, chua vao game, vitals chua fresh, hoac dang gục |
| `POST` | `/api/accounts/:id/auto/stop` | none | `200`, runtime vendor voi Auto idle/tat | `404 ACCOUNT_NOT_FOUND`; `409` neu khong co vendor session |

`anchor.mapId` phai khop `[a-zA-Z0-9_-]{1,64}`, `x/y` la so huu han, `khu` neu co la so nguyen >= 1; runner con kiem tra map co trong `MapData`. Neu vitals client chua ro hoac nhan vat dang gục, start bi chan, khong thay gia tri bang 0.

Error envelope cho Auto:

```json
{ "success": false, "error": "VENDOR_VITALS_UNKNOWN", "errorCode": "VENDOR_VITALS_UNKNOWN", "retryable": true }
```

`retryable:true` chi dung cho trang thai co the tu het khi runner nhan them state/vitals (`VENDOR_NOT_IN_GAME`, `VENDOR_VITALS_UNKNOWN`, `VENDOR_NOT_RUNNING`); `VENDOR_CHARACTER_DOWN`, `ENGINE_*`, map neo sai va halted safety la `false`. Runtime vendor gom lifecycle/connection, supervisor phase + anchor, stats deaths/revives/trips/resumed, `hurtCount`/`lastHurtAt`, packet op counters, move/attack/skill/cmd, packet/update/console errors, fps/uptime/RSS va vitals `source:"client"`. Token/self id/ten nhan vat/id nguoi choi khac khong nam trong envelope hay log.
