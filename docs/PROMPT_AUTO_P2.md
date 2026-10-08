Đọc AGENTS.md trước, rồi docs/AUTO_SPEC.md (mục 3 đến 5, 10 đến 13 và phần "Hướng lệch của A3"), docs/ARCHITECTURE.md, docs/SESSION_LOG.md (hai mục mới nhất). Repo có git, working tree sạch; KHÔNG commit, để thay đổi trong working tree.

MỤC TIÊU: P2 — tiếp cận mục tiêu (approach), kèm kịch bản live đầu tiên (chỉ ĐI TỚI quái, KHÔNG đánh)
Phần này gồm: (A) hàm thuần chọn điểm đích và theo dõi tiếp cận, (B) bộ chạy tiếp cận nối vào cơ chế move-to có sẵn, (C) harness live tắt mặc định, (D) tài liệu kịch bản live. Sandbox của bạn KHÔNG chạy server, KHÔNG đăng nhập, KHÔNG dùng mạng, KHÔNG gửi packet; người dùng sẽ chạy kịch bản live sau. Không sửa vendor. Không nối auto vào state machine training ở bước này. Không có lệnh tấn công/skill nào trong P2.

SỰ THẬT ĐÃ XÁC MINH (dùng làm ràng buộc)
- `runMoveTo` (apps/server/src/orchestrator/worker-pool.ts quanh dòng 1402): mỗi 100 ms tính lại `findWalkPath(mapId, vị trí hiện tại, ô đích)`, bước tối đa `68 * 0.1` px về waypoint đầu, gửi `sendMove(..., 'walk', ...)`, kết thúc `arrived` khi cách đích <= `arrivalRadius` và đoạn thẳng còn thông; `blocked` với `no_walk_path` khi ô đích hoặc ô xuất phát không đi được; `failed` sau 45 s; dừng khi gục (gate mềm). Vì vậy ĐÍCH PHẢI LÀ MỘT ĐIỂM ĐI ĐƯỢC. Vị trí quái có thể nằm trên ô bị chặn: đã đối chiếu A3, 8/8 lệch "có/không có đường" đều do đích bị chặn hoặc ngoài bản đồ (vendor hít đích về điểm gần nhất, `findWalkPath` trả null); truy vấn hợp lệ không lệch; đường dự án dài hơn vendor 3 đến 7 %, không đi xuyên vật cản.
- `findNearestWalkableTarget(mapId, x, y, maxRadiusTiles = 4)` trong apps/server/src/orchestrator/walk-path.ts trả ô tâm đi được gần nhất, xác định (sắp theo khoảng cách rồi ty, tx). Lưới va chạm 16 map trong packages/core-client/src/state/walk-grids.generated.ts.
- packages/automation-engine/src/auto/target-selection.ts có `selectTarget`, `inMeleeReach(self, monster, weaponReachBonus)`, `inSkillRange`, hằng số TARGET_RANGE (150), TARGET_REACH_PAD (40), TARGET_KEEP_PAD (120). Tầm đánh thường = `PLAYER.REACH (26) + reachBonus + bodyRadius(quái)`; `bodyRadius` trong ENEMY_DEFS có thể null (coi là 0).
- Thời gian tiếp cận của client: `TARGET.APPROACH_TIME = 8` s; tìm đường lại mỗi 0,4 s. Tốc độ đi bộ: 68 * hệ số (1.485 đi, 1.65 chạy). Bot đi bằng `st:"walk"`.
- ENEMY_DEFS (packages/core-client/src/state/enemy-defs.generated.ts) có cho mỗi loại quái: level, isBoss, human, tuSi, bodyRadius, hitRadius, hpMax, speed, aggro, contactDmg, leashRange... Hàng quái trên wire: id, x, y, hp (tuyệt đối), hm (hpMax), d (cờ chết), t (loại), st, tg, zn, fz, sl, slm.
- Vitals: HP chỉ làm mới qua `you` (mỗi 10 seq của luồng move), `hurt`, `revived`; `refreshVitals()` chỉ chạy khi không có quái trong 300 đơn vị. Gate di chuyển MỀM (chỉ chặn khi gục). Bot hiện ở `tan_vien` (không có quái); map có quái và đã đi cổng được: `thanh_truc_lam`.

PHẦN A. HÀM THUẦN (packages/automation-engine/src/auto/approach.ts, không phụ thuộc server/WebSocket/đồng hồ; thời gian truyền từ ngoài)

