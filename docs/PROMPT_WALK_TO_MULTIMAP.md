# Nhiệm vụ: `walkTo` bản 2a — chọn map đích, nhân vật tự đi qua các cổng

Hợp đồng chính: `docs/SPEC_WALK_TO.md` — đọc kỹ các mục 1–9 (bản 1 đã triển khai ở commit `502b4ac`) và PHẦN "BẢN 2" (mục 10–17, đã được chủ dự án duyệt). Sau đó `AGENTS.md`, `docs/HANDOFF_NEXT_SESSION.md`, mục đầu `docs/SESSION_LOG.md`. Nếu prompt mâu thuẫn với spec thì theo spec và báo rõ.

KHÔNG chạm game thật, KHÔNG mở mạng, KHÔNG đọc `data/`, `.env*`. Không commit. Không sửa `vendor/`. Sandbox của bạn không build được: tự rà kiểu TypeScript và import; người giao việc sẽ chạy `pnpm build` và test. Thay đổi tập trung; KHÔNG sửa `auto-supervisor.ts` (chuyển supervisor sang module là bước 2b, sau). Được đọc nó để tái sử dụng ý tưởng (`mapRoute`, `portalsOf`, chờ cổng 8 s).

## Mục tiêu

Người dùng chọn một map bất kỳ trong danh sách trên dashboard; server tự lập tuyến giữa các map, đi tới ô cổng, đứng lên cổng, chờ đổi map, lặp tới map đích, rồi dừng (điểm xuất hiện sau cổng). Người dùng không điều khiển cổng.

## Việc cần làm

### A. Đồ thị cổng và lập tuyến (thuần, test được)
- File mới (ví dụ `apps/server/src/headless/map-route.ts`): hàm thuần `planMapRoute(portalsOf, fromMapId, toMapId)` → danh sách chặng `{ fromMapId, toMapId, gate: {tx,ty} }` hoặc `null`; BFS đường ngắn nhất; lấy cổng gần vị trí hiện tại cho chặng đầu, cổng bất kỳ khả dụng cho chặng sau. Và `reachableMaps(portalsOf, allMapIds, fromMapId)` → `[{ mapId, hops, route }]`.
- Nguồn cổng: `MapData` của chính client (như `portalsOf` trong `vendor-runner.ts`; mở rộng đọc đúng các cờ). Đọc `vendor/tutien2d-public-client/2026-10-06/src/world/tilemap.js` và vài `map_*.js` để biết trường chính xác. LOẠI cổng: `byHand` (không tự đổi map), cổng có `cooldownSec > 0`/`cooldownGroup`, và mọi thứ không phải `portals` (ví dụ `warps`). Nếu có loại khác không thể đoán, ghi "chưa xác minh" và loại trừ thận trọng.
- Cần tìm cách liệt kê toàn bộ `mapId` có trong `MapData` của client (đọc `src/world/mapdata.js` hoặc tương đương); không dùng `config/portal-catalog.ts` (không phải nguồn sự thật).

### B. Mở rộng `walk-navigator.ts` (mục 11–12 spec)
- `WalkRequest.targetMapId?`, `abortOnHurt?` (mặc định `true`), `maxHurt?` (số nguyên ≥ 1, mặc định 1); `WalkOperation.route?`, `leg?`. Nếu `targetMapId` bỏ trống hoặc bằng map hiện tại thì hành vi y hệt bản 1 (giữ test cũ: `walk-navigator.test.ts` 5, `vendor-runner.test.ts` 10).
- Lập tuyến một lần khi nhận lệnh; không có tuyến → lỗi mới `ROUTE_UNAVAILABLE` (422); `targetMapId` không tồn tại → `TARGET_INVALID` (400).
- Mỗi chặng: `walking_to_gate` (đích chặng là tâm ô cổng; đây là chỗ DUY NHẤT được phép đứng trên ô cổng) → `on_gate` → `waiting_map` (đợi `transitioning` bật rồi tắt và `mapId` quan sát được bằng map kế tiếp, tối đa 8 s) → chặng kế. Đổi map theo kế hoạch KHÔNG làm hủy thao tác (khác bản 1). Map sau chặng không khớp dự kiến → `failed` `unexpected_map`; hết 8 s không đổi map → `failed` `portal_no_transition`; dừng nhân vật, KHÔNG tự thử cổng khác.
- `abortOnHurt`/`maxHurt`: số `hurt` kể từ lúc bắt đầu ≥ `maxHurt` thì hủy toàn tuyến (`cancelled`, reason `hurt_abort`) và `player.stop()`. Nếu `abortOnHurt=false` thì không hủy vì hurt (vẫn hiển thị).
- Giữ nguyên: một thao tác tại một thời điểm, từ chối khi Auto/supervisor hoạt động (`AUTO_ACTIVE`), hủy khi gục/reconnect/stop runner/Auto bật, kẹt/hết giờ theo từng chặng (thời hạn chặng theo quãng đường như bản 1; có trần tổng cho cả tuyến, ví dụ 10 phút).
- Chặn đường vô tình qua ô cổng ở mọi chặng đi trong map (kể cả bản 1 / bấm mini-map): xem phần C để biết quyết định cách làm.

