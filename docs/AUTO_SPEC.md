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

- **Tầm đánh thường [Đọc được]**: `khoảng cách(tâm nhân vật, mục tiêu) <= Player.reach + bodyRadius(mục tiêu)`. `Player.reach = PLAYER.REACH (26) + reachBonus của vũ khí`. `bodyRadius` lấy từ định nghĩa quái (mặc định 0). "Tâm nhân vật" là `C(player)` trong mã (điểm tham chiếu chân; có thể lệch vài pixel so với `x,y` **[Chưa biết]**).
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

`shape`: `bolt` đạn, `ground` vùng đất, `aura` quanh người, `self` biến hình. "PvP" = chỉ dùng với người, bot bỏ qua. Cột mp/sp là chi phí gốc.

| id | cd (s) | cast (s) | mp | sp | range | coef | ghi chú |
|---|---|---|---|---|---|---|---|
| loi_chuong (Lôi Chưởng, THUNDER) | 5 | 0.34 | 12 | 5 | 96 | 5.45 | sét, bán kính 30, cần bí tịch riêng |
| hoa_cau | 6 | 0.4 | 14 | 4 | 124 | 1.8 | bolt, đốt 3 s |
| phong_nhan | 3.4 | 0.22 | 9 | 3 | 112 | 1.7 | bolt, 3 phát |
| bang_thau | 5 | 0.3 | 13 | 5 | 104 | 1.7 | bolt |
| dia_thich | 7.5 | 0.42 | 16 | 6 | 92 | 1.8 | ground |
| xich_chan | 12 | 0.42 | 12 | 4 | 132 | 0.7 | PvP |
| ngu_kiem_sat | 8.5 | 0.48 | 20 | 8 | 118 | 5.2 | ground |
| huyet_kiem_tran | 10 | 0.52 | 24 | 10 | 126 | 5.6 | ground |
| van_kiem_quy_tong | 12 | 0.65 | 35 | 15 | 220 | 9 | ground |
| cuu_huyet_kiem_tran | 12 | 0.6 | 28 | 12 | 96 | 6.5 | aura |
| kim_thuong_giang_the | 12 | 0.5 | 30 | 12 | 132 | 5.6 | ground |
| loi_thuong_quan_dia | 9 | 0.5 | 30 | 12 | 150 | 6.3 | ground |
| ngu_loi_thuong_vu | 14 | 0.6 | 36 | 14 | 170 | 9.8 | ground |
| thanh_lam_kiem_tru | 8 | 0.38 | 15 | 6 | 128 | 5.2 | bolt |
| anh_ky_phu | 9 | 0.44 | 18 | 7 | 192 | 6 | bolt |
| bang_kiem_tran | 11 | 0.54 | 26 | 11 | 136 | 5 | ground |
| bang_kiem_luan | 10 | 0.72 | 22 | 9 | 246 | 4.9 | aura |
| tien_vu | 11 | 0.46 | 24 | 10 | 176 | 5.25 | ground |
| tram_ma | 9 | 0.42 | 18 | 7 | 176 | 5.25 | aura |
| ma_bao_an | 13 | 0.45 | 34 | 14 | 150 | 6.6 | ground |
| ma_hon_phe | 11.5 | 0.5 | 26 | 12 | 180 | 8.5 | ground |
| nguyet_quang | 14 | 0.55 | 34 | 14 | 190 | 10.5 | ground |
| kim_quang_cu_kiem | 10 | 0.5 | 26 | 11 | 210 | 7.2 | ground, `autoFoe` |
| ngu_sac_than_chuong | 30 | 0.6 | 36 | 14 | 200 | 22.5 | ground |
| huyet_buc_chuong | 5.5 | 0.4 | 14 | 6 | 130 | 5 | ground, `autoFoe` |
| huyet_liem_tram | 7 | 0.45 | 24 | 10 | 150 | 5.8 | ground, `autoFoe` |
| tu_anh_phuoc_tien | 10 | 0.5 | 26 | 10 | 170 | 6 | ground, `autoFoe` |
| xich_ma_hoa_than | 25 | 0.6 | 30 | 12 | 140 | — | `bienHinh`, nên bỏ khỏi luân phiên của bot |

Bảng trích tự động bằng regex trên mã minify; một số kỹ năng còn có `allowedWeapons` (giới hạn vũ khí) và các trường hiệu ứng khác chưa liệt kê. Trước khi dùng cần đối chiếu từng kỹ năng với mã nguồn.

### 7.5 Kỹ năng nào nhân vật đang có **[Đọc được] / [Chưa biết]**

