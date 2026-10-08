# Đặc tả: module di chuyển tới tọa độ (`walkTo`) cho engine vendor

Trạng thái: BẢN 2a đã được duyệt và triển khai offline (2026-10-08). Các mục ghi "chưa xác minh" vẫn phải được đo live trước khi coi là đúng.

## 1. Mục tiêu

Game điều khiển bằng cách nhấp tọa độ, nên "đi tới (x, y)" là nền tảng dùng lại ở nhiều nơi. Bản đầu phục vụ: bấm mini-map trên dashboard để nhân vật đi tới đúng vị trí. Module phải đủ tổng quát để supervisor (về neo, qua cổng), tiếp cận NPC/tài nguyên/quái và các việc nhiệm vụ sau này dùng chung, không viết lại logic đến nơi/kẹt/hết giờ.

## 2. Cơ chế (đã xác minh bằng đọc mã client)

- Tính đường: `Pathfinder.route(map, sx, sy, tx, ty, HITBOX_W/2, HITBOX_H)` rồi `player.setPath(route)`; hủy bằng `player.stop()` (`player.path.length = 0`). Mọi nhấp chuột của client (quái, NPC, tài nguyên) và Auto dùng đúng cặp này. Đã có `walkTo(x, y): boolean` trong `vendor-runner.ts` (cho supervisor) làm đúng việc đó.
- `route` snap đích về ô đi được gần nhất trong bán kính 6 ô (`nearestWalkable`); đích hoàn toàn không tới được → đường rỗng ("Không tới được"). Vì vậy "đúng vị trí" nghĩa là tới ô đi được gần nhất với điểm bấm; module phải trả về cả đích đã snap để dashboard vẽ.
- Client gửi `move` qua `Gateway` khi trạng thái đổi; module KHÔNG tự gửi gói `move`.
- Tốc độ khoảng 101 px/s (đã đo).

## 3. Hợp đồng

```ts
interface WalkRequest {
  target: { x: number; y: number };        // px thế giới, cùng map hiện tại
  arrivalRadius?: number;                  // mặc định 20 px
  timeoutMs?: number;                      // mặc định theo quãng đường, trần 120 s
  requester: 'user' | 'supervisor' | 'auto' | string;
}
type WalkStatus = 'accepted' | 'running' | 'arrived' | 'blocked' | 'failed' | 'cancelled';
interface WalkOperation {
  operationId: string; target: {x:number;y:number}; resolvedTarget: {x:number;y:number} | null; // sau snap
  status: WalkStatus; reason?: string; requester: string; startedAt: number; updatedAt: number;
}
// walkTo(req): WalkOperation | throws WalkError(code)   — một thao tác tại một thời điểm
// cancel(operationId, reason): boolean
```

Mã từ chối khi bắt đầu (`WalkError.code`, kèm HTTP khi qua API):

| Mã | Khi nào | HTTP |
|---|---|---|
| `NOT_IN_GAME` | chưa `IN_GAME` | 409 |
| `VENDOR_MAP_NOT_READY` | chưa nhận gói `map` / đang `transitioning` | 409 (thử lại được) |
| `CHARACTER_DOWN` | nhân vật gục | 409 |
| `AUTO_ACTIVE` | `autoRequested` hoặc supervisor khác `idle` | 409 |
| `OPERATION_IN_PROGRESS` | đang có thao tác đi bộ khác | 409 |
| `TARGET_INVALID` | tọa độ không hữu hạn hoặc ngoài biên map | 400 |
| `TARGET_UNREACHABLE` | `route` rỗng | 422 |
| `TARGET_ON_PORTAL` | đích nằm trên ô cổng (bản đầu không đổi map) | 422 |

## 4. Quyền lái nhân vật

Chỉ một bên lái tại một thời điểm. Quy tắc chốt (theo quyết định của chủ dự án): khi chạy trên server không có người mở game, Auto là chủ.
- Auto/supervisor đang hoạt động → `walkTo` của người dùng bị từ chối (`AUTO_ACTIVE`), không tự tắt Auto hộ.
- Đang đi tay mà `startAuto` được gọi → Auto thắng: thao tác đi tay bị hủy (`cancelled`, reason `auto_started`) rồi Auto bật bình thường.
- Supervisor (về neo/qua cổng) dùng module với `requester: 'supervisor'`; bản đầu CHƯA chuyển supervisor sang module để không gây hồi quy (supervisor có test, đã chạy live); chuyển ở bản sau, khi module đã được kiểm chứng live.

