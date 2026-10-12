# Kế hoạch: giao diện dashboard dạng thanh tài khoản bên trái + bảng chi tiết

Cập nhật: 2026-10-12. Giai đoạn 1 và giai đoạn 2 đã triển khai; nguồn cập nhật/tần suất/độ tin cậy của `sp/bp/exp` còn chờ xác minh live. Quyết định giao diện trong nhiệm vụ đã chốt: bảy tab chi tiết, lọc/tìm ở sidebar, giữ StatsBar và nhật ký chung khi chưa chọn, Túi đồ thành tab dùng lại logic cũ.

## 1. Hiện trạng [đọc từ mã]
- `apps/web/src/App.tsx`: Navbar + `StatsBar` + lưới 1–3 cột `AccountCard` + `LogTerminal`. Mỗi `AccountCard` (157 dòng) chứa tất cả: HP/MP, vị trí, `MiniMap`, `MapTravelControl`, `KhuControl`, `DailyControl`, khối Auto, Túi đồ, đổi mật khẩu, xoá. Thẻ rất cao, nhiều tài khoản thì phải cuộn dài.
- Dữ liệu có sẵn trong `AccountRuntime`: tên nhân vật, `vitals` (hp/mp và max, trạng thái fresh/stale), `derivedMax`, vị trí, `downed`, `activity`, `vendor.*` (Auto, hurt, supervisor), `daily`, `dailyStatus`, `metrics`.
- Snapshot có `character`: cảnh giới, Thần thức (`sp`), Giáp (`bp`), Đạo Hạnh (`exp`) cùng số Linh Thạch (`Progress.stones`), `Loot.stoneToday().da/.tran` và biến động phiên. Các trường character là client model; nguồn gói/cập nhật và độ tin cậy live của `sp/bp/exp` chưa xác minh.

## 2. Bố cục đích
```
┌ Navbar (giữ nguyên) ─────────────────────────────────────────────┐
├ Thanh trái (≈300 px, cuộn riêng) ─┬ Vùng chính ───────────────────┤
│ [tìm / lọc: đang chạy, lỗi]       │ (chưa chọn)  → StatsBar + Nhật ký chung
│ ┌ Tên · Cảnh giới ──── ●chạy ┐    │ (đã chọn)    → Bảng tài khoản
│ │ HP ▓▓▓▓░  MP ▓▓▓░░         │    │   Tiêu đề: tên, cảnh giới, Chạy/Dừng, Auto
│ │ TT ▓▓▓▓▓  Giáp ▓▓░░░       │    │   Tab: Tổng quan | Bản đồ | Hằng ngày |
│ │ Đạo Hạnh ▓▓▓░░ 62%         │    │        Túi đồ | Auto | Nhật ký | Tài khoản
│ └─────────────────────────────┘    │   Nội dung tab chiếm trọn vùng chính
│ ┌ …                          ┐      │
└────────────────────────────────────┴───────────────────────────────┘
```
- Thanh trái: mỗi tài khoản là một hàng gọn (chiều cao ~92 px): tên nhân vật, cảnh giới, chấm trạng thái (chạy/dừng/lỗi/gục/dữ liệu cũ), 5 thanh nhỏ HP, MP (Linh lực), Thần thức, Giáp, Đạo Hạnh kèm số. Giá trị chưa biết hiện "—", không thay bằng 0 (quy tắc `AGENTS.md`).
- Bấm một hàng: chọn tài khoản, vùng chính hiện bảng chi tiết của tài khoản đó (không còn chiếm lưới 3 cột). Bấm lần nữa hoặc nút đóng thì quay về tổng quan.
- Tab trong bảng (dùng lại component hiện có, không viết lại logic): **Tổng quan** (vitals lớn, vị trí, hoạt động, cảnh báo dữ liệu cũ/đang nối lại/lỗi đăng nhập), **Bản đồ** (`MiniMap`, `MapTravelControl`, `KhuControl`), **Hằng ngày** (`DailyControl`), **Túi đồ** (`InventoryModal` chuyển thành nội dung tab thay vì modal), **Auto** (khối Auto chính thức: neo, hurt, bật/dừng), **Nhật ký** (lọc theo tài khoản), **Tài khoản** (đổi mật khẩu, proxy, xoá).
- Màn nhỏ (< 1024 px): thanh trái thành ngăn kéo hoặc danh sách xếp trên; bấm hàng thì bảng chi tiết toàn màn hình có nút quay lại.
- Admin vẫn có chế độ riêng như hiện nay (`activeView`).

