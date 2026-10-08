# Đặc tả vòng lặp "Tự Động" cho bot (phương án A)

Ngày: 2026-10-08. Nguồn: `vendor/tutien2d-public-client/2026-10-06/src` (`scenes/world.js`, `systems/targeting.js`, `systems/skills.js`, `entities/player.js`, `net/gateway.js`, `core/config.js`). Mã đã minify; đã đọc phần quyết định hành vi, chưa đọc mọi nhánh phụ.

**Quy ước độ tin cậy.** Mỗi mục ghi một trong ba nhãn:
- **[Đọc được]**: lấy trực tiếp từ mã client.
- **[Suy ra]**: kết luận hợp lý từ mã nhưng chưa kiểm chứng trên game thật.
- **[Chưa biết]**: chưa có dữ liệu; phải đo hoặc đọc thêm.

## 1. Bản chất

**[Đọc được]** "Tự Động" là cờ `autoOn` trong cảnh `world.js` của client; server không có lệnh auto. Mỗi khung hình, nếu `autoOn` bật, client chạy hàm tick auto (gọi là `Q` trong mã đã minify) để chọn mục tiêu, đi tới, rồi đánh. Kết quả duy nhất server nhìn thấy là các gói `move`, `attack`, `skill`. Bot muốn "auto" thì tự sinh ra đúng các gói đó với cùng nhịp và điều kiện.

**[Đọc được]** Client giữ hầu hết trạng thái chiến đấu cục bộ: cooldown kỹ năng, trừ MP/SP khi niệm, trạng thái tấn công. Server vẫn là nguồn sự thật cho sát thương, quái chết (`kill`), HP khi bị đánh (`hurt`) và kết quả kỹ năng (`skill_res`). Mức độ server kiểm tra lại cooldown/MP của client **[Chưa biết]**.

## 2. Hằng số (từ `core/config.js`) **[Đọc được]**

| Nhóm | Giá trị |
|---|---|
| `TARGET` | `RANGE:150`, `REACH_PAD:40`, `KEEP_PAD:120`, `APPROACH_TIME:8` (giây) |
| `PLAYER` | `SPEED:68`, `RUN_MULT:1.65`, `WALK_MULT:1.485`, `HITBOX_W:16`, `HITBOX_H:12`, `ATTACK_TIME:0.8`, `REACH:26`, `SPELL_GAP:1.2`, `CAST_MOVE_MULT:0.6`, `CAST_RANGE_SLACK:40` |
| `ENEMY` | `HIT_RADIUS:26`, `RESPAWN_SEC:12`, `LEASH_RANGE:260` |
| `THUNDER` (Lôi Chưởng) | `COOLDOWN:5`, `CAST:0.34`, `RANGE:96`, `MP_COST:12`, `SP_COST:5` |
| `RESOURCES` | `SP_PER_SEC:0.75`, `BP_REGEN_DELAY:3` |
| `MEDITATE` | `MP_PER_SEC:6`, `HP_PER_SEC:4`, `SP_PER_SEC:3`, `BP_PER_SEC:18` |
| `DOWNED` | `AUTO_HOME:60` (giây), `HOME_MAP:"tan_vien"`, `HOME_HP:0.6`, `ONSPOT_HP:0.35`, `MAX_REVIVES:3` |
| `FLY` | `SPEED_MULT:1.9`, `REALM_MIN:"luyen_khi_5"` |

Tốc độ đi bộ thực tế = `SPEED` × hệ số (chạy ×1.65, đi ×1.485); bay nhân thêm `FLY.SPEED_MULT` hoặc `fly.speed` của đồ bay.

## 3. Tick auto: thứ tự quyết định **[Đọc được]** (trừ ghi chú)

Mỗi tick (dt) khi `autoOn`:

1. **Điều kiện thoát sớm** (không làm gì):
   - đang có thao tác thủ công `manualCast`;
   - chưa tới `autoNghiDen` (khoảng nghỉ ngắn client đặt sau một số sự kiện; thời gian cụ thể **[Chưa biết]**);
   - đang ở khu "giữ yên" của một số hoạt động (`HuThienUI.giuYen`, `YenLangUI.giuYen`): đây là các vùng không được tự đánh.
2. **Chế độ thủ công chồng lên auto**: nếu người chơi đang tự di chuyển/đang tiếp cận một mục tiêu đã chọn, mục tiêu auto chính là mục tiêu thủ công đó và auto chỉ xả kỹ năng, không tự đổi hướng.
3. **Chọn mục tiêu `l`** theo thứ tự ưu tiên đầu tiên khớp (xem mục 4).
4. Nếu có mục tiêu:
   - cập nhật combo của hotbar theo loại mục tiêu (người / boss / quái);
   - **trường hợp đang đi tiếp cận bằng tay**: chỉ thử xả kỹ năng (`q(player, l, true)`); không đứng lại;
   - **ngược lại**: thử xả kỹ năng theo luân phiên; nếu không xả được và mục tiêu trong tầm đánh thường thì đứng lại, quay mặt, `Player.attack`; nếu chưa trong tầm thì tìm đường tới mục tiêu.
5. **Đi tới mục tiêu**: gọi lại tìm đường mỗi 0,4 giây (`autoPathTimer`), hoặc khi đổi mục tiêu, hoặc khi đường đi hết. Đường tìm bằng `Pathfinder.route` với hitbox `16×12`.

## 4. Chọn mục tiêu **[Đọc được]**

Với bot chỉ đánh quái, bỏ các nhánh PvP/đấu/tông môn chiến. Thứ tự của client:

1. đối thủ đang đấu tay đôi (duel) còn đứng;
2. đối thủ người (`doiThuNguoi`) trong `TARGET.RANGE` (150);
3. mục tiêu hiện tại khi người chơi đang tự điều khiển;
4. mục tiêu tông môn chiến (nếu đang diễn ra);
5. theo **ưu tiên của hotbar** (`uuTien`):
   - `boss`: quái gần nhất thỏa `isBoss` hoặc tên khớp `/Yêu Thú Cấp/`;
   - `quai`: quái gần nhất **không** phải boss;
   - `nguoi`: người chơi thù địch gần nhất trong tầm (bỏ qua với bot);
   - `mau`: quái có tỉ lệ `hp/hpMax` thấp nhất trong `TARGET.RANGE`, hòa thì gần hơn;
   - `auto` (mặc định): **quái còn sống, không phải người (`def.human`), gần nhất, không giới hạn khoảng cách**.

Mọi nhánh loại quái `dead` và quái `def.human`. Bộ lọc `ChinhDao.danhDuoc` (chính đạo/ma đạo) áp dụng khi tạo danh sách mục tiêu **[Suy ra]**: có quái bị loại tùy phe; chi tiết **[Chưa biết]**.

**Đặc tả cho bot (mặc định):** chọn quái sống gần nhất (theo khoảng cách Euclid từ tâm nhân vật), không phải người, có thể có biến thể `boss`/`quai`/`mau` cấu hình được. Giữ mục tiêu đã chọn đến khi chết hoặc rời tầm giữ (`RANGE + REACH_PAD + KEEP_PAD`, khoảng 310) rồi mới chọn lại, để tránh đổi mục tiêu liên tục. Đây là **thiết kế đề xuất cho bot**: danh sách mục tiêu thủ công của client (`Targeting.refresh`) có độ trễ kiểu này, nhưng nhánh auto mặc định (`E(player)`) chỉ chọn lại quái gần nhất ở mỗi tick, nên client auto thật có thể đổi mục tiêu thường xuyên hơn bot **[Suy ra]**.

## 5. Tầm đánh và tiếp cận

### Thiết kế P2 — approach (pure + runner + live probe)

P2 không nối vào state machine training và không có lệnh attack/skill. `computeApproachGoal` trong `packages/automation-engine/src/auto/approach.ts` tính `reachLimit = PLAYER.REACH + weaponReachBonus + (bodyRadius ?? 0)`, ưu tiên vị trí hiện tại nếu đã trong tầm và walkable, sau đó quét 16 điểm xác định trên vòng lùi `margin` quanh quái. Ứng viên được lọc bằng collision/hitbox 16×12 và, khi có, chọn theo độ dài đường thật; cuối cùng mới thử `findNearestWalkableTarget(..., 4)`. `none` trả `goal:null`; không truyền tọa độ quái bị chặn cho move-to.

`ApproachTracker` dùng vị trí xác thực mới để báo `arrived`, giữ timeout 8 giây, lập kế hoạch lại không thường xuyên hơn 400 ms khi quái dịch ít nhất 24 px, mất mục tiêu khi quái chết hoặc rời vùng `TARGET_RANGE + TARGET_REACH_PAD + TARGET_KEEP_PAD`, và chỉ báo `unreachable` sau hai kết quả `none` liên tiếp. `ARRIVAL_CONFIRM_MS=0` vì mỗi tick đã dựa trên vị trí authoritative mới, nên không thêm dwell giả.

`runApproach` chạy nhịp 100 ms, dùng `selectTarget` auto, vitals fresh ≤ `VITALS_ATTACK_MAX_AGE_MS`, snapshot quái/map fresh, và dependency-inject `startMoveTo`/cancel. Replan luôn hủy và chờ operation cũ trước khi đặt operation mới; mọi move vẫn đi qua `sendMove(..., 'walk', ...)`. Hurt, HP giảm, gục, mất kết nối/context, bot dừng hoặc timeout đều dừng và hủy move-to. Harness `TUTIEN_PROBE_APPROACH=1` chỉ chạy một lần sau 20 giây, lọc boss/human/tuSi/contact damage, khoảng cách 120–450 px, đường ≤480 px và aggro của quái khác; khi `arrived` chỉ đứng yên 3 giây.

