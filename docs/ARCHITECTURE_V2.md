# Kiến trúc đích (V2): bot không phụ thuộc client game, mở rộng tới 50 bot

Ngày: 2026-10-10. Trạng thái: ĐỀ XUẤT, chưa có mã nào được viết theo tài liệu này. Kiến trúc hiện tại nằm ở `docs/ARCHITECTURE.md` và vẫn là nguồn sự thật cho tới khi từng bước dưới đây được nghiệm thu.

Nhãn dùng trong tài liệu: **[Đã biết]** có căn cứ trong repo/log; **[Ước lượng]** là suy luận chưa đo; **[Chưa xác minh]** cần kiểm chứng live hoặc đo.

## 1. Vấn đề cần giải quyết

1. **Phụ thuộc client game.** Engine hiện tại chạy client chính thức đã minify trong `node:vm` và gọi thẳng nội bộ của nó (`SceneWorld.update`, `Input._autoToggle`, `Assets.ensureMap`, `startChopping`, `completeEscortSeedQuest`...) **[Đã biết]**. Game đổi tên hàm hoặc cơ chế thì bot hỏng, và nhiều lỗi chỉ lộ khi chạy live (các lỗi `linh_chi` ở `SESSION_LOG.md` là ví dụ).
2. **Tốn phần cứng.** Mỗi bot mô phỏng cả thế giới game khoảng 60 lần/giây (`loopIntervalMs = 16`) dù không vẽ **[Đã biết]**. Trên TV box Cortex-A53 4 nhân 1,2 GHz, một bot dùng gần một nhân **[Đã biết, đo thô]**.
3. **Chỉ dùng một luồng.** Mọi bot chạy chung một tiến trình Node, không có `worker_threads`/`cluster`/`child_process` **[Đã biết]**, nên thêm nhân CPU không tăng sức chứa.
4. **Mục tiêu:** 50 bot, và game cập nhật thì phát hiện nhanh, sửa ở một chỗ.

Không có bot nào độc lập hoàn toàn với game, vì bot nào cũng phải nói đúng protocol. Mục tiêu thực tế là: **khi game đổi, hệ thống tự phát hiện trước khi hỏng tài khoản thật, và việc sửa nằm gọn ở một lớp.**

## 2. Nguyên tắc thiết kế

- **Nhiệm vụ không biết gì về client.** Logic (việc hằng ngày, đi bộ, farm) chỉ gọi giao diện `GameGateway`.
- **Dữ liệu thay vì mã.** Định dạng gói tin, bảng map/quái/kỹ năng là dữ liệu có phiên bản, sinh bằng script; không rải hằng số khắp nơi.
- **Chưa biết phải là chưa biết.** Parser chịu được trường lạ/thiếu và trả `unknown`, không thay bằng 0 (quy tắc của `AGENTS.md`).
- **Client chính thức là công cụ đối chứng ở dev/CI, không phải thành phần bắt buộc ở production.** Vẫn giữ làm đường lui.
- **Phát hiện sớm hơn sửa sớm.** Dấu vân tay phiên bản + canary + giám sát bất thường trước mọi cải tiến khác.
- **Giữ mọi ràng buộc an toàn hiện có** (mục 9).

## 3. Sơ đồ tổng thể

```
Dashboard (React) ⇄ REST/WS ⇄ Tiến trình chính (API, SQLite, auth, entitlement, proxy checker, WS hub)
                                   │  IPC (JSON, có giới hạn tần suất)
                    ┌──────────────┼──────────────┐
                 Shard 1        Shard 2   ...   Shard N          (child_process, mỗi shard k bot)
                    │
        Runner (vòng đời bot, watchdog, hurt/death)
                    │
        Nhiệm vụ: DailyQuests · Navigation · Auto · ...      (không biết client)
                    │  gọi
              GameGateway  (giao diện trừu tượng)
          ┌─────────┴──────────┐
   ProtocolGateway        VendorGateway
   (client nhẹ, mặc định) (client chính thức, dự phòng / chưa viết lại)
          │
   Codec theo schema + Transport (WS qua proxy cố định)
```

