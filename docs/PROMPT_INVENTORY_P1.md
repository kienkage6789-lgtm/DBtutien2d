# Nhiệm vụ: Túi đồ trên dashboard — Giai đoạn 1 (CHỈ ĐỌC)

Đọc `AGENTS.md`, `docs/SESSION_LOG.md` (mục đầu), `docs/CONTROL_PLANE_API.md`, rồi mã: `apps/server/src/headless/vendor-runner.ts` (snapshot, `getDailyStatus` đã đọc `Inventory.count` cho `fishInBag`), `apps/server/src/orchestrator/runner-handle.ts` (+ `shard/protocol.ts`, `shard/remote-runner-handle.ts`: danh sách trắng `RUNNER_RPC_METHODS`), `apps/server/src/orchestrator/worker-pool.ts`, `apps/server/src/api/routes.ts` (ownership middleware `loadOwnedAccount`, cách các route `daily` trả dữ liệu), web: `apps/web/src/components/AccountCard.tsx`, `lib/api.ts`, `types/index.ts`, `lib/dialogs.ts`.
Mã client chính thức (CHỈ ĐỌC, không sửa): `vendor/tutien2d-public-client/2026-10-06/src/net/gateway.js` (cách `Inventory.bag[itemId] = số lượng` được cập nhật từ gói `state`/gói có `item`+`itemCount`), `systems/items.js` / nơi định nghĩa `ITEMS`, `Inventory`, `Inventory.HOP` (bảng hộp mở được), `systems/quest.js` (`HANG_DONG_KEY = "thach_giap_tinh_hach"`, `flags.hang_dong_da_lay_ruong`).

Không chạm game thật, không mở mạng ngoài, không đọc `data/`/`.env*`, không sửa `vendor/` hay `auto-supervisor.ts`, không commit. Test dùng socket giả, `DATA_DIR` tạm.

## Mục tiêu
Chủ sở hữu (và admin) xem được TÚI ĐỒ của từng tài khoản đang chạy trên dashboard: danh sách vật phẩm (id, tên hiển thị, số lượng), đánh dấu vật phẩm nào là HỘP mở được (`Inventory.HOP[id]`), và trạng thái Hang Động (đã có Chìa Khoá chưa; rương đã lấy chưa). Giai đoạn 2 (mở hộp, nhận rương) làm sau, KHÔNG làm ở đây. Không gửi lệnh nào lên game.

## Quy tắc dữ liệu (AGENTS.md)
- Dữ liệu chưa biết là `null`/"chưa biết", không thay bằng 0. Nếu client chưa tải túi (chưa vào game/chưa nhận `state`) thì trả `known: false`, không trả danh sách rỗng như thể túi trống.
- Không in/log nội dung túi ngoài phản hồi cho chủ sở hữu; không đưa vào audit/log máy chủ ngoài số lượng tổng.
- Dữ liệu phải tuần tự hoá được thành JSON thuần (cho chế độ shard `VENDOR_SHARDS>0`).

## Việc cần làm
1. **Runner**: thêm `getInventory()` đọc đồng bộ từ `P.Inventory.bag` và `P.ITEMS`/`P.Inventory.HOP`/`P.Quest.flags`: `{ known, items: [{ id, name, count, openable }], totalKinds, totalCount, caveChest: { keyCount, claimed, active } | null, at }`. Giới hạn kích thước hợp lý (nếu quá nhiều loại, vẫn trả đủ nhưng test với vài trăm mục). `known:false` khi chưa vào game.
2. **RunnerHandle + shard**: thêm `getInventory` vào `RunnerHandle` dạng lệnh bất đồng bộ (KHÔNG đẩy túi trong snapshot 500 ms), thêm vào danh sách trắng RPC, `InProcessRunnerHandle`, `RemoteRunnerHandle`/`shard-main`, bộ hợp đồng `registerRunnerHandleContract` (bất biến mới: chưa vào game -> `known:false`; kết quả qua `JSON.parse(JSON.stringify())` không mất thông tin; trả bản sao).
3. **API**: `GET /api/accounts/:id/inventory` (route có `loadOwnedAccount`: user khác nhận 404 `ACCOUNT_NOT_FOUND`; tài khoản không chạy -> mã lỗi ổn định hiện có như `VENDOR_NOT_RUNNING`; shard stale -> lỗi `VENDOR_DATA_STALE` hoặc `known:false` nhất quán với cách `WorkerPool` đã xử lý stale). Giới hạn tần suất hợp lý. Cập nhật `docs/CONTROL_PLANE_API.md`.
4. **Web**: nút "Túi đồ" ở thẻ tài khoản mở hộp thoại (modal) dùng `lib/dialogs.ts`/phong cách hiện có: bảng vật phẩm (tên, id, số lượng) có ô lọc tìm kiếm, nhóm "Hộp mở được" lên đầu kèm nhãn, dòng trạng thái Hang Động (có chìa khoá / đã nhận rương / chưa kích hoạt), nút Làm mới, hiển thị "chưa biết" khi `known:false`, giao diện hoạt động ở 334 px (không thanh cuộn ngang). Sanitizer ở `api.ts`/`types` chịu được dữ liệu thiếu/sai kiểu. KHÔNG có nút gửi lệnh ở giai đoạn này.
5. Tài liệu + SESSION_LOG + FIX_GUIDE.

## Test và kiểm tra bắt buộc
- Mốc hiện tại: server 187/187, web 49/49 — không được tụt (đếm đúng bằng `npx tsx --test` trên mọi `*.test.ts` trong `apps/server/src`).
- Test: runner với socket giả phát gói có `item`/`itemCount` rồi đọc lại đúng; chưa vào game -> `known:false`; `Inventory.HOP` đánh dấu đúng `openable`; chìa khoá/`claimed` đúng; ownership (user B không đọc túi của user A: 404); API không rò dữ liệu; chế độ shard (kênh giả); web sanitizer + hiển thị "chưa biết".
- Phá thử sửa TRỰC TIẾP NGUỒN, test phải FAIL gọn không treo, rồi khôi phục: (i) chưa vào game trả `known:true` với danh sách rỗng, (ii) bỏ `loadOwnedAccount`, (iii) thay `null` bằng 0 cho trạng thái chưa biết, (iv) đánh dấu `openable` sai, (v) trả tham chiếu sống thay vì bản sao.
- `pnpm build`, web test, từng file test liên quan, toàn bộ test server. Báo cáo kết quả thật, kể cả lệnh không chạy được; nói rõ phần chưa xác minh (chưa chạy live).
