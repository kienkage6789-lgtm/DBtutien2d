# Danh mục chức năng giao diện người chơi (từ client chính thức)

Nguồn: `vendor/tutien2d-public-client/2026-10-06` (56 module `src/ui`, 35 module `src/systems`, `src/net/gateway.js`, `index.html`). Ngày lập: 2026-10-08.

**Cách đọc.** Mã vendor đã minify. Cột "Lệnh" được trích bằng regex từ các lời gọi `cmd("...")` và `send({op:...})` nên chắc chắn là CÓ trong client; phần mô tả chức năng suy ra từ tên module, lệnh và chuỗi tiếng Việt trong giao diện, CHƯA đọc kỹ từng module (ghi "suy ra"). Cột "Core" là trạng thái trong `packages/core-client/src/client.ts`: ✅ đã có phương thức; ❌ chưa có. "Live" là đã kiểm chứng trên game thật (hầu hết chưa).

Lưu ý quan trọng: regex chỉ bắt được lệnh có tên là chuỗi hằng. Một số lệnh dựng động (ví dụ `tmc.` + hậu tố) hoặc gọi qua `sendRaw` có thể còn thiếu. Tổng cộng tìm được 94 lệnh `cmd(...)` khác nhau.

## 0. Hai giao thức từng bị ghi là "chưa xác minh" nay đã tìm thấy trong client

| Chức năng | Giao thức trong client | Ghi chú |
|---|---|---|
| Chọn khu | Xem danh sách: `send({op:"khu", act:"xem"})`. Chọn: `send({op:"khu", act:"chon", khu:N})`. Server trả gói `op:"khu"` với `mapId`, `dem[]` (số người mỗi khu), `toiDa`, `tran[]` (sức chứa từng khu), `khu` (khu hiện tại) | Nguồn: `ui/khu.js`, `net/gateway.js` (`case "khu"`). Chưa kiểm chứng live; ACK/đổi `khu` thành công thể hiện qua gói `map` mới |
| Hồi sinh | `cmd("revive", {mode:"home"})` (về làng) hoặc `cmd("revive", {mode:"spot"})` (tại chỗ). Gói `down` có `left` (đếm ngược), `revived` mang hp/mp | Nguồn: `scenes/world.js` (`reviveAtHome`, `reviveOnSpot`), `ui/downed.js`. Giới hạn số lần hồi sinh tại chỗ (`DOWNED.MAX_REVIVES`) và tự về làng sau `DOWNED.AUTO_HOME`; hằng số nằm trong `core/config.js`. Chưa kiểm chứng live |

Hai khóa `KHU_PROTOCOL_UNAVAILABLE` và `RESPAWN_PROTOCOL_UNAVAILABLE` trong dự án đang dựa trên giả định "không có giao thức"; giả định đó sai về mặt tồn tại lệnh. Gỡ khóa chỉ sau khi kiểm chứng live.

## 1. Nhân vật, chỉ số, tu luyện

| Chức năng (suy ra) | Module | Lệnh | Core | Live |
|---|---|---|---|---|
| Thanh HP/MP/linh lực, thông tin cảnh giới, túi đồ nhanh | `ui/hud.js` (48KB), `ui/chiso.js` | `giftcode`, `nghiep.uongDan` | ❌ giftcode, ❌ uống đan | — |
| Đả tọa (thiền) | `ui/hud.js`, `systems/breakthrough.js` | `meditate` | ✅ `meditate` | — |
| Đột phá cảnh giới | `ui/huyet_sac.js`, `systems/breakthrough.js` | `breakthrough` | ✅ `breakthrough` | — |
| Gục và hồi sinh | `ui/downed.js` | `revive` (home/spot) | ❌ | ❌ (xem mục 0) |
| Linh căn, ngoại hình (cửa hàng ngoại hình) | `ui/hud.js`, `index.html` (`appearance-*`) | `appearance.buy` | ❌ | — |
| Xem người chơi khác | `ui/inspect.js` | `player.inspect` | ❌ | — |
| Điểm danh hằng ngày | `systems/diem_danh.js` | `diemdanh` | ✅ `dailyCheckin` | chưa xác nhận trong phiên này |
| Hướng dẫn tân thủ, màn tạo nhân vật | `ui/tutorial.js`, `ui/daohuongdan.js`, `scenes/charcreate.js`, `scenes/prologue.js` | — | — | không cần tự động hóa |

