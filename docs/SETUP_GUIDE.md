# Hướng dẫn cài đặt và vận hành TuTien2D

Cập nhật: 2026-10-12. Dành cho người dùng cuối (chủ dự án). Bản triển khai production đầy đủ (systemd, Nginx/Caddy, HTTPS) xem `docs/DEPLOY_VPS.md`; mẫu cấu hình đầy đủ nằm ở `apps/server/.env.example`. Những gì chưa thử trên Linux thật được đánh dấu **chưa xác minh**.

## 1. Chuẩn bị
- Node.js 24 trở lên (`node --version`), `pnpm`, `git`. Linux nên có `pm2` (`npm i -g pm2`).
- RAM: ước lượng `RAM hệ điều hành + 250 MB × số bot + 30% dự phòng` (số đo ban đầu, chưa xác minh trên mọi phần cứng).
- Mỗi tài khoản game chỉ có **một phiên đăng nhập**: không mở game bằng cùng tài khoản khi bot đang chạy (sẽ đá phiên của bot).

## 2. Cài đặt và build
```bash
git clone <repo-url> DBtutien2d && cd DBtutien2d
pnpm install --frozen-lockfile
pnpm build
```
Lỗi `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL` khi build nghĩa là một package bị lỗi biên dịch: đọc dòng `error TS...` phía trên để biết file nào.

## 3. Cấu hình `.env`
File cấu hình là `apps/server/.env` (không có sẵn, không được commit).
```bash
cp apps/server/.env.example apps/server/.env
chmod 600 apps/server/.env
```
Sửa tối thiểu các khoá sau:

| Khoá | Ý nghĩa |
|---|---|
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | Tài khoản quản trị cho lần chạy ĐẦU TIÊN (mật khẩu ≥ 6 ký tự). Vào được dashboard thì đổi mật khẩu rồi xoá 2 dòng này |
| `PORT` | Cổng server (mặc định 4000, phục vụ cả API và bản web đã build). Cổng 3000 chỉ là cổng dev, không liên quan khi chạy production |
| `HOST` | Mặc định `127.0.0.1` (chỉ máy đó vào được). Chỉ đổi khi hiểu rõ, xem mục 5 |
| `PUBLIC_ORIGIN`, `ALLOWED_ORIGINS` | Địa chỉ bạn gõ trên trình duyệt. Sai/thiếu thì dashboard bị đẩy về đăng nhập liên tục (WebSocket bị từ chối Origin) |
| `TRUST_PROXY` | Số hop reverse proxy thật phía trước (Nginx một mình = 1, Cloudflare + Nginx = 2) |
| `REQUIRE_PROXY` | `1` = tài khoản chưa gán proxy thì không chạy được (xem mục 7) |
| `MAX_TOTAL_RUNNERS`, `MIN_FREE_MEM_MB` | Trần số bot chạy cùng lúc và ngưỡng RAM trống tối thiểu |

Các khoá điều khiển hành vi bot (đều tuỳ chọn, mặc định có sẵn):

| Khoá | Mặc định | Tác dụng |
|---|---|---|
| `VENDOR_ALWAYS_RUN` | bật | Bot luôn ở chế độ chạy (nhanh hơn ~11% so với đi bộ). Đặt `0` để đi bộ |
| `VENDOR_HALT_MODE` | `disconnect` | Khi Auto dừng an toàn: `disconnect` ngắt kết nối game; `stay` giữ kết nối để còn thấy HP/bản đồ (nhân vật có thể bị quái đánh) |
| `VENDOR_LOOP_INTERVAL_MS` | 16 | Nhịp vòng lặp mô phỏng; 33 giảm khoảng một nửa CPU nhưng di chuyển thô hơn |
| `VENDOR_SHARDS` | 0 | Số tiến trình shard để dùng nhiều nhân CPU (thử với một bot trước) |
| `RECONNECT_MAX_DELAY_MS`, `RECONNECT_GIVE_UP_MS` | 60000, 1800000 | Giãn cách tối đa giữa các lần nối lại; sau bao lâu mất kết nối liên tục thì bỏ cuộc |

Sau mỗi lần sửa `.env` phải khởi động lại server (mục 6).

## 4. Chạy thử trên máy cá nhân
```bash
cd apps/server && node dist/index.js
```
Mở `http://localhost:4000`, đăng nhập bằng `ADMIN_USERNAME`/`ADMIN_PASSWORD`. Cổng 4000 phải còn trống (`PORT` đổi được).