- **Tầm đánh thường [Đọc được]**: `scenes/world.js` kiểm tra `khoảng cách(C(player), mục tiêu) <= Player.reach + (target.def.bodyRadius || 0)` trong `onPlayerSlash`; `Player.reach = PLAYER.REACH (26) + reachBonus của vũ khí`. Riêng `systems/targeting.js` tạo entry quái với bán kính `PLAYER.REACH` và không cộng `bodyRadius` khi dựng danh sách, nên tầm chọn gần và tầm hit là hai phép kiểm tra khác nhau. Quan hệ chính xác của `C(player)` với hitbox/render anchor **[Chưa biết]**.
- **Tầm kỹ năng [Đọc được]**: `def.range` của kỹ năng; `onPlayerSpell` cho phép dư `CAST_RANGE_SLACK` (40) khi chọn mục tiêu, kỹ năng có `autoFoe` tự đổi sang quái gần nhất nếu mục tiêu hiện tại xa hơn.
- **Hết giờ tiếp cận**: `TARGET.APPROACH_TIME = 8` giây cho một lần đi tới mục tiêu chọn bằng tay. Với auto: tìm đường lại mỗi 0,4 giây, không có hết giờ rõ ràng; bot nên tự đặt giới hạn (đề xuất 8 giây rồi bỏ mục tiêu và đánh dấu "không tới được") **[Suy ra]**.
- **Quái bỏ chạy/leash**: quái có `LEASH_RANGE:260` quanh điểm xuất hiện **[Suy ra]**.
- **Tiếp cận trong lúc niệm**: tốc độ giảm theo `CAST_MOVE_MULT = 0.6` **[Đọc được]**.

## 6. Đánh thường **[Đọc được]**, trừ ghi chú

1. `Player.attack(player, target)` đặt trạng thái `attack` trong `attackTime` (mặc định `PLAYER.ATTACK_TIME = 0.8` giây, vũ khí có thể đổi).
2. Đòn "chạm" tại `hitAt × attackTime` (mặc định `0.35 × 0.8 = 0.28` giây). Tại thời điểm đó `onPlayerSlash` gọi `Gateway.attack()`.
3. **Gói gửi lên**: `{op:"attack", targetId:String(id)}`, `targetId` lấy từ `Targeting.currentEnemy()` (quái đang là mục tiêu); nếu không có thì gửi `{op:"attack"}` trống.
4. Không có lệnh theo dõi trúng/trượt riêng ngoài `hurt`/`kill` và phản hồi sát thương (hiệu ứng) **[Chưa biết]** payload.
5. Trong lúc ở trạng thái `attack` hoặc `pose` (niệm), không phát đòn mới (`Player.attack` trả `false`).

**Đặc tả cho bot:** gửi `attack{targetId}` mỗi `attackTime` giây khi trong tầm, không chờ ACK; không gửi lại nếu đã có `attack` đang chờ xác nhận (dùng `OperationLedger`, xác nhận bằng thay đổi `hp` của quái hoặc `kill`). Nhịp thực tế mong đợi khoảng 1,25 đòn/giây nếu không đổi vũ khí **[Suy ra]**. Chưa biết server có giới hạn tần suất hay không **[Chưa biết]**.

## 7. Kỹ năng (phép thuật)

### 7.1 Chọn kỹ năng `pickAuto(player, dist, idx)` **[Đọc được]**

```
rotation = các ô đã học, không "playerTargetOnly", và đã bật "dùng khi auto"  (thứ tự do người chơi sắp trên hotbar)
start    = ((idx mod n) + n) mod n
for h in 0..n-1:
    s = rotation[(start + h) mod n]
    range = s.thunder ? THUNDER.RANGE : (s.shape == "aura" ? min(s.range, 0.8 * s.blastR) : s.range)
    if ready(player, s) and dist <= range:  return {skill: s, idx: (start+h) mod n}
return null
```

- Sau khi xả thành công: `autoSkillIdx = idx + 1` (luân phiên vòng tròn).
- `ready(player, s)` = vũ khí được phép (`allowedWeapons`) **và** không phải kỹ năng biến hình đang biến hình **và** cooldown của chính nó bằng 0 **và** cooldown chung `spellCd` bằng 0. Với Lôi Chưởng dùng `thunderCd`.

### 7.2 Xả kỹ năng `castSpell` **[Đọc được]**

Điều kiện lần lượt (thất bại thì không xả): đúng vũ khí; không đang `attack`/`pose`; không đang biến hình; `spellCd <= 0` và `spellCds[id] <= 0`; `mpMax > 0` (đã khai mở linh lực); `mp >= cost.mp`; `sp >= cost.sp`. Khi xả: trừ `mp`, `sp` cục bộ; đặt `spellCds[id] = cooldown` và `spellCd = SPELL_GAP (1.2)`.

- `cost` có giảm giá nhỏ nếu bật bị động "Tĩnh Tâm" và đứng không xả chiêu đủ lâu (`khongChieuT`); chi tiết giảm giá **[Đọc được]** trong `spellCost`, bot có thể bỏ qua (chỉ ảnh hưởng chi phí).
- Mã trả về lý do thất bại: `chua_hoc`, `chua_khai_mo`, `thieu_linh_luc`, `thieu_than_thuc`.

### 7.3 Gói gửi lên **[Đọc được]**

`{op:"skill", skillId, targetId|null}` (qua `Gateway.skill`). Gửi tại thời điểm "bắn" của tư thế niệm: `fireAt:1` nghĩa là khi vào bước thứ hai của chuỗi `seal (0.55×cast) → palm (0.85×cast) → idle (0.14)`, tức khoảng `0.55 × cast` giây sau khi bắt đầu niệm **[Suy ra]**. Kỹ năng `instantOnPress` gửi ngay.

Server trả `skill_res` với `n` = số mục tiêu trúng; `n = 0` hiển thị "Hụt" **[Đọc được]**.

### 7.4 Bảng kỹ năng (từ `systems/skills.js`) **[Đọc được]**

`shape`: `bolt` đạn, `ground` vùng đất, `aura` quanh người, `self` biến hình. `loi_chuong` là `THUNDER_DEF` riêng nên vendor không đặt `shape`; nhánh auto dùng cờ `thunder`. Cột mp/sp là chi phí gốc. `allowedWeapons` là `null` ở cả 27 `DEFS` hiện tại; `boostWeapon` và `kieuRoi` là trường khác, không được đổi tên thành allowlist.

| id | book | shape | cd | cast | mp/sp | range | coef | blastR | shots | allowedWeapons | autoFoe | playerTargetOnly | bienHinh | instantOnPress | thunder |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---|---|---|---|
| loi_chuong | bi_tich_loi_chuong | — | 5 | 0.34 | 12/5 | 96 | 5.45 | 30 | 1 | — | false | false | — | false | true |
| hoa_cau | bi_tich_hoa_cau | bolt | 6 | 0.4 | 14/4 | 124 | 1.8 | 22 | 1 | — | false | false | — | false | false |
| phong_nhan | bi_tich_phong_nhan | bolt | 3.4 | 0.22 | 9/3 | 112 | 1.7 | 0 | 3 | — | false | false | — | false | false |
| bang_thau | bi_tich_bang_thau | bolt | 5 | 0.3 | 13/5 | 104 | 1.7 | 0 | 5 | — | false | false | — | false | false |
| dia_thich | bi_tich_dia_thich | ground | 7.5 | 0.42 | 16/6 | 92 | 1.8 | 28 | 1 | — | false | false | — | true | false |
| xich_chan | bi_tich_so_xich_chan | ground | 12 | 0.42 | 12/4 | 132 | 0.7 | 54 | 1 | — | false | true | — | false | false |
| ngu_kiem_sat | bi_tich_ngu_kiem_sat | ground | 8.5 | 0.48 | 20/8 | 118 | 5.2 | 38 | 1 | — | false | false | — | false | false |
| huyet_kiem_tran | bi_tich_huyet_kiem_tran | ground | 10 | 0.52 | 24/10 | 126 | 5.6 | 46 | 1 | — | false | false | — | false | false |
| van_kiem_quy_tong | bi_tich_van_kiem_quy_tong | — | 12 | 0.65 | 35/15 | 220 | 9 | 0 | 1 | — | false | false | — | false | false |
| cuu_huyet_kiem_tran | bi_tich_cuu_huyet_tran | aura | 12 | 0.6 | 28/12 | 96 | 6.5 | 96 | 1 | — | false | false | — | false | false |
| kim_thuong_giang_the | bi_tich_kim_thuong_giang_the | ground | 12 | 0.5 | 30/12 | 132 | 5.6 | 130 | 1 | — | false | false | — | false | false |
| loi_thuong_quan_dia | bi_tich_loi_thuong_quan_dia | ground | 9 | 0.5 | 30/12 | 150 | 6.3 | 56 | 1 | — | false | false | — | false | false |
| ngu_loi_thuong_vu | bi_tich_ngu_loi_thuong_vu | ground | 14 | 0.6 | 36/14 | 170 | 9.8 | 84 | 1 | — | false | false | — | false | false |
| thanh_lam_kiem_tru | bi_tich_thanh_lam_kiem_tru | bolt | 8 | 0.38 | 15/6 | 128 | 5.2 | 36 | 1 | — | false | false | — | false | false |
| anh_ky_phu | bi_tich_anh_ky_phu | bolt | 9 | 0.44 | 18/7 | 192 | 6 | 0 | 1 | — | false | false | — | false | false |
| bang_kiem_tran | bi_tich_bang_kiem_tran | ground | 11 | 0.54 | 26/11 | 136 | 5 | 66 | 1 | — | false | false | — | false | false |
| bang_kiem_luan | bi_tich_bang_kiem_luan | aura | 10 | 0.72 | 22/9 | 246 | 4.9 | 246 | 1 | — | false | false | — | false | false |
| tien_vu | bi_tich_tien_vu | ground | 11 | 0.46 | 24/10 | 176 | 5.25 | 80 | 1 | — | false | false | — | false | false |
| tram_ma | bi_tich_tram_ma | aura | 9 | 0.42 | 18/7 | 176 | 5.25 | 176 | 1 | — | false | false | — | false | false |
| ma_bao_an | bi_tich_ma_bao_an | ground | 13 | 0.45 | 34/14 | 150 | 6.6 | 72 | 1 | — | false | false | — | false | false |
| ma_hon_phe | bi_tich_ma_hon_phe | ground | 11.5 | 0.5 | 26/12 | 180 | 8.5 | 42 | 1 | — | false | false | — | false | false |
| nguyet_quang | bi_tich_nguyet_quang | ground | 14 | 0.55 | 34/14 | 190 | 10.5 | 34 | 1 | — | false | false | — | false | false |
| kim_quang_cu_kiem | bi_tich_kim_quang_cu_kiem | ground | 10 | 0.5 | 26/11 | 210 | 7.2 | 0 | 1 | — | true | false | — | false | false |
| ngu_sac_than_chuong | bi_tich_ngu_sac_than_chuong | ground | 30 | 0.6 | 36/14 | 200 | 22.5 | 56 | 1 | — | false | false | — | false | false |
| huyet_buc_chuong | bi_tich_huyet_buc_chuong | ground | 5.5 | 0.4 | 14/6 | 130 | 5 | 44 | 1 | — | true | false | — | false | false |
| huyet_liem_tram | bi_tich_huyet_liem_tram | ground | 7 | 0.45 | 24/10 | 150 | 5.8 | 52 | 1 | — | true | false | — | false | false |
| tu_anh_phuoc_tien | bi_tich_tu_anh_phuoc_tien | ground | 10 | 0.5 | 26/10 | 170 | 6 | 0 | 1 | — | true | false | — | false | false |
| xich_ma_hoa_than | bi_tich_xich_ma_hoa_than | self | 25 | 0.6 | 30/12 | 140 | 0 | 0 | 1 | — | false | false | xich_ma/12s | false | false |

