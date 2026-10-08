# Nhiệm vụ: xóa hẳn mã engine core (bot tự viết), chỉ giữ engine vendor

Đọc `AGENTS.md`, `docs/HANDOFF_NEXT_SESSION.md`, mục đầu `docs/SESSION_LOG.md` trước. KHÔNG chạm game thật, KHÔNG mở mạng, KHÔNG đọc `data/`, `.env*`. Không commit. Không sửa `vendor/`. Sandbox của bạn không build được: tự rà kiểu TypeScript và import cẩn thận; người giao việc sẽ chạy `pnpm build` và toàn bộ test. Cây git có thay đổi đã `git add` (nền); `git diff` (không `--cached`) chỉ hiện việc của bạn.

## Bối cảnh

Dashboard giờ luôn chạy engine `vendor` (client chính thức không hiển thị: `apps/server/src/headless/vendor-runner.ts`, `auto-supervisor.ts`, `vendor-env.ts`, `engine-selection.ts`). `startAccount` luôn chọn vendor; đường core là `startCoreAccountLegacy` (private, không ai gọi). Mục tiêu: xóa toàn bộ mã core còn lại để repo gọn, không đổi hành vi của đường vendor.

## Phải GIỮ NGUYÊN (đừng xóa nhầm)

- Toàn bộ `apps/server/src/headless/`.
- Xác thực Supabase và token manager trong `packages/core-client/src/auth` (vendor-runner và `worker-pool.startVendorAccount` dùng; script spike dùng `core-client/dist`).
- `packages/core-client/src/vitals-policy.ts` và export con `./vitals-policy` (web import).
- Dữ liệu sinh ra bởi `scripts/gen-*.mjs` (`state/*.generated.ts`: lưới đi bộ, điểm sinh quái, quái, kỹ năng, derived vitals) và `apps/server/src/config/walk-grid.ts` NẾU còn được import bởi mã còn lại (kiểm tra: auto-supervisor, vendor-runner, API geometry). Giữ các `scripts/gen-*.mjs` và test `walk-grids`.
- `GET /api/maps`, `GET /api/maps/:id/geometry` (web mini-map dùng), CRUD tài khoản, `start`/`stop`/`restart`, `auto/start`, `auto/stop`, `orchestrator/start-all|stop-all`, logs, WebSocket hub, bảo mật control-plane (bind loopback, `API_TOKEN`, Origin, subprotocol `bearer`).
- Hiển thị của dashboard: thẻ tài khoản, HP/MP, vị trí, MiniMap (chỉ hiển thị), khối Auto chính thức, nhật ký, hurt/chết.

## Cần XÓA (quy tắc: xóa mọi thứ không còn được mã giữ lại import; lấy đồ thị import làm chuẩn, không đoán)

