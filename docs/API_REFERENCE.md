# TuTien2D API Reference — evidence-backed

> Tài liệu chuẩn hiện hành, cập nhật **2026-10-06**.
>
> Game WebSocket: `wss://game.tutien2d.online/`  
> Control plane của dự án: HTTP `/api`, dashboard WebSocket `/ws`.

Đây là điểm tham chiếu chính cho bot. Tài liệu không biến một field mà parser có
thể đọc thành một field mà game server đã được chứng minh là gửi. Mọi JSON không
lấy nguyên văn từ capture đều được gắn nhãn `ILLUSTRATIVE` hoặc `FIXTURE`.

## 1. Quy ước bằng chứng

| Nhãn | Ý nghĩa |
| --- | --- |
| `IMPLEMENTED` | Có trong code dự án và đã build/test ở lớp tương ứng; không tự chứng minh server chấp nhận. |
| `PUBLIC_CLIENT` | Có handler trong client công khai đã snapshot; không chứng minh mọi phiên server đều phát field. |
| `LIVE_OBSERVED` | Đã xuất hiện trong capture/runtime đã redact của phiên live ngày 2026-10-06. |
| `TESTED` | Đã có test hoặc smoke test cho đúng lớp được ghi. Unit test không nâng claim lên live. |
| `ILLUSTRATIVE` | Ví dụ giải thích shape, không phải dữ liệu đã quan sát. |
| `FIXTURE` | Dữ liệu giả lập dùng trong test. |
| `UNVERIFIED` | Chưa đủ bằng chứng để dùng như contract production. |

Nguồn audit:

- Code: `packages/core-client/src`, `packages/automation-engine/src`,
  `apps/server/src`, `apps/web/src`.
- Client công khai snapshot: [`vendor/tutien2d-public-client/2026-10-06/README.md`](../vendor/tutien2d-public-client/2026-10-06/README.md).
- Handler quan trọng: `gateway.js`, `entities/player.js`, `ui/hud.js`,
  `ui/khu.js` trong snapshot trên.
- Capture live đã redact: [`VITALS_SYNC_FIX.md`](VITALS_SYNC_FIX.md).

Không ghi access token, refresh token, password, cookie, proxy credential hoặc
payload chứa secret vào tài liệu, fixture hay log.

## 2. Boundary hệ thống

```text
Game server WSS JSON
  -> SocketClient -> GameStateStore (canonical snapshots)
  -> WorkerPool runtime
     -> REST /api
     -> dashboard WS /ws -> useRealtime -> AccountCard/StatsBar
```

Ba câu hỏi phải được tách riêng:

1. Bot có parser cho field không? (`IMPLEMENTED`)
2. Client công khai có handler cho field không? (`PUBLIC_CLIENT`)
3. Phiên game đang chạy có phát field không? (`LIVE_OBSERVED`)

Ở thời điểm audit, smoke sau khi yêu cầu vào lại map đã quan sát được HP/MP hiện
tại qua `you` và linh thạch qua `state.save.stones`; `maxHp/maxMp` vẫn chưa được
server gửi trong đường packet đã thấy. `formation.balance` vẫn chưa có live
capture. UI hiển thị số hiện tại khi snapshot fresh và để max là unknown, không
suy diễn thành `0`.

## 3. Game WebSocket

### 3.1. Transport và handshake

**Mức:** `IMPLEMENTED`; WSS transport `LIVE_OBSERVED`.

- Frame là JSON text.
- Client gửi `hello` sau `open`.
- Client hiện gửi `proto: 10`, `snap: 2`, feature `formation: 1`.
- Keepalive, reconnect backoff, ACK timeout và rate spacing là cấu hình client,
  không phải rate limit do game server công bố.

`hello` — client → server (`ILLUSTRATIVE`):

```json
{
  "op": "hello",
  "proto": 10,
  "snap": 2,
  "name": "character_name",
  "token": "<REDACTED>",
  "features": { "formation": 1 }
}
```

`welcome` — server → client (`ILLUSTRATIVE`, chưa phải capture):