Bảng này được sinh bằng VM từ `DEFS`, `SLOTS`, `THUNDER_DEF` và `CONFIG.THUNDER`, không còn là trích regex. Hiệu ứng đầy đủ, `boostWeapon`, `kieuRoi`, cảnh giới và `medium` nằm trong file sinh `skill-defs.generated.ts`.

### 7.5 Kỹ năng nào nhân vật đang có **[Đọc được] / [Chưa biết]**

Kỹ năng "đã học" trong client được tính bởi `known(id) = DEFS[id] && ownsBook(id) && !lockReason(id)`; `knownThunder()` dùng `THUNDER_BOOK`, còn `slotKnown(slot)` gọi một trong hai nhánh trên. `ownsBook` đọc `Inventory.owns(book, 1)`/`has`, mà `Inventory.load` nạp từ `state.save.bag` (sách không phải ô trang bị). `lockReason` còn phụ thuộc cảnh giới, vũ khí/`kieuRoi`, chính/ma đạo và một số hệ thống runtime **[Đọc được]**.

Hàm thuần `deriveLearnedSkills(save)` đã có trong `packages/core-client/src/state/auto-data.ts`: trả các ID có `state.save.bag[book] >= 1`, theo `SLOTS`, gồm cả `loi_chuong`; `bound`, `flags.phap_thuat_dung` và `pntt.thanhChieu.v1` không tự chứng minh quyền sở hữu sách **[Đọc được]**. Kết quả này là “book-known”, chưa tự áp dụng đầy đủ `lockReason` **[Suy ra]**. `thuTu`, `tat`, `an` là preference cục bộ `pntt.thanhChieu.v1`; server có thể đồng bộ qua `pref.thanhChieu`, nhưng không có bằng chứng rằng chúng nằm trong `state.save` **[Chưa biết]**.

Evidence đã ghi nhận `state.save` có các nhóm khóa `bag`, `bound`, `equipment`, `flags`, `linhCan`, `realm`, `stage`; trong đó chỉ `bag` với giá trị số dương của đúng `book` là bằng chứng sở hữu mà hàm pure này dùng. Việc `flags` có mã mở khóa/khóa nào khác, và thứ tự ưu tiên/bật tắt auto có được server lưu trong save hay chỉ ở preference, vẫn **[Chưa biết]**.

## 8. Tài nguyên và nghỉ

- Trong phần tick auto đã đọc **không thấy** logic tự thiền khi hết MP; chưa tìm kiếm toàn bộ `world.js` nên không khẳng định client auto không bao giờ thiền **[Chưa biết]**. Kỹ năng không xả được khi `mp`/`sp` thiếu (điều kiện trong `castSpell`), khi đó chỉ còn đánh thường **[Đọc được]**.
- SP hồi `0.75/s` khi ở trạng thái thường; thiền hồi mp `6/s`, hp `4/s`, sp `3/s` **[Đọc được]**.
- **Đặc tả cho bot:** chính sách nghỉ đề xuất, cấu hình được: khi `mp / derivedMax.maxMp < ngưỡng` (đề xuất 20 %) và không có quái trong tầm, thực hiện `meditate`, thoát khi `mp` đủ hoặc có quái tới. Chỉ dùng tỉ lệ khi `derivedMax.complete === true`. Hành vi thiền khi bị đánh: client có `PVP_INTERRUPT_SEC` cho trường hợp PvP; với quái **[Chưa biết]**.

## 9. Gục và hồi sinh

- **Nhận biết [Đọc được]**: `you.dn` (0/1), gói `down` (có `left`: giây còn lại, `lostExp`), gói `revived` (hp, mp).
- **Hồi sinh [Đọc được]**: `cmd("revive", {mode:"home"})` về `tan_vien` với 60 % HP, hoặc `{mode:"spot"}` tại chỗ với 35 % HP (tối đa `MAX_REVIVES = 3` lần). Client tự gọi về làng khi gục quá `AUTO_HOME = 60` giây.
- **Đặc tả cho bot [Chưa kiểm chứng live]**: dừng toàn bộ auto khi `downed === true`; ưu tiên `spot` nếu còn lượt và vị trí an toàn, ngược lại `home`; sau khi `revived` đợi vitals fresh rồi mới tiếp tục. Thông số `REVIVE_INVULN = 3` giây bất khả xâm phạm sau hồi sinh.
- Khóa `RESPAWN_PROTOCOL_UNAVAILABLE` trong dự án chỉ gỡ sau khi thử live.

## 10. Dữ liệu bot cần và hiện trạng

| Dữ liệu | Nguồn | Hiện trạng trong dự án |
|---|---|---|
| Vị trí nhân vật, map, khu | `you`, `map`, `state` | ✅ có (`mapContext`, `location`) |
| Danh sách quái | `snap2.ef` / `snap2.e` / `map.e` | ✅ có, với các trường `id, x, y, hp, dir, st, t, tg, zn, fz, sl, slm, hm, d, wn, bn` |
| Ý nghĩa `hp` của quái | `gateway.js` `$`, `entities/enemy.js` `Enemy.create/draw` | ✅ **[Đọc được]**: HP hiện tại tuyệt đối; client gán `r.hp=o.hp` và vẽ `hp/hpMax`, không phải phần trăm |
| Định nghĩa quái (tên, `isBoss`, `human`, `bodyRadius`, `hpMax`) từ loại `t` | `entities/enemy.js` `ENEMY_DEFS`, `Enemy.create`; `gen-enemy-defs.mjs` | ✅ 62 loại; `t` là khóa trực tiếp. `bodyRadius` chỉ có ở một số def và chưa thấy dùng trong targeting **[Đọc được]** |
| HP/MP/SP của mình | `you` (mỗi 10 `seq`), `hurt`, `revived` | ✅ có + `refreshVitals` |
| SP, BP | `you.sp`, `you.bp` | trong gói nhưng chưa vào `VitalSnapshot` |
| Cooldown kỹ năng của server | — | **[Chưa biết]**; bot phải tự theo dõi cục bộ như client |
| Kỹ năng đã học, thứ tự | `systems/skills.js`, `state.save.bag`, preference | ✅ book-known + hàm pure; `lockReason` đầy đủ và thứ tự preference vẫn tách riêng |
| Lưới va chạm để tìm đường | `world/*`, `walk-grids.generated.ts` | ✅ 16/16 map catalog; có `source`, kích thước và `blockedRows`; `rectFlyBlocked` không đưa vào lưới đi bộ |
| Xác nhận đòn đánh | `hurt`, `kill`, `skill_res`, thay đổi `hp` quái | ✅ parser pure; chưa nối vào `GameStateStore` |

Cập nhật 2026-10-08 (phân tích tĩnh): `map-spawns.generated.ts` có 37 dòng map/loại và 187 điểm spawn, đã đối chiếu khóa với `ENEMY_DEFS`. Đây là dữ liệu chọn vùng farm; respawn/leash thực tế trên server vẫn **[Chưa biết]**.

