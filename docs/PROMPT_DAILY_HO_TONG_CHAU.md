# Nhiệm vụ: hỗ trợ việc Dược Công `ho_tong_chau` (hộ tống) trong module nhiệm vụ hằng ngày

Đọc `docs/RESEARCH_DAILY_QUESTS.md` (ĐẶC BIỆT mục 13 `ho_tong_chau` đã đo live, và mục 9–12), rồi mã hiện có: `apps/server/src/headless/daily-quests.ts` (đã hỗ trợ `duoc_moc`, `linh_chi`, `truc_gia`, `cau_ca`), cách `vendor-runner.ts` cài `DailyClient` (và nhánh `quest-probe` `seed.escortComplete`), `apps/web/src/components/DailyControl.tsx`, `AGENTS.md`, mục đầu `docs/SESSION_LOG.md` (ĐỌC KỸ mục 2026-10-09 về 3 lỗi thật ở `linh_chi`). Nếu prompt mâu thuẫn với kết quả đo thì theo kết quả đo và báo rõ.

KHÔNG chạm game thật, KHÔNG mở mạng, KHÔNG đọc `data/`, `.env*`. Không commit. Không sửa `vendor/`, không sửa `auto-supervisor.ts`. Giữ nguyên các route thử nghiệm `khu-probe`, `quest-probe`. Sandbox của bạn không build được: tự rà kiểu TypeScript, import và chuỗi tiếng Việt UTF-8; người giao việc sẽ chạy `pnpm build` và toàn bộ test. Thay đổi tập trung, giữ hành vi các việc khác.

## BÀI HỌC BẮT BUỘC (đã gặp khi chạy live; test giả từng không bắt được)

1. `walkTo` nhiều map KHÔNG đi tới `target`: chỉ tới điểm xuất hiện của map đích. Bước sang `tan_vien` dùng `beginWalkToMapIfNeeded('tan_vien')`, rồi đi bộ trong map tới Thầy Ông Nội.
2. Prop của map KHÁC chỉ có ô `tx/ty` trong `MapData`; `getDailyProp` đã suy `x/y` (prop thường, kể cả NPC: `x = tx*TILE + TILE/2`, `y = (ty+1)*TILE`). `su_phu` ở `tan_vien` đo được (304,352) khi map đã tải. Đọc vị trí từ map ĐÃ TẢI sau khi sang map; test với dữ liệu client thật cho `getDailyProp('tan_vien','su_phu')` (kỳ vọng (304,352)).
3. Test giả phải mô hình hóa vị trí map (`FakeDailyClient.positionMapId`, `walkRequests`, `listProps` chỉ trả đối tượng của map đang đứng); thêm test đi từ map khác.

## Sự thật đã đo (tóm tắt mục 13)

- `ho_tong_chau`: loại `escort`, thưởng 2 Dược Công + 25 Linh Thạch, tối đa 3 lượt/ngày (server: chưa xác minh giới hạn). Nhận việc ở Đại Phu (`duoc_vien`, đứng ≤ ~56 px thì `seed.start` được; dùng ≤ 40 px như các việc khác) → `ack {ok:true, toast:"Đã nhận việc của Đại Phu"}`.
- "Cháu của Đại Phu" chỉ là hình vẽ phía client, KHÔNG cần bám theo hay kiểm tra.
- Hoàn thành: `Quest.completeEscortSeedQuest()` → lệnh `seed.escortComplete`, chỉ được khi đứng cạnh NPC `su_phu` ("Thầy Ông Nội") ở `tan_vien` (304,352). Cách 162 px hoặc ở `duoc_vien` → `ack {ok:false, why:"không đứng cạnh Thầy Ông Nội"}` + `state {reason:"seed.escortComplete:refused"}` (việc vẫn hoạt động, không mất lượt). Cách 38 px → `ack {ok:true, toast:"+2 Dược Công"}` + `state {reason:"seed.escortComplete"}`, +25 Linh Thạch, +2 Dược Công.
- Đường: `duoc_vien` → `thanh_truc_lam` → `tan_vien` bằng walkTo nhiều map (~17 s) rồi đi bộ ~4 s tới Thầy Ông Nội.

## Việc cần làm

