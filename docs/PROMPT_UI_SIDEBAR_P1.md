# Nhiệm vụ: Giao diện dashboard dạng thanh tài khoản bên trái + bảng chi tiết (GIAI ĐOẠN 1, chỉ web)

Đọc `AGENTS.md`, `docs/PLAN_UI_SIDEBAR.md` (bản kế hoạch; làm ĐÚNG giai đoạn 1), `docs/SESSION_LOG.md` (mục đầu), rồi mã web: `apps/web/src/App.tsx`, `components/AccountCard.tsx`, `StatsBar.tsx`, `Navbar.tsx`, `LogTerminal.tsx`, `MiniMap.tsx`, `MapTravelControl.tsx`, `KhuControl.tsx`, `DailyControl.tsx`, `InventoryModal.tsx`, `lib/context.ts`, `types/index.ts`, `hooks/useRealtime.ts`, `index.css`.

Không chạm game thật, không mở mạng ngoài, không đọc `data/`/`.env*`, không sửa `vendor/`, không sửa `apps/server`/`packages/*` (giai đoạn 1 CHỈ web), không commit. Không thêm thư viện mới ngoài những gì `apps/web/package.json` đã có. Không tải tài nguyên ngoài (CSP chặn).

## Quyết định của chủ dự án (mặc định đã chốt)
- Bảng chi tiết có 7 tab: Tổng quan, Bản đồ, Hằng ngày, Túi đồ, Auto, Nhật ký, Tài khoản.
- Thanh trái có ô tìm theo tên và bộ lọc trạng thái (Tất cả / Đang chạy / Dừng / Lỗi), cuộn riêng; thiết kế cho tới ~50 tài khoản.
- `StatsBar` tổng giữ nguyên ở vùng chính khi CHƯA chọn tài khoản nào (cùng nhật ký chung).
- Túi đồ chuyển thành tab (không còn modal độc lập), vẫn dùng chung logic của `InventoryModal` (tách phần nội dung dùng lại được, không nhân đôi mã).

## Mục tiêu
Thay lưới `AccountCard` bằng bố cục hai cột:
- **Thanh trái** (~300 px, cuộn riêng, sticky dưới Navbar): mỗi tài khoản là một hàng gọn gồm: tên nhân vật (fallback `accountName`), cảnh giới, chấm trạng thái (chạy / dừng / lỗi / gục / dữ liệu cũ / đang nối lại), và 5 thanh nhỏ **HP, Linh lực (MP), Thần thức, Giáp, Đạo Hạnh** có số. HP và MP dùng dữ liệu hiện có (`vitals`, `derivedMax`, quy tắc fresh/stale của `lib/context.ts`, tuổi dữ liệu). **Cảnh giới, Thần thức, Giáp, Đạo Hạnh CHƯA có trong snapshot (sẽ làm ở giai đoạn 2)**: hiện "—" / thanh rỗng, KHÔNG thay bằng 0 hay giá trị giả. Thiết kế kiểu dữ liệu để giai đoạn 2 chỉ cần thêm trường `character?: {realmName: string|null, sp: number|null, spMax: number|null, bp: number|null, bpMax: number|null, exp: number|null, expMax: number|null}` vào `AccountRuntime` (khai báo trường tuỳ chọn trong `types/index.ts` + sanitizer chịu thiếu/sai kiểu; hôm nay luôn undefined). Có test cho hàm định dạng thanh với `null`.
- **Vùng chính**: chưa chọn tài khoản → `StatsBar` + `LogTerminal` chung (như hiện nay). Chọn tài khoản → bảng chi tiết: tiêu đề (tên, cảnh giới "—", nút Chạy/Dừng, Auto bật/tắt nhanh), các cảnh báo (dữ liệu cũ, đang nối lại, lỗi đăng nhập kèm nút đổi mật khẩu) và 7 tab. Bấm hàng đang chọn hoặc nút đóng → bỏ chọn.
  - Tổng quan: HP/MP lớn, vị trí, hoạt động, độ trễ, proxy, chủ sở hữu (admin).
  - Bản đồ: `MiniMap`, `MapTravelControl`, `KhuControl` (dùng lại, giữ nguyên props/hành vi).
  - Hằng ngày: `DailyControl`.
  - Túi đồ: nội dung túi (chỉ khi tài khoản đang chạy, như hiện nay).
  - Auto: khối Auto chính thức hiện có trong `AccountCard` (neo, supervisor, hurt, nút Bật/Dừng).
  - Nhật ký: log đã lọc theo tài khoản (dùng/tái dùng `LogTerminal` với `initialAccountId`).
  - Tài khoản: đổi mật khẩu, xoá, trạng thái proxy.