A1. `computeApproachGoal(input)`:
```
input: {
  self: {x,y}, monster: {x,y, bodyRadius?: number|null},
  weaponReachBonus?: number,          // mặc định 0
  margin?: number,                    // khoảng lùi an toàn so với tầm tối đa, mặc định 8 px
  isWalkablePoint: (p) => boolean,    // tiêm vào: ô đi được VÀ đoạn xuất phát-tại-chỗ không bị chặn theo hitbox 16x12
  nearestWalkable: (x,y,radiusTiles) => {x,y}|null,   // tiêm vào (findNearestWalkableTarget)
  pathLength?: (from, to) => number|null              // tiêm vào, tùy chọn: độ dài đường thật (null = không có đường)
}
output: { goal: {x,y}, reachLimit: number, reason: 'direct'|'ring'|'snapped'|'none' }
```
- `reachLimit = PLAYER.REACH + weaponReachBonus + (bodyRadius ?? 0)`; điểm đích phải cách tâm quái <= `reachLimit - margin` (nếu `reachLimit - margin < 1` thì dùng `reachLimit * 0.5`).
- Ứng viên: nếu `self` đã trong tầm và đi được thì `reason:'direct'` với goal = self; nếu không, lấy ~16 điểm đều trên vòng bán kính `reachLimit - margin` quanh quái (góc cố định bắt đầu từ hướng nhìn từ quái về phía self để xác định), lọc `isWalkablePoint`; chọn điểm có `pathLength` nhỏ nhất (hoặc khoảng cách Euclid tới self nếu không có `pathLength`; hòa thì theo thứ tự góc). Nếu không có ứng viên đi được, thử hít: `nearestWalkable(monster.x, monster.y, 4)` rồi kiểm tra khoảng cách tới quái <= `reachLimit - margin`; nếu thỏa thì `reason:'snapped'`, ngược lại `reason:'none'` và `goal:null`-tương đương (chọn kiểu trả về an toàn, nêu rõ).
- KHÔNG bao giờ trả đích bị chặn. Xác định hoàn toàn (không ngẫu nhiên).

A2. `ApproachTracker` (trạng thái bất biến hoặc đối tượng nhỏ, tick thuần):
```
tick(input: { now: number; self; monster|null; goalResult; config? }): {
  action: 'start'|'continue'|'replan'|'arrived'|'unreachable'|'timeout'|'target_lost',
  goal?: {x,y}, reason: string, elapsedMs: number, distance: number
}
```
- Hằng số tên rõ ràng, đặt một nơi: `APPROACH_TIMEOUT_MS = 8000` (như client), `REPLAN_INTERVAL_MS = 400`, `REPLAN_MONSTER_MOVE_PX = 24` (quái dịch hơn ngưỡng này kể từ lần lập kế hoạch gần nhất thì lập lại), `ARRIVAL_CONFIRM_MS` (mặc định 0; nêu lý do nếu đặt khác).
- `arrived` khi `inMeleeReach(self, monster, weaponReachBonus)` đúng theo vị trí xác thực MỚI (không dùng vị trí dự đoán). `target_lost` khi quái chết (`d` hoặc `hp <= 0`), biến mất khỏi danh sách hoặc rời khỏi `TARGET_RANGE + TARGET_REACH_PAD + TARGET_KEEP_PAD`. `unreachable` khi `reason:'none'` hai lần liên tiếp. `timeout` sau `APPROACH_TIMEOUT_MS`.
- Không lập lại quá `REPLAN_INTERVAL_MS`; đổi mục tiêu thì bắt đầu lại đồng hồ.

A3. Test (node --test, không phụ thuộc server):
- Goal: đã trong tầm (direct); quái trên ô chặn (snapped hoặc ring); quái bao quanh bởi tường (none); không bao giờ trả điểm bị chặn (quét ngẫu nhiên có seed); bodyRadius null; margin lớn; xác định giữa các lần gọi; `pathLength` ưu tiên đường ngắn hơn dù Euclid dài hơn.
- Tracker: tiến trình bình thường, replan khi quái dịch đủ ngưỡng và không replan khi dịch ít, không replan trước `REPLAN_INTERVAL_MS`, timeout đúng ngưỡng, quái chết giữa chừng, quái rời tầm giữ, `arrived` đúng biên (bằng ngưỡng thì đã tới), unreachable cần hai lần liên tiếp.
- Fixture: lưới thật từ walk-grids.generated.ts của `thanh_truc_lam` và vị trí quái từ map-spawns.generated.ts (đọc bằng cách nạp module như walk-path-audit.test.mjs): với MỌI điểm sinh của map, `computeApproachGoal` từ một điểm xuất phát đi được phải trả đích đi được hoặc `none`, và nếu không `none` thì `findWalkPath` có đường tới đích đó.