Kiểm chứng 6 map cũ: `tan_vien`, `thanh_truc_lam`, `duoc_vien`, `vuon_ca_nhan`, `mieu_hoang` khớp từng hàng. `dong_mach_ngam` lệch 1 ô: vendor chặn `(tx=20,ty=14)` do prop `hu_thien_cuc_lac` có `block:true`; bản chép tay cũ thiếu ô chặn này. Chọn vendor làm nguồn đúng và có test hồi quy.

Profile tĩnh của generator coi prop điều kiện là đang hiện; ảnh hưởng khi quest/realm/harvest làm prop ẩn là **[Chưa biết]**. `flyBlocked`/`rectFlyBlocked` chỉ ghi chú, không đưa vào collision đi bộ.

## 11. Kiến trúc đề xuất

Tách bốn lớp, mỗi lớp thuần hàm khi có thể để test bằng dữ liệu ghi lại:

1. **Perception** (đã có phần lớn): snapshot nhất quán `{self, monsters, context, vitals, derivedMax, cooldowns}`.
2. **Decision** (mới, thuần hàm): `decide(snapshot, config, memory) -> Action` với `Action ∈ {idle, rest, approach(target, path), attack(target), cast(skill, target), revive(mode), unreachable(target)}`. Tái hiện đúng mục 3 đến 9.
3. **Actuation**: chuyển `Action` thành gói qua `sendMove` / `attackMob` / `castSkill`, đi qua `OperationLedger` (chống gửi lặp) và các gate hiện có (gate mềm cho di chuyển, gate nghiêm cho tấn công).
4. **Verification**: `hurt`, `kill`, `skill_res`, thay đổi `hp` quái xác nhận kết quả; thiếu xác nhận thì đánh dấu `unconfirmed`, không tự gửi lại ngay (đã có trong ledger).

State machine training hiện có (`automation-engine`) đóng vai điều phối giữa các `Action` này, không nên chứa luật chọn mục tiêu hay tầm đánh.

## 12. Kế hoạch triển khai và tiêu chí nghiệm thu

| Giai đoạn | Nội dung | Nghiệm thu |
|---|---|---|
| P0 | Trích định nghĩa quái (tên, `isBoss`, `human`, `bodyRadius`, `hpMax`) và ý nghĩa `hp`, `t`, `st`, `tg`; parse `kill`, `skill_res`, `down`, `hurt`, `act`, `loot` | ✅ Bảng sinh 62 loại; parser + fixture tổng hợp + test tĩnh. Không có raw tap nên chưa gọi là replay/live |
| P1 | `selectTarget` thuần hàm theo mục 4 (mặc định gần nhất) | ✅ `target-selection.ts` + test: priority/fallback, lọc chết/human/tuSi/unknown, sticky và biên range |
| A1/A2 | Grid collision + spawn cho P2 | ✅ 16/16 map catalog, 37 dòng map/loại, 187 điểm; server facade dùng generated source; 6 map đối chiếu hồi quy |
| A3 | Đối chiếu `Pathfinder.route` với `findWalkPath` | ✅ 220 truy vấn tĩnh trên 11 map có spawn; không có đoạn dự án đi xuyên rectangle vật cản; mismatch độ dài/route được ghi nhận, chưa sửa thuật toán |
| B2 | `pickAutoSkill` + cooldown pure | ✅ luân phiên, ready/range/mp/sp, SPELL_GAP, cooldown riêng, loại `bienHinh`/`playerTargetOnly` |

| P2 | `approach`: tìm đường tới tầm đánh, tìm lại mỗi 0,4 s, giới hạn 8 s | Test trên lưới của map farm; live: đi tới quái đứng yên, dừng đúng tầm |

Trạng thái P2 hiện tại: phần hàm thuần `computeApproachGoal` + `ApproachTracker` đã có test độc lập, gồm fixture thật `thanh_truc_lam` với mọi điểm sinh; `runApproach` và harness approach đã có test dependency-injected. Live chưa chạy trong sandbox và chưa có bằng chứng server/game thật.
| P3 | `attack` đánh thường qua ledger | Live trên 1 quái yếu: gửi đúng `attackTime`, `hp` quái giảm, nhận `kill`; không có đòn trùng |
| P4 | Kỹ năng: `pickAuto`, cooldown cục bộ, kiểm tra mp/sp, `skill_res` | Live: luân phiên đúng thứ tự, tổng mp trừ khớp, không niệm khi thiếu mp |
| P5 | Nghỉ/thiền theo ngưỡng; xử lý `hurt` khi thiền | Live: tự thiền khi hết mp rồi quay lại đánh |
| P6 | Gục/hồi sinh (sau khi kiểm chứng `revive`) | Live có kiểm soát: nhận `down`, `revive`, tiếp tục |
| P7 | Nối vào state machine training; log và dừng khẩn cấp | Chạy 10 phút ổn định, không vi phạm gate |

Bảng A3 (ngưỡng độ dài lệch > 32 px; `presence` là khác có/không đường; mọi dòng đều có ít nhất một cặp unreachable/invalid):

| Map | Q | Unreachable | Presence | Length >32px | Max delta px |
|---|---:|---:|---:|---:|---:|
| `mieu_hoang` | 20 | 3 | 1 | 0 | 23 |
| `thanh_truc_lam` | 20 | 7 | 0 | 1 | 38 |
| `duoc_vien` | 20 | 3 | 0 | 0 | 28 |
| `vuon_ca_nhan` | 20 | 3 | 1 | 0 | 19 |
| `long_uyen` | 20 | 4 | 0 | 0 | 29 |
| `hang_dong_co` | 20 | 3 | 1 | 0 | 26 |
| `bai_da_hang_gio` | 20 | 3 | 2 | 5 | 65 |
| `dong_mach_ngam` | 20 | 3 | 2 | 3 | 49 |
| `mo_linh_thach` | 20 | 3 | 0 | 2 | 55 |
| `thach_phong_thung_lung` | 20 | 3 | 0 | 1 | 39 |
| `hac_phong_linh` | 20 | 3 | 1 | 10 | 70 |

### Hướng lệch của A3 (đã làm rõ 2026-10-08)

Chạy bản sao có in chi tiết của `walk-path-audit.test.mjs` (không đổi test gốc):

- **8 lệch "có/không có đường"**: cả 8 đều là vendor CÓ đường, dự án KHÔNG có đường (`findWalkPath` trả `null`). Không có chiều ngược lại. Cả 8 là truy vấn cố ý không hợp lệ do chính audit tạo: 6 truy vấn `blocked-target` (đích là ô chặn `(0,0)`) và 2 truy vấn `out-of-bounds-target`. Vendor "hít" đích về điểm đi được gần nhất (điểm cuối đường vendor nằm ở ô như `(2,1)`, `(38,28)`), dự án từ chối.
- **Truy vấn hợp lệ (`normal`)**: không có lệch nào về sự tồn tại đường.
- **22 lệch độ dài > 32 px**: đều theo một chiều, đường của dự án DÀI HƠN vendor 3 đến 7 % (tối đa 70 px ở `hac_phong_linh`); không có trường hợp dự án ngắn hơn. Phù hợp với việc vendor nén waypoint.
- **Không lệch về an toàn va chạm** ở cả hai bên (0 vi phạm).

Hệ quả cho P2: dự án chặt hơn vendor, nên không có nguy cơ đi xuyên vật cản. Nhưng vì `findWalkPath` từ chối đích bị chặn, **không được truyền thẳng tọa độ quái làm đích**: vị trí quái có thể rơi vào ô bị chặn. Phải chọn đích là một điểm đi được trong tầm đánh quanh quái (dùng `findNearestWalkableTarget` hoặc tương đương), và coi `null` là "không tới được" thay vì lỗi.

**Điểm dừng an toàn xuyên suốt:** gục, mất kết nối, `hurt` liên tục vượt ngưỡng, không tới được mục tiêu quá N lần, gặp boss khi cấu hình "né boss", HP/MP không rõ quá lâu, người dùng bấm dừng.

## 13. Những gì chưa biết (cần đo trước khi tin)

1. Server có kiểm tra cooldown/mp/sp và tốc độ gửi `attack`/`skill` không, và phản hồi khi vi phạm.
2. Server có giới hạn tần suất hoặc phát hiện hành vi lặp (chống bot) không. Không có dấu hiệu trong client, nhưng kiểm tra đó nếu có sẽ nằm ở server.
3. ~~Ý nghĩa `hp` của quái và các trường `t, st, tg, zn, fz, sl, slm, hm, d, wn, bn`.~~ Đã đọc được từ `gateway.js`/`enemy.js`; chỉ còn miền giá trị server chưa có capture.
4. ~~Payload cơ bản của `kill`, `skill_res`, `hurt`, `down`, `act`, `loot`.~~ Đã có parser pure và bảng trường client đọc; các biến thể `act` không được gateway giải mã đầy đủ vẫn chưa biết.
5. ~~Danh sách kỹ năng nhân vật hiện có.~~ 27 DEFS + Thunder đã sinh; thứ tự/auto preference theo từng nhân vật vẫn chưa biết nếu không có state/pref tương ứng.
6. `autoNghiDen`, `C(player)` và các điều kiện `giuYen` chính xác.
7. Hành vi của quái đối với bot (đuổi, leash) so với client chính thức.
8. `TileMap.load` có nhánh ẩn prop theo quest/realm/harvest; grid sinh ra dùng profile prop đang hiện, nên farm qua các ô gần prop điều kiện cần đo live.
9. `TileMap.enemySpawns` có thể mở rộng `_x2/_x3`; đây là tọa độ client-derived, chưa xác minh là toàn bộ điểm spawn/respawn server.
10. Các lệch A3 đã làm rõ hướng (xem "Hướng lệch của A3"): vendor hít đích bị chặn về điểm gần nhất còn dự án trả null; đường dự án dài hơn 3 đến 7 %. Không phải lỗi va chạm.

