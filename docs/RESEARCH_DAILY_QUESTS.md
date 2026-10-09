# Nghiên cứu: nhiệm vụ hàng ngày

Ngày: 2026-10-08. Nguồn: CHỈ đọc mã client chính thức (`vendor/tutien2d-public-client/2026-10-06/src`: `systems/quest.js`, `systems/diem_danh.js`, `net/gateway.js`, `world/mapdata.js`, `ui/hoatdong.js`). CHƯA chạm game thật. Mọi điều ghi "chưa xác minh" cần đo live trước khi tin.

## 1. Có những "nhiệm vụ hàng ngày" nào

Client có hai hệ thống thật sự theo ngày. (Hang Động `startHangDongQuest`/`claimHangDongChest` và quest chính `quest.turnIn` dùng cờ một lần trong `Quest.flags` như `hang_dong_da_nhan`, KHÔNG phải theo ngày; bí tích `bitich.*` là chuỗi nhiệm vụ riêng, chưa khảo sát.)

1. **Điểm danh hằng ngày** (`systems/diem_danh.js`): nhận 10 Linh Thạch mỗi ngày, ghi cờ `Quest.flags.diem_danh = { ngay, tong }`.
2. **"Việc Dược Công"** (hệ `seedQuest` trong `systems/quest.js`): sáu loại việc do Đại Phu giao, mỗi việc có giới hạn lượt mỗi ngày, trả Dược Công và Linh Thạch.

Ranh giới ngày (cả hai): giờ Việt Nam, đổi ngày lúc 00:00 UTC+7 (`VN_OFFSET_MS = 7 giờ`; `today()` = ngày theo UTC cộng 7 giờ; `DiemDanh.ngayVN` cùng quy tắc). Client tính "đã làm hôm nay" bằng giờ máy (`Date.now()`) — `chưa xác minh` server dùng giờ nào để chốt.

## 2. Điểm danh

- NPC `manh_shopt1` ("Mạnh ShopT1") ở map `tan_vien`, ô (33,18).
- Khi online client gọi `Gateway.cmd("diemdanh", {}, callback)`; chỉ khi offline mới tự cộng cục bộ (`DiemDanh.nhan`). Phần thưởng và việc chặn "đã điểm danh hôm nay" do server quyết (lời nhắn client: "Hôm nay đạo hữu đã điểm danh rồi.").
- Phản hồi: gói `ack` có `rid` của lệnh, kèm `ok`, `why`, `toast`.
- Chưa xác minh: server có đòi đứng gần NPC khi nhận `diemdanh` không (client chỉ mở hội thoại khi tương tác); dạng chính xác của `ack` khi thành công (số Linh Thạch, `tong`).

## 3. "Việc Dược Công" (seed quest)

Điều kiện mở: tiến độ quest chính `Quest.stage >= 8` (`canOpenSeedMenu`/`startSeedQuest`); mỗi lần chỉ một việc đang làm (`hasActiveSeedQuest`). Giới hạn mỗi việc mỗi ngày: `SEED_TASK_DAILY_LIMIT = 3`, riêng `dai_hoi` là 1. Đếm trong `seedQuest.daily[taskId] = { day, n }`. Hủy việc (`cancelSeedQuest`) trả lại một lượt.

| Việc (`taskId`) | Loại | Địa điểm | Yêu cầu | Thưởng (Dược Công / Linh Thạch) |
|---|---|---|---|---|
| `linh_chi` | thu thập | `tan_vien` (props `linh_chi_1..10`, ô như (19,2)) | hái 3 "Nấm Linh Chi Núi" | 1 / 10 |
| `cau_ca` | câu cá | Bờ Hồ Bích Thuỷ hoặc ao trong Vườn Cá Nhân | 3 con cá bất kỳ (`ca_song`, `linh_ngu`) | 4 / 30 |
| `ho_tong_chau` | hộ tống | Dược Cốc → làng Tản Viên | đưa "cháu của Đại Phu" về làng | 2 / 25 |
| `truc_gia` | thu thập | `thanh_truc_lam` (props `truc_gia_1..4`, ô như (18,5)) | chặt 4 "Trúc Tâm" | 1 / 15 |
| `duoc_moc` | thu thập | Thảo Dược Cốc (`duoc_vien`) (props `canh_kho_1..5`; vị trí chưa tra được) | chặt 5 "Cành Khô" | 3 / 20 |
| `dai_hoi` | thi đấu | Đại Hội Tu Tiên (`dai_hoi_cho`) | thắng một trận (giới hạn 1 lượt/ngày) | 10 / 100 |