## 5. Cách truy cập dashboard từ xa (chọn một)
**A. SSH tunnel (khuyên dùng khi thử VPS, không cần sửa `.env` mỗi lần đổi VPS).** Server vẫn bind `127.0.0.1`. Trên máy của bạn:
```bash
ssh -N -L 4001:127.0.0.1:4000 root@IP-VPS
```
Giữ cửa sổ mở, mở `http://localhost:4001`, và đặt `ALLOWED_ORIGINS=http://localhost:4001` trong `.env` của VPS (một lần). Nếu cổng 4000 máy bạn đang trống có thể dùng `-L 4000:127.0.0.1:4000` và mở `http://localhost:4000` (không cần sửa gì).

**B. Vào thẳng IP bằng HTTP (chỉ để thử, web cá nhân).** Chạy một lệnh trên VPS:
```bash
bash scripts/quick-vps.sh            # tự lấy IP công khai; hoặc: bash scripts/quick-vps.sh 1.2.3.4
```
Script ghi `HOST=0.0.0.0`, tạo `API_TOKEN` ngẫu nhiên, đặt `PUBLIC_ORIGIN/ALLOWED_ORIGINS`, mở cổng (ufw nếu bật), khởi động lại pm2. Mỗi VPS mới chạy lại đúng lệnh này. Nhà cung cấp VPS có thể còn firewall riêng: phải mở cổng ở bảng điều khiển của họ. **Cảnh báo:** HTTP không mã hoá, mật khẩu và token đi rõ trên mạng; đây là lựa chọn của chủ dự án cho web cá nhân, trái với khuyến nghị bảo mật mặc định (không mở cổng 4000 ra Internet).

**C. Production với tên miền và HTTPS.** Đặt Nginx/Caddy trước (xem `deploy/` và `docs/DEPLOY_VPS.md`), `HOST=127.0.0.1`, `PUBLIC_ORIGIN=https://ten-mien`, `TRUST_PROXY` đúng số hop, chạy `node scripts/vps-preflight.mjs --smoke --vendor-boot` trước khi bật dịch vụ.

## 6. Chạy bằng pm2
```bash
cd apps/server
pm2 start dist/index.js --name tutien-server --time
pm2 save && pm2 startup        # tự chạy lại khi VPS khởi động (chạy dòng sudo mà pm2 in ra)
```
Lệnh thường dùng:
```bash
pm2 logs tutien-server --lines 50      # xem nhật ký
pm2 describe tutien-server             # trạng thái, số lần restart
pm2 restart tutien-server --update-env # sau khi sửa .env hoặc cập nhật mã
curl -s http://127.0.0.1:4000/health   # kiểm tra server sống
```
Đường dẫn trong `pm2 start` là tương đối với thư mục hiện tại (`apps/server`); đừng ghép `apps/server/...` lần nữa. Nếu máy đang chạy chương trình khác ở cổng 3000 thì không ảnh hưởng: server dùng cổng 4000.

## 7. Dùng dashboard
1. **Đăng nhập** bằng tài khoản quản trị, đổi mật khẩu ở nút Quản lý tài khoản.
2. **Proxy** (nếu `REQUIRE_PROXY=1`): vào tab Quản trị → Proxy, thêm proxy (chọn giao thức socks5/http, nhập `host:port` và tài khoản/mật khẩu). Nút kiểm tra proxy gọi ra ngoài qua chính proxy đó.
3. **Thêm tài khoản game:** nút "Thêm Tài Khoản" (đạo hiệu + mật khẩu). **Bước này đăng nhập thật vào game để xác minh**: dùng đúng thông tin thật, tránh nhập thử mật khẩu giả.
4. **Thanh trái** liệt kê tài khoản (tên, cảnh giới, HP, Linh lực, Thần thức, Giáp, Đạo Hạnh, Linh Thạch); ô tìm kiếm và bộ lọc trạng thái. Bấm một tài khoản để mở bảng chi tiết với các tab: Tổng quan, Bản đồ, Hằng ngày, Túi đồ, Auto, Nhật ký, Tài khoản.
5. **Chạy / Dừng** ở tiêu đề bảng. Bật **Auto** ở tab Auto (neo tại vị trí hiện tại). Luôn theo dõi `hurtCount`; tăng bất thường thì bấm Dừng.
6. **Chơi:** nút "Chơi" mở trang game chính thức `https://tutien2d.online/` ở tab mới, chỉ bật khi bot của tài khoản đã dừng. "Sao chép đạo hiệu" chỉ sao chép tên đăng nhập, bạn tự đăng nhập trang game.
7. **Túi đồ** hiện lưới vật phẩm (chỉ xem). **Linh Thạch** hiển thị ví, số nhận được hôm nay từ quái so với trần theo cảnh giới, và biến động từ lúc bật bot.

