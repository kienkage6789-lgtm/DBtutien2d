# Nghiên cứu phó bản Huyết Xích Cấm Địa ("Huyết Sát")

Cập nhật: 2026-10-11. Nguồn: đọc mã client chính thức ở `vendor/tutien2d-public-client/2026-10-06` (chỉ đọc) và truy vấn dữ liệu bản đồ/quái bằng môi trường offline. KHÔNG chạm game thật.

Nhãn: **[Client]** đọc từ mã/dữ liệu client; **[Suy ra]** tính từ dữ liệu client, chưa kiểm chứng; **[Chưa xác minh]** cần thử live.

## 1. Mục đích
Phó bản tổ đội để **kiếm nguyên liệu đột phá Trúc Cơ** (từ Luyện Khí tầng 13). [Client] `systems/huyet_sac.js`:
- Trúc Cơ Đan = 50 Trúc Cơ Thảo + 30 Địa Linh Hóa Quả + 1 Yêu Đan Cấp 3 trở lên. Đột phá: 70%; kèm 5 Bảo Mệnh Phù: 100%. Thất bại mất đan, giữ cảnh giới.
- Bảo Mệnh Phù = 12 Cổ Bích Mộc + 12 Trấn Thần Thạch (mỗi lá).
- Đan luyện ở Đan Lô trong làng; nguyên liệu thu hoạch trong Huyết Xích.

## 2. Luật vào [Client]
- Lệnh: tổ đội gửi `{op:"party", act:"enter_dungeon", dungeonId:"rung_mang_xa"}`. Đội trưởng xác nhận; thu **100 Linh Thạch** và tính **một lượt hôm nay** của từng thành viên hợp lệ đang ở **Miếu Hoang** (sảnh chờ).
- Tổ đội **2-6 người** (`minMembers:2, maxMembers:6`). Được vào một mình nhưng game cảnh báo "Ba con đầu đàn đánh rất đau".
- **Thời gian**: 900 giây mỗi lượt (`durationSec`). Hết giờ -> `dungeon_closed why:"expired"`.
- **Lượt/ngày**: 5 (4 nếu đã Trúc Cơ). Ngày đổi theo giờ UTC+7 (`HuyetSac.day`).
- Rời: `party act:"leave_dungeon"` (không hoàn phí/lượt, vật phẩm đã thu vẫn giữ).
- Cấm Địa sụp: có đếm ngược `collapseAt`; sụp thì cả đội bị đưa ra Miếu Hoang (`why:"collapsed"`).
- [Chưa xác minh] ai trả phí khi đội trưởng khác thành viên, thành viên không ở Miếu Hoang thì sao, lượt có bị trừ khi vào lại, `collapseAt` bắt đầu từ lúc nào.

## 3. Ba tầng [Client] (truy vấn `MapData`)
| Tầng | Bản đồ | Điểm vào (tx,ty) | Cổng đi tiếp | Quái | Nguyên liệu (số điểm thu) |
|---|---|---|---|---|---|
| 1 | `rung_mang_xa` Rừng Mãng Xà | (18,26) | hàng 0: (18,0),(19,0) -> tầng 2 | 7 Xích Tinh Mãng, 1 **Xích Mãng Vương**, 1 Hắc Y Tà Tu | 6 `bich_ngoc_chop` |
| 2 | `mach_dat_dong` Lòng Đất (cạm bẫy rễ quỷ) | (20,27) | (39,14),(39,15) -> tầng 3; (20,29),(21,29) lùi tầng 1 | 4 Thạch Yêu, 1 Thạch Giáp Yêu, 1 **Thạch Mạch Vương** | 6 `tran_than_thach`, 5 `dia_linh_qua` |
| 3 | `dam_lay_boss` Đầm Lầy | (2,14) | (0,14),(0,15) lùi tầng 2 | **U Minh Cự Mãng** (boss), 2 Xích Tinh Mãng, 1 Hắc Y Tà Tu | 12 `truc_co_thao` |

- Bản đồ 40x30 ô. Tầng 1 và 2 **niêm phong**: nguyên liệu bị khoá cho tới khi hạ hết quái còn sống trong bản đồ (`HuyetSacUI.sealed`). Tầng 3 không dùng niêm phong ở UI.
- Thu hoạch: đứng yên ~3 giây (`huyet_thu ms:3000`); di chuyển quá ~12 px thì huỷ (`huyet_thu_huy`). Điểm đã thu nằm trong `harvested`.
- Không hồi sinh quái trong phó bản (`respawnSec=0`).

