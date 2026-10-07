# TÀI LIỆU THIẾT KẾ & XÂY DỰNG HỆ THỐNG QUẢN LÝ VÀ TỰ ĐỘNG HÓA TUTIEN2D
> **Dự án:** TuTien2D Automation & Multi-Account Dashboard  
> **Phiên bản:** 1.0.0  
> **Trạng thái:** Bản thảo kiến trúc kỹ thuật  

---

## 1. TỔNG QUAN DỰ ÁN (PROJECT OVERVIEW)

### 1.1. Mục tiêu
Xây dựng một nền tảng Dashboard điều khiển tập trung, quản lý đa tài khoản (Multi-Account) cho game TuTien2D, tích hợp engine tự động hóa (Headless Client) hỗ trợ:
- Điều khiển nhiều nhân vật hoạt động song song theo thời gian thực.
- Tự động hóa các tác vụ lặp lại: Nhiệm vụ chính tuyến/hàng ngày, quản lý túi đồ (tự bán đồ theo bộ lọc tùy biến, tự mua HP/MP, phân giải, sử dụng vật phẩm).
- Giao diện trực quan, module hóa (Widget-based) dễ tùy biến bố cục.
- **Lộ trình:** Giai đoạn đầu phục vụ cá nhân; kiến trúc được thiết kế chuẩn Modular & Multi-tenant để sẵn sàng thương mại hóa / mở rộng cho nhiều người dùng về sau.

---

## 2. KIẾN TRÚC HỆ THỐNG (SYSTEM ARCHITECTURE)