```json
{
  "op": "welcome",
  "selfId": "character-or-player-id",
  "name": "character_name",
  "tickHz": 20,
  "serverTime": 1791270209133,
  "hasChar": true,
  "snap": 2,
  "appearance": {}
}
```

WSS mở được chỉ chứng minh transport/TLS, không chứng minh token, schema đầy đủ,
quyền lệnh, rate limit hay gameplay side effect.

### 3.2. Bảng inbound canonical

| Opcode | Field bot xử lý | Kết luận được phép | Bằng chứng |
| --- | --- | --- | --- |
| `welcome` | handshake/session fields | Kết thúc handshake khi packet hợp lệ | `IMPLEMENTED`; shape đầy đủ `UNVERIFIED` |
| `state` | realm, exp, context, bag/equipment, vitals nếu có; resource có thể nằm trong `save` | Parser root + nested-save; không phải mọi field đều live | `IMPLEMENTED`, `TESTED`; live key capture thấy `save/reason`, runtime xác nhận `save.stones` |
| `map` | mapId, khu, soKhu, x/y, dir, p, e | Context map/khu/vị trí/entity | `IMPLEMENTED`, `PUBLIC_CLIENT` |
| `you` | hp, mp, x/y khi có | Self vitals/vị trí | `PUBLIC_CLIENT`; `LIVE_OBSERVED` qua runtime source `you` |
| `hurt` | hp, mp, bp, mpLoss | Self vitals sau damage | `PUBLIC_CLIENT`; chưa `LIVE_OBSERVED` |
| `revived` | hp, mp, x/y, bp | Self vitals/vị trí sau revive | `PUBLIC_CLIENT`; chưa `LIVE_OBSERVED` |
| `down` | left, lostExp/death indicator | Tín hiệu death khi contract được xác minh | `PUBLIC_CLIENT`; chưa `LIVE_OBSERVED` |
| `status` | ht, hm, sh, sl, slm | Haste/shield/slow effects | `LIVE_OBSERVED`; **không phải HP/MP** |
| `formation` | act, stones, mp, item, itemCount | Với `balance`, client cập nhật linh thạch và có thể cập nhật MP/item | `PUBLIC_CLIENT`; parser `IMPLEMENTED`, chưa `LIVE_OBSERVED` |
| `mach`, `world_chat`, `loot` | subset field theo type | Resource/chat/loot event | `IMPLEMENTED` một phần; schema production `UNVERIFIED` |

### 3.3. `state`: parser capability không phải capture

Parser local hỗ trợ standard `hp`, `maxHp`, `mp`, `maxMp` và một số legacy alias
trong context `state`. Parser cũng đọc resource/state fields nằm trong
`state.save`, shape mà client công khai dùng để khôi phục progress. Điều đó chỉ
nói code biết đọc nếu server gửi. Block sau là `ILLUSTRATIVE`, không phải capture:

```json
{
  "op": "state",
  "realm": "luyen_khi_6",
  "mapId": "tan_vien",
  "khu": 3,
  "x": 756,
  "y": 498,
  "hp": 90,
  "maxHp": 100,
  "mp": 20,
  "maxMp": 100,
  "stones": 1146,
  "save": { "stage": 19, "flags": {} }
}
```

Capture live đã redact chỉ ghi nhận:

```json
{"op":"state","keys":["op","save","reason"]}
```

Vì vậy `state.hp/maxHp/mp/maxMp` là `IMPLEMENTED/UNVERIFIED` ở wire level;
`state.stones` và `state.save.stones` đều được parser hỗ trợ, nhưng chỉ nhánh
`state.save.stones` đã được xác nhận qua runtime smoke trong phiên này.

### 3.4. Vitals: HP và MP

Client công khai đọc các field sau (`PUBLIC_CLIENT`):

```json
{"op":"you","hp":90,"mp":20,"x":756,"y":498}
{"op":"hurt","hp":72,"mp":18,"mpLoss":2}
{"op":"revived","hp":100,"mp":50,"x":756,"y":498}
```

Ba dòng trên là `ILLUSTRATIVE` theo shape handler, không phải capture phiên này.