## 2. Túi đồ, trang bị, vật phẩm

| Chức năng | Module | Lệnh | Core | Live |
|---|---|---|---|---|
| Túi đồ, mở rộng túi | `ui/hud.js` (panel `bag-*`) | `bag.expand`, `bag.useItem` | ✅ `expandBag`, `useBagItem` | — |
| Mặc/tháo/bán/vứt | `ui/hud.js`, `ui/xemtudo.js` | `item.equip`, `item.unequip`, `item.sell`, `item.discard` | ✅ `equipItem`, `unequipItem`, `sellItem`, `discardItem` | — |
| Rèn đúc | `ui/forge.js`, `systems/forge.js` (26KB) | chưa thấy tên lệnh hằng; gần đó: `quest.binhKhi` | ❌ | — |
| Nhặt vật rơi | `systems/loot.js` | `loot.pick` | ✅ `pickLoot` | chưa xác nhận trong phiên này |
| Thức ăn | `systems/food.js` | `food.buy`, `food.eat` | ✅ `buyFood`, `eatFood` | — |
| Bùa chú (thanh bùa) | `ui/talismanbar.js`, `systems/talismans.js` | `talisman.use`, `talisman.buy` | ✅ `buyTalisman`; ❌ dùng bùa | — |
| Pháp bảo, hộp, cổ bích mộc | `systems/phapbao.js`, `ui/hop.js`, `ui/encyclopedia.js` (45KB, bách khoa) | `hop.mo`, `op:co_bich_moc` | ❌ | — |
| Bảng bách khoa (tra vật phẩm) | `ui/encyclopedia.js`, `systems/items.js` (141KB, bảng ITEMS) | — | dữ liệu tĩnh đã dùng cho `derivedMax` | — |

## 3. Chiến đấu, kỹ năng, thanh phím tắt

| Chức năng | Module | Lệnh/op | Core | Live |
|---|---|---|---|---|
| Đánh thường, kỹ năng | `systems/skills.js` (67KB), `ui/skillbook.js`, `ui/hotbar.js`, `ui/quickslots.js` | `op:"attack"`, `op:"skill"`, `skill.select`, `skill.biDong`, `pref.thanhChieu` | ✅ `attackMob`, `castSkill`; ❌ chọn kỹ năng, bị động | không có ACK riêng |
| Chọn mục tiêu (ưu tiên: tự động / boss / quái / người / máu ít) | `systems/targeting.js`, `index.html` (`data-uu-tien`) | — (phía client) | ❌ (cần tự cài đặt trong bot) | — |
| Phát hiện quái, boss | `ui/bossboard.js`, `ui/cong_boss.js`, `systems/top_boss.js` | `op:"bosses"` | ❌ | — |
| Hạ gục, kinh nghiệm | gói `kill`, `act` | — | nhận gói nhưng chưa dùng | thấy trong tap |

## 4. Bản đồ, di chuyển, khu

| Chức năng | Module | Lệnh/op | Core | Live |
|---|---|---|---|---|
| Di chuyển | `net/gateway.js` | `op:"move"` (seq, ep) | ✅ `sendMove` | có |
| Bản đồ thế giới, dịch chuyển | `ui/worldmap.js` (25KB) | `op:"enter"` | ✅ `enterMap` (qua cổng) | có |
| Chọn khu | `ui/khu.js` | `op:"khu"` | ❌ | ❌ |
| Thoát kẹt | — | — | ✅ `escapeStuck` | — |
| Truyền tống | `ui/truyentong.js`, `systems/truyentong.js` | `truyentong.di` | ❌ | — |
| Bay (fly) | `index.html` (`btn-fly`), packet `fly`, `fs` | trong gói `move` | trường có sẵn | — |

## 5. Nhiệm vụ