- NPC giao việc: "Đại Phu" ở `duoc_vien`, ô (14,8).
- Tối đa lý thuyết mỗi ngày (không kể `dai_hoi` cần đối thủ): 3 lượt × 5 loại (còn tuỳ khả thi). `chưa xác minh`: có giới hạn tổng ngoài giới hạn từng loại hay không.
- Dược Công dùng để đổi gói hạt (`buySeedPack`, lệnh `seed.buyPack`); không thuộc phạm vi tự động hoá hằng ngày nếu không cần.

## 4. Giao thức (đã xác minh bằng đọc mã)

Client không tự gửi gói thô cho quest: `Gateway.bindIntents` móc vào các hàm của `Quest`/`Progress`, mỗi lần hàm được gọi trong game online thì client phát lệnh `{op:"cmd", cmd, rid, ...}`. Ánh xạ liên quan:

| Hàm client | Lệnh server |
|---|---|
| (hội thoại điểm danh) | `diemdanh` |
| `Quest.startSeedQuest(taskId)` | `seed.start {taskId}` |
| `Progress.markHarvested(propId)` | `gather {propId}` |
| `Quest.collectSeedMaterial(taskId, propId)` | `seed.collect {propId}` |
| `Quest.completeSeedQuest()` | `seed.complete` |
| `Quest.completeEscortSeedQuest()` | `seed.escortComplete` |
| `Quest.cancelSeedQuest()` | `seed.cancel` |
| `Quest.buySeedPack(packId)` | `seed.buyPack {packId}` |

Trả lời: gói `ack` `{rid, ok, why?, toast?}`; hiển thị `toast` hoặc "Không được: <why>" nếu `ok === false`. Phần thưởng là trạng thái server (cập nhật qua các gói `state`/`status`). Vì lệnh phát ra từ chính client chạy headless, cách đúng để điều khiển bằng engine vendor là GỌI CÁC HÀM CỦA CLIENT (như Auto đang làm với di chuyển/đánh), không tự dựng gói.

## 5. Điều chưa biết (cần đo live)

1. Server có đòi vị trí (đứng gần Đại Phu / `manh_shopt1`) khi nhận `diemdanh`, `seed.start`, `seed.complete`? (Với đổi khu, quy tắc "đứng gần" hoá ra không có ở server; có thể tương tự ở đây nhưng PHẢI đo.)
2. Dạng `ack` thật (`ok`, `why`, `toast`) của từng lệnh và toast lỗi khi hết lượt, chưa đủ cấp (`stage < 8`), đã có việc đang làm.
3. Server có kiểm tra thu thập (`seed.collect`/`gather`) theo vị trí và thời gian chặt/hái (animation), hay chỉ kiểm propId + giới hạn.
4. Giờ nào server chốt "ngày" (giờ Việt Nam?), và giới hạn lượt thật so với client (3/ngày).
5. Tiến độ tài khoản hiện tại: `Quest.stage` đã ≥ 8 chưa (runner chưa xuất `stage`).
6. Hộ tống (`ho_tong_chau`): cơ chế "cháu của Đại Phu" đi theo nhân vật (NPC follower `escortFollower`) và điều kiện hoàn thành; việc này cần đi qua map nên hợp với `walkTo` nhưng chưa khảo sát chi tiết.
7. Câu cá: cơ chế câu (`fishing.js`) trong headless chưa thử; thời gian chờ và điều kiện (có cần mồi hay không).

## 6. Đề xuất thiết kế (chờ duyệt, chưa có mã)

Cách làm đúng hướng đã chốt của dự án: chạy chính client, gọi hàm client, quan sát gói trả về.

