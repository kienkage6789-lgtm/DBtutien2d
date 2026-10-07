Bạn đang làm việc trong dự án E:\game\tutien2d (monorepo pnpm: apps/server, apps/web, packages/core-client, packages/automation-engine). Dự án KHÔNG có .git. Đọc trước: docs/SESSION_LOG.md (mục mới nhất), docs/FIX_GUIDE.md (mục B), docs/PROMPT_HP_FIX.md, docs/evidence/packet-tap-2026-10-07T14-28-11-588Z.json, và các hàm resolveMoveVitalError / resolveStrictVitalError / strictVitalError / moveToTrainingArea trong apps/server/src/orchestrator/worker-pool.ts.

BỐI CẢNH ĐÃ XÁC MINH
- HP tuyệt đối của chính mình chỉ đến qua `you` (mang seq, fix, hp, mp, sp, bp, dn), `hurt`, `revived`. Không có HP trong welcome/state.
- Lần kiểm chứng gần nhất: một lệnh move về ĐÚNG tọa độ hiện tại đã `arrived`, nhưng 120 giây không có `you` nào. Kết luận đúng chỉ là "move đứng yên không kích ra `you`". Nó KHÔNG chứng minh `you` không phải ACK của di chuyển thật: trước đó HP 225 đã đến qua `you` sau khi bot đi portal. Client chính thức dùng `you.seq` để dọn lệnh move đang chờ và `you.fix` để sửa vị trí, nên server có thể chỉ gửi `you` khi có dịch chuyển hoặc khi HP/MP đổi.
- Lỗi thiết kế còn sót: `moveToTrainingArea` đang dùng gate NGHIÊM (strictVitalError, trả vitals_unknown khi HP chưa biết). Nhưng di chuyển tới vùng training chính là cách duy nhất để HP xuất hiện, nên training vẫn bị vòng luẩn quẩn ở khâu đi tới chỗ farm.

HAI BƯỚC (làm đúng thứ tự)

BƯỚC 1. Sửa gate: di chuyển dùng gate mềm, chỉ tấn công/skill dùng gate nghiêm
1. Trong worker-pool.ts, `moveToTrainingArea` đổi sang gate mềm giống `requestMoveTo` (moveVitalErrorForEntry): chỉ chặn khi downed === true hoặc vitals fresh từ you/hurt có hp <= 0 (character_down). vitals unknown hoặc downed === null thì CHO ĐI.
2. Gate nghiêm (strictVitalError, vitals_unknown) chỉ áp ở pha TẤN CÔNG/SKILL của training. Rà soát toàn bộ đường tới attack/skill: automation-engine/src/training/state-machine.ts và mọi nơi gọi attackMob/castSkill/startTraining. Bảo đảm pha "đi tới vùng farm" và pha "tấn công" tách bạch: khi HP unknown, state machine được ĐI nhưng không được TẤN CÔNG, và trạng thái blocker hiển thị `VITALS_UNKNOWN` thay vì dừng cả training.
3. Không nới gate nghiêm cho tấn công/skill. Không dùng hp <= 0 một mình để kết luận gục. Không dùng hp trong p/pf (phần trăm) làm vitals.
4. Test: (a) moveToTrainingArea cho đi khi vitals unknown và downed null; (b) chặn khi downed true; (c) pha tấn công vẫn chặn vitals_unknown; (d) state machine tiếp tục di chuyển khi HP unknown và chỉ dừng ở pha tấn công; (e) hp=0 từ source 'state' không đủ để chặn move.
5. Cập nhật phần training blockers (trainingBlockers trong FIX_GUIDE mục C.3 hoặc bản đã triển khai) để vitals unknown chỉ chặn tấn công, không chặn di chuyển.

