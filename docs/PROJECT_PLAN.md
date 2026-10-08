# KẾ HOẠCH TRIỂN KHAI DỰ ÁN (PROJECT IMPLEMENTATION PLAN)
## Nền tảng Quản Lý Đa Tài Khoản & Tự Động Hóa TuTien2D

> **Cập nhật 2026-10-08 — đọc mục này trước.** Phần còn lại của file là kế hoạch gốc v1.0 (2026-10-06), giữ nguyên để tham khảo lịch sử. Kiến trúc thực tế nằm ở [`ARCHITECTURE.md`](ARCHITECTURE.md); nhật ký ở [`SESSION_LOG.md`](SESSION_LOG.md).

## 0. Trạng thái thực tế so với kế hoạch (2026-10-08)

### 0.1 Tiến độ theo sprint

| Sprint | Kế hoạch | Thực tế |
|---|---|---|
| 1. Core headless engine | WebSocket client, state store, anti-detection | **Xong** và đã chạy live: kết nối, hello, ping, reconnect, `GameStateStore`, jitter cho hành động; thêm guard theo epoch, `Snap2Reducer`, `VitalSnapshot`, `OperationLedger`, packet tap |
| 2. Module nghiệp vụ | seller, restocker, farm, quest | **Có mã nhưng đang khóa** ở luồng chạy (bán đồ, mua thuốc, quest, hang động, điểm danh thủ công); chưa kiểm chứng live trong các phiên gần đây. Chỉ Auto farm (điều hướng về bãi) được bật |
| 3. Backend | worker pool, DB, WS hub | **Xong**, nhưng khác công nghệ: Express + `ws`, DB JSON một file (không Prisma/SQLite), worker chạy cùng tiến trình |
| 4. Dashboard | Next.js | **Xong**, nhưng là React + Vite + Tailwind; có MiniMap click-để-di-chuyển, panel điều hướng map, nút làm mới HP, nhập API token |
| 5. Multi-tenant, proxy, Docker | RBAC, proxy pool, compose | **Chưa làm**. Có `proxyUrl` trong DB nhưng luồng proxy chưa hoàn thiện/kiểm thử |

### 0.2 Khác biệt công nghệ so với mục 2

| Kế hoạch | Thực tế |
|---|---|
| Next.js 15 (App Router), Shadcn/UI | React 18 + Vite 6, Tailwind, lucide-react |
| Fastify, Prisma ORM, Redis, PostgreSQL | Express, `ws`, DB JSON (`data/tutien_db.json`), không Redis |
| Mã hóa AES-256-GCM | Đúng như kế hoạch (khóa từ `ENCRYPTION_SECRET` hoặc `data/.secret`) |
| pnpm workspaces | Đúng như kế hoạch (4 package) |

### 0.3 Việc đã làm ngoài kế hoạch gốc

- **Bảo mật control-plane**: bind loopback mặc định, `API_TOKEN` bắt buộc khi bind ngoài, kiểm tra Origin, WebSocket subprotocol `bearer`, error envelope, giới hạn phân trang.
- **Xác minh protocol bằng live**: nguồn HP/MP, `you` là ACK của move theo `seq` bội số 10, `dn` dạng số, `refreshVitals`, điều hướng qua cổng hai chiều.
- **Phân tích client chính thức** (`vendor/`): `UI_FEATURE_INVENTORY.md`, `AUTO_SPEC.md`, các bảng sinh tự động (quái, kỹ năng, lưới va chạm 16 map, điểm sinh quái).
- **Hạ tầng làm việc với agent**: git, `AGENTS.md`, quy trình chạy Codex, `PROMPT_*.md`.

### 0.4 Hướng đi hiện tại

Mục tiêu đổi từ "tự động hóa 100% ngay" sang **dựng lại từng chức năng game, kiểm chứng live, rồi mới tự động hóa dần**:

1. Hoàn thiện nền dữ liệu và kiểm chứng giao thức (đang làm; chọn khu và hồi sinh đã thấy trong client nhưng chưa thử live).
2. Auto đánh quái theo `AUTO_SPEC.md`: P0 (dữ liệu, parser) và P1 (chọn mục tiêu, luân phiên kỹ năng, lưới va chạm) đã xong ở dạng hàm thuần chưa nối vào bot; P2 đến P7 (tiếp cận, đánh thường, kỹ năng, nghỉ, hồi sinh, tích hợp training) chưa làm.
3. Bật lại dần các module cũ (bán đồ, mua thuốc, quest) sau khi từng cái được kiểm chứng.
4. Sprint 5 chỉ làm khi cần mở ra ngoài localhost.