1. Bản đo trước (giống đổi khu): route thử nghiệm ghi lại gói `ack`/`toast`/`state` liên quan sau khi gọi hàm client; đo `diemdanh` (an toàn, việc nhỏ nhất, hợp lệ nhất để đo trước), rồi `seed.start` + một việc thu thập ngắn gần nơi nhân vật đang đứng, đo xem có cần đứng gần NPC hay không.
2. `Daily` module (chạy khi người dùng bấm, KHÔNG tự bật khi khởi động server, đúng quy tắc AGENTS.md): kiểm tra ngày VN, lượt còn lại (đọc `seedQuest.daily` từ client), gọi hàm client theo thứ tự; dùng `walkTo` (nhiều map) để tới NPC/props; một bước tại một thời điểm; hủy được; dừng khi `hurt` theo ngưỡng như `walkTo`.
3. Dashboard: nút "Điểm danh", danh sách "Việc Dược Công" hiện lượt còn lại hôm nay và nút giao/nhận, trạng thái từng bước.
4. Phạm vi bản đầu đề nghị: điểm danh + một việc thu thập (`linh_chi` ở `tan_vien`, nơi an toàn) để kiểm chứng toàn bộ chuỗi (đi tới → hái → hoàn thành → nhận thưởng); các việc còn lại (`truc_gia`, `duoc_moc`, `cau_ca`, hộ tống, `dai_hoi`) sau khi bản đầu chạy đúng.

## 7. Rủi ro và ràng buộc

- Không retry mù lệnh quest (không có ACK riêng cho một số thao tác ngoài `ack` theo `rid`); không tự động hoá ngoài phạm vi người dùng giao; một phiên mỗi tài khoản; theo dõi `hurtCount`.
- Việc ở map có quái (`thanh_truc_lam`: `truc_gia`) cần chặn theo `hurt`; `linh_chi` ở `tan_vien` (không quái) an toàn hơn.
- Lượt trong ngày là tài nguyên có hạn: bản đo không được "đốt" lượt thật ngoài ý chủ dự án (điểm danh chỉ một lần mỗi ngày; việc Dược Công 3 lượt mỗi loại). Cần chủ dự án đồng ý trước khi đo bằng lượt thật.

---

## 8. KẾT QUẢ ĐO LIVE (2026-10-08, `tan_vien`, không quái, hurt 0 suốt đợt)

Công cụ đo: route thử nghiệm `POST /accounts/:id/quest-probe` (status, diemdanh, seed.start, seed.complete, seed.cancel, harvest) và `GET /accounts/:id/khu-probe` để đọc các gói ghi lại (`ack`, `state`, ...). Chỉ gọi các hàm/đường lệnh của chính client.

- **Trạng thái tài khoản (đọc từ client, `status`):** `Quest.stage = 21` (đủ ≥ 8), `today = 2026-10-08` (ngày Việt Nam), `diemDanh = { daNhan: false, tong: 0 }`, `seedQuest.daily` cho thấy cả 5 loại việc (`cau_ca`, `duoc_moc`, `linh_chi`, `truc_gia`, `ho_tong_chau`) đã đủ `n: 3` vào `2026-10-07` (hôm trước) nên có lượt mới hôm nay; `stones` 1257, `duocCong` 16.
- **Điểm danh (`cmd diemdanh`):**
  - Từ xa (~1.000 px) → `ack {ok:false, why:"không đứng cạnh Mạnh ShopT1"}`, rồi server gửi `state {reason:"diemdanh:refused"}` (client đồng bộ lại trạng thái).
  - Đứng cách NPC 56 px (NPC ô (33,18) ≈ (1072,592), nhân vật ở (1057,646)) → `ack {ok:true, toast:"Điểm danh ngày thứ 1 · +10 Linh Thạch", stones, tong}`; Linh Thạch 1257 → 1267, `daNhan = true`. Ngưỡng khoảng cách chính xác chưa đo (≤ 56 px thì được).
