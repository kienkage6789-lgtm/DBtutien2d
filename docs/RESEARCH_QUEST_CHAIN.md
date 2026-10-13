# Nghiên cứu chuỗi nhiệm vụ chính tuyến: từ lúc mới vào game tới Luyện Khí tầng 7

Cập nhật: 2026-10-13. Nguồn: mã client chính thức ở `vendor/tutien2d-public-client/2026-10-06` (`systems/quest.js` mảng giai đoạn `F`, `core/config.js` `REALMS`/`BREAKTHROUGH`, `net/gateway.js`, `systems/farm.js`, `systems/loot.js`, `scenes/world.js`), CHỈ ĐỌC. Không chạm game thật.
Nhãn: **[Client]** đọc từ mã client; **[Suy ra]** tính từ dữ liệu client; **[Chưa xác minh]** cần thử live. Phạm vi theo yêu cầu: chỉ cần tới **Luyện Khí tầng 7** (giai đoạn nhiệm vụ 0 → 18; không cần giai đoạn 19 trở đi).

## 1. Tóm tắt
- Chuỗi chính tuyến có 34 giai đoạn (0..34). Tầng 7 đạt được ở **giai đoạn 18** (hai "cửa quan" cuối bằng Luyện Khí Đan). Giai đoạn 19 chỉ còn Chiến Bảng/Phong Linh Thảo; giai đoạn 20 đòi "đã lên tầng 7" nên 0..18 là đủ. [Suy ra]
- Để lên tầng 7 cần đúng: 1 Tẩy Tuỷ Thang, 1 Linh Dược, **2 Tụ Khí Đan**, **3 Luyện Khí Đan**, và đổ đầy Đạo Hạnh ở mỗi tầng (tổng **3.090 Đạo Hạnh**). [Client]
- Phần khó nhất về thời gian thực: Luyện Khí Đan cần hạt (Dược Công, mỗi việc có trần lượt/ngày), cây chín 5–10 phút, và **12 Linh Thúy** rơi theo tỉ lệ bị ẩn. Ước lượng cả chuỗi: **vài ngày** thay vì vài giờ. [Suy ra]
- Bot hiện có khoảng một phần ba các việc cần làm. Còn thiếu: đối thoại/giao nhiệm vụ NPC, luyện đan ở đan lô, thiền, đột phá, múc/tưới nước, bí tịch, câu cá, hái cỏ/manh mối, tạo nhân vật. Mỗi lệnh cần xác minh gói tin trên game thật.

## 2. Tiến trình cảnh giới tới tầng 7 [Client]
`BREAKTHROUGH[<cảnh giới hiện tại>]`: khoá là cảnh giới ĐANG Ở, giá trị là điều kiện để lên tầng kế (khớp ghi chú trong đan: Tụ Khí Đan "phá quan 2→3 và 3→4", Luyện Khí Đan "4→7").
| Lên | Điều kiện đột phá | Đạo Hạnh phải đầy (`expMax`) | Giai đoạn nhiệm vụ |
|---|---|---|---|
| Phàm Nhân → LK1 | Tẩy Tuỷ Thang (3 Tẩy Uế Thảo) + đả tọa ở đài đá | — | 2–4 |
| LK1 → LK2 | Linh Dược (2 Linh Diệp + 2 Huyết Thảo), không tốn đan | 150 | 8–10 |
| LK2 → LK3 | 1 Tụ Khí Đan; cần giai đoạn ≥ 12 | 195 | 11–13 |
| LK3 → LK4 | 1 Tụ Khí Đan | 255 | 14 |
| LK4 → LK5 | 1 Luyện Khí Đan | 630 | 18 |
| LK5 → LK6 | 1 Luyện Khí Đan; cần giai đoạn ≥ 14 | 810 | 18 |
| LK6 → LK7 | 1 Luyện Khí Đan | 1.050 | 18 |
Tổng Đạo Hạnh cần đổ đầy: 150+195+255+630+810+1.050 = **3.090**. Thiền (`meditate`) tối đa **60 Đạo Hạnh/phút** (`expMinuteGained`), nên thiền thuần mất tối thiểu ~52 phút; hạ quái cũng cộng (Bọ Ngựa 3, Sơn Chuột 5, mỗi con). `addExp` không cộng thêm khi đã đầy. Máu gốc tầng 7: 210, MP 175, Thần Thức 66, Giáp 103.

## 3. Công thức đan [Client]
- **Tụ Khí Đan:** 3 Linh Diệp + 3 Huyết Thảo + 2 Linh Thúy.
- **Luyện Khí Đan:** 3 Linh Ngọc Diệp + 3 Xích Dương Thảo + 4 Linh Thúy.
- Hạt: gói `pham` (2 Dược Công): Linh Diệp x4 + Huyết Thảo x4. Gói `linh` (5 Dược Công, cần LK4): Linh Ngọc x3 + Xích Dương x3. Chi tiết bảng hạt, thời gian chín, việc kiếm Dược Công: `docs/RESEARCH_FARMING.md`.
- **Linh Thúy:** rơi từ Dược Linh Thú. Khi nhiệm vụ đang CẦN (giai đoạn 11) thì chắc chắn rơi; còn lại theo tỉ lệ bị ẩn (`MATERIAL_DROP_CHANCE`). [Chưa xác minh] số thật.