| Chức năng | Module | Lệnh | Core | Live |
|---|---|---|---|---|
| Nhiệm vụ chính, nộp | `systems/quest.js` (84KB), `index.html` (`quest-*`) | `quest.turnIn`, `quest.bachKhoaAnswer`, `quest.binhKhi` | ✅ `questTurnIn`; ❌ trả lời bách khoa, binh khí | — |
| Nhiệm vụ ngày / hạt giống (seed) | `systems/quest.js` | `seed.start`, `seed.collect`, `seed.complete`, `seed.escortComplete`, `seed.cancel`, `seed.buyPack` | ✅ start/collect/complete; ❌ escort, cancel, buyPack | — |
| Nói chuyện NPC | `scenes/world.js` | `talk` | ✅ `talkNpc` | — |
| Hang động / bí cảnh | `ui/hud.js` | `cave.start`, `cave.chest` | ✅ | — |

## 6. Kinh tế và thương mại

| Chức năng | Module | Lệnh | Core | Live |
|---|---|---|---|---|
| Chợ (giao dịch người chơi) | `ui/market.js` (17KB), `systems/market.js` | chưa thấy tên lệnh hằng | ❌ | — |
| Hắc thị, đấu giá | `ui/hacthi.js`, `systems/hac_thi.js` | `hacthi.tayNai`, `hacthi.dauGia` | ❌ | — |
| Cửa hàng chuyên biệt | `world.js` | `daogia.buy`, `kimquang.buy`, `xichma.buy`, `vankiem.buy`, `mabaoan.buy`, `daitanmagic.buy`, `sectskill.buy`, `formation.buy` | ❌ | — |
| Gacha bí tích | `ui/gacha.js`, `ui/bitichluc.js` (18KB), `systems/gacha.js` | `bitich.gacha`, `bitich.point`, `bitich.equipTask`, `bitich.start`, `bitich.finish` | ❌ | — |
| Đổi mã quà | `ui/hud.js` | `giftcode` | ❌ | — |

## 7. Sinh hoạt: trồng trọt, câu cá, hái thuốc

| Chức năng | Module | Lệnh | Core | Live |
|---|---|---|---|---|
| Ruộng linh thảo | `systems/farm.js` | `farm.sow`, `farm.water`, `farm.harvest` | ✅ | — |
| Hái dược thảo | `world.js` | `resource.harvest`, `gather` | ✅ `harvestResource`; ❌ `gather` | — |
| Câu cá | `systems/fishing.js` | `fishing.catch` | ✅ `catchFish` | — |
| Nấu (brew) | `world.js` | `brew` | ❌ | — |

## 8. Xã hội: tông môn, chat, xếp hạng, sự kiện

| Chức năng | Module | Lệnh | Core | Live |
|---|---|---|---|---|
| Tông môn (lập, xin vào, mời, sửa, giải tán, rời, đóng góp, nâng cấp, danh sách) | `ui/sect.js` (23KB), `systems/sect.js`, `ui/quansu.js` | `sect.xem`, `sect.lap`, `sect.danhSach`, `sect.xinVao`, `sect.moi`, `sect.traLoiMoi`, `sect.sua`, `sect.giaiTan`, `sect.roi`, `sect.dongGop`, `sect.nangCap`, `sect.huyDon`, `sect.muaLenh`, `sect.chat` | ✅ `sectDonate` (đóng góp); ❌ phần còn lại | — |
| Nhiệm vụ tông môn / chặt cây | `ui/hoatdong.js` (25KB) | `sect.nv.xem`, `sect.nv.chatCay`, `hoatdong.xem` | ✅ `sectChopTree`; ❌ xem | — |
| Chat thế giới | `ui/chat.js` (21KB) | `op:"world_chat"` | ✅ `sendWorldChat` | — |
| Xếp hạng | `ui/xephang.js` | `xephang.xem`, `xephang.tusi` | ❌ | — |
| Vinh danh, phòng chờ | `ui/phongcho.js` | `vinhdanh.xem` | ❌ | — |
| Đại hội, chiến bảng, tỉ thí | `ui/daihoi.js`, `ui/chienbang.js`, `systems/tournament.js`, `systems/chienbang.js` | `daihoi.doi`, `chienbang.danh`, `chienbang.xem`, `thoatKet` | ❌ | — |
| Tông môn chiến | `ui/tongmonchien.js`, `systems/tongmonchien.js` | `tmc.…` (dựng động) | ❌ | — |
| Hú thiên, làm làng, yên làng | `ui/huthien.js`, `ui/lamlang.js`, `ui/yen_lang.js` | `huthien.xem`, `huthien.nhat`, `lamlang.xem` | ❌ | — |
| Hồn phiên, khôi lỗi, hồn (linh thú) | `ui/honphien.js`, `ui/khoiloi.js` | `hon.thinhPhien`, `hon.thinhHap`, `hon.traVat`, gói `hon`, `khoiloi` | ❌ (tap thấy `hon` gửi liên tục) | — |
| Nghiệp lực | `ui/hud.js` | `nghiep.cung`, `nghiep.uongDan` | ❌ | — |
| Trận pháp, trận mạch | `ui/formations.js` (29KB), `ui/tran_mach.js` | gói `formation` | ❌ (client có `formation.buy`) | — |
| Góp ý, email | `world.js`, `ui/account.js` | `gopy`, `email.soat` | ❌ | không cần |
| Kết giao, PvP | `ui/pvp_ket.js`, `ui/taytrai.js` | `coChien`, `keThu` | ❌ | — |

