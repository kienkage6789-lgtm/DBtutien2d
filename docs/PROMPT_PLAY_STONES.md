# Nhiệm vụ: Nút Play (mở trang game chính thức) + hiển thị Linh Thạch kiếm được

Hai việc nhỏ, làm trong cùng đợt. Đọc `AGENTS.md`, `docs/PLAN_PLAY_BUTTON.md` (phương án thay thế đã chọn), `docs/PLAN_UI_SIDEBAR.md`, `docs/SESSION_LOG.md` (mục đầu), rồi:
- Server: `apps/server/src/headless/vendor-runner.ts` (`getCharacter`, `VendorCharacterSnapshot`, `getSnapshot`), `orchestrator/runner-handle.ts`, `runner-handle.contract.ts`, `shard/protocol.ts`, `shard/remote-runner-handle.ts`, `orchestrator/worker-pool.ts` (nơi gắn `character` vào runtime).
- Web: `types/index.ts`, `hooks/useRealtime.ts` (`sanitizeCharacter`), `components/AccountPanel.tsx`, `AccountSidebar.tsx`, `account-dashboard.ts`, `VitalBar.tsx`, các test liên quan.
- Mã client chính thức (CHỈ ĐỌC): `vendor/tutien2d-public-client/2026-10-06/src/systems/loot.js` (`Loot.stoneToday(P)` trả `{da, tran, ngay}`; `STONE_DAY_CAP`), `core/progress.js`/nơi định nghĩa `Progress` nếu có (`Progress.stones`), `ui/hud.js` (HUD hiển thị "Linh Thạch hiện có" và "Hôm nay từ quái: da/tran").

Không chạm game thật, không mở mạng ngoài, không đọc `data/`/`.env*`, không sửa `vendor/` hay `auto-supervisor.ts`, không commit. KHÔNG tạo tài khoản qua server thật (thêm tài khoản gọi đăng nhập game thật). Test dùng socket giả/fixture có sẵn.

## Việc 1: Nút Play (chỉ web)
- Trong `AccountPanel` (tiêu đề, cạnh nút Chạy/Dừng), thêm nút **Chơi**: liên kết `<a href="https://tutien2d.online/" target="_blank" rel="noopener noreferrer">` mở trang game chính thức ở tab mới. URL là hằng số đặt một chỗ (có thể gom trong `account-dashboard.ts`).
- Chỉ bật khi bot của tài khoản đã dừng (`account.status !== 'running'`, và không đang khởi động/nối lại). Khi đang chạy: nút bị vô hiệu (`aria-disabled`, không mở được dù bấm/Enter), có chú thích "Dừng bot trước khi chơi: game chỉ cho một phiên đăng nhập mỗi tài khoản". Dùng hàm thuần `canPlay(account)` để test.
- Kèm nút nhỏ **Sao chép đạo hiệu** (copy `account.accountName` vào clipboard; có fallback khi `navigator.clipboard` không có/bị từ chối; báo "Đã sao chép" bằng `notify`/nhãn tạm thời). TUYỆT ĐỐI không sao chép/hiển thị mật khẩu hay token; không đưa bất kỳ bí mật nào vào URL.
- Không gọi API nào, không đổi hành vi server cho việc 1.
- Test: `canPlay` (running/stopped/error/reconnecting), nút vô hiệu khi đang chạy (không có `href` thao tác được hoặc `aria-disabled`), có `rel="noopener noreferrer"`, sao chép không lỗi khi clipboard không có.

## Việc 2: Linh Thạch trong snapshot và giao diện
- Mở rộng `character` (cùng chỗ đã có `sp/bp/exp`) thêm: `stones: number|null` (ví hiện có, `Progress.stones`), `stonesToday: number|null` (`Loot.stoneToday().da`), `stonesCap: number|null` (`.tran`), `stonesSessionNet: number|null` (ví hiện tại trừ ví lúc ghi nhận đầu tiên trong phiên chạy này; có thể âm khi tiêu; đặt lại khi chạy lại/nối lại tài khoản mới; null khi chưa có mốc đầu).
- `getCharacter` vẫn thuần/dễ test (nhận thêm đối số cần thiết); mốc đầu giữ ở runner, không ở hàm thuần. Chưa biết → `null`, KHÔNG thay bằng 0; số hữu hạn không âm cho `stones/stonesToday/stonesCap` (0 thật được phép). `stonesToday`/`stonesCap` là số do client tính (`Loot.stoneToday` dùng cờ `Quest.flags.linh_thach_ngay`), chưa xác minh khớp máy chủ: ghi rõ trong tài liệu.
- Cập nhật kiểu và `isChildMessage`/hợp đồng RunnerHandle/shard (JSON thuần, bản sao, null khi chưa vào game/stale), WorkerPool (stale/dừng/lỗi → `character: null` như hiện tại), sanitizer web chịu thiếu/sai kiểu (giữ test cũ).
- Giao diện: thanh trái hiện một dòng nhỏ "Linh Thạch: <ví> · hôm nay <da>/<trần>"; tab Tổng quan thêm thẻ **Linh Thạch** gồm: Hiện có, Hôm nay từ quái (da/trần + thanh %), Biến động từ lúc bật (có dấu +/−, "—" nếu null). Dùng "—" cho null/stale, định dạng nghìn như HP. Nhãn tiếng Việt, ghi chú "Từ quái; trần theo cảnh giới".
- Quy tắc: không in/log nội dung này ngoài runtime cho chủ sở hữu/admin.

## Test và kiểm tra bắt buộc
- Mốc hiện tại: server 197/197, web 66/66 — ghi lại ở đầu báo cáo; không được tụt (đếm server bằng `npx tsx --test` trên mọi `*.test.ts` trong `apps/server/src`).
- Test mới: `getCharacter` với các trường Linh Thạch (đủ, thiếu, NaN/âm, 0 hợp lệ); mốc phiên và `stonesSessionNet` (tăng, giảm, đặt lại khi nối lại); hợp đồng RunnerHandle + shard (JSON thuần, null khi chưa vào game, stale không để lại số cũ); WorkerPool (dừng/lỗi/stale → null); sanitizer web; hiển thị "—" và định dạng; `canPlay`.
- Phá thử sửa TRỰC TIẾP NGUỒN, test phải FAIL gọn không treo, rồi khôi phục: (i) null → 0 cho `stones`, (ii) bỏ vô hiệu `character` khi stale, (iii) `canPlay` luôn true, (iv) `stonesSessionNet` không đặt lại khi chạy lại, (v) sanitizer web nhận chuỗi cho trường số.
- `pnpm build` (nếu không có `pnpm` trong PATH: `%TEMP%\pnpmshim\pnpm.cmd`; nếu vẫn không chạy thì nói rõ và chạy trực tiếp `tsc`/`vite build`/`vitest`), web test, từng file test liên quan, toàn bộ test server.
- Không dùng server thật với tài khoản giả. Xem giao diện (nếu có trình duyệt) bằng build tĩnh + máy chủ giả cục bộ; nếu không có thì nói rõ CHƯA xác minh trực quan.
- Tài liệu: `docs/CONTROL_PLANE_API.md`, `docs/UI_FEATURE_INVENTORY.md`, `docs/PLAN_UI_SIDEBAR.md` (nếu liên quan), `docs/PLAN_PLAY_BUTTON.md` (đánh dấu phương án thay thế đã làm), `docs/SESSION_LOG.md` (mục mới Ở ĐẦU), `docs/FIX_GUIDE.md`. Báo cáo bằng bảng xong/chặn/chưa xác minh, kèm bằng chứng ngắn; KHÔNG tuyên bố xong nếu còn test fail.