## 4. Quái và boss [Client]
Thông số gốc trong `ENEMY_DEFS`; trong phó bản (`e.huyetSac`) **boss có `hp x2`, `contactDmg x2`**, quái có chiêu vồ có `aggro >= 360` và `leashRange = 4000` (đuổi cả bản đồ).
| Quái | Cấp | HP gốc | HP trong phó bản | Va chạm (x2 với boss) | Chu kỳ đánh | Ghi chú |
|---|---|---|---|---|---|---|
| Xích Tinh Mãng | 10 | 205 | 205 | 14 | 0,85 s | nhổ độc: 28%, hồi 5 s, tầm 160, 8 sát thương + 4/s trong 5 s, tối đa 2 mục tiêu |
| Xích Mãng Vương (đầu đàn) | 12 | 1900 | **3800** | **68** | 0,72 s | `pounce` |
| Thạch Yêu | 3 | 18 | 18 | 9 | 0,9 s | |
| Thạch Giáp Yêu | 1 | 30 | 30 | 16 | 0,72 s | tầm thấy 320 |
| Thạch Mạch Vương (đầu đàn) | 12 | 2570 | **5140** | **80** | 0,8 s | `pounce`, chậm (tốc độ 44) |
| U Minh Cự Mãng (boss cuối) | 13 | 3370 | **6740** | **92** | 0,62 s | `pounce`, tầm thấy 320 |
| Hắc Y Tà Tu | 12 | 322 | 322 | 15 | 0,95 s | `khongNhan`, `nhiemVu` (liên quan nhiệm vụ mảnh giấy) |

**Chiêu vồ (`pounce`)** [Client]: sau khi đứng sững >= 1,6 s ở trạng thái đuổi và mục tiêu cách trong (đỉnh tầm, 420 px], boss gồng **0,75 giây** rồi lao tới **vị trí mục tiêu tại lúc bắt đầu gồng**; nếu nhân vật còn trong bán kính 40 px lúc tiếp đất thì nhận sát thương = `contactDmg` của boss (92 với U Minh Cự Mãng). Hồi chiêu 4 s. => **Né được bằng cách rời điểm đó trong 0,75 giây.** [Suy ra]
**So với máu**: Luyện Khí tầng 13 có HP gốc **300**, MP 250 (chưa tính trang bị). U Minh Cự Mãng gây 92 mỗi 0,62 s khi áp sát (~148 sát thương/giây): **khoảng 4 cú đánh là chết** [Suy ra]. Xích Mãng Vương 68/lần (5 lần). Đây là lý do game khuyên tổ đội.

## 5. Gói tin [Client]
- Client -> máy chủ: `party` với `act` = `enter_dungeon {dungeonId}`, `leave_dungeon`; thu hoạch nguyên liệu qua `cmd resource.harvest {propId}` (trả `{ok, retryAfter?, regrowAfter?, why?}`, mỗi lần "+1 <vật phẩm>" ở bản đồ thường). [Chưa xác minh] trong Huyết Xích có dùng `resource.harvest` hay đường `huyet_thu` riêng.
- Máy chủ -> client: `party/huyet_state {used, expiresAt, collapseAt, harvested[], serverNow}`; `party/huyet_thu {propId, ms}`; `party/huyet_thu_huy {why}`; `party/dungeon_closed {why: expired|collapsed}`; tổ đội: `invite {inviteId,fromId,fromName,expiresAt}`, `accepted`, `declined`, `expired`, `deny {why}`. Mời/nhận: `party act:"invite" {targetId}`, `accept|decline {inviteId}`, `leave`, `kick {memberId}`.
- Đột phá: `cmd breakthrough {useBaoMenh}` -> `{ok, success, why}`.

## 6. Khối lượng thu hoạch mỗi lượt và số lượt cần [Suy ra]
Giả định mỗi điểm thu cho 1 vật phẩm (như `resource.harvest` thường) và thu đủ mọi điểm:
- Mỗi lượt: 12 Trúc Cơ Thảo, 5 Địa Linh Hóa Quả, 6 Trấn Thần Thạch, 6 `bich_ngoc_chop` (chưa xác nhận ra Cổ Bích Mộc).
- Trúc Cơ Đan cần 50 Trúc Cơ Thảo (5 lượt) và 30 Địa Linh Hóa Quả (6 lượt) => **tối thiểu 6 lượt**, với giới hạn 5 lượt/ngày là **2 ngày**. Chưa tính 1 Yêu Đan Cấp 3 (nguồn khác).
- Muốn đột phá 100%: thêm 5 Bảo Mệnh Phù = 60 Cổ Bích Mộc + 60 Trấn Thần Thạch => ~10 lượt.

