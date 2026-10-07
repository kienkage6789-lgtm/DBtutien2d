Bạn đang làm việc trong dự án E:\game\tutien2d (monorepo pnpm: apps/server, apps/web, packages/core-client, packages/automation-engine). Dự án KHÔNG có .git. Đọc trước: docs/SESSION_LOG.md (mục mới nhất), docs/FIX_GUIDE.md (mục B, D), docs/evidence/packet-tap-2026-10-07T13-19-41-452Z.json, và packages/core-client/src/debug/packet-tap.ts.

MỤC TIÊU
Chỉ KIỂM CHỨNG trên game thật ba giả thuyết về HP/MP. KHÔNG sửa logic vitals, state machine, gate move-to hay bất kỳ code nghiệp vụ nào. Chỉ được sửa packet tap (mở rộng ghi key) và ghi tài liệu.

KẾT LUẬN ĐÃ CÓ TỪ ĐỌC CODE CLIENT CHÍNH THỨC (vendor/tutien2d-public-client/2026-10-06/src), cần xác nhận hoặc bác bỏ bằng live
- maxHp/maxMp không có trên wire; client tự tính hpMax = REALMS[realm].hpMax + tổng ITEMS[equipment].hpBonus (tương tự mp). Nhân vật live có HP 225 / MP 188 = đúng luyen_khi_8 (hpMax 225, mpMax 188) và không có bonus trang bị.
- Lúc login client chính thức tự đặt hp = hpMax (setRealm khi nhận `state`), không có HP trong `welcome`.
- HP tuyệt đối của chính mình chỉ đến qua `you` (phản hồi lệnh `move`, mang seq, fix, hp, mp, sp, bp, dn), `hurt`, `revived`, và `formation balance` (chỉ mp).
- Nhân vật mình không nằm trong p/pf của snap2; hp của người khác trong p/pf là PHẦN TRĂM (0..100).
- `dn` trong `you` là cờ đã gục.

BA ĐIỂM CẦN KIỂM CHỨNG
A. Gói `you` có được gửi khi nhân vật đứng yên và bot gửi một lệnh move về đúng tọa độ hiện tại không? Nếu có, nó mang hp/mp/dn không? Độ trễ từ lúc gửi tới lúc nhận bao nhiêu ms? seq trong you có khớp seq của move đã gửi không?
B. Thứ tự và nội dung gói khi login: welcome, state, map, snap2 đến theo thứ tự nào; `state` có field realm hoặc save.realm không; vì sao runtime.dataStatus.realm đang false; state.equipment có không và có những slot nào (chỉ ghi tên slot và id vật phẩm, không ghi tên nhân vật).
C. Có hiệu ứng nào làm đổi hpMax theo thời gian không (thức ăn, trận pháp, buff): so sánh giá trị hp/mp từ `you` hoặc `hurt` với bảng realm trước và sau khi có hiệu ứng, nếu có cơ hội quan sát an toàn. Nếu không có cơ hội, ghi "chưa xác minh".

CÁCH LÀM
1. Mở rộng packet tap (packages/core-client/src/debug/packet-tap.ts):
   - Ghi thêm ops -> tập key cấp trên của mỗi op (chỉ tên key, không giá trị), trừ giá trị số của các key hp, maxHp, mp, maxMp, sp, bp, dn, seq, fix, ep, left, lostExp.
   - Ghi thứ tự 30 gói đầu tiên sau kết nối: chỉ op và thời điểm tương đối (ms).
   - Với gói state: ghi danh sách key của state, state.save, state.equipment (tên slot, id vật phẩm), và giá trị realm hoặc save.realm.
   - Với you: ghi seq, hp, mp, sp, bp, dn, fix và thời điểm nhận (ms từ lúc bắt đầu).
   - Giữ chế độ redacted: không token, không refresh token, không tên nhân vật, không selfId, không id người chơi khác. Mặc định tắt, chỉ bật bằng TUTIEN_PACKET_TAP=<giây>.
   - Build lại: pnpm build, và chạy test liên quan.
2. Chạy server với TUTIEN_PACKET_TAP=120, đăng nhập bot (một phiên duy nhất, không tạo phiên thứ hai bằng cùng tài khoản).
3. Điểm B: ngay sau khi bot vào game, KHÔNG làm gì trong 20 giây đầu để tap ghi trình tự login và xem trong khoảng đó có you hay không.
4. Điểm A: sau 20 giây, gửi đúng MỘT lệnh move về tọa độ hiện tại của nhân vật (qua cơ chế move có sẵn của dự án, không tự viết packet). Chờ 5 giây, ghi lại có you hay không. Lặp lại tối đa 3 lần cách nhau 10 giây. Không gửi lệnh tấn công, skill, hay di chuyển sang tọa độ khác.
5. Điểm C: chỉ quan sát thụ động; không dùng vật phẩm, không đổi trang bị, không vào chiến đấu. Nếu trong 120 giây tự nhiên có hurt hoặc revived thì ghi lại giá trị.
6. Đọc file docs/evidence/packet-tap-*.json mới tạo và đối chiếu với từng kết luận ở phần "đã có".

QUY TẮC AN TOÀN
- Không in token, JWT, mật khẩu, refresh token, selfId, tên nhân vật hay id người chơi ra chat, log hay evidence.
- Không bao giờ coi hp trong p/pf là HP tuyệt đối.
- Không sửa vitals.hp, gate move-to, state machine hay worker-pool.
- Không retry mù. Nếu lệnh move không tạo ra you thì ghi nhận kết quả, không gửi thêm quá số lần cho phép.
- Phần không quan sát được ghi "chưa xác minh", không suy đoán.

KẾT QUẢ CẦN GIAO
- docs/evidence/packet-tap-*.json mới (đã redact).
- Mục mới trong docs/SESSION_LOG.md: thay đổi tap, lệnh đã chạy, kết quả thật.
- Bảng trả lời cuối cùng:

| Điểm | Kết luận (xác nhận / bác bỏ / chưa xác minh) | Bằng chứng ngắn (op, thời điểm ms, giá trị số) |
|---|---|---|
| A. you khi đứng yên | | |
| B. trình tự login và nguồn realm | | |
| C. hiệu ứng làm đổi hpMax | | |

- Kèm: nếu A xác nhận, ghi rõ đây có phải cách chủ động đáng tin để lấy HP không; nếu B cho thấy realm có trong state thì ghi key chính xác (state.realm hay state.save.realm) và vì sao dataStatus.realm lại false.