11. Quái có đuổi theo bot trong lúc approach hay leash về spawn theo đúng runtime server không: **[Chưa biết]**, cần live evidence.
12. Sau khi tới tầm, vị trí đứng yên có ổn định hay bị quái đẩy/di chuyển và khoảng cách có giữ trong reach không: **[Chưa biết]**, chưa được suy ra từ dữ liệu tĩnh.

## Phụ lục P0 — Ý nghĩa trường quái trên wire

Nguồn chính: `vendor/.../src/net/gateway.js` hàm nội bộ cập nhật mob (được gọi bởi `buildMobs`/`snap2`), `entities/enemy.js` `Enemy.create`, `Enemy.update`, `Enemy.draw`, và `systems/targeting.js` `Targeting.refresh`. Fixture trong test là tổng hợp, không phải raw packet.

| Trường | Ý nghĩa client | Đơn vị/miền đọc được | Nhãn |
|---|---|---|---|
| `id` | ID instance; `Enemy.find(enemies, id)` dùng để ghép patch | ID opaque, string/number theo parser | [Đọc được] |
| `t` | Type key, lookup `ENEMY_DEFS[t]` khi tạo mob | khóa bảng, phải tồn tại trong defs để client tạo | [Đọc được] |
| `x`, `y` | vị trí instance | tọa độ world; client dùng số pixel | [Đọc được]/[Suy ra] |
| `hp` | HP hiện tại, gán vào `r.hp`; thanh máu dùng `r.hp/r.hpMax` | số tuyệt đối, `>= 0` theo parser; không phải phần trăm | [Đọc được] |
| `hm` | override `r.hpMax` khi truthy | HP tuyệt đối; thiếu thì dùng `def.hp` | [Đọc được] |
| `d` | cờ chết: `r.dead = !!o.d` | boolean-like; cờ `true` làm mob chết trong snapshot | [Đọc được] |
| `kill` | event riêng, đọc `id`, `exp`, `by`; set dead/hp=0 và VFX/exp nếu `by===selfId` | loot không nằm trong handler này | [Đọc được] |
| `dir` | hướng render của mob | client render dùng enum `0..3`; miền wire độc lập chưa được khai báo | [Đọc được]/[Chưa biết] |
| `st` | state mô phỏng: `idle`, `chase`, `return`, `flee`, `wander` xuất hiện trong `Enemy.update` | string; server có thể gửi biến thể chưa thấy | [Đọc được]/[Chưa biết] |
| `tg` | cờ telegraph: `attackState = "telegraph"` nếu truthy, ngược lại `none` | boolean-like | [Đọc được] |
| `zn`, `fz` | thời gian còn lại stun/freeze | giây; `Math.max(0, +value || 0)` | [Đọc được] |
| `sl`, `slm` | thời gian slow và hệ số tốc độ | `sl` giây; `slm` multiplier, mặc định runtime là 1 khi slow đang bật | [Đọc được] |
| `wn`, `bn` | thời gian wound/burn | giây | [Đọc được] |
| `bd` | bật/tắt biến dị qua `Enemy.datBienDi` | boolean-like | [Đọc được] |
| `la` | thời gian `linhAnUntil` | giây, đổi sang deadline bằng `Date.now()+1000*la` | [Đọc được] |
| `pn`, `pd`, `bm` | poison duration/DPS và burn-ma flag | giây, DPS, boolean-like | [Đọc được] |
| `ns`,`nw`,`nx`,`ny`; `hs`,`hw`,`hx`,`hy`; `js`,`jw`,`jx`,`jy`; `bs` | sequence, windup và tọa độ các đòn đặc biệt | sequence integer-like, windup tính từ phần trăm (`/100`), tọa độ world | [Đọc được] |
| `av`, `vk`, `ttl` | attack variant, weapon id, TTL hiển thị | variant/TTL integer-like; `vk` opaque | [Đọc được] |

`bodyRadius` được có trong một số definition (ví dụ Xích Long), không xuất hiện trong `systems/targeting.js` nhưng được cộng vào tầm hit trong `scenes/world.js` như mô tả trên; targeting list dùng `Player.reach` làm bán kính entry. `hitRadius` và `leashRange` là trường behavior của definition mà `Enemy.update` dùng cho đánh/đuổi; generator ghi cả giá trị vendor và fallback config. Việc server có dùng các trường này y hệt client là **[Chưa biết]**.

## Phụ lục — Phạm vi lưới va chạm và spawn

Generator đọc `vendor/tutien2d-public-client/2026-10-06/src` trong VM, không đọc mạng. Không có map catalog nào thiếu grid trong lần chạy 2026-10-08:

| Map | Kích thước ô | Số điểm spawn tĩnh |
|---|---:|---:|
| `mieu_hoang` | 20×14 | 12 |
| `tan_vien` | 40×30 | 0 |
| `thanh_truc_lam` | 40×30 | 62 |
| `duoc_vien` | 40×30 | 26 |
| `vuon_ca_nhan` | 18×13 | 2 |
| `long_uyen` | 40×30 | 4 |
| `hang_dong_co` | 30×20 | 16 |
| `bai_da_hang_gio` | 40×30 | 24 |
| `dong_mach_ngam` | 30×26 | 2 |
| `mo_linh_thach` | 40×30 | 23 |
| `thach_phong_thung_lung` | 40×30 | 4 |
| `bat_quai_thach_phan` | 60×40 | 0 |
| `thien_dao_khuyet` | 100×19 | 0 |
| `u_uynh_vuc` | 100×19 | 0 |
| `hac_phong_linh` | 64×24 | 12 |
| `hac_thi` | 34×20 | 0 |

Tổng 187 điểm/37 dòng map-loại. Một điểm rơi vào ô chặn: `mo_linh_thach`, loại `tm_tru`, `(tx=22,ty=14)`, id tổng hợp `tm_tru`; test giữ nguyên cảnh báo này, không tự sửa tọa độ. Map không có điểm spawn tĩnh không bị bỏ qua: vẫn có grid để dùng cho cổng/đường đi, nhưng chưa có dữ liệu farm từ `enemies` trong snapshot vendor.

## Phụ lục P0 — Payload gói chiến đấu

| Gói | Trường client đọc (kiểu/miền) | Client làm gì |
|---|---|---|
| `kill` | `id`: ID opaque; `exp`: number-like; `by`: ID opaque/null | tìm mob, `dead=true`, `hp=0`, VFX; hiện exp chỉ hiện khi `exp>0` và `by===Gateway.selfId`; loot đến từ `loot` riêng |
| `skill_res` | `n`: số nguyên-like | `n<=0` hiện “Hụt”; gateway không đọc sát thương, skill ID hay mục tiêu từ gói này |
| `down` | `left`, `lostExp`: number-like, tùy chọn | knockdown; `left` thành `reviveLeft` nếu là number; `lostExp>0` hiện text mất đạo hạnh |
| `hurt` | `hp`, `bp`, `mp`, `dmg`, `mpLoss`: number-like; `byId`: ID opaque/null | cập nhật HP/MP/BP; VFX damage; `byId` khác null/rỗng gọi `Player.onPlayerDamage`; không có cờ nguồn quái/người riêng |
| `act` | `k`: string; `id,t`: ID opaque; tọa độ/tham số `tx,ty,x,y,ax,ay,w,r,n,dps,ttl,bay`: number-like; `pts,src,targets`: array; `mau,result`: string; `flight`: boolean-like | chọn VFX/UI/remote action theo `k`; các biến thể chưa có schema đầy đủ vẫn được forward |
| `loot` | `l`: array; item `id`: ID opaque, `item`: string, `n,khoa,vn,age,x,y,ox,oy`: number-like, `owner`: ID/null, `boss,daily,ht`: boolean-like, `bossName`: string/null | tạo drop trên mặt đất, bay về người chơi hoặc bỏ qua nếu đã biết |
| `loot_gone` | `id`: ID opaque; `by`: ID opaque/null | tìm drop; nếu `by` là người nhận thì cho bay/đánh dấu granted, nếu không thì xóa |
| `join` | `id`: ID opaque; `name,realm`: string; `cfg,tong,pos`: object-like; `phanThan`: boolean-like | tạo/cập nhật remote player và roster |
| `leave` | `id`: ID opaque | xóa remote, roster và snap delta |
| `bosses` | `boards`: array | chuyển nguyên bảng cho `BossBoard.set`; UI chỉ nhận array và tự lọc shape |
| `revived` | `ep,x,y,hp,mp,bp`: number-like, `ep/x/y/bp` tùy chọn | cập nhật vị trí/vitals; nếu epoch hợp lệ thì revive và đóng UI gục |

Biến thể `act` đọc được rõ trong gateway gồm `enemy_poison` (`x,y,targets,dps`, target có `id,x,y,t`), `ll_tru_ban` (`id,t,x,y,tx,ty,mau,bay`), `ll_kim_kiem` (`id,t,tx,ty,w`), `ll_ta_hoa` (`pts,w,r`), `long_luu_tinh` (`pts,w,r,mau,tu`), `quy_an` (`id,t,tx,ty,w`), `huyet_hut` (`id,src,n`), `xuyen_kich` (`id,x,y,w`), `vankiem_release` (`id,t,ax,ay,flight`) và `duel_result` (`id,result,ttl`). Những nhánh UI/remote còn lại nhận nguyên packet; schema server đầy đủ của chúng **[Chưa biết]**.