```
┌────────────────────────────────────────────────────────────────────────┐
│                        WEB DASHBOARD (Frontend)                       │
│  - Next.js / React / Tailwind CSS / Shadcn UI                          │
│  - Multi-Account Grid / Realtime Log Stream / Inventory Matrix UI      │
│  - Automation Rules Editor / Custom Widget Layout                      │
└───────────────────────────────────▲────────────────────────────────────┘
                                    │ WebSocket / SSE / REST API
┌───────────────────────────────────▼────────────────────────────────────┐
│                       BACKEND API & ORCHESTRATOR                      │
│  - Node.js (TypeScript) / Express hoặc Fastify                         │
│  - Account LifeCycle Manager (Worker Pool)                            │
│  - Auth & RBAC (Multi-tenant ready), AES-256 Secret Vault              │
└───────────────────────────────────▲────────────────────────────────────┘
                                    │ Internal Event Bus
┌───────────────────────────────────▼────────────────────────────────────┐
│                    GAME HEADLESS CLIENT ENGINE (Core)                 │
│  ┌─────────────────────────┐   ┌─────────────────────────────────────┐ │
│  │   Protocol & Socket     │   │         Automation Modules          │ │
│  │ - WSS Connection Pool   │   │ - Auto Quest Runner                 │ │
│  │ - Ping/Pong Keepalive   │   │ - Inventory & Filter Seller Engine  │ │
│  │ - Jitter & Anti-Detection│  │ - Auto Potion (HP/MP) Restocker     │ │
│  │ - Packet Parser (v10)   │   │ - Auto Combat & Gathering Engine    │ │
│  └─────────────────────────┘   └─────────────────────────────────────┘ │
└───────────────────────────────────▲────────────────────────────────────┘
                                    │ wss:// (Proxy SOCKS5/HTTP per Acc)
┌───────────────────────────────────▼────────────────────────────────────┐
│                GAME SERVER (wss://game.tutien2d.online)                │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2.1. CẤU TRÚC THƯ MỤC DỰ ÁN (PROJECT DIRECTORY STRUCTURE)

Hệ thống được tổ chức theo mô hình **Monorepo** (TypeScript) để chia sẻ kiểu dữ liệu và module tái sử dụng giữa Backend, Bot Engine và Web UI:

```
tutien2d/
├── docs/
│   ├── GAME_API.md                     # Đặc tả toàn bộ Packet, Opcode & Lệnh RPC của Game
│   └── PROJECT_SPEC.md                 # Tài liệu kiến trúc & lộ trình phát triển hệ thống
│
├── apps/
│   ├── web/                            # Giao diện Web Dashboard (Next.js / Tailwind CSS)
│   │   ├── public/                     # Icons, game item sprite previews
│   │   ├── src/
│   │   │   ├── app/                    # Next.js App Router
│   │   │   │   ├── (auth)/             # Trang Login/Register người dùng hệ thống
│   │   │   │   ├── dashboard/          # Trang tổng quan quản lý nhiều tài khoản (Matrix View)
│   │   │   │   │   └── page.tsx
│   │   │   │   ├── accounts/           # Quản lý danh sách tài khoản, proxy, thêm sửa xóa
│   │   │   │   │   └── [id]/           # Chi tiết tài khoản: Túi đồ, log live, cấu hình bot
│   │   │   │   ├── rules/              # Bộ biên tập quy tắc lọc đồ bán & mua dược phẩm
│   │   │   │   └── settings/           # Cài đặt hệ thống, API keys, proxy pool
│   │   │   ├── components/             # UI Components (Shadcn/UI + Custom RPG components)
│   │   │   │   ├── account-card.tsx    # Card tóm tắt HP/MP/Cảnh giới/Trạng thái bot
│   │   │   │   ├── inventory-grid.tsx  # Lưới túi đồ RPG trực quan (click khóa/bán/dùng)
│   │   │   │   ├── log-terminal.tsx    # Cửa sổ stream nhật ký hoạt động thời gian thực
│   │   │   │   └── filter-rule-form.tsx # Form cấu hình bộ lọc bán đồ
│   │   │   ├── hooks/                  # Custom React Hooks (useWebSocket, useAccounts)
│   │   │   ├── lib/                    # API client, WebSocket client kết nối Backend
│   │   │   └── types/                  # Frontend types
│   │   ├── tailwind.config.ts
│   │   └── package.json
│   │
│   └── server/                         # Backend API & Worker Orchestrator (Node.js/Fastify)
│       ├── src/
│       │   ├── api/                    # REST / tRPC routes (Auth, Accounts, Rules, System)
│       │   ├── orchestrator/           # Bộ điều phối Worker Pool (quản lý lifecycle các bot)
│       │   │   ├── worker-pool.ts      # Quản lý số luồng bot chạy song song
│       │   │   └── account-runner.ts   # Tiến trình quản lý 1 tài khoản cụ thể
│       │   ├── ws-hub/                 # Internal WebSocket Server phát log/state lên Web UI
│       │   ├── db/                     # Prisma ORM, migrations & schema database
│       │   │   └── schema.prisma
│       │   └── index.ts                # Server entrypoint
│       └── package.json
│
├── packages/
│   ├── core-client/                    # Headless Game Client Engine (Socket WSS thuần)
│   │   ├── src/
│   │   │   ├── connection/             # Quản lý Socket WSS, Auto-reconnect, Keepalive Ping/Pong
│   │   │   ├── protocol/               # Packet Serializers, Opcode Enums, Packet Definitions
│   │   │   ├── state/                  # Quản lý trạng thái cục bộ (Player, Map, Bag, Stats, Mobs)
│   │   │   ├── anti-detection/         # Bộ tạo trễ tự nhiên (Jitter), Rate Limiter, Movement Smoother
│   │   │   └── types.ts                # TypeScript interfaces cho các gói tin game
│   │   └── package.json
│   │
│   └── automation-engine/              # Logic nghiệp vụ tự động hóa (Bot Modules)
│       ├── src/
│       │   ├── inventory/              # Bộ lọc bán đồ, tự mua HP/MP, trang bị, mở rộng túi
│       │   ├── quest/                  # State Machine chạy chuỗi nhiệm vụ chính tuyến & hàng ngày
│       │   ├── combat/                 # Tự động chọn mục tiêu, đánh quái, combo chiêu, dùng bùa
│       │   ├── farm/                   # Tự chăm sóc dược điền (gieo hạt, tưới nước, thu hoạch)
│       │   └── sect/                   # Điểm danh, đóng góp tông môn, chặt cây
│       └── package.json
│
├── package.json                        # Root workspace configuration (pnpm / npm)
├── tsconfig.base.json                  # Cấu hình TypeScript chia sẻ
└── README.md

### 3.1. Module Kết nối & Quản lý Tài khoản (Account & Session Manager)
* **Xác thực & Kết nối**: Quản lý Supabase JWT Token, tự động gửi handshake `{"op": "hello", ...}` và lắng nghe `welcome`, `map`, `state`.
* **Cơ chế Keep-Alive**: Tự động duy trì chu kỳ `ping`/`pong` theo nhịp máy chủ để giữ kết nối không bị ngắt quãng.
* **Auto-Reconnect Thông minh**: Xử lý tự động kết nối lại khi rớt mạng theo thuật toán *Exponential Backoff*.
* **Hỗ trợ Proxy đa luồng**: Cho phép gán từng Proxy (HTTP/SOCKS5) riêng cho mỗi tài khoản nhằm tránh bị giới hạn hoặc phát hiện IP tập trung.

