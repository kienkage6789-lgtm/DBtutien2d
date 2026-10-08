# AGENTS.md — TuTien2D

Hướng dẫn cho mọi agent (Codex, Claude Code, ...) làm việc trong repo này. Đọc hết trước khi sửa.

## Cấu trúc

- `apps/server`: backend, REST API, orchestrator, WebSocket hub cho dashboard (`src/orchestrator/worker-pool.ts` là file lớn nhất).
- `apps/web`: dashboard React + Vite (dev `:3000`, bản build do server phục vụ ở `:4000`).
- `packages/core-client`: client WebSocket của game, state, parser packet, packet tap debug.
- `packages/automation-engine`: bot controller và state machine training.
- `vendor/tutien2d-public-client/2026-10-06`: code client chính thức (đã minify) dùng để THAM CHIẾU protocol. Không sửa.
- `docs/`: tài liệu. Đọc `docs/SESSION_LOG.md` (mục mới nhất ở đầu file) và `docs/FIX_GUIDE.md` trước khi làm việc.
- Game server: `wss://game.tutien2d.online/`.

## Lệnh

```bash
pnpm install
pnpm build                                  # build 4 package, bắt buộc pass
pnpm --filter @tutien2d/web test            # Vitest cho web
pnpm dev                                    # server + web dev
```

Test JS/TS của core-client, automation-engine, server nằm cạnh package (xem `package.json` từng package). Sau mỗi thay đổi phải chạy `pnpm build` và test liên quan, không làm vỡ test cũ.

## Quy tắc BẮT BUỘC

### Bí mật và dữ liệu nhạy cảm
- KHÔNG in, ghi log, commit hay đưa vào evidence/chat: token, JWT, refresh token, mật khẩu, `API_TOKEN`, `ENCRYPTION_SECRET`, `selfId`, tên nhân vật, id người chơi khác.
- `data/`, `apps/server/data/` (có `.secret`, `tutien_db.json`), `.env*`, `docs/evidence/` đã nằm trong `.gitignore`. Không đọc nội dung các file này khi không cần thiết và không bao giờ in ra.
- Evidence packet phải ở dạng redacted (chỉ tên key, số liệu cần thiết). Packet tap mặc định tắt, bật bằng `TUTIEN_PACKET_TAP=<giây>`.

### An toàn khi chạm game thật
- Mỗi tài khoản game CHỈ MỘT phiên đăng nhập. Không mở client thứ hai bằng cùng tài khoản (sẽ đá phiên của bot).
- Không gửi lệnh tấn công, skill hay di chuyển tự động ngoài phạm vi nhiệm vụ được giao. Không retry mù attack/skill (game không có ACK riêng cho chúng).
- Không bypass portal để đổi map; protocol chọn `khu` và hồi sinh chưa được xác minh nên giữ nguyên các khóa `KHU_PROTOCOL_UNAVAILABLE`, `RESPAWN_PROTOCOL_UNAVAILABLE`.
- Không dừng/xóa/sửa tài khoản, cấu hình bot hoặc database khi không được yêu cầu.
- Khi chạy live, theo dõi `hurtCount`/`lastHurtAt` trong runtime (server không log gói `hurt`). Quái có thể tấn công bot kể cả khi đứng yên; `hurtCount` tăng thì dừng bot ngay (`POST /api/accounts/:id/stop`). Không để bot đứng chờ ở map có quái khi chưa cần.

### Bảo mật control-plane
- Server mặc định bind `127.0.0.1`. Bind ngoài loopback bắt buộc `API_TOKEN` >= 32 ký tự. Không nới allowlist origin (`ALLOWED_ORIGINS`), không dùng `*`, không tắt auth.
- Không đưa token vào query string; WebSocket dashboard dùng subprotocol `bearer`.

### Quy tắc dữ liệu game (đã xác minh)
- `maxHp/maxMp` không có trên wire; chỉ là giá trị SUY RA (`derivedMax`) từ `state.save.realm` + `state.save.equipment`. Không ghi vào `VitalSnapshot`.
- HP tuyệt đối của chính mình chỉ đến qua `you` (mỗi 10 `seq` của move), `hurt`, `revived`, `formation balance` (chỉ mp). `hp` trong `p`/`pf` của người khác là PHẦN TRĂM, không được dùng làm vitals.
- Chết/gục: dùng cờ `dn` (từ `you`) và gói `down`/`revived`. Không dùng `hp <= 0` một mình.
- Gate di chuyển là MỀM (chỉ chặn khi đã gục); gate tấn công/skill là NGHIÊM (cần vitals fresh).
- Dữ liệu chưa biết phải hiển thị là chưa biết, không được thay bằng 0 hoặc giá trị mặc định.
- Phần chưa kiểm chứng ghi rõ "chưa xác minh". Không suy đoán thành kết luận.

### Quy ước làm việc
- Thay đổi nhỏ, tập trung. Giữ phong cách code sẵn có. Không refactor ngoài phạm vi.
- Sửa `apps/web/src` không đổi UI ở `:4000` cho tới khi `pnpm build`; hoặc kiểm tra ở `:3000`.
- Sau khi làm xong: cập nhật `docs/SESSION_LOG.md` (mục mới ở ĐẦU file: thay đổi, lệnh đã chạy, kết quả thật, mục còn chờ xác minh) và checklist ở cuối `docs/FIX_GUIDE.md`.
- Báo cáo kết quả bằng bảng trạng thái (xong / chặn / chưa xác minh) kèm bằng chứng ngắn. Nếu test hoặc build fail, nói thẳng và kèm output; không tuyên bố đã xong.
- Git: repo mới khởi tạo. Không commit khi không được yêu cầu, không force-push, không đụng `.gitignore` để bỏ qua file bí mật.

### Headless vendor engine
- Mỗi tài khoản chỉ có một engine/phiên: `core` hoặc `vendor`; không khởi động engine thứ hai khi engine kia còn chạy.
- Auto vendor chỉ được bật sau yêu cầu rõ ràng từ API/UI; không tự bật khi server khởi động. Luôn theo dõi `hurtCount`/`lastHurtAt`; khi live có hurt phải dừng bằng `POST /api/accounts/:id/stop`.
- Vòng `node:vm` phải giữ `fetch`/XHR/`require`/`process` và file system ngoài tầm vendor; đây không phải sandbox bảo mật. Khi gọi `SceneWorld.update(dt)` phải tăng `Game.time`, chạy `flushRaf`, và không `draw`; `Assets.ensureMap`/`Assets.idle` phải settle ngay.
- Trong supervisor, không toggle Auto khi `Input._autoToggle` còn queue; Auto phải tắt trong mọi pha hồi sinh/hồi phục/đi về. Không suy đoán map/khu/HP khi client chưa cung cấp dữ liệu.