## 5. Vòng đời và kết thúc

- Mỗi khung của runner: nếu thao tác `running`, kiểm tra đến nơi (khoảng cách tới `resolvedTarget` ≤ `arrivalRadius`, hoặc `player.path` rỗng và khoảng cách ≤ 1 ô, giống supervisor) → `arrived`, dừng nhân vật.
- Kẹt: không tiến được quá 5 px trong 5 s → `blocked` (reason `stuck`), `player.stop()`.
- Hết giờ: `timeoutMs` (mặc định = quãng đường/101 × 1,5 + 10 s, tối thiểu 15 s, trần 120 s) → `failed` (reason `timeout`).
- Tự hủy (`cancelled`): nhân vật gục; đổi map/`transitioning`; reconnect; stop runner; Auto được bật; người dùng hủy.
- `hurt` xảy ra: KHÔNG tự hủy và không né quái; `hurtCount` hiển thị như thường, người dùng tự quyết hủy. (Chưa xác minh `hurt` có làm khựng/đứt đường không.)
- Kết thúc luôn `player.stop()` để không đi tiếp.

## 6. API và dashboard

- `POST /api/accounts/:id/move-to` `{x,y}`; `POST /api/accounts/:id/move-to/cancel` `{operationId}`; snapshot runtime có `moveTo` (`WalkOperation | null`). Dùng lại envelope lỗi và kiểu `MoveToApiError`/`MoveToRuntimeInfo` của bản core cũ (`git show 24c75d6:...`).
- Mini-map: bấm → `miniMapToWorld` → `move-to`; chỉ bật khi context map usable, `khu` biết, geometry hợp lệ, Auto tắt, không có thao tác đang chạy; hiện trạng thái, đích đã snap, nút "Hủy di chuyển"; khi bị khóa phải nói lý do ("Tắt Auto để di chuyển bằng tay").

## 7. Phạm vi

Bản 1 (trong tài liệu này): cùng một map; module + `moveTo` của runner + API + dashboard + test. Bản 2: đi nhiều map qua cổng (supervisor đã có BFS `mapRoute` và `portalsOf`; gom vào module), chuyển supervisor sang dùng module, tiếp cận NPC/tài nguyên/quái.

## 8. Cần đo live (chưa xác minh) — chỗ an toàn, một phiên, theo dõi `hurtCount`

1. Độ chính xác: khoảng cách thật còn lại khi `arrived` (kỳ vọng ≤ 20 px) và tốc độ thật.
2. Hành vi snap: bấm vào chỗ không đi được (tường) → đích đã snap là gì, có `TARGET_UNREACHABLE` không.
3. Đi qua gần ô cổng có tự đổi map không (quyết định có cần chặn đường qua cổng hay chỉ chặn đích trên cổng).
4. `hurt` giữa đường: có khựng/đứt đường không.
5. Đi ngay sau khi vào game/chuyển map: map ổn định chưa (đã có chặn `VENDOR_MAP_NOT_READY`).

## 9. Câu hỏi còn mở cho chủ dự án

- Mặc định `timeout` trần 120 s và bán kính 20 px ổn không?
- Bản 1 từ chối đích trên ô cổng; có muốn cho phép đích gần cổng nhưng không phải trên ô cổng?

---

# BẢN 2 (đã duyệt; 2a triển khai offline) — đi nhiều map qua cổng

Ngày: 2026-10-08. Phần này mở rộng mục 7 của bản 1. Bản 2a đã có mã và fixture offline; supervisor vẫn để dành cho bước 2b.

## 10. Cổng hoạt động thế nào (đã xác minh bằng đọc mã client)