### 0.5 "Bước tiếp theo" ở mục 5 của kế hoạch gốc

Ba bước khởi động (monorepo, cài phụ thuộc, `core-client`) **đã hoàn thành**.

---


> **Dự án:** TuTien2D Multi-Account Dashboard & Automation Platform  
> **Phiên bản kế hoạch:** v1.0  
> **Thời gian dự kiến:** 5 Sprints (Giai đoạn cá nhân $\rightarrow$ Mở rộng đa người dùng)  

---

## 1. MỤC TIÊU & TẦM NHÌN DỰ ÁN

| Giai đoạn | Mục tiêu chính | Đối tượng sử dụng | Cơ sở hạ tầng |
| :--- | :--- | :--- | :--- |
| **Giai đoạn 1 (Hiện tại)** | Xây dựng Dashboard cá nhân quản lý 5 - 20 tài khoản cùng lúc; tự động hóa 100% các hoạt động: làm quest, bán đồ theo bộ lọc, mua HP/MP, chăm sóc dược điền, điểm danh. | Cá nhân (Self-hosted trên máy tính hoặc VPS riêng) | SQLite + Node.js Worker Pool + Next.js UI |
| **Giai đoạn 2 (Tương lai)** | Mở rộng thành nền tảng dịch vụ (Multi-Tenant SaaS) cho nhiều người cùng đăng ký tài khoản web để treo acc game; hỗ trợ Proxy riêng, phân quyền người dùng, mã hóa dữ liệu tuyệt đối. | Nhiều người dùng (Multi-User) | PostgreSQL + Redis Queue + Multi-Proxy Pool + Docker |

---

## 2. LỰA CHỌN CÔNG NGHỆ (TECH STACK)

* **Kiến trúc mã nguồn**: Monorepo (`pnpm` workspaces hoặc `npm` workspaces) giúp chia sẻ kiểu dữ liệu TypeScript dùng chung giữa Backend, Core Engine và Frontend.
* **Core Client Engine (`packages/core-client`)**: TypeScript, WebSocket thuần (`ws`), Event-driven EventEmitter, State Machine.
* **Automation Modules (`packages/automation-engine`)**: Thiết kế dạng Modular Plugin (tách riêng từng module nghiệp vụ: Bán đồ, Mua dược phẩm, Quest, Dược điền, Tọa thiền).
* **Backend Orchestrator (`apps/server`)**: Fastify / Express + Node.js Worker Pool, Prisma ORM, mã hóa AES-256-GCM.
* **Frontend Web Dashboard (`apps/web`)**: Next.js 15 (App Router), Tailwind CSS, Shadcn/UI, Lucide Icons, kết nối Realtime qua WebSocket/SSE.

---

## 3. LỘ TRÌNH THỰC HIỆN CHI TIẾT (WORK BREAKDOWN STRUCTURE - WBS)