## 3. Thay đổi dữ liệu (server → web)
1. `VendorRunner` snapshot: thêm `character: { realmId, realmName, sp, spMax, bp, bpMax, exp, expMax }` từ `player`/`Progress` của client vendor; mỗi giá trị `number | null` (không mặc định 0); cờ `fresh` giống `vitals`. Chỉ đọc, không gửi lệnh nào.
   - `spMax/bpMax/expMax` là giá trị mô hình suy ra trong client theo cảnh giới/trang bị, không có trên wire và chưa xác minh live; giữ ngoài `VitalSnapshot`, như quy tắc `derivedMax`.
2. `RunnerHandle`/shard: thêm vào snapshot JSON thuần (kênh 500 ms), cập nhật bộ hợp đồng và `shard/protocol.ts`; `WorkerPool` đưa vào runtime của tài khoản.
3. `apps/web/src/types/index.ts` + sanitizer (`useRealtime`) chịu được thiếu/sai kiểu.
4. Tên cảnh giới lấy từ `REALMS[realmId].name`; id lạ → hiện id thô, không đoán.
5. Chưa xác minh: tần suất cập nhật `sp/bp/exp` (không có trong gói `m`); nếu chỉ cập nhật khi có `state`/`you`, thanh có thể cũ: hiển thị tuổi dữ liệu như HP/MP.

## 4. Thay đổi web
- `App.tsx`: thêm `selectedAccountId` (nhớ trong `localStorage` bọc try/catch), bố cục 2 cột; giữ nguyên các handler (`handleStart`, `handleMoveTo`, ...), truyền xuống bảng chi tiết.
- Component mới: `AccountSidebar` (danh sách + tìm/lọc), `AccountRow` (hàng gọn, `VitalBar` nhỏ dùng chung), `AccountPanel` (tiêu đề + tab), `VitalBar` tách khỏi `AccountCard` để dùng chung.
- `AccountCard` đã xóa sau khi `AccountPanel` thay thế chức năng; không còn component trùng lặp.
- Giữ nhất quán giao diện tối hiện có (Tailwind, `glass-panel`), kiểm tra tương phản.
- Truy cập: hàng là `button`/`role="option"` có nhãn đọc được, điều hướng bàn phím mũi tên, `aria-selected`.

## 5. Giai đoạn
| GĐ | Nội dung | Rủi ro |
|---|---|---|
| 1 | [x] Bố cục + thanh trái + `AccountPanel` dùng lại thành phần cũ, CHƯA đổi server (cảnh giới/TT/giáp/exp hiện "—") | Hoàn tất 2026-10-12 |
| 2 | [x] Server snapshot `character`, RunnerHandle/shard, sanitizer và hiển thị | Hoàn thành 2026-10-12; nguồn cập nhật/tần suất/độ tin cậy chưa xác minh live |
| 3 | [~] Tinh chỉnh tiếp: nhóm trạng thái/shortcuts và tối ưu ngăn kéo sau khi review trực quan; tìm/lọc, bàn phím cơ bản, layout hẹp, tab Túi đồ và xóa `AccountCard` đã có ở giai đoạn 1 | Chưa xong |
| 4 | (Tuỳ chọn) Chế độ xem nhanh nhiều tài khoản, nút Chạy/Dừng ngay trên hàng | Thấp |

