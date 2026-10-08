# Nhiệm vụ: xác nhận HP chủ động cho Auto vendor + dữ liệu bản đồ cho engine vendor

Đọc `AGENTS.md`, `docs/HANDOFF_NEXT_SESSION.md` và mục đầu `docs/SESSION_LOG.md` trước. KHÔNG chạm game thật, KHÔNG mở kết nối mạng, KHÔNG đọc `data/`, `.env*`. Không commit. Không sửa `vendor/`. Giữ phong cách code sẵn có, thay đổi nhỏ và tập trung. Sandbox của bạn không build được: tự rà kiểu TypeScript cẩn thận; người giao việc sẽ chạy `pnpm build` và toàn bộ test.

Bối cảnh: dashboard luôn chạy engine `vendor` (`apps/server/src/headless/vendor-runner.ts`, `auto-supervisor.ts`, `vendor-env.ts`; snapshot dựng ở `getVendorRuntimeInfo` trong `apps/server/src/orchestrator/worker-pool.ts`). Engine core cũ không còn được khởi động.

## Vấn đề 1 — Auto tự tắt vì "vitals_unconfirmed" khi nhân vật đứng yên

Quan sát live: bật Auto ở map không có quái trong tầm → nhân vật đứng yên → client chính thức không gửi `move` nên server không trả `you` (HP tuyệt đối chỉ đến qua `you` mỗi 10 `seq` của luồng `move`, `hurt`, `revived`) → `checkVitalsConfirmation` (`vendor-runner.ts`, `VITALS_CONFIRM_MS` = 10 s) tắt Auto, `atk`/`sk` = 0.

Yêu cầu: thêm cơ chế XÁC NHẬN HP CHỦ ĐỘNG, tương đương `refreshVitals()` của engine core (gửi tối đa 10 move `idle` tại chỗ để lấy `you`), nhưng đi qua đường gửi `move` của chính client vendor (`Gateway`/`Input` của client chính thức, để `seq` tăng đúng; tự đọc mã trong `vendor/tutien2d-public-client/2026-10-06/src/net/gateway.js` và nơi gọi để biết cách client đánh `seq` và tạo gói `move`; không tự dựng gói thô nếu có hàm của client).

Ràng buộc an toàn (BẮT BUỘC):
- Chỉ bơm khi: `autoRequested` (hoặc đang xác nhận trước khi bật), `lastVitalsAt === null`, nhân vật KHÔNG gục (`isDown`), kết nối `IN_GAME`, và client không tự gửi `move` trong khoảng gần đây (đang đứng yên); không bơm khi Auto đang tự di chuyển.
- Tối đa 10 move idle cho mỗi lần xác nhận, giãn cách hợp lý (ví dụ mỗi tick vòng lặp hoặc tối thiểu vài trăm ms, không bắn liên thanh), vị trí/hướng giữ nguyên vị trí hiện tại của người chơi, trạng thái `idle`.
- Dừng bơm ngay khi `hurtCount` tăng (có `hurt`) hoặc đã có `lastVitalsAt`. KHÔNG retry mù vô hạn: nếu bơm xong 10 gói mà vẫn không có `you` trong khoảng chờ hợp lý thì giữ hành vi cũ (`auto_stopped_vitals_unconfirmed`, tắt Auto).
- Ghi log qua `recordLog` với mã mới (ví dụ `vitals_probe_started`, `vitals_probe_done`), không log dữ liệu nhạy cảm. Thêm bộ đếm vào snapshot nếu hợp lý (không bắt buộc).
- Cửa sổ `vitalsConfirmMs` phải tính từ lúc xác nhận bắt đầu hoặc đủ dài để 10 gói idle kịp nhận `you`; không làm tắt Auto sớm hơn cần thiết nhưng cũng không kéo dài vô hạn.
- `startAuto` vẫn không đòi vitals chính thức trước khi bật (giữ test hiện có "starts Auto without an authoritative vitals packet").