```
┌────────────────────────────────────────────────────────────────────────┐
│ SPRINT 1: Nền tảng Monorepo & Core Headless Engine                    │
│ ├── Khởi tạo Workspace & TypeScript base                               │
│ ├── WebSocket Connection Manager (Handshake, Auto-reconnect, Ping/Pong)│
│ ├── Game State Store (Đồng bộ nhân vật, túi đồ, map, linh thạch)      │
│ └── Anti-Detection Layer (Human Jitter Delay, Rate Limiting)           │
└───────────────────────────────────┬────────────────────────────────────┘
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ SPRINT 2: Các Module Nghiệp Vụ Tự Động Hóa (Automation Engine)        │
│ ├── Module 1: Inventory & Item Filter Seller (Tự bán đồ theo bộ lọc)  │
│ ├── Module 2: Auto Potion Restocker (Tự mua & dùng HP/MP/Bùa)         │
│ ├── Module 3: Farm Caretaker (Tự tính timer, gieo hạt, tưới, gặt)     │
│ └── Module 4: Quest State Machine (Làm quest chính tuyến, ngày, hang) │
└───────────────────────────────────┬────────────────────────────────────┘
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ SPRINT 3: Backend Orchestrator & Account LifeCycle Manager            │
│ ├── Worker Pool điều phối đa tài khoản chạy song song                 │
│ ├── Database lưu trữ cấu hình & Token mã hóa (Prisma + SQLite)        │
│ └── WebSocket Server nội bộ stream chỉ số và nhật ký lên Web          │
└───────────────────────────────────┬────────────────────────────────────┘
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ SPRINT 4: Giao Diện Người Dùng (Next.js Dashboard UI)                 │
│ ├── Ma trận tổng quan đa tài khoản (Matrix Grid / Data Table)          │
│ ├── Lưới túi đồ RPG trực quan (Click xem, khóa, gán quy tắc bán)       │
│ ├── Bộ biên tập cấu hình Bot (Tùy biến ngưỡng máu, danh sách bán)     │
│ └── Live Terminal Log xem hoạt động của từng acc                      │
└───────────────────────────────────┬────────────────────────────────────┘
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ SPRINT 5: Chuẩn Hóa Đa Người Dùng & Bảo Mật (Multi-Tenant SaaS)       │
│ ├── Hệ thống xác thực người dùng (Auth, Login/Register, JWT)          │
│ ├── Cô lập dữ liệu giữa các User & Gán Proxy riêng (SOCKS5/HTTP)      │
│ └── Triển khai Docker Compose & Giám sát sức khỏe Worker               │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 4. CHI TIẾT CÁC TÁC VỤ THEO TỪNG SPRINT

### SPRINT 1: Nền Tảng Monorepo & Core Headless Engine
* **Thời gian ước tính**: 3 - 5 ngày
* **Nhiệm vụ trọng tâm**:
  1. **Khởi tạo Monorepo**: Cài đặt `package.json` gốc, thiết lập cấu trúc `apps/` và `packages/`, cấu hình `tsconfig.base.json`.
  2. **WebSocket Client Manager**:
     - Quản lý trạng thái: `Disconnected` $\rightarrow$ `Connecting` $\rightarrow$ `Handshaking` $\rightarrow$ `In-Game` $\rightarrow$ `Reconnecting`.
     - Tự động gửi gói `{op: "hello", ...}` và bắt các gói dữ liệu ban đầu (`welcome`, `state`, `map`).
     - Tự duy trì vòng lặp `{op: "ping"}` định kỳ và tính toán độ trễ RTT.
     - Tự động kết nối lại khi mạng đứt gãy bằng thuật toán Exponential Backoff (1s, 2s, 4s, tối đa 15s).
  3. **Local State Store**:
     - Lưu trữ trạng thái nhân vật: Cảnh giới, HP, MP, Tọa độ `(x, y)`, Map ID, Danh sách túi đồ (`bag`), Trang bị, Linh thạch.
     - Bắt các sự kiện cập nhật từ server (`state`, `you`, `status`, `loot`) để tự động cập nhật Local State.
  4. **Lớp bảo vệ Anti-Detection (Mô phỏng người thật)**:
     - Gắn bộ tạo trễ ngẫu nhiên (*Jitter*): Mọi hành động gửi lên server đều có độ lệch ngẫu nhiên $200\text{ms} - 600\text{ms}$.
     - Bộ giới hạn tốc độ (*Rate Limiter*): Tối đa không quá số lượng gói quy định mỗi giây để tránh kích hoạt cơ chế chống spam của server.
* **Kết quả nghiệm thu**: Một script CLI có thể đăng nhập vào 1-2 tài khoản song song, in ra thông tin nhân vật và duy trì kết nối ổn định 24/7.

---

### SPRINT 2: Các Module Nghiệp Vụ Tự Động Hóa
* **Thời gian ước tính**: 5 - 7 ngày
* **Nhiệm vụ trọng tâm**:
  1. **Module 1: Quản lý Túi đồ & Bộ Lọc Bán Đồ (`InventorySeller`)**:
     - Định nghĩa cấu trúc Rule:
       - Whitelist (Luôn giữ): Các loại bí tịch, trang bị hiếm, đan dược cao cấp.
       - Blacklist (Luôn bán): Cá sống, vật phẩm rơi từ quái cấp thấp, vũ khí trắng.
       - Ngưỡng kích hoạt: Bán khi túi đầy $\ge 80\%$ hoặc sau mỗi phiên làm việc.
     - Gửi lệnh `item.sell` tuần tự theo danh sách lọc kèm delay ngẫu nhiên.
  2. **Module 2: Tự Mua Dược Phẩm & Hồi Phục (`Restocker`)**:
     - Theo dõi số lượng `tu_khi_duoc` hoặc đan dược trong túi.
     - Khi số lượng $< \text{ngưỡng cài đặt}$ (vd: $< 5$ bình): Tự động gửi lệnh `food.buy` hoặc `talisman.buy` mua bù đủ số lượng.
     - Lắng nghe trạng thái HP/MP từ gói `you`: Khi HP dưới mức an toàn (vd: $< 40\%$), tự động dùng `food.eat` hoặc `bag.useItem`.
  3. **Module 3: Chăm Sóc Dược Điền Tự Động (`FarmCaretaker`)**:
     - Quản lý trạng thái 10 luống đất (`plot_1` đến `plot_10`).
     - Đặt đồng hồ đếm ngược theo loại hạt (Linh Điệp 1 phút có tưới, Trúc Cơ Thảo 30 phút...).
     - Khi chín: Gửi lệnh `farm.harvest` $\rightarrow$ `farm.sow` $\rightarrow$ `farm.water`.
  4. **Module 4: Bộ Chạy Nhiệm Vụ (`QuestRunner`)**:
     - Theo dõi `save.stage` và các cờ nhiệm vụ `flags`.
     - Điều khiển nhận/trả nhiệm vụ chính tuyến: `talk` $\rightarrow$ `quest.turnIn`.
     - Tự động hoàn thành chuỗi nhiệm vụ hàng ngày: `seed.start` $\rightarrow$ `seed.collect` $\rightarrow$ `seed.complete`.
     - Tự động nhận rương hang động: `cave.start` $\rightarrow$ `cave.chest`.
     - Tự động điểm danh hàng ngày: `diemdanh`.
* **Kết quả nghiệm thu**: Các module hoạt động độc lập, có thể bật/tắt bằng cấu hình `boolean` và tự động thực thi trơn tru mà không làm gián đoạn nhau.

---

### SPRINT 3: Backend Orchestrator & Multi-Account Manager
* **Thời gian ước tính**: 4 - 6 ngày
* **Nhiệm vụ trọng tâm**:
  1. **Worker Pool (Bộ điều phối tiến trình)**:
     - Cho phép quản lý $N$ tài khoản cùng lúc.
     - Cung cấp các phương thức điều khiển: `startAccount(id)`, `stopAccount(id)`, `restartAccount(id)`, `startAll()`, `stopAll()`.
  2. **Cơ sở dữ liệu (Database với Prisma)**:
     - Tạo bảng `Account`: Lưu tên acc, Supabase Token (được mã hóa chuẩn `AES-256-GCM`), Proxy gán kèm.
     - Tạo bảng `BotConfig`: Lưu cấu hình bộ lọc bán đồ, ngưỡng mua máu/mana, các module đang bật/tắt.
     - Tạo bảng `AccountLog`: Lưu lịch sử hành động (bán đồ nhận bao nhiêu Linh Thạch, làm xong quest gì...).
  3. **WebSocket Hub Nội Bộ (Internal Real-time Gateway)**:
     - Server mở một kênh WebSocket riêng nội bộ.
     - Bắn stream sự kiện: Trạng thái nhân vật, túi đồ, log hoạt động lên Web UI tức thời.
* **Kết quả nghiệm thu**: Backend có REST API hoàn chỉnh để thêm/sửa/xóa tài khoản, điều khiển bật/tắt bot và truyền dữ liệu thời gian thực.

---

### SPRINT 4: Giao Diện Người Dùng (Next.js Web Dashboard)
* **Thời gian ước tính**: 5 - 7 ngày
* **Nhiệm vụ trọng tâm**:
  1. **Trang Quản lý Đa Tài Khoản (Matrix View / Table View)**:
     - Bảng hiển thị toàn bộ tài khoản: Avatar nhân vật, Tên, Cảnh giới, Thanh máu (HP), Thanh mana (MP), Số Linh thạch, Trạng thái Bot (Đang nghỉ / Đang làm quest / Đang bán đồ).
     - Nút hành động nhanh trên từng tài khoản: Bật/Tắt Bot, Bán đồ ngay, Thu hoạch farm ngay, Xem chi tiết.
     - Nút điều khiển hàng loạt: Bắt đầu tất cả, Dừng tất cả.
  2. **Giao diện Túi Đồ Trực Quan (Visual RPG Inventory Grid)**:
     - Mô phỏng ô lưới túi đồ 2D của game với icon vật phẩm và số lượng.
     - Cho phép người dùng click vào vật phẩm để thiết lập nhanh: *Khóa không bao giờ bán*, *Tự động bán khi có*, hoặc *Tự dùng*.
  3. **Trang Cấu Hình Bộ Lọc & Quy Tắc (Rules Configuration)**:
     - Form trực quan để người dùng tick chọn các tính năng:
       - [x] Tự động làm quest chính tuyến
       - [x] Tự động trồng và thu hoạch dược điền
       - [x] Tự động mua thuốc khi số lượng dưới [ 5 ] bình
       - [x] Tự động bán đồ rác khi túi đầy trên [ 80% ]
     - Danh sách tùy biến vật phẩm muốn bán hoặc giữ lại.
  4. **Cửa sổ Nhật Ký Thời Gian Thực (Live Terminal Log Stream)**:
     - Khung hiển thị log dạng console với màu sắc phân biệt: Xanh lá (Thành công/Nhận thưởng), Vàng (Cảnh báo), Đỏ (Lỗi/Mất kết nối).
* **Kết quả nghiệm thu**: Web Dashboard hoàn chỉnh, giao diện tối ưu trên cả máy tính lẫn điện thoại, phản hồi mượt mà theo thời gian thực.

---

### SPRINT 5: Chuẩn Hóa Đa Người Dùng & Bảo Mật (Multi-Tenant SaaS)
* **Thời gian ước tính**: 4 - 6 ngày (Thực hiện khi muốn mở rộng ra ngoài)
* **Nhiệm vụ trọng tâm**:
  1. **Hệ thống Quản lý Người Dùng & Phân Quyền (RBAC)**:
     - Đăng ký / Đăng nhập cho người dùng hệ thống bằng Email/Password (JWT Auth).
     - Phân quyền: `Admin` (quản trị toàn hệ thống), `User` (chỉ quản lý các tài khoản game của riêng mình).
  2. **Tích hợp Proxy Pool**:
     - Cho phép mỗi tài khoản game sử dụng một Proxy (HTTP / SOCKS5) riêng biệt.
     - Ngăn ngừa tình trạng nhiều tài khoản cùng kết nối từ một IP máy chủ duy nhất.
  3. **Đóng gói & Triển khai**:
     - Viết file `docker-compose.yml` đóng gói toàn bộ: Frontend Next.js, Backend Fastify, PostgreSQL và Redis.
     - Sẵn sàng triển khai lên VPS hoặc Cloud chỉ với 1 lệnh `docker compose up -d`.
* **Kết quả nghiệm thu**: Hệ thống sẵn sàng cho hàng chục hoặc hàng trăm người dùng bên ngoài sử dụng đồng thời một cách an toàn và độc lập.

---

## 5. KẾ HOẠCH BẮT ĐẦU NGAY (BƯỚC TIẾP THEO)

Để hiện thực hóa dự án theo lộ trình trên, các bước khởi động đầu tiên sẽ là:
1. **Khởi tạo cấu trúc thư mục Monorepo** trong thư mục dự án `e:\game\tutien2d`.
2. **Cài đặt các gói phụ thuộc cơ bản** (`typescript`, `ws`, `dotenv`...).
3. **Viết module `packages/core-client`**: Đóng gói class `TuTienClient` có khả năng tự động kết nối, ping-pong, và parse toàn bộ trạng thái nhân vật.

## Cấu hình Quest và điểm farm (2026-10-06)

- Quest được bật/tắt riêng bằng autoMainQuest, autoDailyQuest (điểm danh + seed tasks) và autoCaveQuest. Dữ liệu cũ autoDaily/autoCave được đọc làm giá trị dự phòng khi cấu hình mới chưa có.
- Farm có autoTravelToFarm, farmMapId, farmKhu, farmX, farmY. Dashboard hiển thị panel grid minh họa vị trí nhân vật và điểm farm, cùng map/khu/tọa độ và trạng thái đối chiếu.
- Tự đi đến đích hiện chỉ gửi move khi cùng map và cùng khu, cách đích trên 3 đơn vị; giới hạn một lệnh mỗi 30 giây. Giao thức hiện triển khai chưa có command chuyển map/khu đã xác nhận, nên khác map/khu cần người dùng chuyển thủ công. Panel dùng tỷ lệ tọa độ minh họa, không phải bản đồ địa hình game.
- Cập nhật cấu hình một phần giữ nguyên các nested fields trong sellRules và delayRangeMs.