PHẦN B. BỘ CHẠY TIẾP CẬN (apps/server/src/orchestrator/approach-runner.ts, phụ thuộc tiêm vào như vitals-refresh.ts)

- `runApproach(deps)`: mỗi nhịp 100 ms đọc snapshot (vị trí xác thực, danh sách quái tươi, context hiện hành, `downed`, vitals), chạy tracker; khi `start`/`replan` gọi bộ thực thi move-to có sẵn (`startMoveTo` hoặc hàm tương đương trong worker-pool) với đích đã tính và `arrivalRadius` nhỏ (ví dụ 6 px), HỦY lệnh move-to cũ trước khi đặt lệnh mới (dùng cơ chế hủy/`operationId` sẵn có; không để hai lệnh di chuyển chạy song song). KHÔNG thêm loại packet mới; mọi di chuyển đi qua `sendMove` như hiện nay.
- Kết quả: `{status:'arrived'|'unreachable'|'timeout'|'target_lost'|'aborted'|'skipped', reason, elapsedMs, replans, finalDistance, movesSent?}`.
- Dừng khẩn (`aborted`): nhận `hurt` hoặc HP giảm so với lúc bắt đầu, `downed === true`, mất kết nối, context không còn hiện hành, bot bị dừng, hoặc quá thời hạn. Khi dừng phải HỦY lệnh move-to đang chạy.
- Điều kiện bắt đầu (nếu không đạt trả `skipped` kèm lý do cụ thể, KHÔNG gửi gì): đã IN_GAME, `mapContextIsCurrent`, vị trí hợp lệ, không `downed`, không có moveTo/điều hướng đang chạy, vitals `fresh` với tuổi <= `VITALS_ATTACK_MAX_AGE_MS` (không chạy refresh trong khi có quái gần), danh sách quái tươi, `selectTarget` có kết quả.
- Không thêm route API, không thêm nút UI (bề mặt tấn công nhỏ). Test với deps giả: thành công, từng lý do `skipped`, từng nhánh `aborted` (đều hủy move-to), không chạy hai lần đồng thời cho cùng tài khoản, listener/timer được dọn trong mọi nhánh kể cả lỗi.

PHẦN C. HARNESS LIVE (apps/server/src/debug/approach-probe.ts), tắt mặc định, giống phong cách stationary-probe.ts

- Bật chỉ khi `TUTIEN_PROBE_APPROACH=1`. Chạy ĐÚNG MỘT LẦN mỗi tiến trình, sau khi IN_GAME và chờ 20 s, và chỉ khi mọi điều kiện an toàn đạt; nếu không thì ghi lý do và HỦY (tự vô hiệu hóa), không gửi gì.
- Chọn mục tiêu bằng `selectTarget` chế độ `auto` kèm lọc an toàn thêm: không boss, không `human`/`tuSi`, loại quái có `contactDmg` thấp (đặt ngưỡng tên rõ, đề xuất `contactDmg * 10 < HP hiện biết`), khoảng cách Euclid ban đầu trong [120, 450] px, đường đi (findWalkPath tới điểm đích) tồn tại và dài <= 480 px (bước đi tối đa của runMoveTo là 68 px/s nên 8 s đi được tối đa khoảng 544 px; giữ dư địa cho lần rẽ và dừng; nêu rõ phép tính trong mã), và không có quái KHÁC trong bán kính `aggro` của loại quái đó quanh điểm đích (tránh kéo nhiều quái).
- Hành vi: gọi `runApproach`. Khi `arrived`: đứng yên 3 s (không gửi move, không attack, không skill), ghi khoảng cách cuối, rồi kết thúc. KHÔNG tấn công, KHÔNG dùng kỹ năng, KHÔNG đi tiếp, KHÔNG rút lui tự động (rút lui là việc của người vận hành: dừng bot).
- Ghi vào packet tap (đã redact): với mỗi nhịp lập kế hoạch: thời điểm tương đối, loại quái (khóa ENEMY_DEFS, không có id người chơi), khoảng cách Euclid, độ dài đường, số lần replan, hành động tracker; ghi kết quả cuối và lý do hủy. KHÔNG ghi tên nhân vật, selfId, id người chơi, token. Mặc định tắt (`TUTIEN_PACKET_TAP`).
- Test: các điều kiện chặn (boss, human, contactDmg cao, quá gần/quá xa, không có đường, quái khác trong aggro, vitals cũ, đang move-to), một lần mỗi tiến trình, tắt khi env không bằng `1`, hành vi sau `arrived` không gửi gói nào.

