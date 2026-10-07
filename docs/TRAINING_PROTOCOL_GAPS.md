# Training protocol gaps: map, khu, movement, combat, recovery

> Đây là tài liệu backlog/giới hạn training. Evidence vocabulary và contract
> chuẩn nằm trong [`API_REFERENCE.md`](API_REFERENCE.md); các ví dụ trong file
> này không phải capture live.

Ngày rà soát: 2026-10-06  
Phạm vi: source và tài liệu trong workspace hiện tại. Không kết nối game endpoint,
không dùng credential/token thật, không thay đổi source code.

## Quy ước bằng chứng

- `CODE`: được thấy trong implementation; chỉ xác nhận client tạo/gửi/parse shape đó.
- `OBSERVED`: có packet/runtime capture hoặc fixture nguồn gốc rõ ràng đã lưu trong repo.
- `UNVERIFIED`: chưa có bằng chứng đủ để khẳng định server chấp nhận hoặc thực hiện hành vi.

Trong lần rà soát này không tìm thấy capture/fixture protocol game đã lưu. Vì vậy
không có claim gameplay server-side nào được nâng lên `OBSERVED`. Tài liệu API hiện
có ví dụ packet minh họa, nhưng không phải capture; coi các ví dụ đó là `CODE` hoặc
`UNVERIFIED` theo nguồn tương ứng.

## Trạng thái milestone trong source

Milestone code hiện có state machine training và tích hợp `BotController` cho
enter map, xác nhận map, di chuyển và attack; control-plane trả runtime training và
UI có cấu hình opt-in và bộ lọc loại quái. Danh sách gợi ý loại quái trên UI lấy từ
snapshot hiện tại của account; loại quái được chọn là field cấu hình/quan sát từ
snapshot, chưa phải protocol server được xác minh. Đây là trạng thái `CODE`, không
phải xác nhận hành vi server game `OBSERVED`. Freshness hiện được đánh dấu riêng
cho map/khu/position và vitals, đồng thời reset khi đổi context hoặc rời `IN_GAME`.
Quái thiếu HP được controller coi là alive; death nhân vật chỉ được suy ra từ
vitals `fresh` và hợp lệ với `hp=0`. Chưa có command đã xác minh cho chọn khu hoặc
respawn; bật training không đồng nghĩa có thể tự đổi khu, hồi sinh hoặc quay lại
train sau chết. Chi tiết xem [VITALS_SYNC_FIX.md](VITALS_SYNC_FIX.md).

## 1. Contract hiện có

