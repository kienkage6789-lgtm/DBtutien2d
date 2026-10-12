# Ghi chú nghiên cứu: sức mạnh, rơi đồ, Yêu Đan, vũ khí và kỹ năng

Cập nhật: 2026-10-12. Nguồn: mã client chính thức ở `vendor/tutien2d-public-client/2026-10-06` (CHỈ ĐỌC). Chưa chạm game thật.
Nhãn: **[Client]** đọc từ mã client; **[Suy ra]** tính từ dữ liệu client; **[Chưa xác minh]** cần thử live.

## 1. Các cách tăng sức mạnh (tổng quan) [Client]
| Nhóm | Nội dung | Ghi chú |
|---|---|---|
| Cảnh giới | Máu gốc: Luyện Khí 13 = 300, Trúc Cơ sơ kỳ 420, trung kỳ 540. Hệ số sức mạnh kỹ năng (`SKILL_POWER`): LK13 = 15, TC1 = 18, TC2 = 21. Công gốc đòn thường (`BASE_ATK`): 1 (Phàm Nhân), 2 (LK4), 3 (LK7), 4 (LK10), 5 (TC1), 6 (TC2) | Đột phá Trúc Cơ cần Trúc Cơ Đan, xem `docs/RESEARCH_HUYET_XICH.md` |
| Trang bị | 8 ô: `vu_khi`, `mu`, `ao` (y phục/pháp bào), `giap`, `giay`, `nhan`, `phap_boi`, `phi_hanh`. Chỉ số: `atkBonus`, `hpBonus`, `mpBonus`, `spBonus`, `bpBonus`, tốc độ di chuyển, kháng hiệu ứng, hồi MP | Pháp bào chỉ rơi từ Xích Long 0,5% / Linh Hổ 1% |
| Kỹ năng chủ động | ~28 kỹ năng, 44 loại bí tịch | Tầm 92–246 px; xem mục 4 |
| Nội công bị động | Tụ Linh (hồi 2% MP/5 s), Hộ Tâm (<30% máu giảm 15% sát thương), Phong Hành (+5% tốc), Kiếm Ý (đòn thứ 4 +12%), Băng Tâm, Hỏa Mạch, Thổ Thuẫn, Kim Quang Cháo, Mộc Xuân | Hầu hết yêu cầu Trúc Cơ 1 |
| Tiêu hao | Food (cơm linh mễ, linh kê, Đan Ngũ Hành, có giới hạn mua/ngày), bùa (Thanh Tâm hồi 50 MP, Kim Giáp khiên 20, Tốc Hành +30% 8 s, Hàn Băng, Lôi Động, Hoả Phù), trận bàn (Liệt Hỏa, Tụ Linh, Loạn Lôi Hỏa, Tứ Tượng; cần Trúc Cơ, tốn Linh Thạch) | |
| Pháp khí | Lục Tinh Trúc Kiếm (6 phi kiếm; cần Trúc Cơ 2; 10.000 Linh Thạch + 100 Phong Tinh Thạch), phi kiếm/cánh (Lam Phi Kiếm, Phong Lôi Dực, ...) | Thú hồn `thu_hon_3/4/6` từ boss: tác dụng chưa rõ |
| Xã hội | Tông môn, Đại Hội/Chiến Bảng, tổ đội (phó bản) | |
Chưa làm bảng số từng món (chỉ số, giá, nguồn): việc còn lại ở mục 8.

## 2. Linh Thạch từ quái: trần theo ngày [Client]
`systems/loot.js` `STONE_DAY_CAP`, HUD hiển thị "Hôm nay từ quái: đã nhận/trần". Ngày đổi lúc nửa đêm giờ Việt Nam.
| Cảnh giới | Trần/ngày |
|---|---|
| Phàm Nhân → Luyện Khí 3 | 500 |
| Luyện Khí 4 → 6 | 1.500 |
| Luyện Khí 7 → 9 | 3.000 |
| Luyện Khí 10 → 13 | 5.000 |
| Trúc Cơ sơ kỳ trở lên | 10.000 |
Chỉ tính Linh Thạch từ quái. Nhiệm vụ, bán đồ, Linh Thạch của boss: chưa thấy tính vào trần. [Chưa xác minh] Hàm áp trần (`capStones`) không có nơi gọi trong client; máy chủ mới là nơi áp.

## 3. Tỉ lệ rơi đồ [Client]
- Bảng tỉ lệ chung `LootRates` (Linh Thạch thường, nguyên liệu, quặng, trang bị hiếm, bùa chú, kiếm/vật phẩm boss Huyết Xích) **không có trong client công khai**; mã chỉ đọc nó. Các tỉ lệ này ẩn.
- Tỉ lệ cố định đọc được: Xích Long (20% Hoàng Lân Giáp, 20% Xích Long Huyết, 0,5% pháp bảo); Song Đức Ma Bảo (mỗi bí tịch kết đan 1% x5 loại, Ma Hồn Phệ 10%, Quần Đùi 5%, y phục ma bảo 5%, Thanh Tâm Y 1%, Hoàng Lôi Thương 1%, Băng Linh Kiếm 1%); ba đầu đàn Huyết Xích (Bí tịch Huyết Bức Chưởng 5%, Long Tượng Y 0,1%, Xích Viêm Song Kích 0,1%); Hang Động Cổ (Bí tịch Huyết Liêm Trảm 0,0005%); Linh Hổ pháp bảo 1%.
- Rơi đồ thật có thể do máy chủ quyết định nên số trong client chỉ là mô hình. [Chưa xác minh]
- Cách có số thật: ghi mỗi lần giết quái và vật phẩm nhặt theo map/loại quái (bộ đếm trong runner, chưa làm). Món 1% cần hàng nghìn lần giết; 0,0005% không đo nổi.
- Chưa làm: `docs/RESEARCH_DROPS.md` (bảng quái theo map).