## 7. Điều bot hiện có và còn thiếu
Có: đăng nhập, di chuyển theo ô và qua cổng map, Auto đánh quái, hồi phục sau gục (cổng an toàn), hurt/gục, thu hoạch `resource.harvest` (đã dùng cho việc hằng ngày).
Thiếu hoàn toàn: **tổ đội** (mời/nhận/rời/vào phó bản), **phối hợp nhiều tài khoản**, **né chiêu vồ** (cần đọc vị trí và hướng boss và di chuyển trong 0,75 s), kiểm soát khoảng cách với boss (kiting), dùng thuốc hồi, quy tắc "dọn sạch rồi mới thu hoạch", đếm giờ 900 s, xử lý `dungeon_closed`, theo dõi `harvested`.
Bị khoá theo `AGENTS.md`: lệnh hồi sinh (`RESPAWN_PROTOCOL_UNAVAILABLE`) — gục trong phó bản chưa có đường xử lý an toàn.

## 8. Rủi ro chính
1. **Gục**: boss gây ~148 sát thương/giây khi áp sát, nhân vật 300 HP; hồi sinh chưa xác minh. Gục có thể mất kinh nghiệm (`down {lostExp}`).
2. **Tốn lượt và 100 Linh Thạch** nếu vào mà thất bại giữa chừng (không hoàn).
3. Quái đuổi toàn bản đồ (`leash 4000`) nên không thể "chờ ở xa".
4. Nhiều tài khoản cùng một đội: mỗi tài khoản một phiên, nhiều IP/proxy; hành vi tổ đội từ cùng một nhóm tài khoản chưa rõ có bị phát hiện không. [Chưa xác minh]

## 9. Điều cần xác minh live (nhỏ, an toàn, từng bước)
1. Hình dạng thật của `huyet_state` và `huyet_thu` khi vào phó bản một mình (đã chấp nhận mất 100 Linh Thạch và một lượt).
2. Thu hoạch dùng lệnh nào, mỗi điểm cho mấy vật phẩm, có bị niêm phong không.
3. Vị trí/hướng boss được gửi thế nào cho client (để bot né chiêu): cần gói `snap2/m` có toạ độ quái.
4. Quy tắc phí/lượt khi đội trưởng khác thành viên; thành viên có tự vào theo không.
5. Gói thật khi gục trong phó bản (`down`, `dn:1`) và đường ra.

## 10. Đề xuất lộ trình
1. **Chỉ đọc**: hiển thị trên dashboard trạng thái phó bản (`huyet_state`, giờ còn lại, lượt đã dùng, nguyên liệu đã thu) khi tài khoản đang ở trong. Không gửi lệnh.
2. **Lập đội giữa các tài khoản của chủ dự án** (mời/nhận/rời), thử với hai tài khoản ở Miếu Hoang, chưa vào phó bản.
3. **Vào một lượt có kiểm soát** (một tài khoản, người giám sát tại chỗ), chỉ ghi lại gói tin (đã che dữ liệu) và dừng ngay khi `hurtCount` tăng.
4. Sau khi hồi sinh được xác minh: tự động hoá tầng 1 (7 Xích Tinh Mãng + Xích Mãng Vương) với né chiêu vồ; rồi tầng 2; boss cuối làm sau cùng.

## 11. Đánh boss mà không dính sát thương: khả thi đến đâu (2026-10-11)
Nguồn [Client]: `core/config.js` (`SKILL_POWER`, `BASE_ATK`), `systems/skills.js` (`powerDmg = round(coef × power × mult)`), `entities/enemy.js`.