- Cổng là một ô (`tx, ty`) trong `map.portals`. Mỗi khung, nếu không `transitioning`, client gọi `checkPortal(player.x, player.y)`: khi nhân vật ĐỨNG TRÊN ô khớp (`i.tx === ô x && i.ty === ô y`) và cổng không có cờ `byHand` thì cảnh đổi map. Không cần bấm thêm gì.
- Cổng `byHand` (kích hoạt thủ công, ví dụ ở `long_uyen`) KHÔNG đổi map khi đứng lên: bản 2 không dùng các cổng này.
- Một số cổng có `cooldownSec`/`cooldownGroup` ("Cột Khí Bổng" hồi chiêu): đứng lên lúc đang hồi thì không đổi map. Bản 2 coi cổng có cooldown là không dùng được cho tuyến tự động.
- Hệ quả quan trọng cho bản 1: một đường đi SAME-MAP vô tình đi qua ô cổng sẽ bị đổi map. Bản 1 chỉ từ chối đích nằm trên ô cổng, chưa chặn đường đi qua cổng (chưa đo live). Bản 2 phải xử lý việc này (mục 12).
- Supervisor hiện đã làm đúng cách này: BFS giữa các map (`mapRoute`), đi tới tâm ô cổng gần nhất dẫn tới map kế tiếp, chờ tối đa 8 s, gặp `halted` khi không có cổng/đường. Danh sách cổng lấy từ `MapData` của chính client (`portalsOf`), không dùng `config/portal-catalog.ts` (file đó chỉ còn API `routes.ts` đọc cho mục thông tin cạnh).

## 11. Hợp đồng mở rộng

```ts
interface WalkRequest {
  target?: { x: number; y: number }; // bỏ trống khi chỉ đi tới map đích, dừng ở điểm xuất hiện
  targetMapId?: string;        // mới: nếu khác map hiện tại → đi nhiều map; bỏ trống = map hiện tại (như bản 1)
  abortOnHurt?: boolean;       // mới, mặc định true khi đi nhiều map: hurtCount tăng → hủy và dừng nhân vật
  maxHurt?: number;            // số nguyên >= 1; mặc định 1
  ...
}
interface WalkOperation {
  ...
  route?: string[];            // danh sách map dự kiến, ví dụ ['tan_vien','thanh_truc_lam']
  leg?: { index: number; fromMapId: string; toMapId: string | null; phase: 'walking_to_gate'|'on_gate'|'waiting_map'|'walking_to_target' };
}
```

- Lập tuyến một lần khi nhận lệnh bằng BFS trên cổng khả dụng (không `byHand`, không cooldown, đọc từ `MapData` của client). Không có tuyến → `ROUTE_UNAVAILABLE` (422). `targetMapId` không tồn tại → `TARGET_INVALID`.
- Mỗi chặng: đi tới tâm ô cổng đúng (đích chặng LÀ ô cổng, khác bản 1 vốn từ chối đích trên cổng); đứng trên cổng; chờ đổi map (`transitioning` bật rồi tắt, `mapId` đúng map kế tiếp, tối đa 8 s như supervisor); sau đó chặng kế. Bản 2a không cần `target`: chặng cuối dừng tại điểm xuất hiện quan sát được của map đích; tọa độ trong map đích vẫn đi bằng mini-map bản 1.
- Nếu sau khi đứng trên cổng mà map không đổi hoặc sang map KHÁC dự kiến → `failed` (`portal_no_transition` / `unexpected_map`), dừng nhân vật, không tự thử cổng khác (không retry mù).
- `startAuto`/Auto đang bật/supervisor khác `idle` vẫn từ chối `AUTO_ACTIVE`; vẫn hủy khi gục/reconnect/stop runner; đổi map KHÔNG còn là lý do hủy khi đó là chặng được kế hoạch.

## 12. An toàn

- Đi nhiều map đi qua map có quái (ví dụ `thanh_truc_lam`): không phải bypass cổng (nhân vật đi thật tới cổng như người chơi), nhưng nhân vật có thể bị đánh. Mặc định `abortOnHurt: true`: `hurtCount` tăng thì hủy toàn tuyến và dừng nhân vật tại chỗ. Dashboard hiển thị `Hurt` như thường, cảnh báo trước khi gửi lệnh đi qua map khác.
- Chặn đường vô tình qua cổng ở chặng cùng map: khi tính đường (bản 1 và bản 2), nếu `route` đi qua ô cổng không phải đích chặng thì tìm đường vòng (chèn điểm trung gian né ô cổng) hoặc từ chối (`PATH_CROSSES_PORTAL`) nếu không vòng được. Cách đúng cần đo: xem mục 13.
- Một thao tác tại một thời điểm; hủy được giữa các chặng; luôn `player.stop()` khi kết thúc.

## 13. Cần đo live trước/trong khi làm bản 2 (chưa xác minh)

