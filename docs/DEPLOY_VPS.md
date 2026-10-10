# Triển khai TuTien2D trên VPS Linux

Tài liệu này dành cho bước 5. Vendor/game chưa được xác minh trên Linux trong môi trường phát triển Windows; chỉ chạy bot sau khi đã kiểm tra `hurtCount`/`lastHurtAt` theo `AGENTS.md`.

## 1. Chọn máy và chuẩn bị

Số đo ban đầu trên Windows: server khoảng 63 MB RSS lúc rảnh, 95–155 MB sau khi vào game và có lúc tới khoảng 270 MB sau hai phút. Đây chưa phải số đo Linux và chưa phải cam kết. Công thức bảo thủ ban đầu:

`RAM cần ≈ RAM hệ điều hành + (250 MB × số runner) + 30% dự phòng`.

Tạo user riêng, không chạy service bằng root:

```sh
sudo useradd --system --home /opt/tutien2d --shell /usr/sbin/nologin tutien2d
sudo mkdir -p /opt/tutien2d /var/lib/tutien2d /etc/tutien2d
sudo chown -R tutien2d:tutien2d /opt/tutien2d /var/lib/tutien2d
```

Cài Node 24 LTS và pnpm theo cách quản trị viên VPS đã chọn. `node --version` phải là 24 trở lên; chạy `command -v node` và dùng đường dẫn tuyệt đối đó trong `ExecStart` của unit mẫu.

## 2. Lấy mã và build

```sh
sudo -u tutien2d git clone <repo-url> /opt/tutien2d
cd /opt/tutien2d
sudo -u tutien2d pnpm install --frozen-lockfile
sudo -u tutien2d pnpm build
```

Không copy `.env`, `data/`, database hoặc `.secret` vào Git. `DATA_DIR` phải là thư mục riêng, quyền tối đa `0700`; database và `.secret` tối đa `0600`.

## 3. Tạo cấu hình

```sh
sudo install -o tutien2d -g tutien2d -m 0600 deploy/env.example /etc/tutien2d/env
sudoedit /etc/tutien2d/env
```

Đặt `HOST=127.0.0.1`, `TRUST_PROXY=<số hop proxy thật, 1..10; Nginx một mình = 1, Cloudflare + Nginx = 2>`, `PUBLIC_ORIGIN=https://...` đúng hostname thật và `ALLOWED_ORIGINS` không có `*`. Chọn `MAX_TOTAL_RUNNERS` sau khi soak; `0` chỉ có nghĩa là không đặt trần cứng. `MIN_FREE_MEM_MB=300` là cổng RAM tối thiểu cho runner mới, không dừng runner đang chạy.

`AUTO_ASSIGN_PROXY=1` là mặc định để account mới được gán proxy enabled có tải thấp nhất; bật `REQUIRE_PROXY=1` nếu mọi account bắt buộc phải có proxy. `PROXY_CHECK_INTERVAL_MS=300000` và `PROXY_CHECK_TIMEOUT_MS=8000` điều khiển checker. `ALLOW_PRIVATE_PROXY=0` phải giữ nguyên trên VPS; chỉ bật tạm thời cho test local. Proxy được nhập và kiểm tra trong tab quản trị, URL có credential chỉ lưu mã hóa và không xuất hiện trong response/log.

`ADMIN_USERNAME`/`ADMIN_PASSWORD` chỉ dùng lần đầu. Đăng nhập, đổi mật khẩu ngay, rồi xóa hai biến này khỏi `/etc/tutien2/env`. Không đặt `API_TOKEN` trên VPS.

## 4. Preflight

```sh
cd /opt/tutien2d
sudo -u tutien2d node scripts/vps-preflight.mjs
sudo -u tutien2d node scripts/vps-preflight.mjs --smoke --vendor-boot
```