### C. Kiểm chứng offline việc đi qua ô cổng (BẮT BUỘC, quyết định cách chặn)
Viết test với mã client thật trong fixture: đặt nhân vật gần một ô cổng của `tan_vien` (cổng thật trong `MapData`, ví dụ ô dẫn sang `thanh_truc_lam`), cho `setPath` đi XUYÊN qua ô cổng, và quan sát xem client có gửi yêu cầu đổi map ra socket giả không (đọc `vendor/.../src/net/gateway.js` và `scenes/world.js` để biết tên gói, ví dụ yêu cầu `portal`/`enter`; `FakeSocket` ghi lại gói gửi ra). Ghi kết quả vào báo cáo và vào `docs/SPEC_WALK_TO.md` mục 13.1 (đánh dấu "đã xác minh offline"). Dựa vào kết quả: nếu đi qua ô cổng gây đổi map thì cài chặn: khi tính đường cho chặng đi trong map, nếu `route` (các điểm/đoạn) đi qua ô cổng không phải đích chặng thì thử đường vòng bằng vài điểm trung gian né ô cổng; không vòng được → từ chối `PATH_CROSSES_PORTAL` (422). Nếu đi qua không đổi map thì không cần chặn; nói rõ trong báo cáo. Test phải đủ để người đọc thấy bằng chứng, không dùng socket giả phát sẵn kết quả mong đợi.

### D. API (`apps/server/src/api/routes.ts`, kèm ánh xạ lỗi cạnh `move-to-errors.ts`)
- `POST /api/accounts/:id/move-to` nhận thêm `mapId?` (string, hợp lệ `[a-zA-Z0-9_-]{1,64}`), `abortOnHurt?` (boolean), `maxHurt?` (số nguyên 1–50). Kiểm tra kiểu nghiêm ngặt, thiếu `x,y` khi chỉ có `mapId` được phép (đi tới điểm xuất hiện sau cổng) — định nghĩa rõ trong spec và docs (`x,y` tùy chọn khi có `mapId` khác map hiện tại; vẫn bắt buộc khi cùng map). Mã lỗi mới `ROUTE_UNAVAILABLE` (422), `PATH_CROSSES_PORTAL` (422) nếu cài.
- `GET /api/accounts/:id/reachable-maps` → `{ currentMapId, maps: [{ mapId, name?, hops, route: string[] }] }` tính từ map hiện tại của runner (404 tài khoản không tồn tại; 409 `NOT_IN_GAME`/`VENDOR_MAP_NOT_READY` khi chưa biết map). Tên map lấy từ `PUBLIC_CLIENT_MAP_CATALOG` nếu có.
- Cập nhật `docs/CONTROL_PLANE_API.md`; contract test cho lỗi/ánh xạ mới.

### E. Dashboard
- Điều khiển "Đi tới map…" ở thẻ tài khoản: danh sách map tới được (từ API; map không có đường hiển thị mờ kèm "không có đường"), hiển thị tuyến dự kiến (A → B → C), tùy chọn "Dừng khi bị đánh" (mặc định bật) và ngưỡng `maxHurt`, cảnh báo "đi qua map có quái; hủy giữa đường nghĩa là nhân vật đứng lại tại chỗ", nút Bắt đầu/Hủy, trạng thái từng chặng (`leg`) và kết quả. Khóa khi Auto bật, đang có thao tác khác, hoặc context map chưa sẵn sàng (nói rõ lý do). Mini-map vẫn bấm-để-đi trong map hiện tại như bản 1.
- `apps/web/src/lib/api.ts`: hàm gọi mới, kiểu `reachable-maps`, mã lỗi mới; `useRealtime.ts` sanitize `route`/`leg` mới (undefined khi sai kiểu, không `null` lẫn lộn — bài học từ bản 1). Vitest cho logic khóa/hiển thị và sanitize (`pnpm --filter @tutien2d/web test`, hiện 16 test; không làm vỡ).

## Test server

`cd apps/server && npx tsx --test <file>`, mỗi file một lệnh. Giữ nguyên test hiện có. Thêm: test thuần cho `planMapRoute`/`reachableMaps` (đồ thị nhỏ tự dựng + cổng thật của vài map từ `MapData` nếu nạp được trong fixture); test navigator nhiều chặng với giao diện fake (đi hết tuyến, đổi map theo kế hoạch, `unexpected_map`, `portal_no_transition`, `hurt_abort` với ngưỡng, hủy giữa chặng); test tích hợp qua `VendorRunner` với `FakeSocket` nếu fixture cho phép (fake server PHẢN HỒI gói yêu cầu đổi map bằng gói `map` mới sau một độ trễ; KHÔNG phát sẵn). Lưu ý bài học: fixture phải đặt nhân vật ở điểm ĐI ĐƯỢC (điểm xuất hiện mặc định `(240,192)` của `tan_vien` nằm trong ô bị chặn; dùng `FakeSocket.spawn`, ví dụ `(272,860)`); chuyển cảnh headless chậm nên chờ có điều kiện bằng thăm dò thay vì chờ cố định, cửa sổ chờ vài giây.

## Báo cáo cuối

File sửa; nguồn đồ thị cổng và các cờ đã loại; kết quả kiểm chứng offline mục C (đi qua ô cổng có đổi map không, bằng chứng); quyết định chặn đường; những gì CHƯA xác minh (thời gian đổi map thật, `hurt` giữa đường, cổng cooldown/`byHand` thực tế trong các map hay dùng, độ chính xác tuyến qua nhiều map trên game thật); tài liệu đã cập nhật (`docs/SESSION_LOG.md` mục ĐẦU, checklist cuối `docs/FIX_GUIDE.md`, spec). Không tuyên bố build/test pass nếu không chạy được; liệt kê lệnh người giao việc cần chạy.