## 4. Các lớp

### 4.1 `GameGateway` (giao diện duy nhất mà nhiệm vụ được dùng)
Bước 1 hiện thực `apps/server/src/gateway/game-gateway.ts`: `start/stop`, lifecycle và sự kiện disconnect, state chỉ đọc với giá trị chưa biết là `null`, walk/cancel, Auto, khu và metrics. Daily task được chứa qua `daily: DailyClient`, giữ nguyên `DailyQuests` và ACK theo `cmd`. `VendorGateway` uỷ quyền các lệnh cho `VendorRunner`; state gateway chỉ trả vitals khi snapshot xác nhận fresh. Danh sách map đi được hiện là map ID từ đồ thị đường đi của client.

Nhóm thao tác (tên cụ thể đã chốt trong interface):

| Nhóm | Ví dụ thao tác | Ghi chú |
|---|---|---|
| Phiên | `connect`, `disconnect`, `onDisconnect` | một tài khoản một phiên |
| Trạng thái | `getSelf`, `getVitals`, `getEntities`, `getMap` | giá trị chưa biết = `unknown` |
| Di chuyển | `walkTo`, `enterPortal`, `cancelMove` | gate mềm khi gục |
| Tương tác | `talk`, `collect`, `chop`, `fish`, `seedStart/Complete/Cancel` | ACK theo `cmd` |
| Chiến đấu | `attack`, `useSkill`, `setAuto` | gate nghiêm (cần vitals fresh) |
| Sự kiện | `onHurt`, `onDown`, `onRevived`, `onAck` | theo dõi `hurtCount` |

Tiêu chí: nhiệm vụ hiện có (ví dụ `DailyQuests` qua lớp `DailyClient`) chuyển sang giao diện này mà không đổi logic; mối nối `DailyClient` đã có sẵn **[Đã biết]** nên chi phí bước đầu thấp.

### 4.2 Hai bản cài đặt
- **`VendorGateway`:** đã có; bọc `VendorRunner` bằng composition. Giữ nguyên hành vi; là hiện thực duy nhất và nguồn đối chứng hiện tại.
- **`ProtocolGateway`:** client nhẹ, giữ WebSocket, giải mã gói theo schema, giữ mô hình thế giới tối thiểu (vị trí từ `you`, thực thể từ `p`/`pf`, map từ dữ liệu sinh sẵn). Không mô phỏng vật lý toàn cục; chỉ làm những gì cần để gửi gói hợp lệ.
- Chọn gateway theo tài khoản và theo loại việc; một tài khoản chỉ chạy MỘT gateway tại một thời điểm.

### 4.3 Codec và schema protocol
- Mỗi `op` có schema có phiên bản (trường, kiểu, bắt buộc/tuỳ chọn), lưu dạng dữ liệu cạnh các file `*.generated.ts` hiện có.
- Nguồn của schema: đọc từ mã client trong `vendor/` (chỉ đọc) và xác nhận bằng bản ghi live đã che dữ liệu nhạy cảm.
- Gói không khớp schema: ghi nhận (đếm, mẫu đã che), không crash, không đoán.

### 4.4 Dữ liệu tĩnh
Tiếp tục sinh bằng `scripts/gen-*.mjs` từ `vendor/` (lưới va chạm, điểm sinh quái, bảng quái/kỹ năng, derived vitals) **[Đã biết]**. Thêm bước kiểm tra tính nhất quán sau khi sinh (số map, kích thước lưới) để cập nhật `vendor/` mà không âm thầm làm sai dữ liệu.

### 4.5 Dấu vân tay phiên bản game và canary
- Định kỳ tính hash của bundle client và phiên bản dữ liệu map; lưu hash "đã xác nhận".
- Hash đổi: tự **tạm dừng các việc rủi ro** (combat, việc có thưởng), chạy canary (đăng nhập, một bước đi, đọc state, một ACK an toàn), rồi: tiếp tục, chuyển sang `VendorGateway`, hoặc giữ tạm dừng và báo cho chủ dự án.
- **[Chưa xác minh]:** nguồn hash khả dụng ở production (file client tải từ đâu, header phiên bản có hay không).

