Bạn đang làm việc trong dự án E:\game\tutien2d (monorepo pnpm: apps/server, apps/web, packages/core-client, packages/automation-engine). Dự án KHÔNG có .git. Đọc trước: docs/SESSION_LOG.md (mục mới nhất), docs/FIX_GUIDE.md (mục B), docs/evidence/packet-tap-2026-10-07T14-59-31-958Z.json, và `sendMove` / `moveSeq` trong packages/core-client/src/client.ts.

BỐI CẢNH ĐÃ XÁC MINH TỪ EVIDENCE
- Lần probe gần nhất: 90 move gửi đi (seq 1..90, nhịp khoảng 100ms), 9 gói `you` về với seq 10, 20, ..., 90 (mỗi 10 move một gói), độ trễ 98 đến 113ms, nội dung hp=225, mp=188, sp=78, bp=115, dn=0, fix=0.
- Gói `you` đầu tiên (seq 10) đến khi 10 move đầu vẫn còn cùng tọa độ (246,696): nhân vật chưa dịch chuyển. Dịch chuyển thật trong probe chỉ khoảng 27 đơn vị (x 246..266, y 695..715), không phải 40 đến 60.
- seq giữ liên tục qua hai lệnh move (60..90 nối tiếp 1..50); bộ đếm không reset giữa các lệnh.
- Probe trước đó chỉ gửi 1 move (seq=1) nên không có `you`; kết luận "bác bỏ" khi đó là do mẫu quá nhỏ, không phải bằng chứng `you` không tồn tại.
- Giữa hai lệnh move (khoảng nghỉ 7968ms) luồng move dừng và không có `you`.

GIẢ THUYẾT CẦN KIỂM CHỨNG
H1: Server gửi `you` mỗi khi seq của move đạt bội số của 10, KHÔNG phụ thuộc nhân vật có dịch chuyển hay không. Nếu đúng, một đợt 10 move đứng yên tại tọa độ hiện tại sẽ kích ra đúng một `you` mang hp/mp/dn.
H2: Giá trị `st` (trạng thái) của move đứng yên có ảnh hưởng (idle so với walk) hay không.
H3: `you` không có tác dụng phụ lên vị trí: fix=0 và vị trí runtime không đổi sau đợt đứng yên.

NHIỆM VỤ: chỉ PROBE, KHÔNG đổi logic nghiệp vụ
KHÔNG sửa vitals, gate, state machine, automation, API hay UI. Chỉ được thêm harness probe tắt mặc định và mở rộng packet tap nếu cần.

1. Harness (tắt mặc định, chỉ bật khi đặt TUTIEN_PROBE_STATIONARY=1):
   - Đặt trong một module riêng (ví dụ apps/server/src/debug/stationary-probe.ts) và gọi từ worker khi account vào IN_GAME. KHÔNG thêm route API mới, KHÔNG thêm lệnh UI.
   - Chạy ĐÚNG MỘT LẦN mỗi tiến trình, sau khi đã chờ 20 giây kể từ lúc IN_GAME và mapContextIsCurrent=true. Sau khi xong tự vô hiệu hóa.
   - Điều kiện chặn (nếu một điều kiện không đạt thì ghi lý do và HỦY probe, không gửi gì): downed === true; có quái trong bán kính 300 đơn vị theo runtime.monsters; có lệnh move-to hoặc điều hướng đang chạy (moveTo accepted/running hoặc navigation đang hoạt động); không có vị trí hợp lệ.
   - Đợt A: gửi 10 move liên tiếp, nhịp khoảng 100ms (giống nhịp client chính thức), TẠI ĐÚNG tọa độ hiện tại (x, y đã làm tròn), dir hiện tại, `st` theo hành vi client chính thức khi đứng yên (xem vendor/tutien2d-public-client/2026-10-06/src/net/gateway.js, phần gửi move: st lấy từ trạng thái nhân vật; tìm giá trị đứng yên chính xác, thường 'idle'; nếu không xác định được thì dùng 'idle' và ghi rõ giả định). Dùng sendMove có sẵn để seq/ep được xử lý đúng; không tự dựng packet.
   - Chờ 3 giây, ghi các gói `you` đến.
   - Đợt B (chỉ chạy nếu đợt A KHÔNG nhận được `you`): chờ 15 giây rồi lặp lại đợt A nhưng với `st: 'walk'`, vẫn cùng tọa độ. Tối đa 2 đợt, mỗi đợt tối đa 10 move (tổng tối đa 20 move). Không đợt thứ ba.
   - Bắt buộc dùng cùng kênh gửi và cùng điều kiện shouldSend/anti-detection như move thường; không bỏ qua cơ chế có sẵn.