| Khả năng | Contract trong repo | Trạng thái và giới hạn |
| --- | --- | --- |
| Snapshot trạng thái | Parser nhận `state` với `mapId`, `khu`, `x`, `y`, HP/MP; `map` với `mapId`, `khu`, `soKhu`, `x`, `y`, `dir`, `p`, `e`; `you`/`hurt`/`revived` cập nhật self vitals; `status` chỉ cập nhật hiệu ứng. `GameStateStore` có `mapKnown`, `khuKnown`, `positionKnown` và `vitals` canonical; `worldUpdatedAt` chỉ làm mới theo packet world. (`packages/core-client/src/types.ts`, `state/game-state.ts`, `packages/automation-engine/src/bot-controller.ts`) | `CODE`. Cờ known chỉ thể hiện client đã nhận field qua packet; không có packet sequence/timestamp server nên không chứng minh thứ tự mới/cũ giữa các packet. Default phía client không được tính là đã biết. Cách server game phát packet và freshness thực tế chưa được `OBSERVED`; thứ tự packet vẫn `UNVERIFIED`. |
| Chuyển map | `enterMap(mapId)` gửi raw JSON `{op:"enter",mapId}` khi socket mở. Không có ACK/RID; hàm `true` chỉ có nghĩa gửi được qua socket. | `CODE`. Kết quả chuyển map và semantics mapId `UNVERIFIED`; phải đối chiếu snapshot `map` sau lệnh. |
| Chọn khu | Không thấy outbound selector hoặc command chứa khu trong API client. `khu` chỉ được parse từ inbound state/map. Training controller báo `BLOCKED` khi khu hiện tại khác khu đích vì capability bị tắt. | Chưa có contract; tự động chọn khu `UNVERIFIED`, không được coi là hỗ trợ. `soKhu` chỉ được đọc, không chứng minh cách chọn hay phạm vi hợp lệ. |
| Di chuyển | `sendMove(x,y,dir,st)` gửi `{op:"move",seq,x,y,dir,st,fly:0,fs:0,ep:1}` qua raw socket; sequence do client tăng. Không chờ ACK. | `CODE`. Ý nghĩa tọa độ, đơn vị, `seq`, `dir`, `st`, khả năng đi thẳng/đường đi, va chạm, giới hạn bước và việc server có broadcast vị trí chưa được xác minh (`UNVERIFIED`). |
| Di chuyển tới bãi | Training state machine chỉ quyết định move khi map/khu/vị trí đã biết và snapshot còn mới; xác nhận vị trí đích qua snapshot mới trong ngưỡng cấu hình. `sendMove` là raw send, không ACK. | `CODE`. Đây chưa phải pathfinding; semantics tọa độ, walkability và việc server thực hiện lệnh `UNVERIFIED`. |
| Tấn công | `attackMob(targetId)` gửi raw `{op:"attack",targetId}`; không ACK, timeout, cooldown hoặc response handler riêng ở method. | `CODE`. Chấp nhận target, tần suất hợp lệ, phạm vi, kết quả sát thương và điều kiện dừng `UNVERIFIED`. |
| Quái/nhân vật theo map | `p`/`e` được parse vào state; entity list bị xóa khi map/khu context đổi. Training snapshot giữ `id`/`name` nếu packet có; bộ lọc `trainingMonsterType` match exact theo name hoặc ID, không fuzzy. Khi đã chọn loại mà không có quái khớp thì không phát attack; thiếu dữ liệu định danh không được suy đoán. `hp` thiếu/không hữu hạn được coi là alive, hữu hạn `<=0` là dead. | `CODE` về parser/lọc phía client; danh sách gợi ý UI chỉ lấy từ snapshot hiện tại. Loại quái chưa phải field/protocol server được xác minh; nguồn, completeness và semantics HP/alive vẫn `UNVERIFIED`. |
| Chết / HP | Client chuẩn hóa HP/MP từ `state` và các packet self `you`/`hurt`/`revived` thành `VitalSnapshot`; `status` chỉ là effect. Training chỉ đánh dấu dead khi snapshot `fresh`, hợp lệ và `hp=0`. `unknown/stale/invalid/conflict` chuyển sang `RECOVERING`, không phát move/attack/respawn. | `CODE` về guard và state transition; packet death event/type vẫn chưa được xác minh. Trạng thái chết và thứ tự packet `UNVERIFIED`. |
| Hồi sinh / quay lại train | State machine có nhánh intent `RESPAWN`, nhưng controller cấu hình `canRespawn=false`; executor không gửi respawn. Không có command/handler hồi sinh đã xác minh. | `CODE`: capability bị tắt và training bị block. `thoatKet` là thoát kẹt theo tên code, không được diễn giải là hồi sinh. Respawn, auto-return và vị trí spawn `UNVERIFIED`. |
| ACK và retry | `sendCmd` dùng `{op:"cmd",cmd,rid,...}` và chờ `ack`; raw `move/enter/attack` không dùng ACK. RID tăng cục bộ, không có idempotency contract. | `CODE`. Retry raw op có thể lặp side effect; timeout của `cmd` có kết quả mơ hồ. Server dedupe semantics `UNVERIFIED`. |

### Ghi chú về state/cache

`GameStateStore` khởi tạo các giá trị mặc định như `mapId='tan_vien'`, `khu=1`,
`x=0`, `y=0`, `hp=100` và `maxHp=100`; cờ `mapKnown`/`khuKnown`/`positionKnown`
mới thể hiện các field vị trí đã được packet điền. `lastUpdated` là timestamp chung
được cập nhật bởi một số packet và không dùng làm bằng chứng freshness training.
`worldUpdatedAt` là mốc riêng cho packet `state`/`map` có world data;
`BotController.trainingSnapshot()` dùng mốc này, và nó được reset khi invalidate
world context, bao gồm reconnect/rời `IN_GAME`. Đây là hành vi `CODE`, chưa phải
xác nhận từ server game (`OBSERVED`); packet không có revision/sequence nên khả năng
packet cũ đến trễ vẫn `UNVERIFIED`.

## 2. Những gì chưa có bằng chứng

1. Danh sách map hợp lệ, tên hiển thị, liên kết/đường chuyển map và điều kiện vào.
2. Outbound packet chính thức để chọn `khu`, payload, range, lỗi và cách xác nhận.
3. Liệu `enter` chỉ dùng đổi map, có giữ khu, chọn khu mặc định hay có thể đổi khu.
4. Đơn vị tọa độ, map bounds, walkable/collision, tốc độ, bước đi tối đa và
   semantics `move.seq`/`st`/`dir`/các flag.
5. Server có tìm đường từ tọa độ hiện tại tới tọa độ yêu cầu hay cần client phát
   nhiều bước/waypoint; event nào xác nhận tiến triển hoặc đến nơi.
