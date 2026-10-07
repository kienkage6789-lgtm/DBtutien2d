# TuTien2D Game API — compatibility index

Tài liệu chuẩn hiện hành của game WebSocket là:

➡️ [`API_REFERENCE.md`](API_REFERENCE.md)

File này được giữ lại để không làm hỏng liên kết cũ. Không dùng ví dụ hoặc claim
lịch sử của bản tài liệu cũ làm contract. `API_REFERENCE.md` phân biệt:

- `IMPLEMENTED`: parser/wrapper có trong code dự án;
- `PUBLIC_CLIENT`: handler thấy trong client công khai;
- `LIVE_OBSERVED`: packet/runtime đã capture và redact;
- `UNVERIFIED`: chưa đủ bằng chứng server thật.

Điểm cần nhớ cho HP/MP/linh thạch:

- `status` là effect, không phải nguồn HP/MP;
- `you`/`hurt`/`revived` là nguồn HP/MP được client công khai xử lý; smoke live đã
  thấy `you` đưa current HP/MP vào runtime;
- `maxHp/maxMp` chưa có wire evidence;
- linh thạch được client công khai xử lý ở `formation.balance.stones`; parser của
  dự án cũng đọc `state.save.stones`, đã được runtime smoke xác nhận;
- `null/unknown` không phải `0`.