1. `apps/server/src/orchestrator/worker-pool.ts`: `activeBots`, `ActiveBot`, `startCoreAccountLegacy`, `TuTienClient`, `BotController`, `PredictedMover`, `walk-path`, `portal-navigation`, `approach-runner`, move-to, điều hướng/yêu cầu đổi map, vitals-refresh (engine core), training runtime, world/map packet guard của core, toàn bộ `getRuntimeInfo` nhánh core. Giữ `activeVendors`, `startVendorAccount`, `stopAccount`, `restartAccount`, `startAll/stopAll`, `startVendorAuto/stopVendorAuto`, `getRuntimeInfo` nhánh vendor, `verifyLogin`. Rút gọn `RuntimeEngine`/`assertSingleEngine`/`engine-selection` cho khớp (chỉ còn vendor; nếu giữ file thì cập nhật test của nó).
2. File server chỉ phục vụ core và test của chúng: `orchestrator/approach-runner.*`, `walk-path.*`, `portal-navigation.*`, `vitals-refresh.*`, `worker-pool-*.test.*` (world-context, movement, vitals-gate, realm...), `debug/approach-probe.*`, `debug/stationary-probe.ts`, `api/move-to-error.contract.test.ts`, `api/vitals-refresh.contract.test.ts` và các file tương tự. Với mỗi file hãy xác nhận bằng grep import rằng không còn mã giữ lại dùng nó; nếu test chứa phần vẫn có ý nghĩa với vendor thì giữ phần đó.
3. `apps/server/src/api/routes.ts`: bỏ route move-to, cancel move-to, navigation/yêu cầu đổi map, `action`, vitals refresh, training, inventory/bag nếu chỉ dùng core (kiểm tra vendor có cung cấp túi đồ không: snapshot vendor trả `bagCount: 0`/`bag: {}`, nên nếu route túi chỉ có nghĩa với core thì bỏ cùng nút "Túi"/`InventoryModal` ở web). `PUT /config`: rút allowlist chỉ còn các trường còn ý nghĩa với vendor (hiện chỉ `engine` = `vendor` và `pref` nếu có; nếu không còn trường nào, giữ endpoint tối giản hoặc bỏ cả `ConfigModal`; chọn phương án gọn và ghi rõ).
4. `packages/automation-engine`: xóa package nếu sau bước trên không còn code giữ lại import nó. `BotConfig`/`DEFAULT_BOT_CONFIG` được `apps/server/src/db/database.ts` dùng: chuyển sang kiểu cấu hình tối giản nằm trong `apps/server` (ví dụ `src/db/bot-config.ts`), giữ tương thích đọc file DB hiện có (các trường cũ trong `tutien_db.json` phải đọc được mà không lỗi; trường lạ bị bỏ qua khi ghi). Gỡ khỏi `pnpm-workspace`/`package.json` gốc (script `build`), `apps/server/package.json`, `tsconfig` references, `pnpm-lock.yaml` (ghi chú: người giao việc sẽ chạy `pnpm install` để cập nhật lockfile; bạn chỉ cần sửa các file manifest). Các test `.mjs` của package này (`approach`, `skill-rotation`, `target-selection`, `state-machine`) xóa cùng package.
5. `packages/core-client`: xóa `TuTienClient` (`client.ts`), `movement/` (PredictedMover), `anti-detection/`, `connection/`, `state/` phần không còn được import (GIỮ các file `*.generated.ts` còn dùng và mọi thứ chúng cần), `operation-ledger.ts`, `debug/` packet tap nếu chỉ phục vụ core. Cập nhật `src/index.ts` chỉ export những gì còn dùng (`AuthSession`, `SupabaseAuth`, `AuthError`, token manager, kiểu cần thiết, dữ liệu sinh). Xóa test của phần bị xóa (`predicted-mover`, `operation-ledger`, `packet-tap`, ...), giữ `walk-grids`, `derived-vitals`, `vitals` nếu mã tương ứng còn.
6. Web (`apps/web/src`): bỏ `MapNavigationPanel`, `InventoryModal` (nếu bỏ route), `ConfigModal` (nếu bỏ), nút "Làm mới HP", các hàm `api.ts` tương ứng (`requestVitalsRefresh`, `requestMap`, `moveTo`, `cancelMoveTo`, `fetchBotConfig`/`updateBotConfig` nếu không còn dùng...), kiểu `training`/`navigation`/`moveTo`/`bag` trong `types/index.ts` và payload server tương ứng nếu không còn nơi nào dùng. MiniMap giữ phần HIỂN THỊ; bỏ click di chuyển (`onMoveTo`, `onCancelMoveTo`) và dòng chú thích liên quan. Cập nhật Vitest (`pnpm --filter @tutien2d/web test`, hiện 10 test) cho khớp; không xóa test còn ý nghĩa.
7. `scripts/`: xóa script chỉ phục vụ core (`measure-moveto.cjs`, ...). Giữ `soak-vendor.cjs`, các `spike-vendor-*.cjs`, `gen-*.mjs`, `lib/`. Script giữ lại phải còn chạy được với export mới của `core-client/dist` (kiểm tra import).
8. Tài liệu: cập nhật `docs/ARCHITECTURE.md`, `docs/CONTROL_PLANE_API.md`, `docs/UI_FEATURE_INVENTORY.md` (đánh dấu tính năng đã bị gỡ), `docs/HANDOFF_NEXT_SESSION.md` mục 1 và 4 (hết "hai engine"). Thêm mục ĐẦU `docs/SESSION_LOG.md` và checklist cuối `docs/FIX_GUIDE.md` theo quy ước AGENTS.md.

## Ràng buộc

- Không đổi hành vi đường vendor: `vendor-runner.test.ts` (7 test) và `engine-selection.test.ts` (nếu còn) phải còn pass; tự đọc lại sau khi xóa để chắc không còn import hỏng.
- Không để import mồ côi: sau khi xóa, grep toàn repo (trừ `node_modules`, `dist`, `vendor/`, `docs/evidence`) cho từng tên đã xóa (`TuTienClient`, `BotController`, `PredictedMover`, `@tutien2d/automation-engine`, `activeBots`, `startCoreAccountLegacy`, ...) phải trả về rỗng, trừ chú thích tài liệu lịch sử.
- File DB `apps/server/data/tutien_db.json` đang có `engine: "core"`/`autoFarm`... cũ: code đọc DB không được lỗi với các trường cũ.
- Thay đổi theo từng bước nhỏ có thể review; không refactor ngoài phạm vi (không đổi tên, không tái cấu trúc phần vendor).

## Báo cáo cuối

Bảng: file/thư mục đã xóa, file đã sửa, route đã bỏ, phần quyết định (vì sao giữ/xóa mục mơ hồ), những gì chưa kiểm chứng. Nêu rõ không build/test được trong sandbox; liệt kê lệnh người giao việc cần chạy: `pnpm install`, `pnpm build`, `pnpm --filter @tutien2d/web test`, `cd apps/server && npx tsx --test src/headless/vendor-runner.test.ts`, các test còn lại ở `packages/core-client/test`.
