Đọc AGENTS.md trước, rồi docs/SESSION_LOG.md (mục "Ghi chú: so sánh di chuyển" và các mục mới nhất), docs/AUTO_SPEC.md mục 14 và 15. Repo có git, working tree sạch; KHÔNG commit, để thay đổi trong working tree.

MỤC TIÊU: sửa thuật toán di chuyển của engine `core` để đi đúng tốc độ và đúng cách của client thật
Hai vòng di chuyển trong apps/server/src/orchestrator/worker-pool.ts đang rất chậm:
1. `runMoveTo` (move-to của API và MiniMap), quanh dòng 1750: `maxStepPx = 68 * 0.1`.
2. Vòng đi tới ô cổng trong điều hướng cổng, quanh dòng 1946: `movementSpeedPxPerSecond = 68`.

NGUYÊN NHÂN (đã phân tích từ mã; một phần đã đo)
- Tốc độ sai: client thật đi 68 × WALK_MULT 1.485 = **101 px/s** (đo trong mô phỏng offline: 101 px/s đi, 112 px/s chạy với RUN_MULT 1.65). Bot dùng tốc độ gốc 68, tức chậm hơn 33 % ngay cả khi tính đúng.
- Bước tính từ vị trí xác thực lỗi thời: mỗi bước tính `current = entry.location` (vị trí xác thực), mà `entry.location` chỉ được cập nhật khi nhận gói `you`, tức khoảng một lần mỗi giây (server gửi `you` mỗi 10 `seq` của luồng move). Khoảng 10 gói liên tiếp đều chỉ cách vị trí cũ khoảng 6,8 px chứ không cộng dồn, nên tốc độ hiệu dụng chỉ khoảng 7 px/s (ước tính từ mã, chưa đo bằng live). Chú thích trong mã cũ ("bot has no local physics simulation; continuing from a rejected/clipped point would compound the error") giải thích vì sao tác giả chọn cách này: sợ lỗi cộng dồn khi server sửa vị trí. Cách đúng là DỰ ĐOÁN cục bộ rồi HÒA GIẢI khi server trả `you`, giống client thật.

CÁCH CLIENT THẬT LÀM (mã tham chiếu bắt buộc đọc: vendor/tutien2d-public-client/2026-10-06/src/net/gateway.js)
- Hàm tick mạng gửi `move` mỗi `1/netTickHz` giây (10 Hz) CHỈ KHI trạng thái đổi; ghi lại danh sách các lệnh đã gửi `U = [{seq, x, y}]` (tối đa 32).
- Handler gói `you`: bỏ các lệnh có `seq <= you.seq`, giữ các lệnh còn chờ (`seq > you.seq`); nếu `you.fix`: bỏ qua gói cũ theo `ep`/`seq`; tính vị trí đích = `(you.x, you.y)` cộng độ lệch của các lệnh còn chờ so với lệnh đã được ack (`u += t.x - i.x`); sai lệch `h` giữa vị trí đó và vị trí dự đoán hiện tại: `h <= 6` bỏ qua; `h > 140` thì sau 3 lần liên tiếp mới sửa cứng; còn lại sửa mềm. Đọc đúng mã để lấy ngưỡng và điều kiện chính xác; mã vendor thắng nếu khác mô tả này.
- Cấu hình tốc độ: packages/core-client/src/state/auto-data.ts đã có `AUTO_CONSTANTS` (sinh từ vendor); dùng nó (SPEED, WALK_MULT, RUN_MULT, HITBOX), KHÔNG chép tay số 68 hay 1,485.

NHIỆM VỤ

