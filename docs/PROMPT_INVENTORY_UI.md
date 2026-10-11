# Nhiệm vụ: Túi đồ dạng LƯỚI có phân loại như game (vẫn CHỈ ĐỌC)

Đọc `AGENTS.md`, `docs/SESSION_LOG.md` (mục đầu), `docs/PROMPT_INVENTORY_P1.md` (giai đoạn 1 đã làm), rồi mã đang có: `apps/server/src/headless/vendor-runner.ts` (`getInventory`), `orchestrator/runner-handle.ts` + `shard/*` (RPC), `api/routes.ts` (`GET /accounts/:id/inventory`), web: `components/InventoryModal.tsx`, `lib/api.ts`, `types/index.ts`, `lib/inventory.test.ts`, `lib/dialogs.ts`.
Mã client chính thức (CHỈ ĐỌC, không sửa; không sao chép mã vẽ/ảnh của game vào repo): `vendor/tutien2d-public-client/2026-10-06/src/ui/hud.js` (`renderBag`: bộ lọc `bagFilter` ∈ `vat-pham | trang-bi | dao-thuat`, phân nhóm bằng `Market.group(def)` hoặc: có `def.slot` -> `trang-bi`; `type` là `bi_tich`/`phu_chu` -> `dao-thuat`; còn lại `vat-pham`; bộ đếm `Inventory.usedSlots()` / `Inventory.capacity()` "ô"; `extraSlots()`, `MAX_EXTRA_SLOTS`, `nextSlotPrice()`; panel ô trang bị dùng `Inventory.slots` và `Inventory.equipped(slotId)`; hàm tô phẩm cấp `_(grade)` trong hud.js), `src/systems/items.js` (`ITEMS[id] = { id, name, type, grade, desc, icon, slot? }`, `Inventory.list()`), `styles/*.css` (tên lớp màu theo phẩm cấp để chọn màu tương ứng).

Không chạm game thật, không mở mạng ngoài, không đọc `data/`/`.env*`, không sửa `vendor/` hay `auto-supervisor.ts`, không commit. Không tải ảnh/biểu tượng từ mạng (CSP của dashboard chặn ảnh ngoài và không được nới). Test dùng socket giả.

## Mục tiêu
Modal "Túi đồ" hiện là danh sách. Đổi thành giao diện giống túi đồ của game: LƯỚI Ô, ba tab phân loại, bộ đếm ô, panel trang bị đang mặc, chú giải vật phẩm. Vẫn CHỈ ĐỌC (không nút hành động). Biểu tượng pixel thật của game KHÔNG có sẵn cho dashboard: dùng ô tự vẽ bằng CSS/SVG (viền và nền theo phẩm cấp, ký hiệu theo loại vật phẩm, số lượng ở góc), không sao chép ảnh của game.

## Quy tắc dữ liệu (AGENTS.md)
- Chưa biết là `null`/"chưa biết", không thay bằng 0 hoặc mặc định. `known:false` khi chưa vào game như hiện tại.
- Phân nhóm phải khớp logic của client (ưu tiên gọi `P.Market.group(def)` nếu có và hợp lệ, ngược lại dùng đúng quy tắc dự phòng ở trên). Nhóm không xác định được -> `null` và hiện ở tab "Khác", không đoán.
- Mọi trường tuần tự hoá được thành JSON thuần (chế độ shard).