### 4.6 Giám sát bất thường
Theo dõi tỷ lệ ACK `ok:false`, gói không khớp schema, timeout, `hurtCount`, số lần reconnect theo từng loại việc. Vượt ngưỡng: dừng bot đó và báo trên dashboard (`system_alert`), không retry mù (AGENTS.md).

### 4.7 Đối chứng với client chính thức (dev/CI)
Công cụ chạy cùng một kịch bản qua `VendorGateway` và `ProtocolGateway`, so sánh chuỗi gói tin gửi đi (đã che dữ liệu nhạy cảm). Lệch → báo. Đây là chỗ giữ lợi ích của client chính thức mà không phụ thuộc vào nó lúc chạy thật.

### 4.8 Kiểm thử
- Bản ghi phiên đã che (cấu trúc key, thứ tự gói, số liệu cần thiết) làm fixture phát lại. Hiện chưa có raw packet fixture **[Đã biết]**, đây là việc cần làm sớm.
- Giữ nguyên các test hiện có (daily-quests, vendor-runner, contract test); thêm test hợp đồng chạy cùng một bộ nhiệm vụ trên cả hai gateway với bản giả.

## 5. Mở rộng tới 50 bot

- **Shard bằng `child_process`:** mỗi shard chứa k bot, tiến trình chính giữ API/DB/WS/auth. Chọn tiến trình thay cho `worker_threads` vì watchdog RSS và cô lập lỗi theo PID (`watchdogMaxRssGrowthBytes` hiện đo cả tiến trình).
- **IPC:** lệnh start/stop/auto từ chính xuống shard; snapshot, log, sự kiện hurt từ shard lên chính, có giới hạn tần suất.
- **Lập lịch:** gán bot vào shard ít tải nhất; trần tổng `MAX_TOTAL_RUNNERS` và trần mỗi shard dựa trên số đo thực tế.
- **Khoá một phiên:** tiến trình chính giữ khoá duy nhất cho từng account; không bao giờ để hai shard chạy cùng một account, kể cả khi shard chết và khởi động lại (đảm bảo shard cũ đã thoát trước).
- **Shard chết:** đánh dấu `stopped`, không tự bật lại bot.
- **Ước lượng sức chứa [Ước lượng, chưa đo]:** với `ProtocolGateway` mục tiêu CPU ≤ khoảng 7% một nhân A53 mỗi bot để đạt 50 bot trên 4 nhân; với `VendorGateway` hiện tại chỉ khoảng 3–4 bot. Quyết định cuối chỉ sau phép đo ở mục 7, bước 0.

## 6. Lộ trình

Mỗi bước tự pass `pnpm build` và test, không phá cũ, nghiệm thu riêng, không gộp.

| Bước | Nội dung | Rủi ro | Tiêu chí xong |
|---|---|---|---|
| 0 | **Đo:** số liệu CPU/RAM theo từng bot (API/dashboard); đo bản `core` cũ trong lịch sử git so với `vendor` trên TV box | thấp | có bảng số đo thật |
| 1 | Định nghĩa `GameGateway`, bọc `VendorRunner` thành `VendorGateway`, chuyển nhiệm vụ sang giao diện mới | thấp | test cũ pass, hành vi không đổi |
| 2 | Dấu vân tay phiên bản + canary + giám sát bất thường | thấp | game đổi giả lập thì tự tạm dừng và báo |
| 3 | `ProtocolGateway` cho phần đã live: đăng nhập, đi bộ, đổi map qua cổng; công cụ đối chứng gói tin | trung bình | khớp vendor trên kịch bản đi bộ/đổi map, test live ngắn |
| 4 | Chuyển từng việc hằng ngày sang `ProtocolGateway`, mỗi việc một lần, live từng việc | trung bình–cao | từng việc `done` live, `hurtCount` 0 |
| 5 | Shard đa tiến trình, lập lịch, khoá một phiên | cao | chạy N bot soak ổn định trên phần cứng đích |
| 6 | (Tuỳ chọn) combat/Auto/hồi sinh/chọn khu trên `ProtocolGateway` sau khi các khoá `KHU_PROTOCOL_UNAVAILABLE`, `RESPAWN_PROTOCOL_UNAVAILABLE` được xác minh | cao | giữ vendor cho tới khi có bằng chứng live |