1. Đi sát và đi QUA một ô cổng cùng map có tự đổi map không (xác nhận suy luận từ `checkPortal`).
2. Thời gian thật từ lúc đứng trên cổng tới khi `mapId` mới ổn định (so với 8 s).
3. `hurt` giữa đường khi đi qua map có quái; tốc độ thật qua nhiều map.
4. Cổng có cooldown/`byHand` trong các map hay dùng: liệt kê từ `MapData` để biết đồ thị khả dụng.

### 13.1 Kết quả kiểm chứng offline (đã xác minh offline)

Fixture dùng client vendor thật trong `vendor/tutien2d-public-client/2026-10-06`, đặt player vào điểm đi được gần portal `tan_vien` và gọi `Pathfinder.route` + `player.setPath`; `FakeSocket` chỉ ghi gói client gửi ra. Kết quả: khi player đi qua ô portal tự động, client gửi outbound `{op:"enter",mapId:"thanh_truc_lam"}` qua `Gateway.enter`; fixture không phát sẵn gói map để tạo kết quả này. Vì vậy Bản 2a cài chặn route same-map qua portal: thử waypoint vòng; nếu không có route an toàn trả `PATH_CROSSES_PORTAL` (422). Test offline mới nằm cạnh `vendor-runner.test.ts`; chưa xác minh thời gian/độ trễ trên game thật.

## 14. Dashboard

- Điều khiển "Đi tới map…": chọn map đích (danh sách từ `/api/maps`), tùy chọn chọn tọa độ trong map đích bằng mini-map SAU khi tới nơi (bản 2a chỉ đi tới điểm xuất hiện sau cổng của map đích, không chọn tọa độ trước); hiển thị tuyến dự kiến, chặng hiện tại, nút Hủy; cảnh báo "đi qua map có quái" và đang bật `abortOnHurt`.
- Mini-map giữ bấm-để-đi trong map hiện tại như bản 1.

## 15. Phạm vi và thứ tự

- 2a: tuyến nhiều map + chặn đường vô tình qua cổng + API/UI "Đi tới map…" (module mới dùng chung, supervisor CHƯA đổi).
- 2b: chuyển giai đoạn `traveling` của supervisor sang module (giữ nguyên hành vi, giữ test), sau khi 2a đã được kiểm chứng live.
- Sau 2b: tiếp cận NPC/tài nguyên/quái dùng cùng module.

## 16. Câu hỏi mở cho chủ dự án

1. 2a chỉ "đi tới map X (điểm xuất hiện sau cổng)" rồi dừng, tọa độ trong map đích để lần bấm mini-map sau. Ổn không?
2. `abortOnHurt` mặc định BẬT cho đi nhiều map (hủy ngay khi bị đánh). Ổn không, hay muốn ngưỡng cao hơn (ví dụ hủy khi hurt ≥ 3)?
3. Có muốn đo mục 13.1 (đi qua ô cổng ở `tan_vien`) ngay đầu bản 2 để quyết định cách chặn đường vô tình qua cổng không?

## 17. Quyết định cho bản 2a (2026-10-08, chủ dự án duyệt "triển khai 3 mục")

1. **Trải nghiệm:** chọn một map bất kỳ trong danh sách → nhân vật tự tìm đường qua các cổng; người dùng không điều khiển cổng. 2a dừng khi tới map đích (điểm xuất hiện sau cổng); tọa độ trong map đích bấm mini-map sau như bản 1. Map không có đường (chỉ vào được bằng cổng `byHand`/cooldown) bị liệt kê là không tới được.
2. **Khi bị đánh giữa đường:** tham số theo từng chuyến, không cố định: `abortOnHurt` (mặc định `true`) và `maxHurt` (số lần `hurt` kể từ lúc bắt đầu thì hủy; mặc định 1). Dashboard cho chọn trước khi gửi (mặc định hủy ngay khi bị đánh; có tùy chọn "cứ đi tiếp tới khi bị đánh N lần"). Cảnh báo rõ: hủy giữa map có quái nghĩa là nhân vật đứng lại tại chỗ.
3. **Đi qua ô cổng vô tình (mục 13.1):** KHÔNG đo live ở bước đầu. Đã kiểm chứng offline với mã client thật trong fixture: `setPath` đi qua ô cổng `tan_vien` phát `enter` ra socket giả. Vì vậy 2a cài đường vòng và trả `PATH_CROSSES_PORTAL` nếu không vòng được; lần đi nhiều map thật đầu tiên vẫn là phép đo live.