## 8. Cập nhật phiên bản
```bash
git pull && pnpm install --frozen-lockfile && pnpm build
cd apps/server && pm2 restart tutien-server --update-env
```
Sao lưu trước khi cập nhật lớn: `node scripts/backup.mjs` (xem `BACKUP_KEEP`, `BACKUP_DIR` trong `.env`). **Không mất file `.secret`** trong `DATA_DIR`: mất khoá là không giải mã được mật khẩu game và proxy đã lưu.

## 9. Xử lý sự cố thường gặp
| Triệu chứng | Nguyên nhân khả dĩ / cách xử lý |
|---|---|
| Đăng nhập xong bị đẩy ra màn hình đăng nhập | `PUBLIC_ORIGIN`/`ALLOWED_ORIGINS` không khớp địa chỉ đang gõ. Đặt đúng rồi restart; hoặc dùng SSH tunnel (mục 5A).  (Bản hiện tại chưa ghi log riêng cho Origin bị từ chối; dấu hiệu là WebSocket `/ws` lỗi lặp lại trong F12 → Console.) |
| Không vào được `IP:4000` | Server chỉ nghe `127.0.0.1` (mặc định). Dùng tunnel, hoặc `scripts/quick-vps.sh`, và mở cổng ở firewall của nhà cung cấp |
| `pm2` báo `Cannot find module .../apps/server/apps/server/dist/index.js` | Đường dẫn bị ghép đôi; chạy `cd apps/server && pm2 start dist/index.js --name tutien-server` |
| Thêm tài khoản báo 409 | Có thể thiếu proxy khả dụng (`NO_PROXY_AVAILABLE`/`PROXY_REQUIRED`) hoặc đạt giới hạn bot. Xem tab Response trong F12, hoặc đặt `REQUIRE_PROXY=0` khi thử |
| `watchdog_warning (frame_delay)` | Node bị đứng ≥ 250 ms: máy quá tải. Giảm số bot, `VENDOR_SHARDS=2`, hoặc `VENDOR_LOOP_INTERVAL_MS=33`. Dòng thoảng qua thì không sao |
| Sau nhịp trễ lớn mất Auto, HP/Linh lực "chưa có số liệu mới", bản đồ không dùng được | Có thể bộ giám sát Auto đã dừng an toàn và ngắt kết nối. Xem tab Auto: "Đã dừng an toàn: <mã>" hoặc nhật ký `auto_halted`. Khôi phục: Dừng rồi Chạy lại. Muốn giữ kết nối: `VENDOR_HALT_MODE=stay` |
| Sau khi nối lại Auto bị tắt | Cổng an toàn chặn khi `hurtCount` tăng, nhân vật gục hoặc chưa có HP/MP. Xem nhật ký `reconnect_auto_blocked` và `reasonCode` |
| Server tự tắt không rõ lý do | `pm2 describe tutien-server` và nhật ký có dòng `Shutting down ... reason=...`; trên Linux xem thêm `last -x reboot` |

## 10. Quy tắc an toàn
- Không đưa token, mật khẩu, `API_TOKEN`, `ENCRYPTION_SECRET` vào chat, nhật ký hay commit. `data/`, `.env*` đã nằm trong `.gitignore`.
- Mỗi tài khoản một phiên; không mở client thứ hai bằng cùng tài khoản.
- Giữ nguyên các khoá an toàn chưa xác minh giao thức (`KHU_PROTOCOL_UNAVAILABLE`, `RESPAWN_PROTOCOL_UNAVAILABLE`); không bypass portal để đổi map.
- Khi chạy thật, theo dõi `hurtCount`/`lastHurtAt`; tăng thì dừng bot (`POST /api/accounts/:id/stop` hoặc nút Dừng).