### 3.2. Module Tự động hóa Túi đồ & Mua Bán (Inventory & Merchant Engine)
* **Bộ lọc bán đồ (Item Filter Rules)**:
  * Cho phép định nghĩa điều kiện theo: Tên vật phẩm, phẩm cấp/loại (nguyên liệu, bí tịch, rác, dược liệu), số lượng tối thiểu giữ lại.
  * Tự động lọc ra danh sách vật phẩm rác khi túi đồ đạt ngưỡng quy định (ví dụ: túi đầy > 80%).
* **Tự động giao dịch thương nhân (Auto Merchant)**:
  * Tự tìm đường/gửi gói di chuyển tới vị trí NPC Thương Nhân trên bản đồ.
  * Gửi lệnh bán vật phẩm theo danh sách đã lọc.
* **Tự động bổ sung Dược phẩm (Auto HP/MP Restock)**:
  * Theo dõi số lượng đan dược/phù chú trong túi (`bag`).
  * Khi số lượng xuống dưới ngưỡng cấu hình (ví dụ: `< 5` bình HP), tự động mua bổ sung đủ số lượng định mức.
* **Tự dùng phù / bình hồi phục**:
  * Tự kiểm tra `hp` và trạng thái trong `status` / `snap2` để sử dụng dược phẩm hồi phục kịp thời.

### 3.3. Module Tự động làm Nhiệm vụ (Quest Runner)
* **Theo dõi tiến độ**: Bắt gói `op: "state"` lấy `save.stage` và `flags` của nhiệm vụ.
* **State Machine cho Nhiệm vụ**:
  * Trạng thái 1: Nhận nhiệm vụ tại NPC.
  * Trạng thái 2: Di chuyển tới tọa độ mục tiêu (thu thập dược liệu, đánh quái, đọc bia đá, câu cá).
  * Trạng thái 3: Trả nhiệm vụ và nhận thưởng.
* **Hỗ trợ nhiệm vụ ngày (Daily Quests)**: Câu cá, hái dược mộc, linh chi, hộ tống, trúc gia.

### 3.4. Module An toàn & Hành vi tự nhiên (Anti-Detection & Human Simulation)
* **Jitter Delay**: Giữa các hành động (nhặt đồ, chuyển map, dùng chiêu, bán đồ) luôn chèn độ trễ ngẫu nhiên từ $200\text{ms} - 800\text{ms}$ mô phỏng tay người bấm.
* **Path Movement Smoothing**: Khi di chuyển giữa các tọa độ $(x, y)$, gửi các bước nội suy mượt thay vì dịch chuyển tức thời bất thường.
* **Bảo vệ tài khoản**: Tự động ngắt kết nối tạm thời hoặc dừng bot khi phát hiện thông báo kiểm tra từ quản trị viên hoặc xuất hiện mã lỗi bất thường.

---

## 4. THIẾT KẾ GIAO DIỆN NGƯỜI DÙNG (DASHBOARD UI / UX)

### 4.1. Chế độ Xem Đa Tài Khoản (Multi-Account Matrix View)
* **Bảng tổng quan (Card Grid / Data Table)**:
  * Mỗi tài khoản hiển thị một thẻ tóm tắt: Tên nhân vật, Cảnh giới, Máu/Mana thanh bar, Linh thạch, Tọa độ hiện tại, Bản đồ, Trạng thái Bot (Đang nghỉ / Làm quest / Bán đồ / Đánh quái).
  * Nút điều khiển nhanh: `Bật/Tắt Bot`, `Bán đồ ngay`, `Về thành`, `Xem Túi`, `Xem Log`.
  * Thao tác hàng loạt: *Bắt đầu tất cả*, *Dừng tất cả*, *Bán đồ tất cả*.

### 4.2. Chi tiết Tài khoản & Tùy biến (Detail & Customization)
* **Visual Inventory (Lưới túi đồ RPG)**: Hiển thị các ô vật phẩm tương tự trong game, cho phép click để gắn nhãn (Khóa / Tự bán / Tự dùng).
* **Live Log Viewer**: Cửa sổ terminal thu nhỏ theo dõi các hành động của bot theo thời gian thực (được lọc màu cảnh báo: info, success, warn, error).
* **Bố cục dạng kéo thả (Drag & Drop Widget)**: Cho phép người dùng tùy chọn ẩn/hiện hoặc sắp xếp các widget thống kê (Tài nguyên farm được, biểu đồ Linh thạch theo giờ...).

