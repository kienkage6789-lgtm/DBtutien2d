# Nhiệm vụ: engine vendor báo sai map ngay sau khi vào game (cảnh mặc định `tan_vien`)

Đọc `AGENTS.md` và mục đầu `docs/SESSION_LOG.md` trước. KHÔNG chạm game thật, KHÔNG mở mạng, KHÔNG đọc `data/`, `.env*`. Không commit. Không sửa `vendor/`. Sandbox của bạn không build được: tự rà kiểu TypeScript; người giao việc sẽ chạy `pnpm build` và test. Thay đổi nhỏ, tập trung vào `apps/server/src/headless/vendor-runner.ts` và test của nó.

## Quan sát live

Vài giây đầu sau khi vào game, snapshot vendor báo `mapId = tan_vien` (cùng tọa độ cũ) rồi mới đổi sang map thật (`thanh_truc_lam`). Nhân vật thật sự đang ở map thật. Hậu quả: neo của Auto (`startAuto(anchor)`, anchor lấy từ snapshot qua dashboard hoặc API) có thể bị ghi sai map.

## Nguyên nhân (suy luận từ đọc mã, chưa đo — hãy tự xác minh bằng đọc mã client)

`getMapId()` đọc `this.P.SceneWorld.map.data.id ?? this.P.Gateway.mapId`. Client chính thức khởi tạo cảnh mặc định `tan_vien` (xem `vendor/tutien2d-public-client/2026-10-06/src/core/config.js`, `HOME_MAP`) và chỉ chuyển cảnh sau khi nhận gói `map` và tải xong map, nên `SceneWorld.map.data.id` còn là `tan_vien` trong lúc chuyển. Đọc `src/world/` (scene world, `transitioning`) và `src/net/gateway.js` để xác nhận thứ tự: khi nào `Gateway.mapId` được gán, khi nào `SceneWorld.map` đổi, `transitioning` bật/tắt lúc nào. Nếu thực tế khác dự đoán, sửa theo thực tế và ghi rõ.

## Yêu cầu

1. `getMapId()` ưu tiên map của gói `map` đã quan sát (theo cách `observedKhu` đã làm trong cùng file: lưu `observedMapId` ở nơi xử lý `op === 'map'`, xóa khi reset/đóng kết nối/reconnect như `observedKhu`). `SceneWorld.map.data.id` / `Gateway.mapId` chỉ là phương án dự phòng khi chưa có gói `map`; nếu dùng dự phòng và `SceneWorld.transitioning` đang bật thì trả `null` (chưa biết) thay vì map mặc định.
2. Tọa độ `x/y` trong snapshot phải nhất quán với map báo ra: không báo `mapId` mới kèm tọa độ cũ hay ngược lại; khi đang chuyển cảnh (`transitioning`) hoặc chưa nhận gói `map`, `mapId`/`khu`/`x`/`y` là `null` (chưa biết, không thay bằng 0).
3. `startAuto(anchor?)`: từ chối với lỗi mới (ví dụ `VENDOR_MAP_NOT_READY`) khi chưa nhận gói `map` hoặc `SceneWorld.transitioning` còn bật. Khi `anchor` có `mapId` mà khác map đã quan sát thì từ chối (ví dụ `AUTO_ANCHOR_MAP_MISMATCH`); không tự sửa neo. Thêm ánh xạ lỗi mới trong `apps/server/src/api/vendor-auto-errors.ts` (HTTP 409, `retryable: true` cho `VENDOR_MAP_NOT_READY`) theo mẫu các lỗi hiện có, và cập nhật `apps/server/src/api/vendor-auto.contract.test.ts` nếu hợp lý. Dashboard (`apps/web/src/lib/api.ts`/`App.tsx`) đã hiện lỗi qua `alert`; chỉ sửa web nếu cần để thông báo rõ ràng.
4. Tắt/bật Auto khi đang chuyển map qua cổng (do supervisor đưa về neo): đảm bảo `getMapId()` mới không làm hỏng logic supervisor (`apps/server/src/headless/auto-supervisor.ts` dùng `getMapId`/`isTransitioning`): đọc kỹ cách supervisor nhận biết đã tới map đích và đã về neo; nếu `null` khi chuyển cảnh thì supervisor phải coi là "chưa biết/đang chuyển" chứ không phải sai map. Nếu cần chỉnh supervisor, giữ tối thiểu và có test.

## Test (`cd apps/server && npx tsx --test src/headless/vendor-runner.test.ts`, và `auto-supervisor.test.ts` nếu đụng supervisor)

- Fake server phát `map` với `mapId` khác `tan_vien` (ví dụ `thanh_truc_lam`): snapshot không bao giờ báo `tan_vien` sau khi gói `map` đã nhận; trước khi nhận gói `map` thì `mapId` là `null`.
- `startAuto` bị từ chối khi chưa có gói `map` (lỗi mới) và khi `anchor.mapId` khác map đã quan sát; thành công khi khớp.
- Fake server KHÔNG được phát sẵn kết quả mong đợi (bài học các đợt trước); các test cũ (7 test của `vendor-runner.test.ts`) vẫn phải pass, chỉnh fixture nếu cần chứ không nới kiểm tra.

## Báo cáo cuối

File đã sửa, test thêm, thứ tự sự kiện thực tế của client mà bạn đọc được (mapId/transitioning), phần CHƯA xác minh trên game thật. Không tuyên bố build/test pass nếu không chạy được.
