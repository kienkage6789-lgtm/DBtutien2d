# Đặc tả: module di chuyển tới tọa độ (`walkTo`) cho engine vendor

Trạng thái: BẢN NHÁP chờ duyệt (2026-10-08). Chưa có mã. Phần ghi "chưa xác minh" phải được đo live trước khi coi là đúng.

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