## 9. Phần không phải chức năng game (bỏ qua khi dựng bot)

`ui/touch.js`, `ui/orientation.js`, `ui/uiscale.js`, `ui/movelayout.js`, `ui/loading.js`, `ui/auth_background.js`, `ui/authui.js`, `ui/combat_icons.js`, `ui/npc_chatter.js`, toàn bộ `src/gfx`, `src/fx` (đồ họa, hiệu ứng), `src/website`.

## 10. Đề xuất thứ tự dựng lại (để bạn quyết định)

Tiêu chí: giao thức đã thấy rõ trong client, giá trị cho vòng lặp tu luyện, rủi ro thấp.

1. **Hồi sinh và chọn khu** (mục 0): mở khóa hai blocker lớn của training; cần kiểm chứng live riêng từng cái, bắt đầu bằng `khu act:"xem"` (chỉ đọc) trước khi `chon`.
2. **Chiến đấu cơ bản**: chọn kỹ năng (`skill.select`), dùng bùa, ưu tiên mục tiêu theo `data-uu-tien`; cần bắt `hurt`/`kill`/`skill_res` để xác nhận hiệu quả (game không có ACK riêng cho attack).
3. **Vòng sinh hoạt**: đả tọa, đột phá, thức ăn, uống đan (`nghiep.uongDan`), ruộng linh thảo; phần lớn đã có phương thức, thiếu kiểm chứng live.
4. **Nhiệm vụ** (quest chính và seed): đã có một phần; thiếu escort, cancel, buyPack, và máy trạng thái đi/đánh theo yêu cầu nhiệm vụ.
5. **Kinh tế**: chợ, hắc thị, cửa hàng; cần đọc kỹ module `market.js` vì chưa thấy tên lệnh hằng.
6. **Xã hội** (tông môn, đại hội, xếp hạng): ít ảnh hưởng đến tự động hóa lõi, làm sau.

## 11. Việc cần đọc kỹ tiếp (chưa đọc)

- `systems/quest.js` (84KB) và `systems/skills.js` (67KB): hai module lớn nhất, quyết định luật nhiệm vụ và hiệu ứng kỹ năng.
- `ui/market.js` / `systems/market.js`: cách đặt lệnh giao dịch (không thấy tên lệnh hằng).
- Bảng hằng số `core/config.js`: `DOWNED.*`, `RESOURCES.*`, bảng cảnh giới.
- Tên và payload của các gói server → client chưa có trong `types.ts`: `down`, `khu`, `bosses`, `hon`, `khoiloi`, `kill`, `act`, `loot`, `loot_gone`, `skill_res`, `join`, `leave`, `sect`, `mo_khoa`.
