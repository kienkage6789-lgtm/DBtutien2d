Đọc AGENTS.md trước, rồi docs/AUTO_SPEC.md (mục 3 đến 5, 10 đến 13), docs/SESSION_LOG.md (mục mới nhất) và docs/PORTAL_NAVIGATION.md. Repo có git, working tree sạch; KHÔNG commit, để thay đổi trong working tree.

MỤC TIÊU: P1 (chọn mục tiêu) và dữ liệu lưới va chạm cho P2 (tiếp cận) của docs/AUTO_SPEC.md
Hoàn toàn bằng phân tích tĩnh mã vendor và hàm thuần có test. KHÔNG chạy server, KHÔNG đăng nhập, KHÔNG dùng mạng, KHÔNG gửi packet. Không sửa vendor. Không đổi hành vi bot hiện có (chưa nối auto vào state machine ở bước này).

HIỆN TRẠNG CẦN BIẾT
- apps/server/src/config/walk-grid.ts (109 dòng) là bản chép TAY lưới va chạm của đúng 6 map: tan_vien, thanh_truc_lam, duoc_vien, vuon_ca_nhan, mieu_hoang, dong_mach_ngam. Danh mục map có 16 map (apps/server/src/config/map-catalog.ts). API đang dùng: getWalkGrid, isWalkableTile, WALK_TILE_SIZE (32).
- apps/server/src/orchestrator/walk-path.ts (178 dòng) có A* (findWalkPath), isWalkSegmentClear, findNearestWalkableTarget; được worker-pool.ts và routes.ts dùng cho move-to và điều hướng cổng. Hitbox nhân vật 16x12 (PLAYER.HITBOX_W/H).
- Client chính thức: vendor/.../src/world/tilemap.js (luật chặn ô khi TileMap.load), world/pathfinding.js (Pathfinder.route), world/mapdata.js và các file map_*.js (dữ liệu từng map, kèm `enemies`/`spawn`).
- packages/core-client/src/state/enemy-defs.generated.ts (62 loại quái), skill-defs.generated.ts và combat-packets.ts đã có từ P0. Quái trên wire: id, x, y, hp (TUYỆT ĐỐI), hm (= hpMax khi có), d (cờ chết), t (loại), st, tg (báo hiệu đòn), zn (choáng), fz (đóng băng), sl/slm (làm chậm).

PHẦN A. LƯỚI VA CHẠM CHO TẤT CẢ MAP (làm trước)

A1. Script sinh dữ liệu: scripts/gen-walk-grids.mjs, phong cách scripts/gen-enemy-defs.mjs.
- Nạp các file vendor cần thiết trong `node:vm` với `window`/`document` giả tối thiểu để tái hiện đúng TileMap.load (luật chặn ô, vật cản/props có va chạm, ranh giới map, vùng cấm theo `rectFlyBlocked` nếu liên quan đến đi bộ thì KHÔNG đưa vào, chỉ ghi chú). Script KHÔNG truy cập mạng và không đọc thư mục ngoài vendor.
- Sinh packages/core-client/src/state/walk-grids.generated.ts: cho MỌI map có dữ liệu trong vendor (mục tiêu 16 map của danh mục; nếu map nào không dựng được thì ghi rõ lý do trong tài liệu, không bỏ qua lặng lẽ). Giữ nguyên định dạng `blockedRows` (chuỗi `a-b,c` mỗi hàng) để tương thích với walk-grid.ts hiện tại; ghi thêm `source` (file vendor), `tileSize`, `width`, `height`.
- Kiểm chứng chéo BẮT BUỘC: với 6 map đã có trong walk-grid.ts, lưới sinh ra phải KHỚP từng hàng với bản chép tay. Nếu có lệch, báo cáo từng ô lệch và kết luận bên nào đúng bằng cách đọc lại mã vendor (đừng tự chọn). Thêm test cho việc này.
- Thêm cùng script (hoặc script thứ hai gen-map-spawns.mjs) sinh bảng điểm sinh quái từng map: mapId, loại quái (khóa ENEMY_DEFS), tọa độ spawn, số lượng, bán kính lang thang/leash nếu có, `respawnSec`. Ghi vào packages/core-client/src/state/map-spawns.generated.ts. Đây là dữ liệu để chọn vùng farm. Kiểm tra mọi loại quái tham chiếu đều tồn tại trong ENEMY_DEFS.