## Việc cần làm
1. **Runner/`getInventory`** (mở rộng, giữ tương thích ngược các trường cũ): mỗi mục thêm `type`, `grade`, `slot` (hoặc null), `icon` (id chuỗi, chỉ để hiển thị ký hiệu), `desc` (cắt tối đa ~300 ký tự, làm sạch ký tự điều khiển), `group` (`vat-pham|trang-bi|dao-thuat|null`). Thêm `bag: { usedSlots, capacity, extraSlots, maxExtraSlots, nextSlotPrice }` (mỗi số hoặc null nếu client không cung cấp) và `equipment: [{ slotId, slotName, item: { id, name, grade } | null }]` từ `Inventory.slots`/`Inventory.equipped`. Cập nhật kiểu ở `RunnerHandle`, shard, `types/index.ts`, sanitizer web; không đẩy dữ liệu này trong snapshot 500 ms.
2. **Web `InventoryModal`**:
   - Ba tab: "Vật phẩm", "Trang bị", "Đạo thuật" (+ "Khác" nếu có mục `group:null`), hiển thị số lượng mục từng tab; nhớ tab đang chọn (an toàn nếu `localStorage` lỗi).
   - Lưới ô vuông (CSS grid, ô cỡ cố định, số cột co theo bề rộng, tối thiểu 5 cột ở 334 px; không thanh cuộn ngang); ô trống hiện đủ tới sức chứa của tab/tổng nếu biết (quy ước rõ: túi chung `usedSlots/capacity`, không bịa số ô cho từng tab).
   - Mỗi ô: viền/nền màu theo phẩm cấp (bảng ánh xạ phẩm cấp -> màu đặt trong một file riêng, có màu mặc định cho phẩm cấp lạ; đảm bảo tương phản đạt cả theme sáng/tối của dashboard), ký hiệu theo `type` (emoji hoặc SVG nội tuyến, có nhãn truy cập), số lượng ở góc dưới phải (ẩn nếu 1? giữ đúng game: hiện khi > 1), dấu hộp mở được cho `openable`.
   - Bấm/chạm một ô: panel chi tiết (tên, phẩm cấp, loại, số lượng, mô tả, id); bàn phím điều hướng được; có chỗ trống dự kiến cho nút hành động ở giai đoạn sau (KHÔNG làm nút).
   - Thanh/bộ đếm "đã dùng / sức chứa ô" (hoặc "chưa biết"), thông tin mở rộng túi chỉ để xem (giá mở thêm nếu biết).
   - Panel "Đang mặc": các ô trang bị theo `equipment` (ô trống ghi tên ô).
   - Giữ ô tìm kiếm theo tên, nút Làm mới, trạng thái Hang Động, "Chưa biết" khi `known:false`; hoạt động ở 334 px.
   - Không tải tài nguyên ngoài; không `dangerouslySetInnerHTML` với `desc`/`name` (chống chèn mã từ dữ liệu game).
3. Tài liệu: `docs/CONTROL_PLANE_API.md` (trường mới), `docs/UI_FEATURE_INVENTORY.md`, SESSION_LOG, FIX_GUIDE (ghi rõ: biểu tượng pixel thật của game chưa có, là hạng mục riêng).

## Test và kiểm tra bắt buộc
- Mốc hiện tại: server 191/191, web 51/51 — không được tụt (đếm đúng bằng `npx tsx --test` trên mọi `*.test.ts` trong `apps/server/src`).
- Test: phân nhóm đúng (có `slot`, `bi_tich`, `phu_chu`, mặc định; dùng `Market.group` khi có); mục thiếu `type/grade` không làm vỡ; `desc` bị cắt và làm sạch; `bag`/`equipment` chưa biết -> null; sanitizer web loại dữ liệu sai kiểu; ánh xạ phẩm cấp có màu mặc định; không có `dangerouslySetInnerHTML` (test tĩnh/hoặc RTL render chuỗi chứa thẻ `<script>` hiển thị như chữ); tab đếm đúng; chế độ shard (kênh giả).
- Phá thử sửa TRỰC TIẾP NGUỒN, test phải FAIL gọn không treo, rồi khôi phục: (i) gom nhóm sai (`bi_tich` vào `vat-pham`), (ii) đổi `null` thành 0 cho `capacity`, (iii) bỏ cắt `desc`, (iv) tab đếm sai, (v) phẩm cấp lạ làm ném lỗi.
- Chạy server tạm (DB tạm, cổng khác 4000) và xem modal trên trình duyệt thật ở 1280, 768 và 334 px bằng dữ liệu giả (nếu không có trình duyệt thì nói rõ là CHƯA xác minh trực quan, đừng tuyên bố đã xem).
- `pnpm build`, web test, từng file test liên quan, toàn bộ test server. Báo cáo kết quả thật, kể cả lệnh không chạy được.