- Màn hẹp (< 1024 px): thanh trái thành danh sách phía trên (hoặc ngăn kéo); chọn tài khoản → bảng chi tiết chiếm màn hình với nút "Quay lại danh sách". Không thanh cuộn ngang ở 334 px.
- Admin: giữ nguyên `activeView` và `AdminPanel`; thanh trái chỉ áp dụng cho `dashboard`.
- Nhớ `selectedAccountId`, bộ lọc và tab đang mở trong `localStorage` (bọc try/catch; render đúng khi storage lỗi). Nếu tài khoản đang chọn bị xoá hoặc không còn trong danh sách → bỏ chọn, không lỗi.

## Yêu cầu kỹ thuật
- Component mới (đặt tên gợi ý): `AccountSidebar`, `AccountRow`, `AccountPanel`, `VitalBar` dùng chung (tách khỏi `AccountCard`). Hàm thuần để test: tính % thanh (null → không có %, "—"), nhóm trạng thái hàng, lọc/tìm theo tên (bỏ dấu tiếng Việt khi tìm nếu đơn giản, không bắt buộc), đọc/ghi lựa chọn từ storage an toàn.
- Giữ NGUYÊN mọi handler và hành vi nghiệp vụ trong `App.tsx` (`handleStart`, `handleStartAuto`, `handleMoveTo`, ...). Không đổi API, không đổi quyền, quy tắc khoá do hết hạn (`entitlementLock`) vẫn áp cho mọi điều khiển.
- Không xoá `AccountCard.tsx` ở giai đoạn này nếu còn nơi dùng; nếu không còn nơi nào dùng thì xoá và nói rõ trong báo cáo (không để mã chết khó hiểu).
- Truy cập: hàng là `button`/`role="option"` trong `role="listbox"`, `aria-selected`, điều hướng bàn phím (mũi tên lên/xuống, Enter), nhãn đọc được cho thanh (ví dụ "HP 120 trên 300"); tab có `role="tablist"/"tab"/"tabpanel"`.
- Màu tương phản đạt trên nền tối hiện có; dùng lớp Tailwind sẵn có; không `dangerouslySetInnerHTML`.
- Phong cách mã khớp các file xung quanh (React + TS + Tailwind, tiếng Việt cho chuỗi giao diện).

## Test và kiểm tra bắt buộc
- Mốc hiện tại: web 58/58 (ghi lại số đầu báo cáo), server 192/192 — không được tụt. Đếm server bằng `npx tsx --test` trên mọi `*.test.ts` trong `apps/server/src` (KHÔNG sửa server nên số không đổi).
- Test Vitest mới: hàm thanh (null/0/âm/vượt max/fresh-stale), lọc + tìm, nhóm trạng thái, storage lỗi không làm vỡ, tài khoản chọn bị xoá → bỏ chọn, tab chỉ hiện nội dung đúng, "—" cho trường `character` thiếu.
- Phá thử sửa TRỰC TIẾP NGUỒN, test phải FAIL gọn không treo, rồi khôi phục: (i) null → 0 cho thanh, (ii) lọc "Đang chạy" trả cả tài khoản dừng, (iii) không bỏ chọn khi tài khoản bị xoá, (iv) storage ném lỗi làm vỡ render, (v) thanh vượt 100% khi hp > max.
- `pnpm build` (nếu `pnpm` không có trong PATH, thử `%TEMP%\pnpmshim\pnpm.cmd`; nếu vẫn không chạy được thì nói rõ và chạy trực tiếp `tsc`/`vite build`/`vitest`), web test, toàn bộ test server.
- Xem trên trình duyệt thật ở 1280, 768 và 334 px bằng dữ liệu giả (build tĩnh + máy chủ tĩnh; KHÔNG dùng Vite dev server vì làm treo chụp màn hình trong môi trường này); nếu không có trình duyệt thì nói rõ là CHƯA xác minh trực quan, đừng tuyên bố đã xem.
- Cập nhật `docs/SESSION_LOG.md` (mục MỚI Ở ĐẦU), checklist cuối `docs/FIX_GUIDE.md`, `docs/UI_FEATURE_INVENTORY.md` (nếu có), `docs/PLAN_UI_SIDEBAR.md` (đánh dấu giai đoạn 1 xong, giai đoạn 2 chờ). Báo cáo kết quả thật bằng bảng xong/chặn/chưa xác minh; KHÔNG tuyên bố xong nếu còn test fail.
