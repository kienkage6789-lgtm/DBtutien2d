# Bàn giao cho phiên làm việc mới

Ngày: 2026-10-08. Đọc file này, `AGENTS.md`, rồi mục đầu của `docs/SESSION_LOG.md` trước khi làm việc. Không đọc `data/`, `.env*` hoặc evidence chưa redact.

## 1. Dự án là gì và đang ở đâu

Đây là monorepo pnpm điều khiển nhiều tài khoản TuTien2D qua dashboard web và server control-plane. `apps/server` phục vụ REST/WebSocket, `apps/web` là dashboard, `packages/core-client` hiện chỉ còn xác thực, token manager, policy và dữ liệu vendor-derived cần thiết. Client chính thức trong `vendor/tutien2d-public-client/2026-10-06` được chạy headless qua `apps/server/src/headless/`.

Sau đợt dọn mã ngày 2026-10-08, server chỉ còn engine `vendor`: `startAccount` khởi động `VendorRunner`, không còn bot controller/client WebSocket tự viết, movement prediction, training runtime hay lựa chọn engine trong API/UI. Một tài khoản vẫn chỉ được phép có một vendor session. Auto là Auto của client chính thức, được điều khiển qua supervisor và các route `auto/start`/`auto/stop`.

## 2. Phần đã giữ

- CRUD tài khoản, start/stop/restart, start-all/stop-all, logs, WebSocket dashboard và bảo mật control-plane.
- `GET /api/maps` và `GET /api/maps/:id/geometry` cho MiniMap chỉ đọc.
- HP/MP, down/death, hurt, vị trí/entity/map khi vendor cung cấp; dữ liệu chưa biết không được thay bằng 0.
- `apps/server/src/headless/`, auth Supabase/token manager, vitals policy, generated walk-grid/spawn/enemy/skill/derived-vitals và các script vendor/generator.
- DB vẫn đọc bản ghi config cũ có `engine: "core"` hoặc trường cũ; khi ghi chỉ chuẩn hóa về cấu hình vendor tối giản.

## 3. Việc còn lại

1. Chạy các lệnh kiểm tra ở mục 4 sau khi cài dependency.
2. Rà output TypeScript/test; nếu có lỗi do chữ ký snapshot vendor thì sửa nhỏ, không khôi phục mã core.
3. Chưa chạy game thật trong đợt này. Không tự mở session, không mở mạng, không bật bot/vendor live.

## 4. Cách chạy và kiểm tra

```bash
pnpm install
pnpm build
pnpm --filter @tutien2d/web test
cd apps/server && npx tsx --test src/headless/vendor-runner.test.ts
```

Sau đó chạy các test `.mjs` còn lại trong `packages/core-client/test` theo `package.json`; các test đã xóa cùng client core không còn là mục tiêu. Có thể chạy riêng server tests còn lại nếu cần. Không dùng các lệnh live hoặc script cần credential trong phiên xác minh này.

## 5. Cảnh báo

- Không sửa `vendor/`, không commit, không in token/JWT/mật khẩu/selfId/tên nhân vật/id người chơi.
- Không bind control-plane ra ngoài loopback, không nới Origin allowlist và không tắt bearer auth.
- Không dùng `hp <= 0` thay cho cờ `dn`/gói down/revived; không dùng hp phần trăm của player khác làm vitals.
- Nếu sửa `apps/web/src`, phải build trước khi kết luận bản server build đã cập nhật.