PHẦN D. TÀI LIỆU KỊCH BẢN LIVE (docs/LIVE_SCENARIO_APPROACH.md)

Viết kịch bản để người dùng/Claude Code chạy sau, gồm: điều kiện tiên quyết; các bước (chạy server với `TUTIEN_PACKET_TAP=150 TUTIEN_PROBE_APPROACH=1`; bot đang ở `tan_vien`; dùng API `map/enter` đã có để đi cổng sang `thanh_truc_lam` và chờ xác nhận map; dừng 20 s; gọi `vitals/refresh` khi chưa có quái trong 300 đơn vị; để harness tự chạy); kết quả mong đợi; tiêu chí thành công (tới tầm trong <= 8 s, khoảng cách cuối <= reachLimit, không `hurt`, không đi xuyên vật cản, vị trí cuối đi được); tiêu chí hủy khẩn và cách dừng bot an toàn; những gì cần ghi lại; và bảng "việc chưa làm trong kịch bản này" (đánh, kỹ năng, rút lui, nhiều quái). Nêu rõ rủi ro: quái có `aggro` có thể tấn công khi lại gần; dừng ngay khi `hurt`.

PHẦN E. TÀI LIỆU KHÁC
- Cập nhật docs/AUTO_SPEC.md: mục 5 (tiếp cận) ghi đúng thiết kế P2, mục 12 (P2: hàm thuần xong / live chưa), mục 13 (điều chưa biết: quái đuổi theo bot, độ ổn định đứng yên trong tầm).
- Cập nhật docs/ARCHITECTURE.md (mục auto, harness), docs/SESSION_LOG.md (mục mới ở ĐẦU file) và checklist cuối docs/FIX_GUIDE.md.

QUY TẮC AN TOÀN
- KHÔNG chạy server, KHÔNG đăng nhập, KHÔNG dùng mạng; sandbox của bạn cũng không cần mạng.
- Không đọc/in data/, .env; không ghi token, tên nhân vật, selfId, id người chơi vào file nào. Fixture là dữ liệu tổng hợp hoặc sinh từ dữ liệu tĩnh trong repo.
- Không sửa vendor, gate, allowlist origin, .gitignore, và không thêm route API hay nút UI. Không thêm dependency.
- Không có attack/skill trong P2. Không retry mù. Không làm đổi hành vi của move-to, vitals-refresh, stationary-probe hiện có (chỉ được tái sử dụng/ tách phần dùng chung nhỏ nếu test cũ vẫn pass).
- Nếu `pnpm` không có trong PATH hoặc build bị chặn (EPERM/EACCES): thử `corepack pnpm`, hoặc chạy tsc trực tiếp từng package bằng node_modules/typescript/bin/tsc, rồi chạy test bằng `node --test` (automation-engine, core-client) hoặc `npx tsx --test` (server). Nêu rõ lệnh nào chạy được, lệnh nào bị chặn. KHÔNG tuyên bố build pass nếu chưa chạy; tôi sẽ tự build và chạy lại, và lỗi kiểu thường chỉ lộ khi build (ba đợt trước đều có).
- Phần không xác định ghi "chưa xác minh/[Chưa biết]", không suy đoán thành sự thật.

KẾT QUẢ CẦN GIAO
- approach.ts (+ test), approach-runner.ts (+ test), approach-probe.ts (+ test), docs/LIVE_SCENARIO_APPROACH.md, tài liệu cập nhật.
- Bảng cuối:

| Hạng mục | Trạng thái (xong / chặn / chưa xác minh) | Bằng chứng ngắn |
|---|---|---|
| A computeApproachGoal + ApproachTracker | | (số test; kết quả quét mọi điểm sinh quái của thanh_truc_lam) |
| B runApproach | | |
| C approach-probe | | |
| D Kịch bản live | | |
| Test | | (số test pass/fail theo từng lệnh) |
| Build | | |

- Kèm: mọi chỗ mã/ tài liệu mâu thuẫn, các giả định cần kiểm chứng live ở kịch bản, và danh sách rủi ro còn lại.