**Né (kiting) về cơ học [Suy ra]**
- Tốc độ người ~101–112 px/s, boss 44–62 px/s: chạy thoát được. Boss `leash 4000` nên không bỏ đuổi, nhưng chỉ cần giữ khoảng cách > 26 px (HIT_RADIUS) thì đòn va chạm không trúng.
- Không né va chạm bằng phản xạ: telegraph chỉ 0,18 s, nhỏ hơn độ trễ mạng. Phải giữ khoảng cách từ trước, không để boss áp sát.
- Chiêu vồ có báo trước 0,75 s và toạ độ rơi (`jx,jy`, gồng `jw`, seq `js`) được máy chủ gửi trong gói `m`: bot đọc được và rời bán kính 40 px là né được. [Chưa xác minh] live (gói thật, độ trễ).
- Tầm kỹ năng 92–246 px, vượt xa 26 px nên đánh từ xa được. Hỏa Cầu có tầm 124 px.

**Sát thương của mình: đây là chỗ nghẽn [Suy ra]**
- Luyện Khí tầng 13: `SKILL_POWER = 15` (Trúc Cơ sơ kỳ 18, trung kỳ 21).
- Hỏa Cầu: coef 1,8 × 15 = **~27 sát thương/phát**, hồi 6 s, tốn 14 MP => ~4,5 sát thương/giây, chưa tính thiêu đốt (dps 0,15 coef × 3 s, nhỏ).
- U Minh Cự Mãng có **6740 HP**, thời gian 900 s => cần trung bình **>= 7,5 sát thương/giây** chỉ riêng boss cuối, chưa tính tầng 1 (Xích Mãng Vương 3800 HP) và tầng 2 (Thạch Mạch Vương 5140 HP) và quái lẻ. Tổng ~15.700 HP đầu đàn trong 900 s ≈ 17 dps.
- MP 250 / 14 = ~18 phát Hỏa Cầu (~490 sát thương) rồi cạn. Hồi MP chỉ có từ Đan Linh (bí tịch) / chỉ số trang bị `mpRegen`, thiền; chưa tìm thấy hồi MP tự nhiên đáng kể trong chiến đấu [Chưa xác minh].
- Kết luận: **với một kỹ năng và 250 MP thì KHÔNG hạ nổi boss bằng kite thuần trong 900 s.** Cần: nhiều kỹ năng song song (cộng dps), phẩm cấp/tầng cao hơn (Trúc Cơ: power 18–21), trang bị tăng sát thương/hồi MP, thuốc hồi MP, và nhiều người trong đội (sát thương cộng dồn, aggro chia).
- Vũ khí tăng sát thương (`WEAPON_BOOST_MULT`, `damageMultiplier`) chưa khảo sát; nên đọc tiếp trước khi kết luận cuối.

**Hệ quả cho bot**
1. Phải đo trên nhân vật thật: cảnh giới, danh sách kỹ năng có sách, MP/hồi MP, trang bị => tính dps tối đa bền vững.
2. Nếu dps bền vững < ~17 thì phó bản không thể hạ hết một mình; chỉ tổ đội đông (2–6) mới khả thi, mỗi người kite riêng và boss chia mục tiêu.
3. Rủi ro lớn nhất vẫn là hồi sinh bị khoá: một cú trượt = gục = không có đường xử lý an toàn.
4. Lộ trình an toàn: (a) chỉ đọc trạng thái nhân vật/kỹ năng, (b) tính dps trên giấy, (c) mới bàn tới né chiêu vồ.

## 12. Hiệu chỉnh mục 11: bỏ sót đòn đánh thường (2026-10-12)
[Client] `entities/player.js` (`meleeDamage`), `systems/skills.js` (`boostWeapon`), `systems/items.js`.
- Đòn đánh thường = `baseAttack(realm)` + `atkBonus` trang bị (hoặc `baseAttack + weapon.damage` nếu vũ khí có `damage`), mỗi `attackTime` giây; tầm đánh = 26 + `reachBonus`.
- Luyện Khí 13: `baseAttack` = 4. Vũ khí có `requireRealm` <= Luyện Khí 10, atk +5, reach +73, `attackTime` 0,9 => (4+5)/0,9 ≈ **10 sát thương/giây ở tầm ~99 px**, lớn hơn Hỏa Cầu (~4,5/giây). Mục 11 chỉ tính kỹ năng nên ước lượng dps quá thấp; cần tính lại cùng đòn thường. [Suy ra] Chưa xác minh đòn thường có dùng được trong lúc kite (đứng yên khi vung, `hitAt`).
- Kỹ năng có `boostWeapon`: sát thương x1 khi có đúng vũ khí/vật phẩm chỉ định, x0,5 nếu không (`WEAPON_NO_BOOST_MULT`). Vũ khí ảnh hưởng kỹ năng chỉ qua `boostWeapon`, không qua tầm đánh.