- **`seed.start` (nhận việc `linh_chi`)**: gọi `Quest.startSeedQuest('linh_chi')` từ `tan_vien` (xa Đại Phu ở `duoc_vien`) → hàm client chạy cục bộ rồi `bindIntents` phát `seed.start`; server trả `ack {ok:false, why:"không đứng cạnh Đại Phu"}` kèm `state {reason:"seed.start:refused"}`; trạng thái `seedQuest` cục bộ được hoàn lại (`active:false`), không mất lượt.
- Kết luận: server ép "đứng cạnh NPC" cho `diemdanh` và `seed.start` (khác với đổi khu); lỗi trả bằng `ack.why` bằng tiếng Việt; sau mỗi lần từ chối server gửi `state` đồng bộ lại.
- Chưa đo: `resource.harvest` (hái/chặt vật thu thập), `seed.complete`, `seed.escortComplete`, câu cá, `dai_hoi`; ngưỡng khoảng cách chính xác; việc server chốt ngày theo giờ nào (chỉ biết client dùng giờ VN).

---

## 9. KẾT QUẢ ĐO LIVE — chu trình `duoc_moc` hoàn chỉnh (2026-10-08, `duoc_vien`)

Đo một chu trình thật: nhận việc → chặt 5 cành → giao việc. Tất cả đều qua hàm/đường lệnh của chính client; hurt không đáng kể (đi qua `thanh_truc_lam` bị đánh 2 lần, ở `duoc_vien` 1 lần; không gục). Công cụ đo: `quest-probe` với các hành động `status`, `props`, `chop`, `seed.start`, `seed.collect`, `seed.complete`.

| Bước | Điều kiện | Kết quả (gói server) |
|---|---|---|
| Đi tới `duoc_vien` | `walkTo` nhiều map (`tan_vien` → `thanh_truc_lam` → `duoc_vien`) | 24 s tổng, thành công |
| `seed.start duoc_moc` từ xa (đã đo ở `tan_vien`) | cách Đại Phu rất xa | `ack {ok:false, why:"không đứng cạnh Đại Phu"}` + `state {reason:"seed.start:refused"}`; trạng thái cục bộ được hoàn lại, không mất lượt |
| `seed.start duoc_moc` | cách Đại Phu 36 px (prop (464,288)) | `ack {ok:true, toast:"Đã nhận việc của Đại Phu"}` + `state {reason:"seed.start"}`; `daily.duoc_moc = {day, n:1}` |
| Chặt cổ thụ `co_thu_linh_moc` (prop (1104,832), `r` 58, tile (34,25)) | đứng cách cây 64–67 px | client tự chặt 3 nhát, cành rơi sau ~0,8–0,9 s (mỗi lần cấp `materialId` kế tiếp `canh_kho_1..5`); đứng xa quá `r+16` ≈ 74 px thì client tự hủy việc chặt |
| Nhặt cành (đi tới chỗ cành rơi ~(1063..1089, 674..683)) | client tự nhặt khi tới gần | client phát `seed.collect {propId:"canh_kho_N"}` → `ack {ok:true}` (không có toast); `Inventory.count('canh_kho')` 1→5, `seedQuest.collected` 1→5 |
| `seed.complete` từ xa | cách Đại Phu ~900 px | `ack {ok:false, why:"không đứng cạnh Đại Phu"}` + `state {reason:"seed.complete:refused"}`; trạng thái cục bộ hoàn lại (vẫn 5 cành, việc còn hoạt động) |
| `seed.complete` | cách Đại Phu 52 px | `ack {ok:true, toast:"Đã báo công việc vặt — nhận Dược Công"}` + `state {reason:"seed.complete"}`; Linh Thạch 1267 → 1287 (+20), Dược Công 16 → 19 (+3), cành 5 → 0; `daily.duoc_moc.n = 1` |

Kết luận đã xác minh:
- Server ép "đứng cạnh NPC" cho `diemdanh`, `seed.start` và `seed.complete` (cách ≤ 56 px thì được, vài trăm px trở lên thì bị từ chối); `seed.collect` không bị chặn theo vị trí NPC nhưng cành chỉ rơi khi đứng trong tầm cây.
- Lỗi luôn trả bằng `ack.why` (tiếng Việt) và server gửi `state` đồng bộ lại; hàm cục bộ của client không để lại trạng thái sai nhờ gói `state`.
- Phần thưởng khớp định nghĩa trong client (`duoc_moc`: 3 Dược Công, 20 Linh Thạch).
- Lượt trong ngày được tính theo giờ Việt Nam (`daily.<task>.day = 2026-10-08`).

