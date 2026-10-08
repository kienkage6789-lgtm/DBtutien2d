Đọc AGENTS.md trước, rồi docs/AUTO_SPEC.md (đặc biệt mục 7, 10, 12, 13), docs/UI_FEATURE_INVENTORY.md và docs/SESSION_LOG.md (mục mới nhất). Repo có git, working tree sạch; KHÔNG commit, để thay đổi trong working tree.

MỤC TIÊU: giai đoạn P0 của docs/AUTO_SPEC.md
Dựng lớp DỮ LIỆU và PARSER nền cho auto, hoàn toàn bằng phân tích tĩnh mã client trong vendor và dữ liệu đã ghi sẵn. KHÔNG chạy server, KHÔNG đăng nhập game, KHÔNG gửi packet nào. Không sửa vendor. Không đổi hành vi bot hiện có.

CÁC HẠNG MỤC (làm theo thứ tự)

P0.1 Định nghĩa quái (enemy defs)
- Tìm trong vendor/tutien2d-public-client/2026-10-06/src (gợi ý: entities/enemy.js, world/*, core/config.js, scenes/world.js) bảng định nghĩa quái: id/loại, tên, isBoss, human, bodyRadius, hpMax (hoặc tương đương), exp, respawnSec, level, kích thước sprite nếu liên quan tầm, và bất kỳ trường nào ảnh hưởng chọn mục tiêu/tầm đánh. Xác định trường `t` của hàng quái trên wire (snap2.ef, snap2.e, map.e) ánh xạ vào định nghĩa nào (khóa bảng nào), và `d`, `hm`, `st`, `tg`, `zn`, `fz`, `sl`, `slm`, `wn`, `bn`, `hp`, `dir` nghĩa là gì: đọc đúng hàm client dựng/cập nhật thực thể quái từ gói (gateway.js, enemy.js, world.js). Với mỗi trường ghi: ý nghĩa, đơn vị, miền giá trị, nguồn (file + tên hàm), và nhãn [Đọc được] / [Suy ra] / [Chưa biết].
- Đặc biệt trả lời: `hp` của quái trên wire là phần trăm hay tuyệt đối? quái chết được báo bằng cờ nào (`d`? gói `kill`?)? `st` có những giá trị nào?
- Sinh bảng thành file TypeScript bằng script (ví dụ scripts/gen-enemy-defs.mjs, theo phong cách scripts/gen-derived-vitals.mjs): đầu file ghi nguồn vendor và lệnh sinh lại. Khuyến nghị: nạp các file vendor cần thiết trong `node:vm` với `window`/`document` giả tối thiểu để lấy đối tượng dữ liệu thật, thay vì regex trên mã minify; script phải KHÔNG truy cập mạng/FS ngoài việc đọc file vendor, và nếu không nạp được thì ghi rõ lý do và dùng cách dự phòng có kiểm chứng chéo.
- Kiểm chứng chéo: dùng ít nhất 3 mục (một quái thường, một boss, một loại `human`) để đối chiếu giá trị sinh ra với mã nguồn gốc.

P0.2 Định nghĩa kỹ năng đầy đủ
- Sinh bảng kỹ năng từ systems/skills.js (DEFS, SLOTS, THUNDER_DEF, THUNDER trong config): id, shape, cooldown, cast, mp, sp, range, coef, blastR, shots, allowedWeapons, autoFoe, playerTargetOnly, bienHinh, instantOnPress, book (id bí tịch), thunder. Bảng ở docs/AUTO_SPEC.md mục 7.4 trích bằng regex nên có thể thiếu trường: hãy đối chiếu và nêu rõ chỗ lệch; sửa bảng trong tài liệu nếu sai.
- Xác định chính xác khi nào kỹ năng "đã học" (known/ownsBook/lockReason/slotKnown) và nguồn dữ liệu nhân vật tương ứng trong `state.save` (bag khóa `bi_tich_*`? flags? `thuTu`/`tat`/`an` của pref `pntt.thanhChieu.v1`?). Viết hàm thuần `deriveLearnedSkills(save)` trả danh sách kỹ năng đã học; nêu rõ phần nào suy ra được từ gói state.save (đã có trong evidence: saveKeys gồm bag, bound, equipment, flags, linhCan, realm, stage...), và phần nào [Chưa biết] (ví dụ thứ tự ưu tiên/bật tắt auto nếu không có trong save).

P0.3 Packet kill, skill_res, down, hurt, act, loot
- Từ gateway.js (các `case "kill"`, `case "skill_res"`, `case "down"`, `case "hurt"`, `case "act"`, `case "loot"`, `case "loot_gone"`, `case "join"`, `case "leave"`, `case "bosses"`) trích đầy đủ payload mà client đọc: tên trường, kiểu, ý nghĩa, và client làm gì khi nhận. Đặc biệt:
  - `kill`: id quái, `by` (ai hạ), `exp`, vật rơi?
  - `skill_res`: `n` (số trúng) và các trường khác (sát thương? id kỹ năng? mục tiêu?).
  - `hurt`: ngoài hp/mp/bp/dmg/mpLoss/byId, có trường nào cho biết nguồn (quái hay người)?
  - `down`: `left`, `lostExp`.
- Thêm kiểu TypeScript vào packages/core-client/src/types.ts và parser/chuẩn hóa thuần hàm (phong cách normalizeVitals: validate kiểu, trả null khi sai) vào module mới (ví dụ packages/core-client/src/state/combat-packets.ts). KHÔNG đưa vào GameStateStore hay đổi luồng hiện có; chỉ cung cấp hàm + export. Không làm vỡ parser hiện tại; gói chưa biết vẫn đi qua như cũ.

P0.4 Fixture và test
- Dựng fixture từ dữ liệu ĐÃ CÓ: key/kiểu trong docs/evidence/*.json (chỉ tên key, kiểu, số liệu không nhạy cảm) và hàm client. Không có raw packet thật trong evidence, nên fixture phải do bạn dựng tổng hợp theo đúng hình dạng đã đọc từ mã client và ghi rõ là tổng hợp.
- Test (node --test, .mjs hoặc tsx theo phong cách repo): bảng quái và kỹ năng (giá trị mẫu đối chiếu với mã gốc), mỗi parser (hợp lệ, thiếu trường, sai kiểu, giá trị biên), `deriveLearnedSkills` với save tổng hợp, và tính nhất quán dữ liệu (mọi `book` của kỹ năng tồn tại trong bảng ITEMS đã có từ gen-derived-vitals nếu áp dụng được).

P0.5 Tài liệu
- Cập nhật docs/AUTO_SPEC.md: mục 10 (đánh dấu những dòng đã giải quyết), mục 13 (gạch điều đã biết), sửa mục 7.4 nếu bảng sai; thêm phụ lục "Ý nghĩa trường quái" và "Payload gói chiến đấu" với nhãn [Đọc được]/[Suy ra]/[Chưa biết].
- Cập nhật docs/SESSION_LOG.md (mục mới ở ĐẦU file) và checklist cuối docs/FIX_GUIDE.md.

QUY TẮC AN TOÀN
- KHÔNG chạy server, KHÔNG đăng nhập, KHÔNG dùng mạng. Sandbox của bạn không có mạng và cũng không được cần mạng.
- Không đọc/in data/, .env, tiện ích bí mật. Không ghi token, tên nhân vật, selfId, id người chơi vào file nào. Fixture không chứa dữ liệu thật của người chơi.
- Không sửa vendor, không đổi gate, không nới allowlist origin, không đụng .gitignore.
- Thay đổi nhỏ, theo phong cách code sẵn có; không refactor ngoài phạm vi. Không thêm dependency mới; nếu bắt buộc, nêu lý do và báo cáo.
- Nếu `pnpm` không có trong PATH hoặc build bị chặn (EPERM/EACCES): thử `corepack pnpm`, hoặc chạy tsc trực tiếp từng package bằng node_modules/typescript/bin/tsc, rồi chạy các test .mjs bằng `node --test`. Nêu rõ lệnh nào chạy được, lệnh nào bị chặn. KHÔNG tuyên bố build pass nếu chưa chạy; tôi sẽ tự build và chạy lại sau.
- Phần không xác định được ghi "chưa xác minh/[Chưa biết]", không suy đoán thành sự thật.

KẾT QUẢ CẦN GIAO
- File sinh (bảng quái, bảng kỹ năng), script sinh, parser + kiểu, test, tài liệu cập nhật.
- Bảng cuối:

| Hạng mục | Trạng thái (xong / chặn / chưa xác minh) | Bằng chứng ngắn |
|---|---|---|
| P0.1 Định nghĩa quái + ý nghĩa trường wire | | (số loại quái, câu trả lời về `hp`, `d`, `t`) |
| P0.2 Kỹ năng + deriveLearnedSkills | | (số kỹ năng, lệch so với mục 7.4 nếu có) |
| P0.3 Payload kill/skill_res/down/hurt/act/loot | | (trường mỗi gói) |
| P0.4 Test | | (số test pass/fail theo từng lệnh) |
| Build | | |

- Kèm: danh sách điều vẫn [Chưa biết] cần đo live (để quyết định kịch bản live cho P1 đến P3), và mọi chỗ mã vendor mâu thuẫn với AUTO_SPEC.md.
