# Kiến trúc TuTien2D

Cập nhật: 2026-10-10. Repo chỉ có một hiện thực gateway là `VendorGateway`, adapter mỏng quanh client chính thức chạy headless trong Node. `GameGateway` là giao diện cho vòng đời, state, di chuyển, Auto, khu và `DailyClient`; chưa có `ProtocolGateway`. `vendor/` là nguồn tham chiếu chỉ đọc.

## Luồng chính

```text
Dashboard REST/WS
        │
        ▼
apps/server WorkerPool ── VendorGateway ── VendorRunner ── vendor client trong node:vm ── game server
        │                        │
        └── runtime snapshot ────┴── AutoSupervisor
```

- `WorkerPool.startAccount` luôn gọi `startVendorAccount`; mỗi account tối đa một `VendorGateway`/`VendorRunner`.
- `GameGateway` được định nghĩa tại `apps/server/src/gateway`; `VendorGateway` chỉ uỷ quyền, không giữ protocol hoặc safety logic riêng.
- `DailyQuests` tiếp tục phụ thuộc `DailyClient`; `VendorGateway.daily` cung cấp cùng interface từ runner.
- `VendorRunner` giữ auth/session, WebSocket chính thức, snapshot HP/MP/vị trí, counters, hurt/death và vòng đời Auto.
- `AutoSupervisor` là lớp an toàn của Auto chính thức: neo, recovering/traveling, giới hạn death/timeout và dừng khi dữ liệu không đủ.
- `vendor-env.ts` cung cấp DOM/canvas/RAF/clock/socket adapter cần thiết; không hiển thị game.
- `engine-selection.ts` chỉ còn kiểu `vendor` và assertion tương thích.

## Gói còn lại

| Phần | Vai trò |
|---|---|
| `apps/server/src/headless` | Vendor environment, runner, supervisor và test vendor |
| `apps/server/src/orchestrator/worker-pool.ts` | Lifecycle account vendor, runtime snapshot, catalog map |
| `packages/core-client/src/auth` | Supabase auth, `AuthError`, `AuthSession`, `TokenManager`; được VendorRunner và spike dùng |
| `packages/core-client/src/vitals-policy.ts` | Ngưỡng hiển thị/freshness dùng bởi web |
| `packages/core-client/src/state/*.generated.ts` | Bảng quái/kỹ năng, derived vitals, collision grid/spawn sinh từ vendor |
| `apps/server/src/config/walk-grid.ts` | Facade read-only cho geometry MiniMap/API |
| `apps/web` | Dashboard account, HP/MP, vị trí, MiniMap hiển thị, Auto chính thức, log và hurt/death |

`packages/core-client` không còn `TuTienClient`, socket/state parser, predicted movement, operation ledger, packet tap hay anti-detection. `packages/automation-engine` đã bị xóa vì không còn import giữ lại.

## Dữ liệu runtime

HP/MP chỉ hiển thị khi snapshot vendor fresh; dữ liệu chưa biết là `null`. `maxHp/maxMp` trên vendor snapshot là dữ liệu client chính thức; các bảng `derived-vitals` vẫn được giữ cho kiểm thử và tham chiếu, không biến thành vitals wire. `hurtCount`, `lastHurtAt` và `downed` đi riêng để dashboard phát hiện trạng thái nguy hiểm.

Monster/player và map/khu chỉ là marker/context hiển thị. MiniMap không phát lệnh di chuyển, không chọn target và không gửi `enter`/combat command.

## Control-plane

Giữ nguyên bind loopback, `API_TOKEN`, Origin allowlist, WS subprotocol `bearer`, CRUD account, start/stop/restart, start/stop Auto, start-all/stop-all, logs và map catalog/geometry. Các route điều khiển core (vitals refresh, map entry/navigation, action, training, config bot) đã bị gỡ.

Database vẫn đọc được `botConfigs` cũ; `apps/server/src/db/bot-config.ts` chuẩn hóa mọi bản ghi thành `{ engine: "vendor", pref? }` và bỏ qua field legacy khi ghi.