6. Contract chọn mục tiêu và đánh: target ID ổn định trong context nào, attack
   cadence, range, target invalid/dead, combat event và HP mutation.
7. Packet xác nhận chết, cờ sống/chết, animation/state chuyển tiếp, và có phân
   biệt disconnect/HP=0/stun hay không.
8. Command hồi sinh, lựa chọn hồi sinh, thời gian chờ, chi phí, ACK, map/khu/tọa độ
   spawn và điều kiện được phép gửi.
9. Chính sách reconnect và thứ tự snapshot sau reconnect; cách loại entity/state cũ.
10. Server có chống lặp cho `enter`, `move`, `attack` hoặc lệnh respawn hay không.

## 3. Fixture / packet capture tối thiểu cần thu từ client chính thức

Chỉ thu trên tài khoản/môi trường được phép. Dùng capture đã redact: loại bỏ
`token`, cookie, password, refresh token, account identifiers nhạy cảm và mọi
secret. Giữ nguyên thứ tự/thời gian tương đối, direction, opcode, payload không
nhạy cảm, build/client version và chú giải thao tác. Không tạo fixture bằng cách
đoán payload.

### Gói capture bắt buộc

1. **Khởi tạo và baseline:** kết nối → `welcome` → state/map/status đầu tiên; ghi
   quan hệ thứ tự, thời điểm, map/khu/vị trí/HP, và packet lặp định kỳ nếu có.
2. **Chuyển map:** trước thao tác, thao tác UI đổi map, tất cả outbound packet,
   ACK/error nếu có, inbound map/state cho tới khi ổn định. Ghi map nguồn/đích và
   khu trước/sau.
3. **Chọn khu:** giữ map cố định, ghi thao tác UI đổi khu, mọi outbound/inbound
   packet và trạng thái ổn định; lặp lại cho ít nhất hai khu. Đây là bằng chứng
   bắt buộc trước khi thiết kế command khu.
4. **Di chuyển:** bắt đầu/đích gần và xa trong cùng map/khu; capture outbound
   movement và inbound self-position/state/map từng bước, bao gồm dừng trước
   chướng ngại hoặc va chạm nếu có thể. Ghi rõ thao tác người chơi và thời điểm.
5. **Combat:** một lần chọn quái rồi đánh, thu outbound target/attack, mọi
   inbound combat/state/map/entity/HP event cho tới khi target chết hoặc bị bỏ;
   thêm trường hợp target ra khỏi tầm hoặc biến mất nếu client hiển thị.
6. **Death/recovery:** capture từ trạng thái sống ngay trước khi chết, toàn bộ
   packet lúc chết, thao tác hồi sinh UI, outbound/inbound tương ứng, cho tới khi
   map/khu/vị trí/HP ổn định. Ghi chi phí hoặc xác nhận không có chi phí nếu UI
   hiển thị; không suy ra từ việc nhân vật xuất hiện lại.
7. **Reconnect/stale context:** ngắt mạng có kiểm soát rồi reconnect khi đang ở
   map và khi có target; ghi packet baseline mới và cách entity/context được thay.

### Quy cách fixture

- Lưu từng scenario thành capture nguyên thứ tự (JSONL hoặc định dạng capture đã
  dùng trong dự án) cùng manifest: `scenario`, phiên bản client, map/khu, thao tác,
  timestamp tương đối, redact status, checksum file.
- Kèm fixture rút gọn cho test: packet inbound/outbound đã redact, correlation
  marker thao tác, và expected state transition. Không đưa token thật hoặc raw
  handshake credential vào fixture.
- Tối thiểu có một capture lặp lại cho mỗi thao tác quan trọng để phân biệt packet
  ổn định với trường ngẫu nhiên; capture cả success và server/UI rejection.
- Lưu riêng trường chưa hiểu nguyên dạng, đánh dấu `UNVERIFIED`; không đặt tên
  field suy đoán thành contract.

## 4. Acceptance criteria để mở khóa tính năng

