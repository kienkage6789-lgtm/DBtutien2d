# Kế hoạch thực hiện ARCHITECTURE_V2 (từng bước, nghiệm thu từng bước)

Tham chiếu: `docs/ARCHITECTURE_V2.md` (đích), `AGENTS.md` (ràng buộc). Mỗi bước giao cho Codex một lần, tôi (Claude) nghiệm thu độc lập rồi mới sang bước sau. Không gộp bước. Không commit khi chưa được chủ dự án yêu cầu.

## Quy trình mỗi bước
1. Viết prompt `docs/PROMPT_V2_STEPn.md` (phạm vi, ràng buộc, test bắt buộc).
2. Giao Codex (`codex exec`, model `gpt-6-luna`, suy luận `high`, sandbox `workspace-write`).
3. Nghiệm thu độc lập (không tin báo cáo của Codex):
   - Đọc toàn bộ diff (`git diff`), đối chiếu phạm vi: không có thay đổi ngoài phạm vi, không lộ bí mật.
   - `pnpm build` pass (3 package).
   - `pnpm --filter @tutien2d/web test` pass.
   - Chạy TỪNG file test server liên quan: `cd apps/server && npx tsx --test <file>`; sau đó chạy toàn bộ test server và so với trước bước (không được tụt số test pass).
   - Test mới phải thật sự bắt lỗi: tạm làm hỏng mã (mutation nhanh) và xác nhận test fail.
   - Bài kiểm tra chạy thật (server tạm, DB tạm, cổng khác) khi bước có thay đổi API/UI.
   - Bước chạm bot live: chỉ chạy khi chủ dự án đồng ý, từng bước nhỏ, dừng ngay khi `hurtCount` tăng.
4. Báo cáo bảng trạng thái (xong / chặn / chưa xác minh) kèm bằng chứng. Test fail thì nói thẳng.
5. Cập nhật `docs/SESSION_LOG.md` (mục đầu) và checklist `docs/FIX_GUIDE.md`.

## Đường găng và cổng quyết định
- Sau Bước 0 (có số đo thật) dừng lại để quyết định có đầu tư tiếp client nhẹ (Bước 3 trở đi) hay không.
- Bước 1–2 có ích độc lập, không phụ thuộc quyết định trên.

## Các bước

| Bước | Nội dung | Rủi ro | Cổng nghiệm thu chính |
|---|---|---|---|
| 0a | Số liệu hiệu năng theo từng bot: thời gian mỗi khung (`frame()`), tỷ lệ chiếm vòng lặp sự kiện, độ trễ vòng lặp, RSS/heap tiến trình; phơi ra API admin và hiển thị gọn | thấp | không đổi hành vi bot; test collector dùng đồng hồ tiêm; test vendor-runner cũ vẫn pass |
| 0b | Đo thật trên phần cứng đích (TV box/VPS) bằng bài đo bot thật, và đo bản `core` cũ trong git | trung bình (chạm game thật) | chủ dự án cho phép và theo dõi; bảng số đo CPU/RAM trước-sau |
| 1 | `GameGateway` + `VendorGateway` bọc `VendorRunner`; chuyển nhiệm vụ sang giao diện | thấp–trung bình | toàn bộ test cũ pass, hành vi không đổi, test hợp đồng trên bản giả |
| 2 | Dấu vân tay phiên bản game + canary + giám sát bất thường | thấp–trung bình | giả lập đổi hash thì tạm dừng việc rủi ro và báo |
| 3 | `ProtocolGateway` cho đăng nhập/đi bộ/đổi map + công cụ đối chứng gói tin với vendor | cao | khớp vendor trên kịch bản; live ngắn có kiểm soát |
| 4 | Chuyển từng việc hằng ngày sang `ProtocolGateway`, mỗi việc một lần | cao | từng việc `done` live, `hurtCount` 0 |
| 5 | Shard đa tiến trình (`child_process`), lập lịch, khoá một phiên | cao | soak N bot trên phần cứng đích, không bao giờ hai phiên cùng tài khoản |
| 6 | Combat/Auto/hồi sinh/chọn khu (tuỳ chọn, sau khi protocol được xác minh) | cao | giữ vendor tới khi có bằng chứng live |

Bước 3 trở đi chỉ lên prompt chi tiết sau khi có kết quả Bước 0 và 1.

## Bước 0a — phạm vi chi tiết (prompt: `docs/PROMPT_V2_STEP0A.md`)
Chỉ thêm quan sát, KHÔNG đổi hành vi bot, KHÔNG đổi `loopIntervalMs`, KHÔNG đụng tới protocol/game.
- Collector thuần (đồng hồ tiêm được) ghi thời gian mỗi `frame()` của `VendorRunner`: số khung, trung bình trượt, p95 và max trong cửa sổ, tổng thời gian khung chia thời gian thực = "tỷ lệ chiếm vòng lặp".
- Độ trễ vòng lặp sự kiện (`perf_hooks.monitorEventLoopDelay`), RSS/heap tiến trình và số runner đang chạy.
- Phơi ra qua trường `metrics` trong runtime snapshot của account (REST/WS, chỉ admin hoặc chủ sở hữu, không lộ bí mật) và `GET /api/admin/health`.
- Hiển thị tối thiểu ở tab "Tài khoản toàn hệ thống" (admin): ms/khung và % chiếm vòng lặp. Giá trị chưa có hiện "chưa biết", không phải 0.
- Test: collector (cửa sổ, p95, chia cho 0, đồng hồ tiêm), snapshot không rò thông tin, vendor-runner test cũ vẫn pass, web sanitizer nhận được trường mới.