Chưa đo (chưa xác minh): ngưỡng khoảng cách chính xác (giữa 56 px và vài trăm px); `linh_chi`, `truc_gia`, `cau_ca`, `ho_tong_chau`, `dai_hoi`; việc giới hạn 3 lượt/ngày có thật ở server; hành vi nếu rời nhiệm vụ giữa chừng.

## 10. TRIỂN KHAI BẢN 1 (offline, 2026-10-08)

Đã triển khai module nhiệm vụ hằng ngày cho engine vendor: điểm danh và `duoc_moc`. State machine đọc status từ client, dùng `WalkNavigator` cho cả đi cùng map/nhiều map, lấy prop theo id lúc chạy, bắt chước `ea()` bằng `SceneWorld.chopping = { prop, swing: 0, t: 10 }`, để client tự nhặt và theo dõi ACK `seed.collect` theo `cmd` với timeout hữu hạn, không retry mù. Đã nối snapshot/runtime, API, dashboard và test fake/contract.

Đây là triển khai offline, không phải kết quả đo mới. Các mục “chưa xác minh” của mục 9 vẫn giữ nguyên; đặc biệt chưa xác nhận lại trên game thật ngưỡng NPC, giới hạn lượt server, các việc khác và hành vi rời việc giữa chừng.

Fixture `VendorRunner + FakeSocket` bản 1 mới chỉ kiểm tra đường điểm danh và ghép ACK theo `cmd` (có ACK khác lệnh đến trước); chưa giả lập trọn chu trình `duoc_moc` với map/props, khoảng cách NPC, cành rơi/tự nhặt và thưởng server.

---

## 10. KẾT QUẢ ĐO LIVE — chu trình `linh_chi` hoàn chỉnh (2026-10-08, `duoc_vien` ↔ `tan_vien`)

Đo qua `quest-probe` (thêm lọc prop `ling_chi_prop` ở `props`). Hurt 0 suốt đợt, không gục.

| Bước | Điều kiện | Kết quả (gói server) |
|---|---|---|
| `seed.start linh_chi` | cách Đại Phu 50 px | `ack {ok:true, toast:"Đã nhận việc của Đại Phu"}` + `state {reason:"seed.start"}`; `daily.linh_chi = {day, n:1}` |
| Đi tới `tan_vien` | `walkTo` nhiều map | 2 chặng qua `thanh_truc_lam`, thành công |
| `resource.harvest` từ xa | cách prop ~715 px | `ack {ok:false, why:"không đứng cạnh tài nguyên ấy"}` + `state {reason:"resource.harvest:refused"}` |
| `resource.harvest linh_chi_6` | cách 25 px | `ack {ok:false, why:"tài nguyên chưa mọc lại", retryAfter:2}` (prop dùng chung giữa người chơi cùng khu, đang hồi) |
| `resource.harvest linh_chi_8`, `linh_chi_2`, `linh_chi_5` | cách 31, 35, 24 px | `ack {ok:true, toast:"+1 Nấm Linh Chi Núi", itemId, regrowAfter:12, du:false}` (lần thứ 3 `du:true`) + `state {reason:"resource.harvest"}`; `Inventory.count('nam_linh_chi')` 1 → 2 → 3 (kho do server cập nhật); `seedQuest.collected` luôn 0 (không dùng cho `linh_chi`) |
| `seed.complete` | cách Đại Phu 38 px | `ack {ok:true, toast:"Đã báo công việc vặt — nhận Dược Công"}` + `state`; Linh Thạch 1355 → 1365 (+10), Dược Công 22 → 23 (+1), nấm 3 → 0; `daily.linh_chi.n = 1` |

Kết luận đã xác minh:
- `linh_chi` hái bằng `Gateway.cmd("resource.harvest", {propId})` (đúng đường `_a` của client), KHÔNG dùng `seed.collect`; server tính số nấm trong kho; `du:true` báo đủ số cần (3).
- Server ép đứng cạnh tài nguyên (đo ≤ 35 px được, ~715 px bị từ chối) cũng như cạnh Đại Phu.
- Prop dùng chung giữa người chơi cùng khu: có thể "chưa mọc lại" (`retryAfter` giây) → thử prop khác hoặc chờ; `regrowAfter` 12 s sau khi hái.
- 10 prop `linh_chi_1..10` ở `tan_vien` (tile như (19,2)); 2 prop (`linh_chi_9`, `linh_chi_10`) đang ẩn (cùng toạ độ (624,96)) lúc đo. Vị trí đọc từ `MapData` lúc chạy, không viết cứng.
- Phần thưởng khớp định nghĩa: 1 Dược Công + 10 Linh Thạch.