---

## 5. THIẾT KẾ CƠ SỞ DỮ LIỆU & BẢO MẬT (DATABASE & MULTI-TENANCY)

### 5.1. Mô hình Dữ liệu (Prisma Schema - PostgreSQL / SQLite)

```prisma
// Người dùng hệ thống (Sẵn sàng mở rộng sau này)
model User {
  id           String        @id @default(uuid())
  email        String        @unique
  passwordHash String
  role         String        @default("user") // admin, user
  createdAt    DateTime      @default(now())
  accounts     GameAccount[]
}

// Tài khoản game
model GameAccount {
  id             String         @id @default(uuid())
  userId         String
  user           User           @relation(fields: [userId], references: [id])
  accountName    String
  encryptedToken String         // Token đăng nhập được mã hóa AES-256
  proxyUrl       String?        // Proxy riêng (nếu có)
  status         String         @default("stopped") // running, stopped, error
  characterName  String?
  realm          String?
  stones         Int            @default(0)
  config         BotConfig?
  createdAt      DateTime       @default(now())
}

// Cấu hình Bot cho từng tài khoản
model BotConfig {
  id             String      @id @default(uuid())
  accountId      String      @unique
  account        GameAccount @relation(fields: [accountId], references: [id])
  autoQuest      Boolean     @default(false)
  autoSell       Boolean     @default(true)
  sellRules      Json        // Quy tắc lọc đồ bán: { whitelist: [], blacklist: [], rarities: [] }
  autoBuyHpMp    Boolean     @default(true)
  minHpPotion    Int         @default(5)
  minMpPotion    Int         @default(5)
  delayRangeMs   Json        // { min: 300, max: 700 }
}
```

### 5.2. Chính sách Bảo mật (Security & Isolation)
* **Mã hóa Token**: Supabase Token hoặc mật khẩu đăng nhập game của người dùng bắt buộc được mã hóa bằng thuật toán `AES-256-GCM` trước khi lưu vào database.
* **Cô lập môi trường (Worker Sandbox)**: Mỗi tài khoản chạy trong một Worker Process hoặc Instance riêng biệt để lỗi của tài khoản này không làm gián đoạn tài khoản khác.

---

## 6. LỘ TRÌNH TRIỂN KHAI (ROADMAP)

### Giai đoạn 1: Xây dựng Core Engine & Thư viện Giao thức (Tuần 1 - 2)
- [x] Phân tích cấu trúc Packet WebSocket (Handshake, Ping/Pong, Map, State, Bag).
- [ ] Xây dựng bộ khung Client Headless bằng TypeScript (Node.js).
- [ ] Hoàn thiện State Machine quản lý vòng đời nhân vật.
- [ ] Thử nghiệm CLI quản lý 2-3 tài khoản chạy ngầm song song.

### Giai đoạn 2: Phát triển Module Tự động hóa Cơ bản (Tuần 3 - 4)
- [ ] Viết Module quản lý túi đồ (`InventoryManager`): Lọc và gửi gói bán vật phẩm.
- [ ] Viết Module tự động mua dược phẩm và kiểm tra ngưỡng hồi phục.
- [ ] Thử nghiệm bộ sinh độ trễ tự nhiên (Anti-ban jitter).

### Giai đoạn 3: Xây dựng Dashboard Web Cá nhân (Tuần 5 - 6)
- [ ] Dựng Frontend Next.js + Tailwind + Lucide Icons.
- [ ] Tích hợp WebSocket nội bộ để truyền thông tin tài khoản và nhật ký thời gian thực lên Web.
- [ ] Thiết kế giao diện lưới quản lý nhiều tài khoản và giao diện chỉnh sửa cấu hình bộ lọc bán đồ.

### Giai đoạn 4: Mở rộng Nhiệm vụ & Chuẩn hóa Multi-Tenant (Tuần 7+)
- [ ] Xây dựng Auto Quest Engine cho chuỗi nhiệm vụ chính tuyến và nhiệm vụ hàng ngày.
- [ ] Bổ sung hệ thống xác thực người dùng (Auth/RBAC) để sẵn sàng mở cho nhiều người dùng.
- [ ] Tích hợp Proxy Pool và các cơ chế giám sát sức khỏe hệ thống.