`maxHp` và `maxMp` chưa thấy là field wire được handler đọc trong snapshot public.
Client công khai tạo/giữ max từ cấu hình/chỉ số nhân vật rồi HUD tính phần trăm;
protocol gửi max trực tiếp hay không vẫn `UNVERIFIED`.

`status.ht`, `status.hm`, `status.sh`, `status.slm` là effect. Không map chúng
thành HP/MP dưới bất kỳ alias nào.

Canonical snapshot của dự án:

```ts
type VitalStatus = 'unknown' | 'fresh' | 'stale' | 'invalid' | 'conflict';
type VitalsSource = 'state' | 'you' | 'hurt' | 'revived' | 'status' | null;

interface VitalSnapshot {
  hp: number | null;
  maxHp: number | null;
  mp: number | null;
  maxMp: number | null;
  status: VitalStatus;
  source: VitalsSource;
  observedAt: number | null;
}
```

`status` vẫn tồn tại trong union vì tương thích type/code cũ, nhưng packet
`status` effect-only không tạo snapshot `fresh` và không phải nguồn vitals
authoritative.

Quy tắc:

- Chỉ snapshot `fresh` + finite + invariant hợp lệ mới được đưa số lên runtime và
  dùng cho automation.
- Thiếu max hoặc sai invariant không được biến thành `0`.
- `null` nghĩa là chưa biết; `hp=0` chỉ là chết khi snapshot fresh/valid.
- `fresh` hiện là freshness theo packet/client timestamp; chưa có TTL/sequence
  server và không nên mô tả là realtime liên tục.

### 3.5. Linh thạch

Client công khai xử lý (`PUBLIC_CLIENT`); smoke runtime cũng đã thấy linh thạch
đến từ state path:

```json
{"op":"formation","act":"balance","stones":1146,"mp":20}
```

Handler kiểm tra `stones` là safe integer không âm và cập nhật `Progress.stones`.
Parser dự án forward nhánh này vào `StonesSnapshot` (`IMPLEMENTED`, `TESTED`).
Runtime smoke ngày 2026-10-06 đã trả `stonesSnapshot.value=1146`,
`status=fresh`, `source=state`; artifact đã redact nằm tại
[`docs/evidence/2026-10-06-vitals-smoke.json`](evidence/2026-10-06-vitals-smoke.json).
Chưa có raw `formation.balance` capture trong phiên này.

`state.stones` vẫn được parser nhận để tương thích, nhưng tài liệu này không gọi
đó là nguồn authoritative nếu chưa có bằng chứng wire độc lập.

```ts
interface StonesSnapshot {
  value: number | null;
  status: 'unknown' | 'fresh' | 'stale' | 'invalid' | 'conflict';
  source: 'state' | 'formation' | null;
  observedAt: number | null;
}
```

### 3.6. Map, khu và vị trí

Client công khai xử lý `map.mapId`, `map.khu`, `map.soKhu`, `map.x`, `map.y`,
`map.p`, `map.e`. Đây là context map/khu/entity, không phải nguồn HP/MP.

| Raw opcode | Payload tối thiểu | Kết luận |
| --- | --- | --- |
| `enter` | `{ "mapId": "tan_vien" }` | `IMPLEMENTED`; chỉ gửi sau khi đứng đúng ô portal; phải chờ `map` xác nhận |
| `move` | seq, x, y, dir, st, fly, fs, ep | `IMPLEMENTED`; live acceptance đã thấy trong portal smoke |
| `attack` | targetId | `IMPLEMENTED`; combat result `UNVERIFIED` |
| `skill` | skillId, targetId | `IMPLEMENTED`; acceptance `UNVERIFIED` |
| `khu` | `{ "op":"khu", "act":"chon", "khu": n }` | `PUBLIC_CLIENT`; bot chưa có ACK contract |

`POST /api/accounts/:id/map/enter` trả `202` với `data.status` là
`navigation_started` hoặc `already_at_destination`. Đây là lệnh bắt đầu một
route qua các portal đã biết, không phải bypass map. Worker chỉ gửi packet
`move` theo tọa độ nhỏ, chờ nhân vật đứng đúng tile portal rồi mới gửi raw
`enter`; hoàn tất chỉ khi nhận packet `map` mới có `mapId` đích. Nếu không có
route portal đã xác minh, endpoint từ chối thay vì gửi `enter` mù.