Chưa đo: ngưỡng khoảng cách chính xác tới prop/NPC (giữa 35 px và hàng trăm px); khi cả 10 prop đều đang hồi; giới hạn 3 lượt/ngày ở server.

## 10b. TRIỂN KHAI OFFLINE — `linh_chi` (2026-10-08)

Đã triển khai offline `linh_chi` trong `DailyQuests` và `VendorRunner`: nhận/giao ở Đại Phu, đi nhiều map tới `tan_vien`, chọn prop `ling_chi_prop` không ẩn theo khoảng cách, gọi `resource.harvest`, đọc `Inventory.count('nam_linh_chi')` và xử lý `ack.du`/`retryAfter` hữu hạn. `duoc_moc` giữ nguyên chu trình cũ; các việc khác vẫn `TASK_NOT_SUPPORTED`. Bản triển khai không phải phép đo live mới.

Chưa xác minh: build/test đầy đủ trong môi trường giao việc, ngưỡng khoảng cách chính xác, hành vi khi mọi prop đồng thời hồi, giới hạn 3 lượt/ngày phía server và `truc_gia`/`cau_ca`/`ho_tong_chau`/`dai_hoi`.

---

## 11. KẾT QUẢ ĐO LIVE — chu trình `truc_gia` hoàn chỉnh (2026-10-09, `duoc_vien` ↔ `thanh_truc_lam`)

Đo qua `quest-probe` (`seed.start`, `props`, `chop`, `status`, `seed.complete`). Xung quanh 23 quái ở `thanh_truc_lam`; hurt tổng 2 lần, không gục.

| Bước | Điều kiện | Kết quả (gói server) |
|---|---|---|
| `seed.start truc_gia` | cách Đại Phu 40 px | `ack {ok:true, toast:"Đã nhận việc của Đại Phu"}` + `state {reason:"seed.start"}`; `daily.truc_gia = {day, n:1}` |
| Đi tới `thanh_truc_lam` | `walkTo` map 1 chặng | thành công (khu 1, điểm xuất hiện (432,927)) |
| Props việc | `props` của map đã tải | 4 prop `truc_gia_1..4`, type `seed_bamboo_prop`, `seedTask:"truc_gia"`, `r` 44, tất cả hiện: (592,192), (880,416), (336,672), (1008,288); `block:true` (ô bị chặn, ô chiếm vùng phía TRÊN toạ độ prop: đáy ô = `prop.y`) |
| Chặt thử đứng cách điểm chặt 82 px | đích `(x, y+36)` bị `walkTo` dịch xa | KHÔNG thu được: client tự hủy việc chặt (tầm = `r+16` = 60 px quanh `(prop.x, prop.y - TILE/2)`); không phát lệnh nào |
| Chặt đứng cách điểm chặt 37–51 px | đích `(x, y+16)` | client tự chặt 3 nhát (~1,4 s), chặt xong tự gọi `collectSeedMaterial` ⇒ `seed.collect {propId}` ⇒ `ack {ok:true}` (không toast) + `state {reason:"seed.collect"}`; `seedQuest.collected` 1 → 4 |
| `seed.complete` | cách Đại Phu 37 px | `ack {ok:true, toast:"Đã báo công việc vặt — nhận Dược Công"}` + `state`; Linh Thạch 1375 → 1390 (+15), Dược Công 24 → 25 (+1) |

Khác `duoc_moc`: trúc là prop riêng (4 cây, mỗi cây một lần), chặt xong thu NGAY (không có cành rơi để nhặt); khác `linh_chi`: dùng `seed.collect` (không phải `resource.harvest`) và số cây cần đã cố định theo prop. Phần thưởng khớp định nghĩa: 1 Dược Công + 15 Linh Thạch.

