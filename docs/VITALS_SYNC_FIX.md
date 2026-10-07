# Vitals synchronization fix

Ngày triển khai: **2026-10-06**  
Phạm vi: game WebSocket → `core-client` → automation engine → control-plane API.

## Vấn đề

Trong phiên live trước, runtime báo `hp=0/maxHp=1` trong khi người vận hành kiểm
tra nhân vật trên game và thấy đầy máu. Kết quả cũ chỉ chứng minh bot nhận một
snapshot `0/1`; chưa đủ chứng minh nhân vật thật sự chết.

## Nguyên nhân đã xác nhận trong code

- `GameStateStore` và `WorkerPool` tự đọc alias HP theo hai thứ tự khác nhau.
- Server giữ một cache vitals riêng, tách khỏi state canonical của core-client.
- Vitals chưa biết được biểu diễn thành `0` ở runtime API, có thể bị hiểu thành
  HP thật bằng không.
- Training suy ra chết bằng `hp <= 0`, dù packet có thể stale, invalid hoặc
  conflict.
- `map` không phải nguồn HP; packet `down`/`revived` chưa có contract đã xác minh.

## Thay đổi đã triển khai

### Canonical vitals ở core-client

`normalizeVitals()` là nguồn chuẩn duy nhất cho packet `state` và các packet self
`you`/`hurt`/`revived`. Field chuẩn (`hp`, `maxHp`, `mp`, `maxMp`) được ưu tiên;
alias legacy (`ht`, `hm`, `sh`, `slm`) chỉ được phép trong `state`. Packet `status`
chỉ mang hiệu ứng chiến đấu nên không được dùng làm HP/MP. Khi hai field vitals
cùng tồn tại nhưng khác giá trị, snapshot được đánh dấu `conflict`; dữ liệu số
sai hoặc vi phạm invariant được đánh dấu `invalid`.

Snapshot có các trạng thái `unknown`, `fresh`, `stale`, `invalid`, `conflict`.
Packet `map` không cập nhật vitals. API core vẫn giữ các field số cũ để tương
thích, nhưng quyết định automation chỉ dùng `VitalSnapshot`.

### Server dùng state canonical

`WorkerPool` không còn tự ánh xạ `ht/hm` hoặc `hp/maxHp`. Runtime lấy
`client.state.vitals` và trả thêm:

Ví dụ dưới đây là `ILLUSTRATIVE`, không phải số liệu live:

```json
{
  "hp": 100,
  "maxHp": 100,
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

Khi vitals chưa fresh/valid, các field top-level `hp`, `maxHp`, `mp`, `maxMp`
trả `null`, không trả `0`. Consumer phải đọc `vitals.status` trước khi điều
khiển nhân vật.

### Automation fail-safe

Training chỉ được di chuyển, đánh hoặc xử lý chết khi vitals là `fresh` và thỏa
`0 <= hp <= maxHp`, `maxHp > 0`. Các trạng thái `unknown`, `stale`, `invalid`,
`conflict` chuyển sang `RECOVERING`, xóa action đang chờ và không phát side effect.
`hp=0` chỉ được xem là chết sau khi snapshot fresh/valid; protocol hồi sinh vẫn
đang khóa vì chưa có contract server đã xác minh.

### Dashboard

Dashboard hiển thị rõ trạng thái vitals (`đang đồng bộ`, `dữ liệu cũ`, `dữ liệu
không hợp lệ`, `dữ liệu xung đột`) thay vì hiển thị `0/0` như một HP thật.
Đường `account_updated` trên dashboard WebSocket và logic merge đã được triển
khai. Smoke live ngày 2026-10-06 đã xác nhận UI nhận HP `195`, MP `163` và linh
thạch `1.146`; `maxHp/maxMp` chưa có trong packet nên UI hiển thị `—` ở phần max.
Linh thạch có `stonesSnapshot`; client công khai xác nhận nguồn
`formation.balance.stones`, còn parser hiện cũng đọc `state.save.stones` — nhánh
đã được runtime smoke xác nhận. Khi chưa thấy snapshot hợp lệ, UI hiển thị
`Đang chờ dữ liệu realtime` thay vì fallback về `0`.

### Bằng chứng live đã thu

Trong phiên kiểm thử live ngày **2026-10-06**, packet đã redact ghi nhận:

```json
{"op":"status","fields":{"ht":0,"hm":1,"sh":0,"slm":1}}
{"op":"state","keys":["op","save","reason"]}
```

Client chính thức của game dùng `ht`/`hm` cho haste và `sh`/`slm` cho shield/slow;
đây không phải HP/MP nhân vật. Việc parser cũ biến packet effect thành
`hp=0/maxHp=1` phù hợp với lỗi alias đã được sửa trong parser, nhưng capture đơn
lẻ không đủ chứng minh quan hệ nhân quả hoàn chỉnh giữa packet đó và mọi runtime
cũ. Sau bản sửa, cùng loại packet chỉ giữ vitals ở `unknown`/`null` nếu chưa có
packet HP chuẩn; bot không tự kết luận nhân vật đã chết. Client công khai xác nhận
HP/MP đến từ `you`, `hurt`, `revived`, còn linh thạch được cập nhật trong
`formation` với `act: "balance"`. Parser cũng đọc `state.save.stones`, và smoke
runtime đã xác nhận nhánh state này trả số dư. Sau khi yêu cầu vào lại map,
runtime nhận `vitals.status=fresh`, `source=you`, HP `195`, MP `163` và
`stonesSnapshot.status=fresh`, `source=state`, value `1146`; max HP/MP vẫn chưa
có trong packet nên UI để `—` ở phần max.

Nguồn đối chiếu là asset client công khai [gateway.js](https://tutien2d.online/src/net/gateway.js?v=d1223c624841),
đã kiểm tra ngày **2026-10-06**. Handler chính thức gán `you.hp/mp`,
`hurt.hp/mp`, `revived.hp/mp`; handler `formation` chỉ gán `Progress.stones` khi
`act === "balance"` và `stones` là số nguyên an toàn không âm.

## Kiểm thử

- `packages/core-client/test/vitals.test.mjs`: standard/legacy fields, conflict,
  malformed/invalid/missing, map-only, reconnect và `formation.balance.stones`.
- `packages/automation-engine/src/training/state-machine.test.mjs`: full HP,
  unknown/stale/invalid/conflict, HP=0 hợp lệ, recovery và stale dead flag.
- `pnpm build`: core-client, automation-engine, server và web đều pass.

## Giới hạn còn lại

Chưa có packet capture đã redact chứng minh shape thực tế của `down`/`revived`,
chưa mở khóa auto-respawn, chọn khu hoặc chuyển map qua portal. Baseline live đã
được xác nhận không cung cấp HP trong `status`; current HP/MP đã đồng bộ qua
`you`, nhưng cần thêm wire evidence cho `maxHp/maxMp` nếu muốn vẽ phần trăm đầy
đủ.