Runtime `AccountRuntime.navigation` chứa `operationId`, `phase`, `route`,
`routeIndex`, `attempt`, `currentMapId`, `targetMapId` và `reason`. Các phase
chính là `planning`, `moving_to_portal`, `waiting_map_confirmation`,
`arrived`, `failed`, `blocked`.

`GET /api/maps` trả catalog display lấy từ snapshot public client đã vendored,
được enrich bởi packet map đã thấy trong process hiện tại. Mỗi item có `mapId`,
`name`, `scope`, `observed`, `catalogSource`, `soKhu` và `lastSeenAt`. `Catalog`
chỉ là metadata để hiển thị; `observed=true` và packet `map` mới là bằng chứng
runtime. Map cá nhân hoặc map gated có thể xuất hiện trong danh sách nhưng vẫn
có thể bị game server từ chối khi gửi `enter`.

### 3.7. Death, revive và training

Client public có handler `down`/`revived`, nhưng live chưa capture chuỗi death →
revive. Automation hiện fail-safe:

- chỉ kết luận chết với vitals fresh, valid và `hp === 0`;
- `unknown`, `stale`, `invalid`, `conflict` chuyển `RECOVERING`, không phát
  move/attack/respawn mù;
- chưa cam kết tự hồi sinh, chọn khu hay quay lại đúng bãi sau chết.

## 4. Outbound và ACK

`cmd` — client → server (`IMPLEMENTED`, `ILLUSTRATIVE`):

```json
{
  "op": "cmd",
  "cmd": "food.buy",
  "rid": 102,
  "itemId": "tu_khi_duoc",
  "n": 10
}
```

`ack` — server → client (`IMPLEMENTED`, `ILLUSTRATIVE`):

```json
{"op":"ack","rid":102,"ok":true,"toast":"<optional>","data":{}}
```

`rid` chỉ là correlation ID, không phải idempotency key. ACK timeout là **unknown
outcome**; không retry mutation có side effect khi server chưa có deduplication.
Command registry trong core client là `IMPLEMENTED`; range, enum, error code,
retryability và acceptance của game server vẫn `UNVERIFIED` nếu chưa có capture.

## 5. Control-plane API

Chi tiết route nằm trong [`CONTROL_PLANE_API.md`](CONTROL_PLANE_API.md). Tóm tắt:

| Surface | Endpoint | Trạng thái |
| --- | --- | --- |
| Health | `GET /health` | `IMPLEMENTED` |
| Runtime | `GET /api/accounts`, `GET /api/accounts/:id` | `IMPLEMENTED`, không trả secret |
| Lifecycle | `POST /api/accounts/:id/start|stop|restart` | `IMPLEMENTED` |
| Config | `GET/PUT /api/accounts/:id/config` | `IMPLEMENTED`, validation local |
| Map request | `POST /api/accounts/:id/map/enter` | `IMPLEMENTED`, 202 chỉ request sent |
| Discovery | `GET /api/maps` | catalog public client + enrich packet live; không phải allowlist server |
| Stream | `ws(s)://<host>/ws` | `IMPLEMENTED`, auth/origin/RBAC còn thiếu |

Runtime account có thể trả block sau (shape tổng thể là `ILLUSTRATIVE`; trạng thái
null/unknown và số live được phân biệt ở evidence ledger):

```json
{
  "hp": null,
  "maxHp": null,
  "mp": null,
  "maxMp": null,
  "stones": null,
  "vitals": {
    "hp": null,
    "maxHp": null,
    "mp": null,
    "maxMp": null,
    "status": "unknown",
    "source": null,
    "observedAt": null
  },
  "stonesSnapshot": {
    "value": null,
    "status": "unknown",
    "source": null,
    "observedAt": null
  }
}
```

Pipeline realtime `IMPLEMENTED/TESTED`:

