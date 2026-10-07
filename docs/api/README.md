# TuTien2D API documentation set

Bộ tài liệu được chia theo boundary và evidence level. Điểm vào chính là:

- [API_REFERENCE.md](../API_REFERENCE.md) — contract chuẩn, nguồn bằng chứng,
  opcode game, pipeline realtime và ma trận phần đã/chưa xác minh.

Các tài liệu chi tiết theo boundary:

- [GAME_API.md](../GAME_API.md) — compatibility index trỏ về API reference; không
  còn là nguồn định nghĩa vitals.
- [CONTROL_PLANE_API.md](../CONTROL_PLANE_API.md) — REST `/api` và dashboard WS `/ws`;
  response hiện tại, lifecycle, security posture và runtime/config training.
- [PORTAL_NAVIGATION.md](../PORTAL_NAVIGATION.md) — state machine, packet contract,
  collision-aware path và evidence cho chuyển map bắt buộc qua portal.
- [MINIMAP_NAVIGATION.md](../MINIMAP_NAVIGATION.md) — geometry, mini-map realtime,
  click-to-move, cancel và giới hạn evidence.
- [API_REVIEW.md](../API_REVIEW.md) — audit findings, evidence ledger, verification
  record và thứ tự hardening.
- [TRAINING_PROTOCOL_GAPS.md](../TRAINING_PROTOCOL_GAPS.md) — trạng thái training,
  evidence và các protocol gap về khu, death/respawn, di chuyển và combat.
- [VITALS_SYNC_FIX.md](../VITALS_SYNC_FIX.md) — canonical vitals, trạng thái stale/
  conflict và bằng chứng kiểm thử false-death.

## Quy ước bằng chứng hiện hành

- `IMPLEMENTED`: có trong code dự án và đã kiểm tra ở lớp tương ứng.
- `PUBLIC_CLIENT`: handler có trong snapshot client công khai.
- `LIVE_OBSERVED`: xuất hiện trong capture/runtime đã redact.
- `TESTED`: test đúng lớp đã ghi, không tự nâng thành server contract.
- `ILLUSTRATIVE`/`FIXTURE`: ví dụ hoặc dữ liệu giả lập, không phải capture.
- `UNVERIFIED`: chưa đủ bằng chứng để dùng như contract production.

Đặc biệt, `status` không phải nguồn HP/MP; `null` không phải `0`; và việc parser
đọc được một field không chứng minh game server đã gửi field đó.

Không đặt access token, refresh token, password hoặc proxy credential vào tài liệu,
fixture, log hay snapshot.