## 4. Nhu cầu vật phẩm tới tầng 7 [Suy ra]
| Vật phẩm | Số lượng | Ghi chú |
|---|---|---|
| Tẩy Uế Thảo | 3 | khóm ven suối, mọc lại sau 90 s |
| Linh Dược | 1 | 2 Linh Diệp + 2 Huyết Thảo |
| Tụ Khí Đan | 2 | 6 Linh Diệp + 6 Huyết Thảo + 4 Linh Thúy |
| Luyện Khí Đan | 3 | 9 Linh Ngọc + 9 Xích Dương + **12 Linh Thúy** |
| Dược Công | ≥ 15–17 | 3 gói `linh` (5 mỗi gói) + gói `pham` cho đan thứ hai; hạt đầu giai đoạn 8 do Đại Phu cho sẵn (chưa kiểm chứng số lượng) |
| Linh Thúy tổng | ~16 | 2 + 2 (Tụ Khí) + 12 (Luyện Khí) |
Hạt cây: 9 Linh Ngọc + 9 Xích Dương = 3 gói `linh` = 15 Dược Công. Dược Công tối đa ~43/ngày khi đủ mọi lượt, nhưng nhiều việc chỉ mở sau giai đoạn 8 và Đại Hội chỉ làm được sau khi có đủ điều kiện.

## 5. Từng giai đoạn: việc cần làm, lệnh, hiện trạng bot [Client] [Chưa xác minh live]
Ký hiệu bot: ✔ đã có · ◐ có một phần · ✘ chưa có.
| GĐ | Tên | Việc cần làm | Lệnh/cơ chế (client) | Bot |
|---|---|---|---|---|
| 0 | Nhập môn | Đọc Bia Đá hoặc hỏi Thầy Ông Nội (map `tan_vien`) | `talk` / tương tác prop | ✘ |
| 1 | Lĩnh ngộ cổ pháp | Đọc bia/hỏi Đạo Dẫn thuật | `talk`, `Quest.advance` | ✘ |
| 2 | Hái Tẩy Uế Thảo | Hái 3 ngọn ven suối | `gather {propId}` | ◐ (có việc hái `resource.harvest` kiểu khác; `gather` chưa) |
| 3 | Sắc Tẩy Tuỷ Thang | Đan lô cũ, chọn Tẩy Tuỷ Thang | `brew {recipeId}` | ✘ |
| 4 | Tẩy Uế Thể Xác | Đài đá: uống thang, đả tọa → LK1 | `meditate`, `breakthrough` | ✘ |
| 5 | Dọn yêu thú Rừng Trúc | Gặp Huấn Sư Huynh, cầm Trúc Kiếm, diệt 5 Bọ Ngựa/Sơn Chuột | `talk`, `item.equip`, Auto | ◐ (Auto, đi map có; thoại/trang bị chưa) |
| 6 | Tuần tra Rừng Trúc | Diệt thêm 5, hái 3 manh mối, báo lại | Auto, `gather`, `quest.turnIn` | ◐ |
| 7 | Bái kiến Đại Phu | Đi xuống Thảo Dược Cốc, gặp Đại Phu | di chuyển, `talk` | ◐ (đi có, thoại chưa) |
| 8 | Trồng linh thảo | Vườn Cá Nhân: gieo hết hạt, múc nước một lần, tưới từng luống, hái | `farm.sow`, `lake.scoop`, `farm.water`, `farm.harvest` | ◐ (gieo/hái có; tưới và múc nước chưa) |
| 9 | Sắc Linh Dược | Đan lô trong vườn | `brew` | ✘ |
| 10 | Dùng dược luyện khí | Đài đá trong vườn: uống, đổ đầy Đạo Hạnh, phá quan → LK2 | `bag.useItem`/`food`, `meditate`, `breakthrough` | ✘ |
| 11 | Dược Viên có khách lạ | Hạ 2 Dược Linh Thú trong vườn lấy Linh Thúy | Auto trong `vuon_ca_nhan` | ◐ |
| 12 | Luyện Tụ Khí Đan | Đan lô: 3+3+2 | `brew` | ✘ |
| 13 | Đột phá LK3 | Đổ đầy Đạo Hạnh, uống Tụ Khí Đan → LK3 | `meditate`, `breakthrough` | ✘ |
| 14 | Duyên pháp bí tịch | Binh khí ở Đại Phu; Tụ Khí Đan thứ hai → LK4; Tàng Kinh Lão Nhân, hai mảnh bí tịch ở Miếu Hoang | `quest.binhKhi`, `bitich.start`/`point`/`equipTask`/`finish`, `brew`, `breakthrough` | ✘ |
| 15 | Yêu Cốt Miếu Hoang | Hạ Yêu Quái, nhặt 10 Yêu Cốt Vụn, báo | Auto, `quest.turnIn` | ◐ |
| 16 | Độc Đằng và Linh Ngư | Hạ Độc Đằng Yêu (10 Độc Dịch), câu 1 Linh Ngư, giao Đại Phu | Auto, câu cá, `quest.turnIn` | ◐ (đã có việc câu cá hằng ngày) |
| 17 | Hỏi đạo, Tàng Kinh Các | 5 câu Bách Khoa của Thầy Ông Nội (thưởng 300 Linh Thạch); rút tủ sách tới khi có bí tịch mới | `quest.bachKhoaAnswer`, `bitich.*` | ✘ |
| 18 | Cửa quan tầng 5 và 6 | Dược Công → đổi gói `linh` → trồng → săn Linh Thúy → luyện 3 Luyện Khí Đan → phá quan 4→5, 5→6, 6→7 | `seed.*`, `farm.*`, `brew`, `breakthrough` | ◐ (Dược Công hằng ngày, đổi hạt, gieo/hái có) |
Chưa có trong bảng vì không cần: giai đoạn ≥ 19 (Chiến Bảng, Hang Động, Xích Long, Trúc Cơ...).