## 14. Client thật gửi gì khi đứng yên (đo bằng đọc mã, 2026-10-08)

Nguồn: `vendor/.../src/net/gateway.js` (hàm tick mạng, hàm báo cáo mạng `sendNetReport`), `core/config.js`, `runtime-config.js`. Chưa đối chiếu bằng bắt gói của client thật (cần đăng nhập vào trang game trong trình duyệt). Nhãn: **[Đọc được]** từ mã; **[Suy ra]** suy luận từ mã.

### 14.1 Gói `move`: chỉ gửi khi có thay đổi **[Đọc được]**

Mỗi `1 / netTickHz` giây (`netTickHz` mặc định 10, đọc từ `runtime-config.js`, nên khoảng 10 Hz), client so trạng thái hiện tại với trạng thái đã gửi lần trước và chỉ gửi `move` nếu có ít nhất một khác biệt:

- `|x - x_trước| > 0.5` hoặc `|y - y_trước| > 0.5`;
- đổi `dir`;
- đổi `state` (idle, walk, attack, pose...);
- đổi tên bước tư thế (`pose`);
- đổi cờ bay (`fly`);
- đổi cờ câu cá (`fs`) hoặc vị trí phao (`fx`, `fy`).

Hệ quả: nhân vật đứng yên, không đổi tư thế thì client **không gửi gói `move` nào**. Khi vừa dừng lại, nó gửi đúng một gói cuối với `st` đã chuyển (thường `idle`). Client không bao giờ gửi liên tiếp nhiều gói `move` giống hệt nhau. Cũng vì vậy, ở client thật khi đứng yên không có `you` (vì `you` chỉ đến theo `seq` của luồng `move`).

### 14.2 Gói `ping` kèm thống kê mạng: khoảng 30 s một lần **[Suy ra]**

`sendNetReport` gửi `{op:"ping", t, ns:{v:1, s, u, l, d, n, q, g?, f?, r?}}`: `s` là số giây thực tế kể từ báo cáo trước, `u`/`l` là số lần cạn mốc nội suy và số khung khựng trong khoảng đó, `d` là độ trễ vẽ, `n` số người đang thấy, `q` mức chất lượng đồ họa, `g`/`f`/`r` là phân vị 90 của độ trễ, p95 của khung hình, và một số đo khác. Hàm chỉ gửi khi `Gateway.ready` và tab đang hiển thị (`document.hidden` sai). Nơi duy nhất tìm thấy gọi hàm này là trong trình xử lý gói `snap`: được gọi khi chưa có báo cáo nào trong 30 s gần nhất (`Date.now() - I.at >= 30000`); lần gọi đầu tiên chỉ ghi mốc, không gửi. Nên chu kỳ thực tế khoảng 30 s hoặc hơn, tùy gói `snap` đến.

### 14.3 Các op khác client chủ động gửi

Chỉ khi người chơi hoặc sự kiện cục bộ kích hoạt: `hello` (lúc kết nối), `create_char`, `resync` (khi snap2 lệch), `formation`, `skill`, `duel`, `dosat`, `enter`, `chat`, `whisper`, `act`, `khu`, cùng các lệnh RPC `cmd(...)`. Không thấy gói giữ nhịp (heartbeat) nào khác. Lưu tiến trình định kỳ (`saveIntervalSec` 20 s trong cấu hình) không đi qua WebSocket của game theo kết quả quét các op gửi **[Suy ra]**; có thể là kênh khác (lưu trữ đám mây), chưa kiểm tra.

### 14.4 So với bot hiện tại

| Hành vi | Client thật | Bot hiện tại |
|---|---|---|
| `move` khi đứng yên | không gửi | không gửi (khớp) |
| `ping` | khoảng 30 s, `s` và thống kê thật | mỗi 8 s (`pingIntervalMs: 8000`), `ns` là hằng số (`s:15, u:0, l:0, d:160, n:6, q:2`) |
| `move` liên tiếp giống hệt | không bao giờ | `refreshVitals` và hai probe đứng yên gửi tới 10 gói giống hệt nhau, 10 Hz |
| `move` khi đi | khi tọa độ lệch hơn 0.5 px, tick 10 Hz | tick 100 ms; gửi mỗi bước kể cả khi vị trí xác thực chưa đổi (chưa kiểm tra có gửi trùng không) |

**Rủi ro [Chưa biết]:** server có phát hiện hay xử lý khác các mẫu trên hay không (chuỗi `move` giống hệt, tần suất `ping` và `ns` cố định) thì chưa có dữ liệu. Chúng là các điểm bot khác client thật và có thể phân biệt được từ phía server. `refreshVitals` hiện là cách duy nhất đã biết để lấy HP chủ động lúc đứng yên và nó phụ thuộc vào đúng mẫu "move giống hệt" này.

### 14.5 Hướng xử lý đề xuất (chưa làm)

1. Đưa `ping` về nhịp gần client: khoảng 30 s, `ns.s` bằng số giây thực tế, `n` bằng số người đang thấy thực tế, các trường còn lại lấy từ số liệu thật hoặc ít nhất thay đổi hợp lý.
2. Hạn chế `refreshVitals`: chỉ khi thật cần (HP cũ quá ngưỡng trước khi tấn công), tần suất thấp, ưu tiên lấy HP qua `hurt` và qua luồng `move` đang có sẵn khi di chuyển thật.
3. Kiểm chứng bằng bắt gói của client thật (người dùng tự chạy trong trình duyệt của mình, không gửi mật khẩu cho agent) để xác nhận 14.1 và 14.2.
## 15. Spike: chạy client chính thức không hiển thị (hướng B), 2026-10-08

Ý tưởng: thay vì viết lại logic auto/di chuyển, chạy chính client của game nhưng bỏ phần vẽ. Server giao toàn bộ việc tự di chuyển và đánh cho client, nên logic đó nằm trong mã client.

### 15.1 Đã thử (offline, không mạng, không đăng nhập) — `scripts/spike-vendor-client-boot.cjs`

Nạp lần lượt 241 script theo thứ tự `index.html` trong `node:vm` với `window`, `document`, `localStorage`, `WebSocket`, canvas... là đối tượng giả (Proxy trả về chính nó cho mọi truy cập). Kết quả **[Đã đo]**:

- 239/241 script nạp thành công. Hai lỗi vô hại: script chuyển trang (`location.replace`) và script thống kê Cloudflare (không có trong snapshot).
- `window.PNTT` có 223 khóa. Có đủ các module cốt lõi: `Game` (`init`, `start`, `changeScene`), `Gateway` (88 khóa: `connect`, `login`, `send`, `cmd`, `attack`, `skill`, `remotes`, `selfId`...), `SceneWorld` (`enter`, `update`, `draw`, `switchMap`, `reviveAtHome`, `reviveOnSpot`, `cancelApproach`, `onPlayerSpell`...), `Player`, `Enemy`, `Skills`, `Targeting`, `Pathfinder`, `TileMap`, `MapData`, `Input`, `Net`.
- Chạy 40 callback timer đã đăng ký: 0 lỗi ném ra. Nhưng chưa có socket nào được mở và `Game.scene` còn rỗng (`null`): vòng đời game chưa được khởi động.

### 15.2 Tín hiệu thuận lợi

- `SceneWorld.update` và `SceneWorld.draw` là hai hàm riêng: có thể tự gọi `update(dt)` và không bao giờ gọi `draw`.
- Các module logic (Pathfinder, Skills, Targeting, TileMap, Enemy, Player) đã nạp được với đối tượng giả tối thiểu. Các script sinh dữ liệu và test A3 trước đó cũng chạy chúng trong vm.
- Client dùng `new WebSocket(url)` với `onopen`/`onmessage` dạng thuộc tính: thay bằng gói `ws` của Node là đủ.

### 15.3 Chưa biết (cần thử tiếp)

1. Khởi động vòng đời: `Game.init`/`Game.start`, tạo cảnh `SceneWorld.enter` khi không có canvas thật; `Net.init` và đăng nhập (đưa phiên Supabase vào), `Gateway.login`/`connect`.
2. Các module vẽ bị gọi ngầm trong `update` (VFX, Audio, Camera, Renderer): đối tượng giả có đủ không, có gây lỗi ngầm hay tốn CPU không.
3. Độ chính xác: `update(dt)` do mình gọi với `dt` và nhịp thế nào để mô phỏng giống client thật (client chạy theo khung hình ~60 Hz với `dt` thay đổi).
4. Bật Auto bằng `Input.pressAutoToggle()` trong môi trường này có chạy vòng auto không.
5. Chi phí tài nguyên (CPU, RAM) cho mỗi tài khoản so với bot hiện tại.
6. Server có coi client chạy kiểu này giống client trình duyệt không (tiêu đề, origin, hành vi mạng). Chưa biết.
7. Điều khoản dịch vụ của game về bot/tự động hóa: người dùng tự cân nhắc.

### 15.4 Bước tiếp theo đề xuất

Thử nghiệm giai đoạn 2 (cần người dùng đồng ý vì sẽ kết nối thật bằng phiên tài khoản của người dùng): khởi động `Game`/`Gateway` trong vm, thay `FakeWebSocket` bằng `ws`, đưa phiên đăng nhập của bot vào, vào game một lần, kiểm tra `Gateway.ready`, `SceneWorld.player` có vị trí và HP; tuyệt đối chưa bật Auto ở lượt này. Một phiên đăng nhập mỗi tài khoản.