Kỹ năng "đã học" khi nhân vật sở hữu bí tịch (`book`) và đủ điều kiện (`lockReason`), cờ ưa thích (`autoUses`) và thứ tự do người chơi chọn (`pntt.thanhChieu.v1`, đồng bộ qua lệnh `pref.thanhChieu`). Bot cần:
- danh sách bí tịch từ `state.save.bag` (khóa `bi_tich_*`) **[Suy ra]**;
- thứ tự/ưu tiên: lấy từ `state.save.flags` hoặc gói tương ứng **[Chưa biết]**, chưa thấy trong evidence; nếu không có thì dùng thứ tự `Skills.SLOTS` mặc định.

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
| Ý nghĩa `hp` của quái | — | **[Chưa biết]**: có thể là phần trăm (như người chơi) hay tuyệt đối; cần đối chiếu `hpMax` trong định nghĩa quái |
| Định nghĩa quái (tên, `isBoss`, `human`, `bodyRadius`, `hpMax`) từ loại `t` | `entities/enemy.js`, `world/*` | ❌ chưa trích; bắt buộc để lọc boss/người và tính tầm |
| HP/MP/SP của mình | `you` (mỗi 10 `seq`), `hurt`, `revived` | ✅ có + `refreshVitals` |
| SP, BP | `you.sp`, `you.bp` | trong gói nhưng chưa vào `VitalSnapshot` |
| Cooldown kỹ năng của server | — | **[Chưa biết]**; bot phải tự theo dõi cục bộ như client |
| Kỹ năng đã học, thứ tự | `state.save` (bag/flags) | ❌ chưa trích |
| Lưới va chạm để tìm đường | `world/*`, `walk-grid.ts` | ⚠️ chỉ có cho một số map (portal); chưa đủ cho vùng farm |
| Xác nhận đòn đánh | `hurt`, `kill`, `skill_res`, thay đổi `hp` quái | ❌ chưa parse `kill`, `skill_res` |

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
| P0 | Trích định nghĩa quái (tên, `isBoss`, `human`, `bodyRadius`, `hpMax`) và ý nghĩa `hp`, `t`, `st`, `tg`; parse `kill`, `skill_res`, `down` | Bảng quái đủ cho một map farm; test parser bằng gói ghi từ tap |
| P1 | `selectTarget` thuần hàm theo mục 4 (mặc định gần nhất) | Test với snapshot ghi lại: chọn đúng, giữ mục tiêu theo `KEEP_PAD`, không chọn quái chết/`human` |
| P2 | `approach`: tìm đường tới tầm đánh, tìm lại mỗi 0,4 s, giới hạn 8 s | Test trên lưới của map farm; live: đi tới quái đứng yên, dừng đúng tầm |
| P3 | `attack` đánh thường qua ledger | Live trên 1 quái yếu: gửi đúng `attackTime`, `hp` quái giảm, nhận `kill`; không có đòn trùng |
| P4 | Kỹ năng: `pickAuto`, cooldown cục bộ, kiểm tra mp/sp, `skill_res` | Live: luân phiên đúng thứ tự, tổng mp trừ khớp, không niệm khi thiếu mp |
| P5 | Nghỉ/thiền theo ngưỡng; xử lý `hurt` khi thiền | Live: tự thiền khi hết mp rồi quay lại đánh |
| P6 | Gục/hồi sinh (sau khi kiểm chứng `revive`) | Live có kiểm soát: nhận `down`, `revive`, tiếp tục |
| P7 | Nối vào state machine training; log và dừng khẩn cấp | Chạy 10 phút ổn định, không vi phạm gate |

**Điểm dừng an toàn xuyên suốt:** gục, mất kết nối, `hurt` liên tục vượt ngưỡng, không tới được mục tiêu quá N lần, gặp boss khi cấu hình "né boss", HP/MP không rõ quá lâu, người dùng bấm dừng.

## 13. Những gì chưa biết (cần đo trước khi tin)

1. Server có kiểm tra cooldown/mp/sp và tốc độ gửi `attack`/`skill` không, và phản hồi khi vi phạm.
2. Server có giới hạn tần suất hoặc phát hiện hành vi lặp (chống bot) không. Không có dấu hiệu trong client, nhưng kiểm tra đó nếu có sẽ nằm ở server.
3. Ý nghĩa `hp` của quái và các trường `t, st, tg, zn, fz, sl, slm, hm, d, wn, bn`.
4. Payload của `kill`, `skill_res`, `hurt` đối với đòn từ quái.
5. Danh sách kỹ năng nhân vật hiện có và thứ tự ưu tiên.
6. `autoNghiDen`, `C(player)` và các điều kiện `giuYen` chính xác.
7. Hành vi của quái đối với bot (đuổi, leash) so với client chính thức.