Test (`apps/server/src/headless/vendor-runner.test.ts`, chạy bằng `cd apps/server && npx tsx --test src/headless/vendor-runner.test.ts`): thêm test dùng socket/Gateway giả mà KHÔNG phát sẵn `you`; xác nhận runner gửi ≤ 10 move idle, `you` chỉ được phát sau khi nhận đủ gói move có seq phù hợp thì Auto vẫn bật; test dừng bơm khi `hurt`; test không bơm khi gục hoặc khi client đang tự move; test hết 10 gói không có `you` thì Auto tắt như cũ. Test không được cho socket giả "phát sẵn" kết quả (bài học các đợt trước).

## Vấn đề 2 — Bản đồ/vị trí không hiển thị với engine vendor

Quan sát live: snapshot vendor có `mapId` (`tan_vien`) và x/y nhưng `khu = null` → `locationKnown` = false trong `getVendorRuntimeInfo` → `mapContext.fresh` = false và khu `null`; phía web `resolveMapContext` (`apps/web/src/lib/context.ts`) trả `missing` khi `ctx.khu === null` → mini-map, vị trí, "Bản đồ · thực thể" trống. Ngoài ra `monsters`/`players` luôn rỗng và `dataStatus.monsters/players` luôn false cho vendor nên không có marker.

Việc cần làm:
1. Tìm nguồn `khu` thật trong client chính thức (`src/ui/khu.js`, `src/world/map_khu.js`, `src/net/gateway.js`, gói `map`/`welcome`, `SceneWorld.map`) và sửa `getKhu()` ở `vendor-runner.ts` cho đúng. Nếu client thật sự không giữ `khu` ở mặc định (khu 1 do không chọn), CHỈ suy ra từ dữ liệu client/gói đã quan sát, ghi rõ nguồn và nhãn "chưa xác minh" trong comment/tài liệu; không đoán bừa. Nếu vẫn không biết thì giữ `null` và là "chưa biết", nhưng làm bước 3.
2. Xuất danh sách quái và người chơi từ dữ liệu client vendor (`SceneWorld` hoặc cấu trúc client dùng để vẽ/chọn mục tiêu; đọc mã để biết trường: id, tên, x, y, hp là PHẦN TRĂM với người khác, KHÔNG dùng làm vitals) vào snapshot runner rồi vào `getVendorRuntimeInfo`: điền `monsters`, `players`, `monstersContext`/`playersContext` (`mapId`, `khu`, `observedAt`, `fresh`), `dataStatus.monsters/players`. Giới hạn số lượng và cắt trường ở mức dashboard cần (khớp kiểu `AccountRuntime` ở `apps/web/src/types/index.ts`). Không lộ id người chơi khác ra log. Chỉ fresh khi có dữ liệu thật vừa quan sát.
3. Khi `mapId` và x/y đã biết nhưng `khu` chưa biết: dashboard vẫn phải hiển thị map + tọa độ nhân vật và marker (nhãn "Khu: chưa biết"), thay vì trống. Sửa `resolveMapContext`/`MiniMap`/`AccountCard` tối thiểu để làm được mà KHÔNG thay `khu` chưa biết bằng 0 hay 1, và không mở lại thao tác di chuyển/nhấp bản đồ nếu cần khu (giữ khóa nơi cần khu xác định). Cập nhật/ thêm test Vitest (`pnpm --filter @tutien2d/web test`, hiện 9 test pass; không làm vỡ).
4. Kiểm tra `GET /api/maps/:mapId/geometry` và logic tải geometry ở `apps/web/src/App.tsx` vẫn đúng với map hiện tại của vendor.
5. Tìm xem lần sửa trước (loại bỏ luồng auto cũ: `git diff HEAD` hoặc `git diff --cached`) có xóa nhầm phần nào ảnh hưởng hiển thị map không; nếu có, khôi phục. (Dự đoán: không, nguyên nhân là mục 1–2; hãy xác nhận bằng đọc mã.)

## Báo cáo cuối

Liệt kê file đã sửa, test đã thêm, những gì CHƯA xác minh (đặc biệt: nguồn `khu`, hành vi thật của `you` khi bơm idle trên game thật). Không tuyên bố đã build/test pass nếu không chạy được.