A2. Dùng chung và giữ tương thích
- apps/server/src/config/walk-grid.ts giữ API công khai cũ (WALK_TILE_SIZE, WalkGrid, WALK_GRIDS, getWalkGrid, isWalkableTile) nhưng lấy dữ liệu từ walk-grids.generated.ts trong core-client (export qua packages/core-client/src/index.ts hoặc một đường dẫn con có `exports` hợp lệ, nhớ giữ điều kiện `default` trong package.json của core-client để tsx/node --test nạp được). Xóa bản chép tay chỉ SAU KHI test khớp 6 map đã pass.
- Mọi test cũ của portal navigation và move-to phải vẫn pass nguyên (apps/server/src/orchestrator/*.test.ts, apps/server/src/api/*.test.ts).

A3. Đối chiếu thuật toán tìm đường
- Chạy Pathfinder.route của vendor (trong vm, cùng lưới, hitbox 16x12) và findWalkPath của dự án trên một bộ truy vấn: ít nhất 20 cặp điểm cho mỗi map có quái (lấy từ spawn và cổng), gồm cả cặp không tới được. So sánh: có/không có đường, độ dài đường (chênh lệch cho phép nêu rõ), từng đoạn có `lineClear` theo hình chữ nhật 16x12. Báo cáo bảng lệch; KHÔNG tự sửa thuật toán nếu lệch nhỏ, chỉ ghi vào tài liệu. Nếu đường của dự án đi xuyên vật cản mà vendor chặn thì đây là LỖI: sửa tối thiểu trong walk-path.ts kèm test.

PHẦN B. CHỌN MỤC TIÊU (P1)

B1. Module thuần hàm trong packages/automation-engine/src/auto/target-selection.ts (không phụ thuộc server, WebSocket hay đồng hồ hệ thống; thời gian và trạng thái nhớ được truyền vào):

```
type PriorityMode = 'auto' | 'boss' | 'quai' | 'mau';
interface MonsterRow { id: string; x: number; y: number; hp?: number; hm?: number; d?: number|boolean; t?: string; [k: string]: unknown }
interface SelectInput {
  self: { x: number; y: number };
  monsters: ReadonlyArray<MonsterRow>;
  priority: PriorityMode;
  memory: { targetId: string | null };           // mục tiêu đang giữ
  config?: { range?: number; reachPad?: number; keepPad?: number; excludeTypes?: ReadonlySet<string> };
}
interface SelectResult { target: MonsterRow | null; reason: string; memory: { targetId: string | null }; considered: number }
export function selectTarget(input: SelectInput): SelectResult
```

Luật (đối chiếu AUTO_SPEC.md mục 4; nếu mã vendor khác tài liệu thì mã vendor thắng và bạn cập nhật tài liệu):
- Loại quái chết (`d` truthy hoặc `hp <= 0`), loại `human` và `tuSi` (bot chỉ đánh quái), loại loại quái không có trong ENEMY_DEFS (kèm `reason: 'unknown_type'`, không đoán), loại nhóm `excludeTypes`.
- `auto`: quái gần nhất theo khoảng cách Euclid, không giới hạn khoảng cách (như E() của client). `boss`: gần nhất trong số boss (`isBoss` hoặc tên khớp /Yêu Thú Cấp/ như X() của client); `quai`: gần nhất trong số không phải boss; `mau`: tỉ lệ `hp/hpMax` thấp nhất trong `RANGE` (hpMax lấy từ `hm` nếu có, ngược lại từ ENEMY_DEFS), hòa thì gần hơn. Khi nhánh ưu tiên không có kết quả thì rơi về `auto` như client (`r || E(t)`).
- Giữ mục tiêu: nếu `memory.targetId` còn sống và còn trong `RANGE + REACH_PAD + KEEP_PAD` thì giữ nguyên, nếu không thì chọn lại. Đây là thiết kế cho bot (client auto mặc định chọn lại gần nhất mỗi tick): ghi rõ trong tài liệu, và để `config.sticky` (mặc định true) tắt được.
- Mọi hằng số lấy từ một nơi duy nhất (TARGET trong core/config.js: RANGE 150, REACH_PAD 40, KEEP_PAD 120). Export hằng số có tên, không rải số.
- Hòa khoảng cách: quyết định xác định (so sánh id theo thứ tự chuỗi) để test lặp lại được.
- Hàm phụ thuần: `inMeleeReach(self, monster, weaponReachBonus)` (khoảng cách <= REACH + reachBonus + bodyRadius của định nghĩa quái; bodyRadius null coi như 0, nêu rõ), và `inSkillRange(self, monster, skill)` theo công thức tầm của pickAuto (thunder dùng THUNDER.RANGE; aura dùng min(range, 0.8*blastR); còn lại range).

B2. Hàm thuần `pickAutoSkill` theo AUTO_SPEC.md mục 7.1 (luân phiên, `ready`, trong tầm) cùng `SkillCooldowns` thuần (nhận `now` từ ngoài, kiểm tra cooldown riêng + cooldown chung SPELL_GAP 1.2 + mp/sp đủ) trong packages/automation-engine/src/auto/skill-rotation.ts. Dữ liệu kỹ năng lấy từ skill-defs.generated.ts và kỹ năng đã học từ deriveLearnedSkills. Nếu mã vendor khác mục 7 thì mã vendor thắng và sửa tài liệu.

B3. Test (node --test .mjs hoặc tsx theo phong cách repo, không phụ thuộc server/mạng):
- selectTarget: từng chế độ ưu tiên; rơi về auto; loại chết/human/tuSi/loại lạ; giữ mục tiêu qua nhiều tick và bỏ khi vượt KEEP; hòa khoảng cách xác định; danh sách rỗng; tọa độ NaN/thiếu (loại và đếm vào `considered`); không đổi đầu vào (bất biến).
- inMeleeReach / inSkillRange: biên chính xác (bằng đúng ngưỡng thì trong tầm).
- pickAutoSkill/SkillCooldowns: luân phiên vòng tròn, bỏ qua chưa sẵn sàng, bỏ qua ngoài tầm, thiếu mp/sp, chia sẻ SPELL_GAP, `bienHinh` bị loại khỏi vòng luân phiên của bot.
- Lưới: khớp 6 map; mọi map sinh ra có kích thước hợp lệ; mọi ô spawn trong map-spawns nằm trên ô đi được (nếu có spawn rơi vào ô chặn thì báo cáo, không giấu).
- Phần A3: bộ truy vấn đối chiếu đường đi dưới dạng test có thể chạy lại.

PHẦN C. TÀI LIỆU
- Cập nhật docs/AUTO_SPEC.md: mục 10 (đánh dấu lưới va chạm, spawn đã có), mục 12 (P1 xong/chặn), mục 13 (gạch điều đã biết), sửa chỗ khác mã vendor; thêm phụ lục "Phạm vi lưới va chạm và spawn: map nào có, map nào thiếu và vì sao".
- Cập nhật docs/SESSION_LOG.md (mục mới ở ĐẦU file) và checklist cuối docs/FIX_GUIDE.md.

QUY TẮC AN TOÀN
- KHÔNG chạy server, KHÔNG đăng nhập, KHÔNG dùng mạng; sandbox của bạn cũng không cần mạng.
- Không đọc/in data/, .env, không ghi token/tên nhân vật/selfId/id người chơi vào file nào. Fixture là dữ liệu tổng hợp, ghi rõ.
- Không sửa vendor, gate, allowlist origin, .gitignore. Không thêm dependency; nếu bắt buộc, nêu lý do.
- Thay đổi nhỏ, theo phong cách code sẵn có; không refactor ngoài phạm vi (di chuyển dữ liệu lưới sang core-client là ngoại lệ đã được phép ở A2).
- Nếu `pnpm` không có trong PATH hoặc build bị chặn (EPERM/EACCES): thử `corepack pnpm`, hoặc chạy tsc trực tiếp từng package bằng node_modules/typescript/bin/tsc, rồi chạy test bằng `node --test` (core-client) hoặc `npx tsx --test` (server). Nêu rõ lệnh nào chạy được, lệnh nào bị chặn. KHÔNG tuyên bố build pass nếu chưa chạy; tôi sẽ tự build và chạy lại, và lưu ý các lỗi kiểu thường chỉ lộ khi build.
- Phần không xác định được ghi "chưa xác minh/[Chưa biết]", không suy đoán thành sự thật.

KẾT QUẢ CẦN GIAO
- File sinh (lưới 16 map, spawn), script sinh, module chọn mục tiêu và luân phiên kỹ năng, test, tài liệu cập nhật.
- Bảng cuối:

| Hạng mục | Trạng thái (xong / chặn / chưa xác minh) | Bằng chứng ngắn |
|---|---|---|
| A1 Lưới + spawn | | (số map sinh được, map thiếu và lý do, kết quả khớp 6 map) |
| A2 Dùng chung, giữ tương thích | | (test cũ còn pass) |
| A3 Đối chiếu tìm đường | | (số truy vấn, số lệch, có sửa không) |
| B1 selectTarget | | |
| B2 pickAutoSkill + cooldown | | |
| B3 Test | | (số test pass/fail theo từng lệnh) |
| Build | | |

- Kèm: mọi chỗ mã vendor mâu thuẫn với AUTO_SPEC.md, danh sách map thiếu lưới (và ảnh hưởng đến farm), và các điều [Chưa biết] cần đo live trước P2/P3.