Preflight kiểm tra Node/`node:sqlite`, quyền thư mục, vendor client, hai thư mục `dist`, port, loopback, origin/proxy, RAM/lõi. `--smoke` chỉ bind localhost, dùng `DATA_DIR` tạm và admin tạm; `--vendor-boot` nạp client offline, không đăng nhập và không mở mạng ngoài. Script không in token, mật khẩu hay nội dung secret.

## 5. systemd

Sửa đường dẫn Node 24 trong unit rồi cài:

```sh
sudo cp deploy/tutien2d.service /etc/systemd/system/
sudo cp deploy/tutien2d-backup.service deploy/tutien2d-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now tutien2d.service
sudo systemctl enable --now tutien2d-backup.timer
sudo systemctl status tutien2d.service tutien2d-backup.timer
```

Unit chỉ cho ghi `DATA_DIR`, tự khởi động lại khi lỗi, và chờ tối đa 25 giây khi dừng để runner thoát an toàn. Khi restart, server đặt account persisted `running` về `stopped`, không tự chạy bot.

## 6. Reverse proxy, HTTPS, firewall

Node chỉ nghe `127.0.0.1:4000`. Dùng Caddy để tự lấy Let's Encrypt hoặc Nginx + Certbot; mẫu đã chuyển tiếp WebSocket, `X-Forwarded-Proto` và không cấu hình log `Authorization`. Không mở port 4000:

```sh
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw deny 4000/tcp
sudo ufw enable
```

Sau HTTPS, kiểm tra `PUBLIC_ORIGIN`, Origin WebSocket và HSTS. HSTS chỉ xuất hiện khi `TRUST_PROXY` ≥ 1 và request tới Node có `X-Forwarded-Proto: https`; HTTP thuần không nhận HSTS.

## 7. Theo dõi và cập nhật

```sh
journalctl -u tutien2d.service -f
curl -sS https://bot.example.com/health
curl -sS -H 'Authorization: Bearer <session-token>' https://bot.example.com/api/admin/health
```

Không đưa session token vào URL hoặc log. Trước khi cập nhật: dừng bot an toàn, `git pull`, cài dependency/build, rồi `systemctl restart`; kiểm tra `/health`, đăng nhập và runner.

## 8. Sao lưu và khôi phục

Backup chạy khi server đang hoạt động, dùng SQLite `VACUUM INTO` thay vì copy file WAL:

```sh
sudo -u tutien2d node scripts/backup.mjs
```

Backup gồm database, `.secret`, manifest kích thước/băm/schema và giữ 14 bản gần nhất mặc định. Mất `.secret` thì không giải mã được credential game. Khôi phục phải dừng service, kiểm tra backup và bắt buộc cờ an toàn:

```sh
sudo systemctl stop tutien2d.service
sudo -u tutien2d DATA_DIR=/var/lib/tutien2d node scripts/restore.mjs /var/lib/tutien2d/backups/20261009-120000 --i-stopped-the-server
sudo systemctl start tutien2d.service
```

`restore.mjs` xác minh manifest/băm/integrity, tạo snapshot `pre-restore-*` trước khi ghi đè và không in nội dung secret.

## 9. Soak và sự cố

Chạy `scripts/soak-vendor.cjs` theo hướng dẫn hiện có, đo RSS/CPU và số runner trên chính VPS. Tăng `MAX_TOTAL_RUNNERS` từng bước, giữ `MIN_FREE_MEM_MB`, và dừng ngay khi `hurtCount` tăng. Lỗi thường gặp: port đã dùng, Node không phải 24, quyền `DATA_DIR` quá rộng, origin sai, WebSocket timeout do proxy hoặc firewall mở nhầm 4000.

Chưa xác minh trên Linux/VPS thật: vendor runner/headless, RAM/CPU và soak dài, hiệu năng rate-limit với nhiều user, CSP trên mọi trình duyệt/màn hình, systemd/Caddy/Nginx thực tế và restore trên máy khác. Đây là các mục chủ dự án cần chạy và báo lại.