## 7. Chỉ số nghiệm thu
- CPU và RAM mỗi bot (đo thật, ghi cùng phần cứng): bảng trước/sau.
- Độ phủ chức năng: số việc/chức năng chạy được trên `ProtocolGateway` so với `VendorGateway`, ghi rõ phần chưa xác minh.
- Thời gian phát hiện game đổi (dấu vân tay → tạm dừng) và thời gian chuyển sang đường lui.
- Số lỗi chỉ lộ khi live (mục tiêu: giảm nhờ fixture và đối chứng).
- Không có lần nào hai phiên cùng một tài khoản; `hurtCount` live bằng 0 trong các bài thử.

## 8. Độ phủ chức năng dự kiến khi dựng client nhẹ **[Ước lượng]**

| Nhóm | Ban đầu | Sau nhiều vòng test live |
|---|---|---|
| Đăng nhập, đọc state, đi bộ, đổi map qua cổng | ~85–95% | ~95% |
| Việc hằng ngày (5 việc) | ~50–70% | ~85–90% |
| Combat, Auto đánh, hồi sinh, chọn khu | ~30–50% | ~70–80% |

Tổng ~60–75% lúc đầu, 85–90% sau nhiều tháng. Không cam kết 100%. Phần combat cần dùng `VendorGateway` cho tới khi được xác minh.

## 9. Ràng buộc bắt buộc (từ `AGENTS.md`, giữ nguyên)
- Mỗi tài khoản chỉ một phiên và một engine/gateway tại một thời điểm.
- Không tự bật Auto khi server khởi động; Auto chỉ bật sau yêu cầu rõ ràng; theo dõi `hurtCount`/`lastHurtAt` và dừng ngay bằng `POST /api/accounts/:id/stop`.
- Giữ khoá `KHU_PROTOCOL_UNAVAILABLE`, `RESPAWN_PROTOCOL_UNAVAILABLE` cho tới khi xác minh.
- Không in/log bí mật (token, mật khẩu, `selfId`, tên nhân vật, id người chơi khác); evidence luôn đã che.
- Không retry mù attack/skill; gate di chuyển mềm, gate tấn công/skill nghiêm.
- Không sửa `vendor/`; control-plane bind loopback, auth, Origin allowlist giữ nguyên.
- Mọi bước đo/test live bắt đầu nhỏ, có điều kiện dừng khi `hurtCount` tăng.

## 10. Rủi ro và câu hỏi mở
- Game đổi cơ chế lớn (mã hoá, xác thực mới) vẫn cần sửa tay; V2 chỉ giúp phát hiện sớm và khoanh vùng.
- Server có kiểm tra hành vi/nhịp di chuyển mà client nhẹ mô phỏng chưa đúng? **[Chưa xác minh]** (xem các lần sửa tốc độ di chuyển trước đây trong `docs/PROMPT_FIX_MOVE_SPEED.md`).
- Game có phát hiện 50 tài khoản từ cùng nhóm IP/proxy? **[Chưa xác minh]**.
- Nguồn dấu vân tay phiên bản ở production (mục 4.5) chưa rõ.
- Độ trễ và tải IPC khi gửi snapshot từ nhiều shard; cần giới hạn tần suất.
- Hành vi shard mồ côi khi tiến trình chính khởi động lại.
- Chi phí duy trì hai gateway song song trong giai đoạn chuyển tiếp.
- Phần đo ở bước 0 có thể cho thấy client nhẹ không rẻ như kỳ vọng; khi đó dừng lại và đánh giá lại trước khi đầu tư bước 3 trở đi.