### 15.5 Kết quả giai đoạn 2 (kết nối thật, chỉ quan sát), 2026-10-08

Script: `scripts/spike-vendor-client-live.cjs` (cần `TUTIEN_SPIKE_LIVE=1`; từ chối chạy nếu cổng 4000 đang có server). Lấy phiên bằng mã của dự án (`TokenManager` + DB; refresh token xoay vòng được lưu lại như worker), nạp 241 script của client vào `node:vm` (240 nạp được), thay `WebSocket` giả bằng `ws` thật, cấp phiên cho `Net.client.auth.getSession`, gọi `Gateway.connect()`. Không gọi `Game.start`, không bật Auto, không gửi lệnh gameplay, không giả `Origin`/`User-Agent`. Quan sát 25 s.

**[Đã đo]**

| Quan sát | Kết quả |
|---|---|
| Kết nối | `Gateway.connect()` thành công; `ready` sau 1014 ms; không đóng, không lỗi |
| Server chấp nhận | Có, dù không gửi `Origin` kiểu trình duyệt |
| Trạng thái do chính mã client tính | `selfId` có, `mapId` đúng, `mapEpoch` 1, `snapV` 2, `remotes` 9 (danh sách người chơi do `Gateway` tự dựng từ snap2) |
| Gói nhận | `welcome`, `map`, `state`, `status`... và `snap2` 246 gói (~10 Hz), `act` 149, `kill` 86, `loot` 22, `hon` 98... |
| Lỗi trong trình xử lý gói của client | 0 |
| `SceneWorld.player` | chưa có: cảnh game chưa khởi động |

Kết luận: toàn bộ lớp mạng của client chính thức (`Gateway`) chạy được trong Node không hiển thị với server thật, xử lý trọn gói `welcome`, `state`, `map`, `snap2` mà không lỗi.

**Chưa làm / chưa biết**
1. Khởi động cảnh: `Game.init`/`Game.start`, `SceneWorld.enter`, tạo `Player` và nạp bản đồ khi không có ảnh/canvas thật (`Assets.ensureMap`).
2. Gọi `SceneWorld.update(dt)` thủ công và để mặc `draw`: chi phí CPU và lỗi ngầm.
3. Bật Auto (`Input.pressAutoToggle`) rồi quan sát `move`/`attack`/`skill` client tự gửi; so với client trình duyệt thật.
4. Lượng gói client này gửi đi (chưa đếm `move`, `ping` ở lượt này).
5. Server có phân biệt kiểu kết nối này với trình duyệt không; điều khoản dịch vụ.
6. Phiên đăng nhập: refresh token đã xoay vòng và được lưu lại; cần kiểm tra bot vẫn đăng nhập được ở lần chạy kế tiếp.

### 15.6 Kết quả giai đoạn 3 (OFFLINE): cảnh game và Auto của client chạy không hiển thị, 2026-10-08

Scripts: `scripts/lib/vendor-env.cjs` (môi trường giả dùng chung), `scripts/spike-vendor-scene-offline.cjs`, `scripts/spike-vendor-auto-offline.cjs`. Không mạng, không đăng nhập: client ở chế độ offline tự mô phỏng quái cục bộ.

**[Đã đo]**

| Quan sát | Kết quả |
|---|---|
| Khởi động cảnh | `Game.init`, `SceneWorld.startMapData/nuongNenDau`, `Game.changeScene(SceneWorld)` chạy được; có `SceneWorld.player`, bản đồ `tan_vien` |
| Vòng `update` thủ công (không `draw`) | 600 lần `update(1/60)`, 0 lỗi; khoảng 78 ms CPU thật cho 10 giây mô phỏng (khoảng 130 lần nhanh hơn thời gian thực, số đo trên máy dev Windows) |
| Chuyển map | `SceneWorld.switchMap('thanh_truc_lam')` sang đúng map, 62 quái (khớp `map-spawns.generated.ts`). Phải thay `Assets.ensureMap` bằng hàm trả ngay vì ảnh giả không bao giờ báo đã tải |
| Cảnh giới | `Player.setRealm(player, 'luyen_khi_8')` cho 225/188 HP/MP, đúng bảng cảnh giới |
| Auto | `Input.pressAutoToggle()` bật được `autoOn`. Trong 45 s mô phỏng: đi tới quái, 41 đòn thường, hạ 5 quái, bị đánh từ 225 xuống 0 HP và gục ở giây 43 (trạng thái `down`) |
| Lỗi | 0 lỗi `update`, 0 `console.error` |
| Kỹ năng | 0 lần dùng: mô phỏng offline không có bí tịch nào đã học |

**Hai bẫy khi tự điều khiển vòng lặp** (đã xử lý trong script):
1. `Game.time` do vòng lặp chính của `Game` cập nhật, không phải `SceneWorld.update`. Phải tự tăng `Game.time += dt` mỗi bước, nếu không Auto đứng yên mãi (bộ đếm nghỉ `autoNghiDen` dựa vào nó).
2. Cờ `SceneWorld.transitioning` có thể kẹt `true` vì hiệu ứng mờ dần phụ thuộc DOM giả; script tắt tay sau 5 s mô phỏng.

**Ý nghĩa**
- Logic "Tự Động" đúng chuẩn client (chọn mục tiêu, tìm đường, tiếp cận, đánh, nhịp đòn) chạy được trong Node mà không cần viết lại. Đây là cơ sở để thay các giai đoạn P2 đến P4 viết tay bằng việc chạy client thật.
- Auto của client KHÔNG tự tránh nguy hiểm, hồi máu hay rút lui: nhân vật mô phỏng chết sau khoảng 43 s khi đánh cụm quái. Cần lớp an toàn bao ngoài (ngưỡng HP, dừng Auto, rút lui, hồi sinh). Lưu ý đây là mô phỏng offline, sát thương và hành vi quái có thể khác server thật.
- Trong client chạy ngầm, `SceneWorld.player.hp` là mô hình HP của chính client (khởi tạo đầy, được `you`/`hurt` sửa), có thể dùng làm nguồn HP thay cho việc tự dựng.

**Chưa làm**
1. Chế độ ONLINE: cảnh game cùng `Gateway` đã kết nối (mã client dùng `h()` để chọn nhánh server), để Auto gửi `move`/`attack`/`skill` thật. Cần xác nhận thứ tự khởi động (tạo cảnh trước rồi kết nối, `enterServerMap`), và đếm gói client gửi đi so với bot cũ.
2. Lớp an toàn bao ngoài Auto (HP thấp, `hurtCount`, gục, hồi sinh) và nút dừng khẩn.
3. Chi phí CPU/RAM trên Linux và với nhiều tài khoản; độ chính xác nhịp `update` so với client trình duyệt (60 Hz, `dt` thay đổi).
4. Hành vi tiến trình dài (rò rỉ bộ nhớ, bộ đếm thời gian giả tăng mãi).

### 15.7 Kết quả giai đoạn 4 (ONLINE): Auto của client chạy không hiển thị trên game thật, 2026-10-08

Script: `scripts/spike-vendor-auto-online.cjs` (cần `TUTIEN_SPIKE_LIVE=1`; từ chối chạy nếu cổng 4000 có server). Phiên lấy bằng mã dự án (refresh token xoay vòng được lưu lại). Nạp client vendor trong `node:vm`, thay `WebSocket` bằng `ws` có đếm gói, vòng lặp thời gian thật 16 ms gọi `Game.scene.update(dt)` (không `draw`, tự tăng `Game.time`), `Gateway.login`, dựng cảnh, bật `Input.pressAutoToggle()`. Lớp an toàn bao ngoài, kiểm tra mỗi 250 ms: dừng Auto và ngắt phiên nếu HP dưới 50 %, nhân vật gục, mất kết nối, hoặc hết thời gian. Không giả `Origin`/`User-Agent`.

**[Đã đo] Chạy không bật Auto (đứng yên ~12 s):** cảnh khớp server (cùng map `thanh_truc_lam`, cùng vị trí, 225/225 HP, 62 quái); client gửi đúng **một gói `hello`**, không `move`, không `ping`. Khớp với kết quả đọc mã (`AUTO_SPEC.md` mục 14).

**[Đã đo] Ba lần bật Auto (30 s, 20 s, 15 s), cùng nhân vật ở `thanh_truc_lam`:**

| Chỉ số | Lần 30 s | Lần 20 s | Lần 15 s |
|---|---|---|---|
| Gói `move` gửi | 150 | 94 | 79 |
| `attack` (đòn thường) | 21 | 15 | 8 |
| `skill` | 4 | 2 | 3 |
| `cmd` | 4 (`loot.pick`) | 1 | 2 (`loot.pick`) |
| Gói server trả liên quan | `hit` 19, `skill_res` 4, `you` 15 | `hit` 9, `you` 9 | |
| Quái do nhân vật hạ (`kill` có `by` là chính mình) | chưa đếm | 6 | 3 |
| `hurt` nhận | 0 | 0 | 0 |
| HP cuối | 225/225 | 225/225 | 225/225 |
| Quãng đường | 151 px | 187 px | 50 px |
| Lỗi `update` / lỗi xử lý gói / `console.error` | 0 / 0 / 0 | 0 / 0 / 0 | 0 |