## 4. Vũ khí và kỹ năng [Client]
- Đòn thường: sát thương = `baseAttack(cảnh giới)` + `atkBonus` trang bị (hoặc `+ weapon.damage` nếu vũ khí có `damage`); tốc độ = 1/`attackTime`; tầm = 26 + `reachBonus`.
- Ví dụ ở Luyện Khí 13 (công gốc 4): Trúc Kiếm (+1, 0,8 s, tầm 26) ≈ 6/giây; Trúc Côn (+2, tầm 60) ≈ 7,5/giây; vũ khí độc cần Luyện Khí 10 (+5, 0,9 s, tầm 99) ≈ 10/giây; cung (cần Trúc Cơ, +8, 0,78 s, tầm 180) ≈ 15/giây.
- Kỹ năng: tầm do kỹ năng (92–246 px), không do vũ khí. Sát thương = `coef × SKILL_POWER × mult`. Kỹ năng có `boostWeapon` gây x1 khi có đúng vũ khí/vật phẩm chỉ định, x0,5 nếu không. Cặp đã đọc: Huyết Kiếm Trận/Ngũ Kiếm Sát/Cửu Huyết Kiếm Trận → `huyet_kiem`; Kim Thương → `hoa_kim_thuong`; Quán Địa/Thương Vũ → `hoang_loi_thuong`; Băng Kiếm Trận/Luân, Thanh Băng Kiếm Trụ → `bang_linh_kiem`; Tiễn Vũ → `cung_linh`; Liêm Trảm → `huyet_ma_liem`. Hỏa Cầu, Phong Nhẫn, Cự Kiếm, ... không có `boostWeapon`.
- Hỏa Cầu: coef 1,8, hồi 6 s, 14 MP, tầm 124 → ~27 sát thương/phát ở LK13 (~4,5/giây).
- [Chưa xác minh] `boostWeapon` kiểm "sở hữu" (`Inventory.owns`) hay "đang đeo"; đòn thường có dùng được khi vừa lùi vừa đánh (`hitAt`).
- Kết luận chọn: chủ yếu đánh thường → vũ khí tầm xa nhất mà công không thấp hơn nhiều; chủ yếu dùng kỹ năng → vũ khí khớp `boostWeapon` của kỹ năng mạnh nhất.

## 5. Yêu Đan Cấp 3 (và mảnh) [Client]
Cần Yêu Đan Cấp 3 trở lên (3, 4 hoặc 6) cho Trúc Cơ Đan.
| Nguồn | Chi tiết |
|---|---|
| Xích Long chết | Rơi chắc chắn, "bốc thăm trong người có công" |
| Hạng 1 xếp hạng tuần Xích Long | 1 viên Cấp 3 (+ Thần Kiếm Y, 1000 Linh Thạch, 3 phù lôi); hạng 2–3: 2/1 mảnh |
| Tán Tu Chiến Bảng | Top 1 ngày (chốt 22:00): 1 viên Cấp 3, 1 Cấp 1, Xích Phi Kiếm, 500 Linh Thạch; hạng 2–3: 1 mảnh. 10 lượt/ngày |
| Đại Hội (đấu giải) | Hạng 1 Luyện Khí: 1 viên Cấp 3; hạng 2–4: 1 mảnh |
| Đổi điểm Đại Hội | 30 điểm = 1 mảnh (khoá); thắng 1 trận = 1 điểm [Chưa xác minh] số điểm/thắng |
| Sỹ Sách Điện | Hạ boss tối Chủ Nhật: tổng 10 mảnh mỗi bản; top 1–3: 3/2/1 mảnh |
- Ghép: 3 mảnh → 1 viên ở Đan Lô, 70%, thất bại mất mảnh; kèm 3 Bảo Mệnh Phù: 100%.
- Con đường thực tế nhất: ~90 điểm Đại Hội → 3 mảnh → ghép. Huyết Xích không rơi Yêu Đan.

## 6. Tổ đội ở bản đồ thường [Client]
Lợi ích rất ít: không đánh nhầm đồng đội (`targeting.js`), HUD thanh HP/trạng thái đồng đội. KHÔNG thấy chia kinh nghiệm/rơi đồ/buff theo đội (lời mời ghi rõ "không chia ké Đạo Hạnh hay chiến lợi phẩm"). Tổ đội chỉ có giá trị ở phó bản. [Chưa xác minh] phía máy chủ có thưởng theo đội ở map thường không. Chi tiết: `docs/RESEARCH_PARTY.md`.

## 7. Boss Xích Long
Plan nghiên cứu riêng: `docs/PLAN_AUTO_XICH_LONG.md`. Tóm tắt: 100.000 HP, va chạm 230, hỏa cầu tầm 460, hồi sinh 3 giờ, rơi chỉ cho người đánh đòn chót → auto một tài khoản không khả thi; hướng thực tế là theo dõi boss trên dashboard và (nếu xác minh được né chiêu) gây sát thương cho xếp hạng tuần.

## 8. Việc còn lại
1. Bảng số liệu đầy đủ từng trang bị/kỹ năng/bí tịch (chỉ số, giá, nguồn, yêu cầu cảnh giới) → có thể sinh tự động từ `ITEMS`/`SKILLS`.
2. `docs/RESEARCH_DROPS.md`: quái theo map và món rơi.
3. Bộ đếm giết/nhặt trong runner để đo tỉ lệ thật; hiển thị `Loot.stoneToday()` trên dashboard.
4. Tính lại dps khả dụng ở Luyện Khí 13 gồm đòn thường (`docs/RESEARCH_HUYET_XICH.md` mục 12).