1. `SocketClient` nhận packet.
2. `GameStateStore` cập nhật snapshot canonical.
3. `WorkerPool` sync `vitals`/`stonesSnapshot`.
4. Server broadcast `account_updated` trên `/ws`.
5. `useRealtime` merge và không để HTTP snapshot cũ ghi đè WS mới.
6. `AccountCard`/`StatsBar` chỉ render số khi snapshot fresh/valid.

Smoke end-to-end đã xác nhận số HP/MP/linh thạch đi tới runtime/UI; raw packet
artifact chưa được lưu đầy đủ nên không nâng claim lên wire schema production.

### 5.1. UI display contract

| Dữ liệu | Render số khi | Nếu chưa đủ |
| --- | --- | --- |
| HP/MP | vitals `fresh`, finite, có max hợp lệ | waiting/status, không fallback 0 |
| Max HP/MP | max hợp lệ cùng snapshot | unknown |
| Linh thạch | stones snapshot `fresh`, integer không âm | waiting/status, không fallback 0 |
| Thanh phần trăm | current và max hợp lệ | ẩn/unknown, không vẽ 0% giả |

`null` khác `0`. `0` chỉ là số hợp lệ khi source packet và invariant đã được
xác minh.

## 6. Live evidence ledger

| Ngày | Surface | Đã quan sát | Không được suy ra |
| --- | --- | --- | --- |
| 2026-10-06 | Game WSS đã đăng nhập | `status` với `ht/hm/sh/slm`; `state` có key `save/reason`; runtime `IN_GAME` có context map/khu | Raw packet đầy đủ và death/revive contract chưa có |
| 2026-10-06 | Runtime smoke sau `enter(tan_vien)` | `vitals.status=fresh`, `source=you`, HP `195`, MP `163`; `stonesSnapshot=fresh`, `source=state`, value `1146`; map `tan_vien`, khu `4` | `maxHp/maxMp` vẫn null; chưa có raw formation balance capture |
| 2026-10-06 | Dashboard WS smoke | Có `account_updated` qua stop → start | Không nâng unit/runtime smoke thành server schema đầy đủ |
| 2026-10-06 | Build/test | core-client, automation-engine, server, web build pass; vitals/training tests pass | Không nâng unit test thành server acceptance |

Muốn nâng claim HP/MP/linh thạch cần artifact đã redact theo chuỗi:

```text
game packet -> canonical snapshot -> runtime REST/WS -> UI value
```

## 7. Test matrix và gaps

| Test | Trạng thái |
| --- | --- |
| `you`/`hurt`/`revived` standard, thiếu field, zero, sai kiểu | `TESTED` parser |
| `status` effect không tạo HP/MP | `TESTED` |
| `formation.balance.stones` valid/invalid/non-balance | `TESTED` parser |
| `state` fields | `TESTED` capability, không server observed |
| reconnect/stale/conflict và training recovery | `TESTED` |
| REST/WS merge không để HTTP cũ ghi đè WS mới | `TESTED` code path |
| UI null không render fallback 0 | `TESTED` code path |
| live self vitals | `PARTIAL`: current HP/MP đã runtime-observed qua `you`; cần max và raw capture |
| live balance stones | `PARTIAL`: state.save path đã runtime-observed; cần raw formation balance nếu muốn xác nhận nhánh đó |
| maxHP/maxMP wire source | `UNVERIFIED` |
| khu selector, respawn, return-to-training | `UNVERIFIED` |

## 8. Tài liệu liên quan và hardening

- [`GAME_API.md`](GAME_API.md) là compatibility index, không còn định nghĩa
  vitals.
- [`CONTROL_PLANE_API.md`](CONTROL_PLANE_API.md) là chi tiết REST/control plane;
  sample response phải đọc cùng nhãn bằng chứng ở tài liệu này.
- [`VITALS_SYNC_FIX.md`](VITALS_SYNC_FIX.md) là changelog false-death.
- [`TRAINING_PROTOCOL_GAPS.md`](TRAINING_PROTOCOL_GAPS.md) là backlog evidence,
  không phải danh sách server contract đã xác minh.

Control plane vẫn cần auth/RBAC, CORS allowlist, Origin check cho WS, rate limit,
schema validation, request ID, error code ổn định, idempotency key và redaction
tập trung trước khi expose ra Internet.
