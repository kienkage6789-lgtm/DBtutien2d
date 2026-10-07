# Portal navigation contract

## Mục tiêu

Game không cho phép bot bypass bằng cách gửi `enter(mapId)` từ bất kỳ vị trí
nào. Map chỉ đổi khi nhân vật đi tới đúng ô portal của map hiện tại. Vì vậy
navigation được thiết kế như một state machine có xác nhận authoritative:

```text
planning
  -> moving_to_portal
  -> waiting_map_confirmation
  -> moving_to_portal (nếu còn edge)
  -> arrived
```

Lỗi hoặc thiếu route chuyển sang `failed`/`blocked`; không tự coi packet gửi
thành công là đã đổi map.

## Contract wire đã đối chiếu

Public client dùng `TILE = 32` và kiểm tra portal bằng:

```ts
Math.floor(player.x / 32) === portal.tx
&& Math.floor(player.y / 32) === portal.ty
```

Packet di chuyển có các field:

```json
{
  "op": "move",
  "seq": 1,
  "x": 240,
  "y": 944,
  "dir": 3,
  "st": "walk",
  "fly": 0,
  "fs": 0,
  "ep": 1
}
```

`seq` bắt đầu từ `1`; `ep` lấy từ `welcome`/`map`. Movement là stream liên tục,
không đi qua action jitter 300–700ms: worker phát tọa độ nhỏ khoảng 100ms/lần,
theo tốc độ walk của public client và re-plan từ vị trí server echo sau mỗi tick.

Chỉ sau khi tile hiện tại khớp portal, worker mới gửi:

```json
{ "op": "enter", "mapId": "thanh_truc_lam" }
```

Sau đó phải nhận packet `map` mới hơn thời điểm gửi, với `mapId` đúng map đích.
Nếu timeout, worker retry có giới hạn; không phát `enter` từ xa và không báo
`arrived` dựa trên `sendRaw() === true`.

## Route và collision

- `apps/server/src/config/portal-catalog.ts` là catalog edge đã xác minh từ
  public client snapshot.
- `apps/server/src/config/walk-grid.ts` chứa collision grid tĩnh đã trích từ
  `mapdata.js` và rule `TileMap.load()`.
- `apps/server/src/orchestrator/walk-path.ts` dùng A* 8 hướng, cấm corner-cutting
  và kiểm tra rectangle nhân vật 16×12 theo `lineClear` mỗi 6px.
- `apps/server/src/orchestrator/portal-navigation.ts` chứa reducer thuần cho
  route planning, retry và map confirmation.
- `apps/server/src/orchestrator/worker-pool.ts` là lớp thực thi packet và
  authoritative snapshot.

Khu chưa có command wire được xác minh. API hiện hiển thị `khu` và giữ
`farmKhu` làm cấu hình mục tiêu, nhưng không giả vờ chọn khu khi protocol không
có selector.

## Runtime/API

`POST /api/accounts/:id/map/enter` nhận `{ "mapId": "..." }` và trả `202`:

- `navigation_started`: đã lập route, có `operationId` và danh sách edge;
- `already_at_destination`: snapshot hiện tại đã ở map đích.

Theo dõi `GET /api/accounts/:id` hoặc frame `account_updated` trên `/ws`; trường
`navigation` cho biết `phase`, edge hiện tại, số lần thử và `reason` khi lỗi.

## Verification

Unit/integration checks hiện có:

- `node apps/server/dist/orchestrator/portal-navigation.test.js`
- `node apps/server/src/orchestrator/walk-path.test.mjs`
- `node packages/core-client/test/vitals.test.mjs`
- `node packages/automation-engine/src/training/state-machine.test.mjs`
- `pnpm build`

Live smoke 2026-10-06 đã xác nhận hai chiều trên account test đã đăng nhập:

1. `tan_vien/K4 (252,883)` đi qua portal `(7,29)` tới
   `thanh_truc_lam/K1 (240,63)`; phase cuối `arrived`.
2. `thanh_truc_lam/K1 (240,63)` đi qua portal `(7,0)` quay lại
   `tan_vien/K1 (240,927)`; phase cuối `arrived`.

Evidence đã redact: [`docs/evidence/2026-10-06-portal-navigation-smoke.json`](evidence/2026-10-06-portal-navigation-smoke.json).

