Đọc AGENTS.md trước. Repo đã có git (HEAD 38093d3). KHÔNG commit; để thay đổi trong working tree.

BỐI CẢNH
Probe thứ nhất (docs/SESSION_LOG.md, evidence packet-tap-2026-10-07T15-34-28-827Z.json): 10 move `idle` đứng yên (seq 1..10) tại (246,695) kích đúng một gói `you` với seq=10 (hp 225, mp 188, dn 0, fix 0), trễ khoảng 104ms; vị trí không đổi. Probe trước nữa (14-59-31): 90 move, `you` ở seq 10,20,...,90 mỗi ~1,07 giây.

Hạn chế: cả hai lần luồng move đều bắt đầu ở seq=1 (hoặc nối tiếp đúng bội số 10), nên chưa phân biệt được ba mô hình:
- M1: server dựa trên trường seq do client gửi: gửi `you` khi seq của move là bội số của 10.
- M2: server đếm 10 move đã nhận kể từ khi luồng bắt đầu (hoặc từ sau khoảng nghỉ), rồi gửi `you` mang seq của move thứ 10 đó.
- M3: server gửi `you` theo thời gian (khoảng 1 giây kể từ khi luồng bắt đầu), mang seq của move mới nhất lúc đó.

NHIỆM VỤ: chỉ PROBE thứ hai, KHÔNG đổi logic nghiệp vụ
Mở rộng harness có sẵn apps/server/src/debug/stationary-probe.ts bằng một chế độ mới, tắt mặc định, KHÔNG làm đổi hành vi chế độ cũ (TUTIEN_PROBE_STATIONARY=1 vẫn như cũ):

1. Chế độ mới bật bằng TUTIEN_PROBE_STATIONARY=offset (giá trị khác 'offset' và '1' thì tắt).
2. Trình tự (tất cả tại đúng tọa độ hiện tại, dir hiện tại, st='idle', nhịp 100ms như harness cũ, dùng sendMove có sẵn):
   - Đợt 0: 4 move (seq 1..4 khi tiến trình mới khởi động). Chờ 3 giây. Trong 3 giây này KHÔNG được có `you` theo cả ba mô hình; nếu có thì ghi nhận bất thường.
   - Đợt 1: 10 move tiếp theo (seq 5..14). Chờ 3 giây sau move cuối.
   - Tổng tối đa 14 move, một lần mỗi tiến trình, không đợt thứ ba, không retry.
3. Giữ nguyên toàn bộ guard hủy: downed true, quái trong 300 đơn vị, move-to đang chạy, navigation đang chạy, thiếu vị trí hoặc context không hiện hành; chờ 20 giây sau IN_GAME và context hiện hành trước khi bắt đầu.
4. Seq thực tế của đợt 0 phụ thuộc bộ đếm hiện tại. Ghi rõ seq đầu/cuối của từng đợt. Nếu seq đầu của đợt 0 không phải 1 (bộ đếm không bắt đầu từ 1) thì VẪN chạy nhưng ghi rõ, và diễn giải bảng bên dưới theo seq thực tế.
5. Packet tap ghi theo đợt như đã có (label riêng cho hai đợt: ví dụ 'offset-0' và 'offset-1'), mỗi `you` ghi seq, hp, mp, sp, bp, dn, fix, thời điểm ms và trễ so với move gần nhất, kèm vị trí trước/sau. Redacted, không ghi token/tên/id.
6. Test đơn vị cho chế độ mới (đủ 14 move, đúng 2 đợt, guard hủy giữa chừng, tắt khi env không phải 'offset', chế độ '1' không đổi). Cập nhật test hiện có nếu cần, không làm vỡ test cũ.

CHẠY (cần phiên game thật)
- Build, restart server với TUTIEN_PACKET_TAP=90 và TUTIEN_PROBE_STATIONARY=offset. Một phiên đăng nhập duy nhất, không mở client thứ hai bằng cùng tài khoản. Không làm gì khác (không MiniMap, không tấn công, không skill).
- Sau khi tap ghi xong, dừng server và xác nhận port 4000 đã giải phóng.

PHÂN TÍCH (bằng số liệu từ evidence)
Gọi S là seq của gói `you` đầu tiên nhận được, T là thời điểm so với move đầu tiên của đợt 1, N là số `you` nhận được tổng cộng.
- N=0: các mô hình đều không giải thích được với 14 move; ghi "chưa xác minh", không suy đoán.
- S=10 và T khoảng 0,5 đến 0,7 giây sau move đầu của đợt 1: ủng hộ M1 (server dựa vào seq client gửi).
- S=14 (hoặc 13) và T khoảng 1 giây: ủng hộ M2 (đếm 10 move từ đầu luồng/sau khoảng nghỉ) hoặc M3; phân biệt tiếp bằng việc có `you` nào đến trước đợt 1 kết thúc hay không, nhưng nếu không đủ dữ liệu ghi "M2 hoặc M3, chưa phân biệt".
- Kết quả khác: mô tả nguyên trạng, không ép vào mô hình.
- Ghi thêm: có `you` nào trong 3 giây nghỉ giữa hai đợt không; hp/mp có bằng 225/188; dn/fix; vị trí trước/sau.

QUY TẮC AN TOÀN
- Không in token, JWT, mật khẩu, refresh token, selfId, tên nhân vật hay id người chơi ra chat, log hay evidence.
- Chỉ gửi đúng tối đa 14 move đứng yên. Không tấn công, skill hay di chuyển nào khác. Không retry mù. Không tạo phiên đăng nhập thứ hai.
- Harness tắt mặc định, không thêm route/UI. Không nới allowlist origin, không tắt auth.
- Chạy `pnpm build` (nếu pnpm không có trong PATH của sandbox thì ghi rõ và KHÔNG tuyên bố build pass), các test liên quan (node --test cho harness và packet tap), và nêu rõ cái nào chạy được, cái nào không.
- Phần chưa xác minh ghi "chưa xác minh".

KẾT QUẢ CẦN GIAO
- Cập nhật docs/SESSION_LOG.md (mục mới ở ĐẦU file) và checklist ở cuối docs/FIX_GUIDE.md.
- Evidence mới docs/evidence/packet-tap-*.json (đã redact).
- Bảng cuối:

| Mô hình | Kết luận (ủng hộ / bác bỏ / chưa phân biệt) | Bằng chứng ngắn (S, T, N, seq đầu/cuối từng đợt) |
|---|---|---|
| M1: seq client % 10 | | |
| M2: đếm 10 move từ đầu luồng | | |
| M3: theo thời gian ~1s | | |

- Kèm: kết luận về việc thiết kế refreshVitals() có phụ thuộc mô hình nào không (số move tối thiểu cần gửi để chắc chắn nhận được `you`).