- Tốc độ gửi `move` trung bình khoảng 4,8 gói/s khi Auto chạy (client chỉ gửi khi trạng thái đổi); phân bố `st`: `walk` nhiều nhất, rồi `attack`, `pose`, `idle`.
- `ping` kèm thống kê: 1 gói trong lần chạy 30 s, nhận 1 `pong`; phù hợp chu kỳ khoảng 30 s.
- Lệnh `cmd` duy nhất client tự gửi trong Auto là `loot.pick` (nhặt vật rơi sau khi hạ quái).
- Kỹ năng được dùng (2 đến 4 lần mỗi phiên): server trả `skill_res`; nhân vật thật có kỹ năng đã học.
- Mỗi lần chạy kết nối và ngắt sạch (`closeInfo` rỗng trong suốt phiên); server chấp nhận kết nối từ client chạy kiểu này.

**Ý nghĩa**
- Hướng "dùng thẳng client, bỏ phần hiển thị" khả thi trên game thật: di chuyển, chọn mục tiêu, đánh thường, kỹ năng, nhặt đồ đều do mã client chính thức quyết định.
- Các giai đoạn tự viết P2 đến P7 không còn là đường chính cho việc đánh quái; thay bằng lớp bao ngoài (an toàn, cấu hình, quan sát) quanh client.
- Vẫn không có bằng chứng server phân biệt hay không phân biệt client này với trình duyệt: 3 phiên ngắn không bị từ chối không chứng minh điều đó.

**Chưa biết / việc tiếp theo**
1. Chạy dài (hàng giờ): rò rỉ bộ nhớ, trôi đồng hồ giả/thật, tái kết nối khi rớt mạng, token hết hạn giữa phiên.
2. Lớp an toàn đầy đủ: rút lui/dừng khi HP thấp (hiện chỉ dừng và ngắt phiên), hồi sinh, xử lý boss/cụm quái nguy hiểm, giới hạn khu vực.
3. Tích hợp vào `apps/server` (module chạy ngầm thay cho `core-client` ở tài khoản này), runtime/UI hiển thị, cấu hình bật tắt Auto, kỹ năng ưu tiên (`pref.thanhChieu`).
4. Chi phí CPU/RAM trên Linux và với nhiều tài khoản; đo thật.
5. Bàn giao phiên sang trình duyệt (`PLAN_SESSION_HANDOFF.md`) và quy tắc phiên của server.
6. Điều khoản dịch vụ của game về bot/tự động hóa: người dùng tự cân nhắc.

### 15.8 Lớp an toàn: nhớ vị trí Auto, chết thì quay về tiếp tục, 2026-10-08

Yêu cầu của người dùng: lớp an toàn là **nhớ map và toạ độ nơi bật Auto; sau khi chết thì quay trở lại đúng vị trí đó để tiếp tục**.

Mã: `scripts/lib/auto-supervisor.cjs` (bộ giám sát, chỉ dùng API của client chính thức nên chạy được cho mô phỏng offline lẫn client online), `scripts/spike-vendor-supervisor-offline.cjs` (bài thử offline), tùy chọn `TUTIEN_SPIKE_SUPERVISE=1` trong `scripts/spike-vendor-auto-online.cjs`.

**Vòng đời:** `farming` (Auto bật, đã ghi neo `{mapId, x, y}` lúc bắt đầu) → `down_wait` (gục: tắt Auto, chờ 1,5 s) → `reviving` (gọi `SceneWorld.reviveAtHome()` mặc định; `reviveMode:'spot'` thì thử `reviveOnSpot()` rồi mới về làng) → `recovering` (ngồi thiền bằng `Input.pressMeditate()` tới 90 % HP) → `traveling` (tìm chuỗi map bằng đồ thị cổng `MapData.*.portals`, đi tới ô cổng gần nhất bằng `Pathfinder.route` + `player.setPath`, client tự đổi map khi bước lên cổng; tới map đích thì đi tới đúng toạ độ neo) → `resuming` (bật Auto) → `farming`. `halted` khi vi phạm giới hạn và không tự thoát.

**Giới hạn an toàn:** quá 3 lần chết trong 600 s thì dừng hẳn; hồi sinh quá 20 s, hồi phục quá 180 s, đi về quá 240 s, cổng không mở sau 8 s, không tìm được đường 8 lần, HP dưới 35 % khi đang đi về: đều dừng và báo lý do. Chết ở bất kỳ pha nào kể cả đang đi về đều quay lại vòng hồi sinh.

**[Đã đo] Offline** (mô phỏng cục bộ, `thanh_truc_lam`, neo `(240,92)`), ba lần chạy độc lập 400 s (mô phỏng quái ngẫu nhiên nên mỗi lần khác): mỗi lần chết đều → hồi sinh về `tan_vien` (HP 60 %) → thiền → đi qua cổng `tan_vien` sang `thanh_truc_lam` → về tới **cách neo 13 px** với HP 90 % → bật Auto lại. Tổng 4 đến 5 lần chết mỗi lần chạy, 4 chuyến về đều thành công, không lần nào dừng ngoài ý muốn; với giới hạn 3 lần chết trong 600 s, lần thứ 4 bị chặn (đã thấy ở lần chạy với `maxDeaths=3`). 0 lỗi `update`, 0 `console.error`.

**Ba lỗi tìm ra khi thử và đã sửa:**
0. Auto vẫn BẬT trong lúc đi về nên nhân vật lao đi đuổi quái thay vì về neo (một lần chạy dừng ở HP 33 % cách neo hơn 200 px). Nay bộ giám sát ép Auto TẮT ở mọi tick của các pha `down_wait`, `reviving`, `recovering`, `traveling`; bộ tìm đường không trả đường cho khoảng cách dưới một ô nên có thêm quy tắc "đã trong một ô quanh neo thì coi là tới"; bán kính mặc định 16 px.
1. Hàng đợi `requestAnimationFrame` của môi trường giả không bao giờ chạy nên `SceneWorld.transitioning` kẹt `true` sau khi đổi map; nay `env.flushRaf()` chạy hàng đợi mỗi khung hình (đã gắn vào các script).
2. Lệnh bật/tắt Auto được xếp hàng (`Input._autoToggle`) và chỉ xử lý ở khung sau: bấm khi còn lệnh chờ thì hai lệnh triệt tiêu nhau. Nay `setAuto(desired)` không bấm khi còn lệnh chờ.

Hai lỗi môi trường (ảnh hưởng cả script online) đã nêu ở trên là mục 1 và 2:

**Chưa kiểm chứng (cần lưu ý trước khi dùng trên game thật)**
- **Chết và hồi sinh trên game thật CHƯA thử.** Lệnh hồi sinh online (`cmd("revive",{mode})`) chỉ đã được đọc từ mã client. Cái chết thật làm mất Đạo Hạnh (`lostExp`) và có giới hạn số lần hồi sinh tại chỗ (`MAX_REVIVES = 3`); không nên thử chết cố ý khi chưa có quyết định của người dùng.
- Offline dùng logic hồi sinh/quái cục bộ; sát thương, thời gian chờ hồi sinh và gói `down`/`revived` của server có thể khác.
- Khu (`khu`): neo chưa ghi khu thật; nếu hồi sinh/đi cổng đưa về khu khác thì chưa xử lý (giao thức chọn khu mới chỉ đọc từ mã).
- Đi về qua cổng có thể bị chặn bởi điều kiện mở khóa của map; supervisor dừng với lý do `cổng ... không mở`.
- Neo là vị trí lúc bật Auto: Auto của client tự rời neo để đuổi quái, supervisor chỉ đưa về neo sau khi chết, chưa kéo về khi trôi xa (không được yêu cầu).
- Chưa tích hợp vào `apps/server` (hiện là script spike).
### 15.9 Quyết định tích hợp server, 2026-10-08

Các spike ở 15.5–15.8 nay được viết lại thành module TypeScript trong `apps/server/src/headless/`: `vendor-env.ts`, `vendor-runner.ts`, `auto-supervisor.ts`. Đây là đường chính cho tài khoản chọn `engine: "vendor"`; các pha P2 đến P7 viết tay trong `automation-engine` chỉ còn là đường legacy cho `engine: "core"`, không bị xóa và không tự chuyển account hiện có.

Runner giữ một phiên cho một account, lấy token bằng `TokenManager`, chỉ dùng `CONFIG.GAME_SERVER_URL`, dựng cảnh sau `Gateway.login`, chạy đồng hồ thật khoảng 16 ms và không gọi `draw`. Auto chỉ bật qua API/UI; runtime/dashboard hiển thị lifecycle, pha supervisor, neo, chết/chuyến về, `hurtCount`, packet counters, lỗi xử lý và cảnh báo halted. `start` bị từ chối khi engine khác đang chạy; `stop` luôn tắt Auto, dừng player và ngắt socket.

Các bẫy 1–6 của 15.6/15.8 được giữ thành invariant/test: tăng `Game.time`, flush rAF, Assets settle ngay, không toggle khi queue còn lệnh, Auto off trong mọi pha hồi sinh/hồi phục/đi về, và coi khoảng cách dưới một ô là đã tới nếu Pathfinder không trả route. Đồng hồ giả/RNG có hạt giống chỉ dùng offline test; runner online dùng `Date.now()`/`performance.now()` thật.

Chưa xác minh live sau khi chuyển module: reconnect thật, refresh token hết hạn giữa phiên, chạy dài/CPU-RSS, chết/hồi sinh thật và quy tắc khu. Không dùng `process.chdir`; vendor snapshot được nạp read-only và `node:vm` chỉ là capability boundary cho mã trusted, không phải sandbox bảo mật.
