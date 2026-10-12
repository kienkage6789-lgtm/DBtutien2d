# Kế hoạch nghiên cứu: Auto boss Thần Thú Xích Long

Cập nhật: 2026-10-12. Nguồn: `vendor/tutien2d-public-client/2026-10-06` (`entities/enemy.js`, `world/map_long_uyen.js`, `systems/loot.js`, `systems/top_boss.js`, `ui/hoatdong.js`, `net/gateway.js`), CHỈ ĐỌC. Chưa chạm game thật.
Nhãn: **[Client]** đọc từ mã client; **[Suy ra]** tính từ dữ liệu client; **[Chưa xác minh]** cần thử live.

## 1. Dữ kiện [Client]
| Mục | Giá trị |
|---|---|
| Loại / bản đồ | `than_thu_xich_long`, map `long_uyen`, điểm sinh `ttxl_1` (cấp 14) |
| HP | **100.000** |
| Sát thương va chạm | **230**, nhịp 0,62 s, tầm trúng (`hitRadius`) 78 px, thân (`bodyRadius`) 44 px |
| Tốc độ / dây xích | 52 px/s / `leashRange` 300 (quái thường ở đây đuổi không quá 300 px) |
| Hộ vệ | 3 Xích Nhãn Ngưu (`xich_nhan_nguu_1..3`), phải hạ trước |
| Hồi sinh | **10.800 s (3 giờ)** |
| Rơi đồ | `lootLastHitOnly`: **chỉ người đánh đòn chót** nhận rơi; Hoàng Lân Giáp 20%, Xích Long Huyết 20%, pháp bảo 0,5% (+ Yêu Đan/Linh Thạch 100–500, tỉ lệ khác bị ẩn) |
| Xếp hạng tuần | `TopBoss`: chốt 22:00 (UTC+7) mỗi tuần theo sát thương gây ra; top 1–3 nhận Thần Kiếm Y, Yêu Đan cấp 3 hoặc mảnh, Linh Thạch 1000/700/500, bùa |

Chiêu thức:
- **Hỏa cầu (`fireNova`)**: hồi 2,4 s, gồng 1,1 s, tầm **460 px**, bán kính nổ 68 px, 90 sát thương + thiêu 16/giây trong 6 s (~186 tổng).
- **Long Viêm Bạo Kích (`baoKich`)**: hồi 9 s, báo trước 8 s?, bán kính 150 px, tối đa 5 mục tiêu, 2–4 đòn, hệ số 1,3, kèm dot. (`delay:8` chưa rõ nghĩa: chưa xác minh.)
- **Thiên Hỏa Diệt Thế (`tuyetChieu`, "mưa lửa")**: ở khoảng 5–10% HP, gồng 3 s, bán kính 280 px.
- **Long Viêm Lưu Tinh (`luuTinh`)**: ở khoảng 20–25% HP, gồng 1,4 s, bán kính 76 px, 2 điểm mỗi người, rải ~10, hệ số 3.

## 2. Đánh giá khả thi [Suy ra]
1. **HP 100.000.** Với ~10 sát thương/giây (đòn thường tốt nhất ở Luyện Khí 13, xem `docs/RESEARCH_HUYET_XICH.md` mục 12) cần ~10.000 giây ≈ 2,8 giờ cho một người; dài hơn thời gian sống hợp lý và chưa biết boss có hồi máu khi bị bỏ lại không (chưa xác minh). Một mình hạ boss là **không thực tế**; boss này thiết kế cho nhiều người chơi cùng đánh.
2. **Máu mình 300 (Luyện Khí 13)**: một va chạm 230 + hỏa cầu 186 là chết sau 2 đòn. Hỏa cầu tầm 460 px vượt mọi tầm đánh (kỹ năng tối đa 246 px), nên không thể "đứng ngoài tầm" mà vẫn đánh; phải né theo báo trước (gồng 1,1 s).
3. **Đòn chót quyết định rơi đồ** nên auto có đánh nhiều cũng chưa chắc nhận đồ: cạnh tranh với người chơi khác, không kiểm soát được.
4. **Xếp hạng tuần** chỉ cần gây sát thương, không cần hạ boss: đây là mục tiêu thực tế hơn nếu giữ sống sót được. Cần biết cách máy chủ tính "sát thương gây ra" (chưa xác minh).
5. Hồi sinh vẫn bị khoá (`RESPAWN_PROTOCOL_UNAVAILABLE`): một lần gục là mất lượt và rủi ro mất kinh nghiệm.

