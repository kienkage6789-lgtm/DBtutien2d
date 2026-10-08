# TuTien2D vendor dashboard

Monorepo pnpm cho control-plane và dashboard nhiều tài khoản TuTien2D. Server chạy client chính thức ở chế độ headless qua `apps/server/src/headless/`; dashboard không chứa bot engine tự viết và không render client game.

## Thành phần

- `apps/server`: REST API, WebSocket hub, worker pool, Supabase auth/token manager và `VendorRunner`/Auto supervisor.
- `apps/web`: React/Vite dashboard hiển thị tài khoản, HP/MP, vị trí, MiniMap chỉ đọc, Auto chính thức, hurt/death và logs.
- `packages/core-client`: auth, token manager, vitals policy và dữ liệu vendor-derived/generated còn được server/scripts dùng.
- `vendor/tutien2d-public-client/2026-10-06`: client chính thức để tham chiếu/chạy headless; không sửa thư mục này.

## Chạy và kiểm tra

```bash
pnpm install
pnpm build
pnpm --filter @tutien2d/web test
cd apps/server && npx tsx --test src/headless/vendor-runner.test.ts
```

Server production chạy ở cổng 4000 sau khi build; dev dashboard chạy ở cổng 3000. Xem `docs/CONTROL_PLANE_API.md` và `docs/ARCHITECTURE.md` để biết API, bảo mật và giới hạn vendor-only.

## An toàn

Mặc định control-plane chỉ bind loopback. Khi bind ngoài loopback phải đặt `API_TOKEN` đủ mạnh và giữ Origin allowlist/bearer auth. Không đưa token vào query string. Mỗi tài khoản chỉ có một vendor session; không chạy live hoặc gửi lệnh game ngoài nhiệm vụ đã được phê duyệt.