### 1. `daily-quests.ts` + `vendor-runner.ts`
- Hỗ trợ năm việc: giữ nguyên bốn việc cũ, thêm `ho_tong_chau`; `seedTasks[].supported` đúng.
- Máy trạng thái, mỗi lượt: đi tới Đại Phu (≤ 40 px, như các việc khác) → `seed.start` (chờ `ack`) → `beginWalkToMapIfNeeded('tan_vien')` → đi bộ tới `su_phu` (đọc từ map đã tải, đứng ≤ ~40 px, tái dùng hằng/hàm đi tới NPC của bước giao việc) → `seed.escortComplete` (chờ `ack` theo `cmd`, thời hạn như các ack khác, không retry mù) → ghi thưởng → nếu còn lượt trong `runs` thì lặp lại (lượt sau phải quay lại `duoc_vien` nhận việc).
- Việc `ho_tong_chau` đang hoạt động (đứt giữa chừng) thì TIẾP TỤC: không `seed.start` lại, đi thẳng sang `tan_vien` (nếu chưa ở đó) rồi giao.
- `ack ok:false` với `why` ở `seed.escortComplete` (không đứng cạnh): đi sát hơn đúng một lần rồi `failed` kèm `why` nếu vẫn từ chối.
- `DailyClient`: thêm `completeEscortSeedQuest()` (dùng `P.Quest.completeEscortSeedQuest`, như `completeSeedQuest`); `readDailyState()` cho `ho_tong_chau`: `activeRequired` 0/không có tiến độ vật phẩm; `progress` có thể `null` (không bịa số). Tái dùng mã của `quest-probe` nhưng KHÔNG xóa probe.
- Giữ an toàn hiện có (chỉ chạy khi người dùng gọi API; hủy khi gục/reconnect/stop/Auto bật; `AUTO_ACTIVE`/`OPERATION_IN_PROGRESS`; `abortOnHurt`/`maxHurt`; `recordLog` mã ngắn kèm `detail` (khoảng cách tới Thầy Ông Nội, map, kết quả)). Thời hạn tổng mỗi lượt ~3 phút. Hủy giữa chừng: dừng đi bộ; không gọi `seed.cancel` tự động.

### 2. API và giao diện
- `POST /api/accounts/:id/daily/seed` chấp nhận `taskId: 'ho_tong_chau'`. Cập nhật `docs/CONTROL_PLANE_API.md`; sửa contract test nếu cần.
- `DailyControl.tsx` tổng quát cho mọi việc `supported`: thêm ghi chú nhỏ cho `ho_tong_chau` ("Đi từ Dược Cốc về làng Tản Viên gặp Thầy Ông Nội"). Giữ xác nhận trong giao diện, UTF-8. Không thêm tiến độ giả.

### 3. Test
`cd apps/server && npx tsx --test <file>`, mỗi file một lệnh. Giữ nguyên test hiện có. Thêm test máy trạng thái bằng giao diện fake: bắt đầu ở `duoc_vien` → đi Đại Phu → `seed.start` → sang `tan_vien` (đúng thứ tự: walk map trước rồi đi bộ tới NPC) → `seed.escortComplete` → thưởng +25/+2, chạy nhiều lượt (lượt sau quay lại `duoc_vien`); tiếp tục việc dở từ `duoc_vien` và từ `tan_vien`; `ack ok:false` "không đứng cạnh" → đi sát hơn một lần → `failed` kèm `why`; `ack` timeout không retry mù; hủy giữa chừng; Auto bật hủy; bắt đầu từ map khác (đi theo map trước). Test `vendor-runner.test.ts` với dữ liệu client thật: `getDailyProp('tan_vien','su_phu')` ≈ (304,352) và `getDailyProp('duoc_vien','dai_phu')` vẫn (464,288). Chờ có điều kiện bằng thăm dò; tham số mặc định khai báo kiểu tường minh; làm sạch chuỗi server: đổi ký tự điều khiển thành khoảng trắng RỒI gộp khoảng trắng.

## Báo cáo cuối

File sửa, cách chờ/ack, những gì CHƯA xác minh (ngưỡng khoảng cách chính xác, giới hạn 3 lượt/ngày ở server, hủy giữa chừng với escort, quái trên đường, `dai_hoi`), tài liệu đã cập nhật (`docs/SESSION_LOG.md` mục ĐẦU, checklist cuối `docs/FIX_GUIDE.md`, `docs/RESEARCH_DAILY_QUESTS.md` ghi "đã triển khai `ho_tong_chau`"). Không tuyên bố build/test pass nếu không chạy được; liệt kê lệnh người giao việc cần chạy.