Kết luận sơ bộ: **hạ boss bằng auto một tài khoản: không khả thi ở cảnh giới hiện tại.** Hướng có thể nghiên cứu tiếp: (a) quan sát và theo dõi trạng thái boss (hiện diện, HP%, đếm ngược hồi sinh) để báo trên dashboard; (b) gây sát thương an toàn cho xếp hạng tuần bằng đánh rồi rút (chỉ khi xác minh được né chiêu).

## 3. Các giai đoạn
**G0 – Ngoại tuyến (làm được ngay, không chạm game)**
- Trích đầy đủ `ENEMY_DEFS.than_thu_xich_long` + hộ vệ + `tuyetChieu/luuTinh` (trường `delay`, `from/to`) và logic `entities/enemy.js` thành bảng số liệu.
- Mô phỏng ngoại tuyến (không mạng) vòng AI của Xích Long: nhịp hỏa cầu, vùng nổ, thời gian né tối thiểu, tốc độ chạy so với 52 px/s; cho ra "cửa sổ né" và dps tối thiểu cần để kéo hạng.
- Xác định các trường gói `m` mang báo trước chiêu (như `jx,jy,jw,js` của chiêu vồ; `bs` cho bạo kích) để bot đọc được.

**G1 – Chỉ quan sát trên game thật (không gửi lệnh chiến đấu)**
- Với tài khoản đang đứng xa (ngoài `aggro` 320 px), ghi lại đã che dữ liệu: boss còn sống không, HP%, thời điểm chết/hồi sinh (đối chiếu "Hồi sau" trong Hoạt Động), số người đang đánh.
- Hiện trên dashboard: trạng thái boss, đếm ngược 3 giờ. Chưa xác minh cách lấy HP% của quái (`m` có `hp` phần trăm?).

**G2 – Xác minh báo trước chiêu (giám sát tại chỗ)**
- Một tài khoản thử, đứng ngoài tầm hỏa cầu, ghi gói khi boss đánh người khác/hộ vệ: các trường báo trước, độ trễ mạng, thứ tự.
- Điều kiện dừng: `hurtCount` tăng, HP thấp, bị khoá hồi sinh.

**G3 – Né thử nghiệm (nếu G2 cho dữ liệu)**
- Chỉ tiến hành khi có người giám sát và chủ dự án đồng ý rủi ro gục. Thử hit-and-run: vào tầm, đánh, rút khỏi vùng nổ trong cửa sổ 1,1 s, ghi sát thương nhận được.

**G4 – Quyết định**
- Nếu dps không đủ kéo hạng tuần hoặc né không ổn định: dừng ở G1 (chỉ theo dõi/cảnh báo), không tự đánh boss.

## 4. Việc cần xác minh live
- `delay:8` của bạo kích, hồi máu khi bỏ lại, cách tính sát thương cho xếp hạng tuần, `tuyetChieu/luuTinh` kích hoạt theo HP% thật, gói báo trước từng chiêu, giới hạn tấn công từ xa, ai nhận rơi khi nhiều người đánh.

## 5. Ràng buộc an toàn (AGENTS.md)
Mỗi tài khoản một phiên; không gửi tấn công/skill/di chuyển ngoài nhiệm vụ; không retry mù; theo dõi `hurtCount` và dừng ngay khi tăng; không bypass portal; hồi sinh khoá.