Bài học áp dụng: đích đi bộ tới cây là `(prop.x, prop.y + 16)` (sát hơn 36 px vì ô cây chiếm vùng phía trên); prop của `thanh_truc_lam` phải đọc từ map ĐÃ TẢI (có `x/y`), đi theo map tới `thanh_truc_lam` trước (`walkTo` nhiều map không đi tiếp tới `target`).

Chưa đo: khi cây bị người khác chặt (`hidden`), ngưỡng khoảng cách chính xác, giới hạn 3 lượt/ngày ở server.

Triển khai offline 2026-10-09: `daily-quests.ts` và `vendor-runner.ts` đã hỗ trợ `truc_gia` theo kết quả đo trên; không xem dòng này là xác minh live mới. `duoc_moc` và `linh_chi` giữ nguyên hành vi đã triển khai.

---

## 12. KẾT QUẢ ĐO LIVE — việc `cau_ca` (2026-10-09, `duoc_vien`)

Đo qua `quest-probe` (thêm `fish`, `props` tìm cả `interactables`, `status` có `ca`/`fishing`). Hurt 0.

Định nghĩa client: `cau_ca` loại `fishing`, `need` 3, `itemIds` `ca_song` và `linh_ngu` (cá bất kỳ), thưởng 4 Dược Công + 30 Linh Thạch. `seedQuestComplete()` cho việc câu cá là "số cá trong túi (`ca_song` + `linh_ngu`) ≥ 3"; `completeSeedQuest` lấy cá theo thứ tự `itemIds` (cá thường trước).

| Bước | Điều kiện | Kết quả (gói server) |
|---|---|---|
| `seed.start cau_ca` | cách Đại Phu 41 px | `ack {ok:true, toast:"Đã nhận việc của Đại Phu"}` + `state`; `daily.cau_ca = {day, n:1}` |
| `seed.complete` với cá CÓ SẴN trong túi (28 con từ các ngày trước), không câu | cách Đại Phu ~41 px | `ack {ok:true, toast:"Đã báo công việc vặt — nhận Dược Công"}` + `state`; Linh Thạch 1405 → 1435 (+30), Dược Công 26 → 30 (+4), cá 28 → 25 (tiêu 3 cá thường) |
| Câu thử từ xa | cách hồ ~240 px | sau 4,5 s chờ phía client: `ack {ok:false, why:"không đứng cạnh mặt nước"}` + `state {reason:"fishing.catch:refused"}` |
| Câu ở bờ hồ | đứng cách prop hồ 19 px (581,512), ô nước trong ±3 ô | mỗi lần: client chờ 3–6 s (`Fishing.waitTime`) rồi tự gửi `fishing.catch`; `ack {ok:true, itemId}` (bắt được cá, kho +1) hoặc `ack {ok:true, missed:true}` ("cá rỉa mất mồi", kho không đổi) + `state {reason:"fishing.catch"}`; 5 lần câu: 3 được, 2 hụt (tỉ lệ server ≈ 60% mẫu nhỏ, không phải 0,8 của client) |

Điểm câu ở `duoc_vien` (cùng map với Đại Phu): `interactables` `ho_bich_thuy_cong` ("Hồ Bích Thuỷ", prop (592,528), `r` 50) và `suoi_duoc_coc` ("Suối Dẫn Thuỷ", (1040,400), `r` 44, chưa đo); client bật câu bằng `SceneWorld.fishing = { t: 0, duration, bobX, bobY, waterName, prop, auto }` (hàm `In(prop)` không xuất ra ngoài; đã bắt chước trong `quest-probe` `fish`: dừng nhân vật, `Player.stand`, phao ở ô `water` gần nhất trong ±3 ô quanh nhân vật, nếu không có thì dưới chân).

Kết luận: việc `cau_ca` KHÔNG bắt buộc phải câu nếu túi đã có ≥ 3 cá (tiêu 3 cá thường mỗi lượt); khi túi thiếu cá phải tới bờ hồ (≤ ~19 px đã đo là được; xa 240 px bị từ chối) và câu lặp tới đủ, kết quả mỗi lần do server quyết (có thể hụt).

Chưa đo: ngưỡng khoảng cách chính xác tới mặt nước, `suoi_duoc_coc`, `linh_ngu`, giới hạn 3 lượt/ngày ở server, hành vi khi túi đầy.