| Tính năng | Điều kiện mở khóa |
| --- | --- |
| Đọc map/khu/vị trí | Có capture baseline và schema fixture thể hiện packet nguồn; parser kiểm tra kiểu/range; chỉ đánh dấu snapshot đã biết khi nhận packet server chứa trường đó; stale/missing field không được thay bằng default để ra quyết định. |
| Chuyển map | Capture client chính thức cho success và rejection; outbound payload và response/transition được lặp lại; xác định timeout, error, map đích và snapshot xác nhận. Mọi transition chỉ hoàn tất khi snapshot mới xác nhận đúng map. |
| Chọn khu | Capture chính thức cho ít nhất hai khu cùng map, gồm success và rejection/invalid khu; xác định exact command/payload, ACK hoặc observable confirmation, valid range và retry behavior. Không mở khóa chỉ từ `khu`/`soKhu` inbound hoặc tài liệu giả định. |
| Đi tới bãi | Capture chuyển động gần/xa; xác định semantics tọa độ, progress signal, giới hạn bước/tốc độ và server correction. Runtime chỉ xác nhận đến nơi bằng snapshot position mới trong ngưỡng được hỗ trợ; mỗi waypoint có timeout/progress rule, hủy khi context đổi. Pathfinding chỉ mở khóa khi có walkability/map geometry đủ dữ liệu. |
| Auto attack | Capture attack và phản hồi success, target invalid/dead/range failure; xác định tần suất và target lifecycle. Chỉ đánh khi map/khu/entity snapshot còn mới và target cùng context; có stop condition khi chết, mất target, context đổi hoặc không có progress. |
| Death detection | Capture chính thức phân biệt alive → dead và dead → alive; xác định event/field và thứ tự với HP/map. HP<=0 một mình chưa đủ nếu chưa được chứng minh. |
| Auto respawn | Capture thao tác hồi sinh thành công và ít nhất một failure/điều kiện bị chặn; xác định command, ACK/timeout, chi phí, giới hạn/cooldown, spawn state. Sau respawn phải xác nhận state sống mới trước mọi hành động. `thoatKet` không mở khóa mục này nếu chưa chứng minh cùng semantics. |
| Return-to-training | Map/khu selection, navigation, death, respawn đều đã đạt criteria độc lập; end-to-end replay fixture chứng minh sau respawn bot xác nhận đúng map/khu/bãi trước khi attack. Hạn chế retry/death loop và có trạng thái dừng rõ khi bất kỳ bước nào không xác nhận. |

## 5. Rủi ro retry, duplicate và stale context

- **Raw send không phải ACK:** `true` từ `sendRaw` chỉ phản ánh gửi được trên socket. Timeout/đóng kết nối sau gửi không cho biết server đã xử lý hay chưa. Không retry tự động nếu chưa biết duplicate semantics.
- **RID không phải idempotency:** `rid` là correlation ID cục bộ cho RPC; không áp dụng cho raw `enter`, `move`, `attack`, và chưa có bằng chứng server dedupe command khi RID lặp.
- **Duplicate enter:** có thể tạo chuyển cảnh lặp, reset vị trí hoặc đổi state ngoài dự kiến. Sau lần gửi, chờ map snapshot mới; timeout là kết quả không rõ, không đồng nghĩa thất bại.
- **Duplicate move:** có thể ghi đè hướng/vị trí, tạo bước nhảy hoặc khiến waypoint mới tranh chấp với lệnh cũ. Chỉ có một movement operation đang chờ; không phát lại khi chưa phân loại trạng thái.
- **Duplicate attack:** có thể phát nhiều hit/animation hoặc vượt cadence; target ID cũ có thể được tái sử dụng/không còn hợp lệ. Không retry chỉ vì chưa thấy event ngay.
- **Khu/map context cũ:** entity `e`/`p` không mang revision rõ trong type; packet trễ có thể điền lại entity từ map/khu trước sau khi đổi context. Cần epoch/revision ở receiver hoặc loại bỏ packet không thể gắn chắc vào context.
- **Snapshot partial/stale:** `state` và `map` có thể chỉ cập nhật một phần; default values khiến trạng thái ban đầu trông hợp lệ. `worldUpdatedAt` lọc snapshot world cũ ở cấp packet có world data, nhưng không cung cấp freshness riêng từng field hoặc thứ tự packet; yêu cầu đủ cờ known và snapshot hiện hành trước khi di chuyển/đánh.
- **Death/reconnect race:** HP cũ hoặc packet map đến trễ có thể kích hoạt hồi sinh/lệnh đánh sai thời điểm. Sau reconnect/death, đóng băng side effect cho tới baseline mới và state sống được xác nhận.
- **Retry policy tối thiểu:** phân loại `not sent`, `sent but unconfirmed`, `confirmed success`, `confirmed rejection`; chỉ retry trường hợp được chứng minh an toàn. Giới hạn attempt/backoff, operation generation để hủy tác vụ cũ, và circuit-break sang trạng thái chờ khi context/ACK không rõ.

## Nguồn rà soát trong repo

- `docs/GAME_API.md`, `docs/API_REVIEW.md`, `docs/SESSION_LOG.md`,
  `docs/PROJECT_PLAN.md`, `docs/api/README.md`.
- `packages/core-client/src/types.ts`, `client.ts`,
  `connection/socket-client.ts`, `state/game-state.ts`.
- `packages/automation-engine/src/bot-controller.ts`, `farm/farm-manager.ts`,
  `types.ts`.