A. Bộ di chuyển dự đoán thuần hàm (dễ test): `PredictedMover`
- Đặt trong module mới, không phụ thuộc WebSocket hay worker-pool (ví dụ packages/core-client/src/movement/predicted-mover.ts hoặc apps/server/src/orchestrator/predicted-mover.ts; chọn nơi hợp lý và giải thích). Thời gian truyền từ ngoài (hàm `now()`), không dùng đồng hồ toàn cục.
- Trạng thái: vị trí dự đoán, thời điểm gửi gần nhất, danh sách lệnh đã gửi `{seq, x, y, at}` (giới hạn 32), tốc độ (px/s) cấu hình được, mặc định `SPEED * WALK_MULT`.
- `step({ waypoint, now })`: tính `dt` = thời gian THỰC trôi từ lần gửi trước (kẹp trong [20 ms, 200 ms]; lần đầu dùng 100 ms), dời vị trí dự đoán về phía waypoint tối đa `tốc độ × dt` (không vượt waypoint, làm tròn như `sendMove` làm tròn), trả toạ độ cần gửi. Tuyệt đối KHÔNG gửi vị trí vượt quá `tốc độ × dt` so với lần gửi trước (server có thể kiểm tra tốc độ; không đi nhanh hơn client thật).
- `onAuthoritative({ seq, x, y, fix })`: hòa giải đúng quy tắc của client thật (xem trên): bỏ lệnh đã ack, cộng độ lệch lệnh còn chờ, bỏ qua sai lệch nhỏ, sửa mềm, sửa cứng sau số lần liên tiếp quy định, và luôn sửa cứng khi `fix` kèm sai lệch lớn nếu đó là hành vi của client. Trả về loại hiệu chỉnh đã áp dụng (để log/test).
- `reset(authoritativePosition)`: dùng khi bắt đầu một lệnh di chuyển, đổi map, hồi sinh, hoặc mất đồng bộ.
- Vị trí dự đoán chỉ dùng để TÍNH BƯỚC TIẾP; mọi quyết định "đã tới đích", "kẹt", "không có đường" vẫn dựa trên vị trí XÁC THỰC (`entry.location` đã được cập nhật bởi gói thật), giữ nguyên các kiểm tra hiện có (`observedAt` mới hơn lúc bắt đầu, `isWalkSegmentClear`, `authoritative_position_stalled`...).

B. Nối vào hai vòng di chuyển
- Thay phép tính `next` ở runMoveTo và vòng đi tới cổng bằng `PredictedMover`. Giữ nguyên: nhịp gửi khoảng 100 ms (nhưng dt tính bằng thời gian thực), tìm đường `findWalkPath` từ vị trí DỰ ĐOÁN (không phải vị trí xác thực cũ) để waypoint đầu tiên đúng phía trước, gate mềm theo trạng thái gục, deadline 45 s, tiêu chí `arrived`/`blocked`/`failed`, hủy bằng `operationId`.
- Cung cấp cho mover các gói xác thực: nhận `you` từ client (có `seq`, `x`, `y`, `fix`, `ep`) qua sự kiện hiện có (`client.on('you', ...)`), gỡ listener khi vòng kết thúc ở mọi nhánh kể cả lỗi.
- Phát hiện kẹt phải dựa trên vị trí xác thực như cũ nhưng với chu kỳ phù hợp: vì `you` chỉ đến khoảng 1 s một lần, ngưỡng kẹt hiện tại ("không tiến triển 1 s, 3 lần thì chặn" ở runMoveTo; 2,5 s ở vòng cổng) phải được xem lại để không báo kẹt oan (đặt ngưỡng dựa trên chu kỳ `you`, ghi lý do trong mã).
- KHÔNG đổi API, mã lỗi, hay hành vi ngoài tốc độ và cách tính bước. KHÔNG đổi engine vendor (VendorRunner) và vendor/.

