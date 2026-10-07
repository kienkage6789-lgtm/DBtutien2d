# Nền Tảng Tự Động Hóa & Quản Lý Đa Tài Khoản TuTien2D

Hệ thống Dashboard điều khiển tập trung, tự động hóa đa tài khoản cho game **TuTien2D** (WebSocket Protocol v10).

---

## 🌟 Tính Năng Nổi Bật

1. **Core Headless Engine (`@tutien2d/core-client`)**:
   - Tương tác trực tiếp qua WebSocket `wss://game.tutien2d.online/` theo giao thức JSON Frame song công.
   - Quản lý vòng đời kết nối: Handshake `hello` (Supabase JWT), duy trì Keepalive `ping`/`pong`, tính toán RTT Latency.
   - Tự động kết nối lại (Auto-reconnect) bằng thuật toán *Exponential Backoff*.
   - Quản lý đồng bộ trạng thái nhân vật: Cảnh giới, HP, MP, Linh Thạch, Tọa độ bản đồ, Túi đồ, Nhiệm vụ.
   - Lớp chống phát hiện (*Anti-Detection*): Cơ chế Jitter ngẫu nhiên (200ms - 700ms) và Rate Limiter chống spam.

2. **Automation Engine (`@tutien2d/automation-engine`)**:
   - **Tự động bán đồ (`InventorySeller`)**: Lọc đồ theo Whitelist (bí tịch, trang bị hiếm) và Blacklist (vật phẩm rác), tự động bán cho Thương Nhân khi túi đầy.
   - **Tự động dùng & mua dược phẩm (`Restocker`)**: Tự uống đan khi tụt máu và tự mua thêm khi số lượng trong túi dưới ngưỡng cài đặt.
   - **Chăm sóc dược điền (`FarmCaretaker`)**: Tự động thu hoạch, gieo hạt giống và tưới nước cho các luống đất.
   - **Tự động làm nhiệm vụ & phúc lợi (`QuestRunner`)**: Điểm danh hàng ngày, làm nhiệm vụ ngày (`seed.*`), mở rương hang động bí cảnh (`cave.*`).

3. **Backend Orchestrator & WS Hub (`@tutien2d/server`)**:
   - Worker Pool điều phối nhiều tài khoản chạy song song.
   - Mã hóa Token bảo mật cao bằng thuật toán `AES-256-GCM`.
   - **Tự động đăng nhập & duy trì phiên 24/7**: Đăng nhập trực tiếp bằng **Đạo hiệu + Mật khẩu** qua Supabase Auth REST, tự động làm mới access token mỗi 48 phút (80% TTL), không cần dán JWT thủ công.
   - Cơ sở dữ liệu lưu trữ tài khoản, mật khẩu được mã hóa chuẩn `AES-256-GCM`, cấu hình bot và nhật ký hoạt động.
   - Kênh WebSocket nội bộ phát sóng trực tiếp (Real-time stream) trạng thái nhân vật và log về Web UI.

4. **Web Dashboard Cao Cấp (`@tutien2d/web`)**:
   - Giao diện phong cách Tiên Hiệp / Tu Chân (Cinzel + Outfit typography, bảng màu Obsidian, Ngọc Bích, Kim Thạch và Glassmorphism).
   - Ma trận thẻ nhân vật đa tài khoản với thanh máu/mana, linh thạch và nút điều khiển nhanh.
   - Lưới túi đồ RPG trực quan: Click vào từng vật phẩm để Khóa (Whitelist) hoặc Gán bán tự động (Blacklist).
   - Cửa sổ Live Terminal hiển thị nhật ký thời gian thực có lọc theo tài khoản và mức độ.
   - Điều khiển hàng loạt: Bật toàn bộ bot, Dừng toàn bộ bot.

---

## 🚀 Hướng Dẫn Khởi Chạy

## Cấu hình quest và điểm farm

- Có thể bật/tắt riêng `autoMainQuest` (thử trả nhiệm vụ chính đang hoạt động), `autoDailyQuest` (điểm danh và nhiệm vụ ngày) và `autoCaveQuest` (bí cảnh/hang động). Cấu hình cũ `autoDaily` và `autoCave` được dùng làm dự phòng khi đọc dữ liệu cũ.
- Điểm farm cấu hình qua `autoTraining`, `farmMapId`, `farmKhu`, `farmX`, `farmY`, `trainingRadius`, `trainingAttackIntervalMs` và `trainingMonsterType`. Có thể lọc theo tên hoặc ID quái khớp chính xác; danh sách gợi ý UI lấy từ snapshot hiện tại. Đây là dữ liệu quan sát/cấu hình, chưa phải protocol loại quái phía server đã xác minh. Training opt-in điều phối chuyển map, di chuyển tới tọa độ và đánh quái dựa trên snapshot có freshness; chi tiết runtime/config trong [tài liệu Control-plane API](docs/CONTROL_PLANE_API.md).
- Protocol hiện chưa có command đã xác minh để chọn khu hoặc hồi sinh. Death hiện là heuristic HP<=0, nên không cam kết tự hồi sinh/quay lại train sau chết. Xem [gap protocol training](docs/TRAINING_PROTOCOL_GAPS.md); grid tọa độ chỉ minh họa, không phải dữ liệu địa hình game.
- Cập nhật cấu hình từng phần giữ nguyên các trường con chưa gửi trong `sellRules` và `delayRangeMs`.

### Hướng dẫn khởi chạy

### 1. Cài đặt các gói phụ thuộc
```bash
pnpm install
```

### 2. Xây dựng toàn bộ dự án
```bash
pnpm build
```

### 3. Chạy hệ thống
- **Chạy môi trường Production (Chạy cả Backend + Web trên port 4000):**
```bash
pnpm start
```
Truy cập: [http://localhost:4000](http://localhost:4000)

- **Chạy môi trường Development (Hot-Reload):**
```bash
pnpm dev
```
Truy cập Web UI tại [http://localhost:3000](http://localhost:3000) (Backend chạy tại [http://localhost:4000](http://localhost:4000)).

---

## 📂 Cấu Trúc Monorepo

```
tutien2d/
├── packages/
│   ├── core-client/          # Headless WSS Game Client Engine
│   └── automation-engine/    # Logic các Module Bot (Bán đồ, Mua thuốc, Dược điền, Quest)
├── apps/
│   ├── server/               # Backend API, Worker Pool Orchestrator & WS Hub
│   └── web/                  # Web Dashboard UI (React, Tailwind CSS, Lucide Icons)
├── docs/
│   ├── api/README.md         # Mục lục bộ tài liệu API
│   ├── GAME_API.md           # Đặc tả WSS game code-backed
│   ├── CONTROL_PLANE_API.md  # REST/WS API của dashboard
│   ├── API_REVIEW.md         # Findings, evidence và remediation
│   └── PROJECT_PLAN.md       # Lộ trình triển khai WBS
└── PROJECT_SPEC.md           # Tài liệu kiến trúc hệ thống
```