BƯỚC 2. Kiểm chứng lại điểm A bằng một move CÓ dịch chuyển thật (cần phiên game thật)
1. Mở rộng packet tap một chút để ghi lệnh move ĐI RA (outbound): với mỗi move đã transmit chỉ ghi seq, x, y đã làm tròn, thời điểm ms tương đối và ep. Không ghi gì khác. Ghi sẵn thời điểm để tính độ trễ đến `you`. Vẫn redacted, mặc định tắt (TUTIEN_PACKET_TAP).
2. Chọn điều kiện an toàn trước khi thử: lấy runtime.monsters; nếu có quái trong bán kính 300 đơn vị quanh nhân vật thì KHÔNG thử ở đó, báo lại và dừng (không tự điều hướng sang map khác). Không thử khi downed === true.
3. Chọn đích: một điểm cách vị trí hiện tại khoảng 40 đến 60 đơn vị, nằm trong vùng đi được (dùng walk-grid/validateMoveToTarget có sẵn của dự án để chọn, không tự đoán). Nếu không chọn được điểm hợp lệ thì ghi lại và dừng.
4. Quy trình: chạy server với TUTIEN_PACKET_TAP=150, đăng nhập bot (MỘT phiên duy nhất, không tạo phiên thứ hai bằng cùng tài khoản). Chờ 20 giây không làm gì. Gửi move tới điểm đích bằng cơ chế move-to có sẵn (không tự viết packet), chờ 8 giây. Sau đó gửi move quay lại đúng vị trí ban đầu, chờ 8 giây. Chỉ 2 lệnh, không lặp lại, không tấn công, không skill, không di chuyển xa hơn.
5. Từ evidence ghi: có gói `you` hay không; nếu có thì mỗi `you` có seq, fix, hp, mp, sp, bp, dn là gì; độ trễ so với move gần nhất (ms); `you.seq` có khớp seq của một move đã gửi không; HP/MP có bằng 225/188 (luyen_khi_8, derivedMax) không; runtime sau đó có vitals.status = fresh, source = you không.
6. Kết luận theo bảng:
   - `you` đến sau move thật, có seq khớp -> XÁC NHẬN: `you` là ACK/đồng bộ khi có dịch chuyển; cách chủ động lấy HP là một move ngắn có dịch chuyển (ghi rõ khoảng cách tối thiểu cần để kích, nếu suy ra được).
   - `you` đến nhưng chỉ khi có fix hoặc seq không khớp -> XÁC NHẬN MỘT PHẦN; ghi mô tả chính xác điều kiện quan sát được, không khái quát.
   - Không có `you` dù đã di chuyển thật -> BÁC BỎ; khi đó HP chỉ biết qua hurt/revived. Chỉ ĐỀ XUẤT (không tự code) phương án coi HP lúc login là giả định đầy máu với nhãn nguồn riêng 'assumed' giống client chính thức, và nói rõ rủi ro.
   - Server chặn move hoặc lỗi -> ghi nguyên văn mã lỗi, không retry.
7. KHÔNG sửa logic vitals hay thêm cơ chế lấy HP nào trong bước này; chỉ báo cáo.

QUY TẮC AN TOÀN
- Không in token, JWT, mật khẩu, refresh token, selfId, tên nhân vật hay id người chơi ra chat, log hay evidence. Tap giữ chế độ redacted.
- Không gửi lệnh tấn công, skill hay di chuyển ngoài đúng hai move ở bước 2. Không retry mù.
- Không nới gate cho tấn công/skill. Không nới allowlist origin, không tắt auth.
- Mỗi bước: `pnpm build` pass; test liên quan pass (JS, server TS, web Vitest); không làm vỡ test cũ (hiện 26 test JS, 5 test server TS, 6 test web).
- Phần chưa xác minh ghi "chưa xác minh", không suy đoán.

KẾT QUẢ CẦN GIAO
- Cập nhật docs/SESSION_LOG.md (mục mới: thay đổi, lệnh đã chạy, kết quả thật, mục chưa xác minh) và checklist/giả định ở cuối docs/FIX_GUIDE.md.
- Evidence mới (bước 2): docs/evidence/packet-tap-*.json đã redact.
- Bảng cuối:

| Bước | Trạng thái (xong / chặn / chưa xác minh) | Bằng chứng ngắn |
|---|---|---|
| 1. Gate mềm cho di chuyển, nghiêm cho tấn công | | |
| 2. you sau move thật | | (số gói you, seq, độ trễ ms, hp/mp/dn) |

- Kèm: kết luận chính thức về cách lấy HP chủ động, danh sách việc người dùng phải làm tay, và điểm còn rủi ro.
