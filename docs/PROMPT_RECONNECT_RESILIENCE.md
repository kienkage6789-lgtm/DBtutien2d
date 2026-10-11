# Nhiệm vụ: bot không được tự ngắt vĩnh viễn khi mất kết nối game tạm thời

Đọc `AGENTS.md`, `docs/SESSION_LOG.md` (mục đầu), rồi: `apps/server/src/headless/vendor-runner.ts` (`handleSocketClosed`, `connectAndBuild`, `reconnectAttempts`, `reconnectMaxRetries` mặc định 5, backoff 1 s..30 s, `lifecycle 'error'`, `reconnect_exhausted`, phần khôi phục Auto sau reconnect `if (reconnect && this.autoRequested)`), `apps/server/src/orchestrator/worker-pool.ts` (onLog, cập nhật trạng thái tài khoản, `system_alert`), `apps/server/src/orchestrator/runner-handle.ts`, `apps/server/src/shard/*` (nếu VENDOR_SHARDS>0 thì runner chạy trong shard; thay đổi phải đúng ở cả hai chế độ), `apps/server/src/network/proxy-transport.ts`.

Không chạm game thật, không mở mạng ngoài, không đọc `data/`/`.env*`, không sửa `vendor/` hay `auto-supervisor.ts`, không commit. Test dùng socket giả, `DATA_DIR` tạm, đồng hồ tiêm (không `sleep` dài).

## Vấn đề (đã đọc mã, chưa chạy live)
Sau `reconnectMaxRetries` (mặc định 5) lần thử, tổng ~31 s, runner đặt `lifecycle='error'`, ghi `reconnect_exhausted` rồi KHÔNG thử nữa. Mạng chập chờn, game server khởi động lại, hoặc token hết hạn lâu hơn ~30 s làm bot chết vĩnh viễn đến khi người dùng bấm chạy lại. Người dùng thấy như "tự ngắt kết nối".

## Việc cần làm
1. Đổi chính sách kết nối lại: thử LIÊN TỤC với backoff luỹ thừa có trần (`RECONNECT_MAX_DELAY_MS`, mặc định 60 000) cộng nhiễu ngẫu nhiên nhỏ (jitter, nhưng có thể tiêm hàm ngẫu nhiên để test tất định), cho tới khi tổng thời gian mất kết nối liên tục vượt `RECONNECT_GIVE_UP_MS` (mặc định 1 800 000 = 30 phút; 0 = không bao giờ bỏ cuộc). Chỉ khi quá hạn mới đặt `lifecycle='error'`, ghi `reconnect_exhausted`. Bộ đếm/đồng hồ mất kết nối reset khi vào lại game thành công. Thêm vào `config.ts`, `.env.example`, `docs/DEPLOY_VPS.md` (giá trị sai -> mặc định; kẹp hợp lý), truyền xuống `VendorRunner` ở cả in-process và shard.
2. Khôi phục Auto sau khi nối lại: giữ đúng hành vi hiện có (`autoRequested` + neo), KHÔNG bật Auto nếu trước đó người dùng chưa bật; KHÔNG tự bật Auto khi `downed`; tôn trọng mọi cổng an toàn hiện có (vitals xác nhận, hurt, gục). Thêm test: mất kết nối giữa lúc Auto bật -> nối lại -> Auto lại bật; Auto tắt -> nối lại -> vẫn tắt.
3. Mất proxy: khi proxy lỗi trong lúc nối lại, tiếp tục thử QUA proxy (fail-closed: tuyệt đối không đi thẳng bằng IP máy chủ) theo cùng chính sách backoff.
4. Lỗi xác thực vĩnh viễn (refresh token bị từ chối/thu hồi — `AuthError` hoặc tương đương đã có trong mã): KHÔNG thử lại vô hạn; dừng ngay với mã lỗi rõ và đặt `authError` trên tài khoản như cơ chế hiện có.
5. Hiển thị: trong lúc đang nối lại, trạng thái runtime là `connecting`/đang kết nối lại (đã có) kèm số lần thử; khi bỏ cuộc vì quá hạn thì ghi nhật ký tài khoản + audit + `system_alert` cho chủ sở hữu ("Bot mất kết nối quá lâu và đã dừng"), và tài khoản chuyển `stopped`/`error` nhất quán với cách `WorkerPool` đang xử lý.
6. KHÔNG đổi: quy tắc "một tài khoản một phiên", không retry mù attack/skill (không liên quan), không tự bật bot khi server khởi động.

## Test và kiểm tra bắt buộc
- Mốc hiện tại: server 181/181 (32 file), web 49/49 — không được tụt. Đếm đúng bằng `npx tsx --test` trên mọi `*.test.ts` trong `apps/server/src`.
- Test với socket giả và đồng hồ tiêm: (a) mất kết nối 5 phút rồi nối lại được -> bot vẫn sống; (b) vượt `RECONNECT_GIVE_UP_MS` -> `error` + `reconnect_exhausted` + alert; (c) `RECONNECT_GIVE_UP_MS=0` không bao giờ bỏ cuộc; (d) backoff không vượt trần và không bùng nổ số lần thử; (e) AuthError dừng ngay; (f) proxy lỗi không bao giờ đi thẳng; (g) Auto khôi phục đúng như mục 2; (h) hoạt động ở chế độ shard (kênh giả).
- Phá thử sửa TRỰC TIẾP NGUỒN, test phải FAIL gọn không treo, rồi khôi phục: (i) quay lại bỏ cuộc sau 5 lần, (ii) bỏ trần backoff, (iii) không reset đồng hồ khi nối lại thành công, (iv) bật Auto khi người dùng chưa bật, (v) đi thẳng khi proxy lỗi.
- `pnpm build`, web test, từng file test liên quan rồi toàn bộ test server. Cập nhật SESSION_LOG/FIX_GUIDE. Báo cáo kết quả thật, kể cả lệnh không chạy được; nói rõ phần chưa xác minh (chưa chạy bot live).