## 6. Kiểm tra
- Vitest: sanitizer `character` (thiếu/sai kiểu → null), định dạng thanh ("—" khi null, % khi biết), chọn/bỏ chọn, lọc, lưu `localStorage` lỗi không làm vỡ; test tab render đúng component.
- Server: bộ hợp đồng `RunnerHandle` (JSON thuần, null khi chưa vào game), shard.
- `pnpm build`, web test, server test; xem trên trình duyệt ở 1280 / 768 / 334 px bằng dữ liệu giả (kỹ thuật bản build tĩnh + tab foreground như lần Túi đồ).
- Phá thử nguồn: (i) `null` thành 0 cho sp/bp/exp, (ii) bỏ sanitizer, (iii) chọn tài khoản sai id.

## 7. Kết quả giai đoạn 1
- `AccountSidebar`, `AccountPanel` và hàm tiện ích thanh/trạng thái/lọc/storage được thêm; `AccountCard.tsx` được xóa.
- Có bảy tab, điều khiển nghiệp vụ cũ, lưu lựa chọn/bộ lọc/tab an toàn, layout responsive và test cho null/stale/lỗi storage/xóa account.
- Web test 63/63; server 192/192; TypeScript core-client/server/web và Vite web pass trực tiếp. `pnpm build` shim không chạy được vì lệnh `pnpm` bên trong shim không có trong PATH.
- Trình duyệt không khả dụng qua CUA, nên chưa xác minh trực quan 1280/768/334 px.
- Giai đoạn 2 thêm `character` từ server; payload thiếu trường vẫn giữ trạng thái chưa biết và không suy ra số.

## 8. Giai đoạn 2 — snapshot character và hiển thị (2026-10-12)

- [x] Snapshot 500 ms đọc các trường HUD `player.sp/spMax`, `player.bp/bpMax`, `player.exp/expMax`; `realmId` lấy từ `player.realmId`, tên tra trong `REALMS` của client. Không gửi lệnh game.
- [x] `character` đi cùng snapshot hiện có qua RunnerHandle và shard; JSON clone/bản sao được giữ, và shard stale, WorkerPool stale, runner dừng/lỗi đều xóa character.
- [x] Runtime API/WS và sanitizer web giữ null, giới hạn chuỗi, từ chối số không hữu hạn/âm và không vẽ số cũ; sidebar và Tổng quan hiển thị các thanh kèm phần trăm.
- [x] Offline: getCharacter, RunnerHandle, WorkerPool, shard, sanitizer và render test; không tạo tài khoản hoặc dùng game server thật.
- [ ] CHƯA XÁC MINH: `Progress` không có định nghĩa trong cây client tham chiếu; `Player.create` dùng `Progress.realm()` và player copy `Progress.exp`. Nguồn/gói cập nhật, tần suất cập nhật và độ tin cậy live của `sp/bp/exp` chưa xác minh. `spMax/bpMax/expMax` là mô hình client tính từ cảnh giới/trang bị, chưa xác minh live; không phải vitals wire.
- [ ] Kiểm tra trực quan bằng trình duyệt chưa xác minh.

## Giai đoạn 3 — Linh Thạch và nút Chơi (2026-10-12)
- [x] Sidebar hiện số ví và hôm nay/trần; Tổng quan có thẻ Linh Thạch, thanh % và biến động phiên, null/stale hiển thị “—”.
- [x] Trần/ngày là số client tính qua `Loot.stoneToday()` và `Quest.flags.linh_thach_ngay`; chưa xác minh khớp hạch toán máy chủ.
- [x] Nút Chơi dùng phương án thay thế ở `PLAN_PLAY_BUTTON.md`; không đăng nhập tự động và không gọi API.
- [ ] Chưa xác minh trực quan trên trình duyệt hoặc giá trị Linh Thạch trong phiên game thật.