## 6. Bot đã có và còn thiếu
- **Có:** đăng nhập, đi bản đồ nhiều map, Auto đánh quái, việc Dược Công hằng ngày (Linh Chi, câu cá, hộ tống, Trúc Tâm, dược mộc), đổi gói hạt, gieo, thu hoạch (chưa thử live), đọc túi/vốn, chạy luôn, nối lại tự phục hồi Auto.
- **Thiếu (theo thứ tự cần):** (1) tạo nhân vật; (2) đối thoại NPC và giao/nhận nhiệm vụ (`talk`, `quest.turnIn`, `quest.advance`); (3) luyện đan (`brew`); (4) thiền và đột phá (`meditate`, `breakthrough`); (5) tưới và múc nước (`farm.water`, `lake.scoop`); (6) hái cỏ/manh mối (`gather`); (7) bí tịch và binh khí (`bitich.*`, `quest.binhKhi`, `item.equip`); (8) 5 câu Bách Khoa (`quest.bachKhoaAnswer`) — đáp án CHƯA biết nằm ở đâu trong client; (9) theo dõi giai đoạn nhiệm vụ hiện tại để biết việc kế tiếp.

## 7. Rủi ro và điều cần xác minh live
- Gục: hồi sinh bị khoá; giai đoạn đầu nhân vật yếu (HP 100–210). Cần quy tắc dừng an toàn trước mỗi đoạn Auto.
- Đa số lệnh nêu trên chưa có ACK mẫu: hình dạng phản hồi, `why`, khoảng cách tối đa tới NPC/prop, thứ tự điều kiện (ví dụ phải `talk` trước khi `gather`) đều chưa xác minh.
- Linh Thúy rơi theo tỉ lệ ẩn: số giờ cày thật chưa biết.
- Đáp án Bách Khoa; tạo nhân vật; cửa quan tầng 5 yêu cầu giai đoạn ≥ 14 (đã ghi).
- Phát hiện bot: chuỗi hành vi giống nhau trên nhiều tài khoản; chưa xác minh phía game có xử lý không.
- Game cập nhật làm đổi giai đoạn/lệnh: cần kiểm tra phiên bản client trước khi chạy dài (xem `docs/ARCHITECTURE_V2.md`).

## 8. Đề xuất lộ trình (chưa làm)
1. **Theo dõi nhiệm vụ (chỉ đọc):** đọc `Quest.stage` và cờ từ gói `state`, hiện trên dashboard giai đoạn hiện tại và việc kế tiếp (lấy từ `F[stage].hint`).
2. **Nền tảng lệnh chung:** `talk`, `quest.turnIn`/`advance`, `gather`, `brew`, `meditate`, `breakthrough`, `farm.water`, `lake.scoop` — mỗi lệnh một thao tác tuần tự có ACK như `garden.ts`, thử live với một tài khoản, ghi gói tin che dữ liệu.
3. **Đoạn dễ trước:** GĐ 5–7, 11, 15 (đánh quái, đi bản đồ); rồi GĐ 8–10, 12–13 (vườn, đan, đột phá); sau cùng GĐ 14, 16–18 (bí tịch, câu cá, Bách Khoa, cửa quan).
4. **Bộ điều phối:** máy trạng thái theo `Quest.stage`: mỗi giai đoạn gọi các đoạn trên, có dừng an toàn (`hurtCount`, gục, mất kết nối) và chờ theo ngày (Dược Công, trần lượt).
5. Chỉ nối thành "treo từ đầu tới LK7" sau khi từng đoạn đã chạy ổn có giám sát.