2. Packet tap (đã có TUTIEN_PACKET_TAP và ghi outbound move): bật TUTIEN_PACKET_TAP=90 cùng lúc. Với mỗi đợt ghi: seq đầu và seq cuối, st, tọa độ, thời điểm ms tương đối; với mỗi `you` ghi seq, hp, mp, sp, bp, dn, fix, thời điểm ms, độ trễ so với move gần nhất. Vẫn redacted, không ghi token, tên nhân vật, selfId hay id người chơi.

3. Chạy (cần phiên game thật):
   - Build, restart server với TUTIEN_PACKET_TAP=90 và TUTIEN_PROBE_STATIONARY=1.
   - Đăng nhập bot (MỘT phiên duy nhất, không tạo phiên thứ hai bằng cùng tài khoản).
   - Không làm gì khác. Không bấm MiniMap, không tấn công, không skill.
   - Sau khi tap ghi xong file, dừng server.

4. Phân tích và kết luận (ghi bằng số liệu từ evidence):
   - H1: đợt A có đúng một `you` với seq là bội số của 10 nằm trong khoảng seq đã gửi không? Nếu seq đầu của đợt không phải 1 hoặc bội số của 10 thì ghi rõ `you` rơi vào seq nào để kiểm tra "mỗi bội số của 10".
   - H2: nếu đợt A không có `you` mà đợt B có thì st quyết định; nếu cả hai không có thì ghi "bác bỏ H1 với move đứng yên".
   - H3: fix có phải 0 không; vị trí runtime trước và sau có đổi quá 1 đơn vị không; dn có phải 0 không.
   - hp/mp trong `you` có bằng derivedMax (225/188 với luyen_khi_8) hay không; nếu khác, ghi giá trị khác và KHÔNG tự suy luận nguyên nhân.
   - Độ trễ từ move cuối của đợt đến `you` (ms).

5. Kết luận cuối phải thuộc đúng một trong:
   - XÁC NHẬN: đợt 10 move đứng yên kích được `you`; nêu rõ điều kiện (st, độ dài đợt) và thời gian cần thiết (ví dụ khoảng 1 giây + độ trễ).
   - XÁC NHẬN MỘT PHẦN: chỉ một số điều kiện hoạt động; mô tả chính xác điều kiện đã quan sát, không khái quát.
   - BÁC BỎ: không đợt nào kích được `you`; khi đó HP chủ động chỉ lấy được khi nhân vật thực sự di chuyển; chỉ ĐỀ XUẤT (không tự code) hướng xử lý.
   - CHƯA XÁC MINH: probe bị hủy (nêu lý do cụ thể).

6. Sau probe, ĐỀ XUẤT thiết kế (chỉ viết trong tài liệu, KHÔNG code): trường `vitalsAgeMs` trong runtime, TTL hợp lý cho HP trong lúc đánh quái đứng yên (hurt là nguồn duy nhất khi đó), và một hàm "refreshVitals" dùng đợt move đứng yên nếu H1 được xác nhận, kèm điều kiện an toàn (không có quái gần, không đang tấn công, giới hạn tần suất).

QUY TẮC AN TOÀN
- Không in token, JWT, mật khẩu, refresh token, selfId, tên nhân vật hay id người chơi ra chat, log hay evidence.
- Không gửi tấn công, skill hay di chuyển nào ngoài tối đa 20 move đứng yên ở bước 1. Không retry mù. Không tạo phiên đăng nhập thứ hai.
- Harness tắt mặc định, không có route/UI mới, chỉ chạy một lần mỗi tiến trình, và tự hủy khi điều kiện an toàn không đạt.
- Không nới allowlist origin, không tắt auth.
- `pnpm build` pass; test liên quan pass (JS, server TS, web Vitest); không làm vỡ test cũ. Thêm test cho các điều kiện chặn của harness (downed, có quái gần, đang có move-to, thiếu vị trí) và cho việc harness không chạy khi biến môi trường tắt.
- Phần chưa xác minh ghi "chưa xác minh", không suy đoán.

KẾT QUẢ CẦN GIAO
- Cập nhật docs/SESSION_LOG.md (mục mới: thay đổi, lệnh đã chạy, kết quả thật, mục chưa xác minh) và checklist/giả định ở cuối docs/FIX_GUIDE.md.
- Evidence mới: docs/evidence/packet-tap-*.json đã redact.
- Bảng cuối:

| Giả thuyết | Kết luận (xác nhận / một phần / bác bỏ / chưa xác minh) | Bằng chứng ngắn (seq, st, độ trễ ms, hp/mp/dn/fix) |
|---|---|---|
| H1. you mỗi bội số seq 10, không cần dịch chuyển | | |
| H2. st (idle/walk) có ảnh hưởng | | |
| H3. you không đổi vị trí | | |

- Kèm: đề xuất thiết kế vitalsAge và refreshVitals (bước 6), danh sách việc người dùng phải làm tay, và các rủi ro còn lại.