C. Kiểm thử (bắt buộc, không phụ thuộc mạng)
- `PredictedMover`: (1) hồi quy lỗi gốc: gửi 10 bước liên tiếp mà KHÔNG có cập nhật xác thực thì vị trí tích lũy đúng khoảng `tốc độ × thời gian` (không kẹt ở 6,8 px); (2) không bao giờ vượt `tốc độ × dt` giữa hai lần gửi liên tiếp, kể cả khi `dt` thực lớn bất thường (kẹp) hoặc rất nhỏ; (3) dùng 101 px/s lấy từ AUTO_CONSTANTS (so sánh bằng chính biểu thức `SPEED * WALK_MULT`, không hằng số chép tay); (4) hòa giải: bỏ qua sai lệch nhỏ, sửa mềm sai lệch vừa, sửa cứng sai lệch lớn sau số lần liên tiếp, xử lý lệnh còn chờ, lệnh cũ (seq nhỏ hơn đã ack) bị bỏ, `ep` lệch bị bỏ; (5) không vượt waypoint; (6) quãng đường 300 px mất khoảng 3 s ở 101 px/s (so với hơn 40 s ước tính của bản cũ); (7) xác định (cùng đầu vào cho cùng đầu ra).
- Tích hợp: mở rộng/viết test cho runMoveTo và vòng cổng với client giả (có `sendMove` ghi lại và phát `you` giả theo `seq` bội số 10, có biến thể server sửa vị trí) để chứng minh: tốc độ hiệu dụng xấp xỉ 101 px/s, tới đích, hủy sạch, gỡ listener, kẹt thật vẫn bị phát hiện, và `blocked`/`failed` giữ nguyên ngữ nghĩa. Nếu việc dựng test cho hai hàm private trong worker-pool quá khó, tách phần vòng lặp thành hàm nhỏ có thể tiêm phụ thuộc (không đổi hành vi) rồi test hàm đó.
- Giữ nguyên các test hiện có (core-client 11 file, automation-engine 4 file, server TS khoảng 15 file, server .mjs 3 file, web Vitest 9): không làm vỡ test cũ, đặc biệt walk-path.test.mjs, portal-navigation.test.ts, minimap-navigation.contract.test.mjs, move-to-error.contract.test.ts.

D. Tài liệu
- docs/SESSION_LOG.md (mục mới ở ĐẦU file), docs/ARCHITECTURE.md (mục di chuyển: dự đoán + hòa giải + tốc độ lấy từ AUTO_CONSTANTS), docs/PORTAL_NAVIGATION.md và docs/MINIMAP_NAVIGATION.md (sửa mô tả tốc độ cũ 68 px/s), checklist cuối docs/FIX_GUIDE.md. Ghi rõ điều chưa kiểm chứng live.

QUY TẮC AN TOÀN
- KHÔNG chạy server thật, KHÔNG đăng nhập game, KHÔNG dùng mạng, KHÔNG gửi packet thật trong sandbox của bạn. Việc đo tốc độ thật qua live do Claude Code làm sau.
- Không in token, JWT, mật khẩu, selfId, tên nhân vật, id người chơi. Không đọc data/ hay .env. Không sửa vendor, gate, allowlist origin, .gitignore. Không thêm route, không thêm dependency.
- Không đi nhanh hơn client thật: bước mỗi lần gửi không vượt `tốc độ × dt thực`. Không tăng tần suất gửi quá 10 Hz.
- Nếu `pnpm` không có trong PATH hoặc build bị chặn (EPERM/EACCES): thử `corepack pnpm`, hoặc chạy tsc trực tiếp từng package bằng node_modules/typescript/bin/tsc, rồi chạy test bằng `npx tsx --test` hoặc `node --test`. Nêu rõ lệnh nào chạy được, lệnh nào bị chặn. KHÔNG tuyên bố build pass nếu chưa chạy. Các đợt trước đều để lại lỗi kiểu chỉ lộ khi build (thu hẹp kiểu sau `await`, giá trị `null`, type guard, `readonly`); hãy tự rà kỹ khi viết. Tôi sẽ tự build và chạy lại.
- Phần không xác định ghi "chưa xác minh", không suy đoán thành sự thật.

KẾT QUẢ CẦN GIAO
- Mã `PredictedMover`, hai vòng di chuyển đã nối, test, tài liệu.
- Bảng cuối:

| Hạng mục | Trạng thái (xong / chặn / chưa xác minh) | Bằng chứng ngắn |
|---|---|---|
| PredictedMover + hòa giải | | (số test, các ngưỡng đã lấy từ gateway.js) |
| runMoveTo dùng dự đoán + 101 px/s | | |
| Vòng đi tới cổng dùng dự đoán | | |
| Ngưỡng phát hiện kẹt | | (giá trị cũ và mới, lý do) |
| Test | | (số test pass/fail theo từng lệnh) |
| Build | | |

- Kèm: các quyết định thiết kế, điều cần kiểm chứng live (tốc độ hiệu dụng thật, `you.fix` có xuất hiện không, đi qua cổng thật), và rủi ro còn lại.
