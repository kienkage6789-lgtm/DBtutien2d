# Nhiệm vụ: Giai đoạn 2 — đưa cảnh giới, Thần thức, Giáp, Đạo Hạnh (exp) vào snapshot và hiển thị

Giai đoạn 1 (giao diện thanh trái + bảng chi tiết) đã xong, nằm trong cây làm việc (chưa commit). Đọc `AGENTS.md`, `docs/PLAN_UI_SIDEBAR.md` (mục 3 "Thay đổi dữ liệu"), `docs/SESSION_LOG.md` (mục đầu), rồi:
- Server: `apps/server/src/headless/vendor-runner.ts` (`VendorRunnerSnapshot`, `getSnapshot`, `getVitals`, `getPlayer`, đọc `this.P`), `orchestrator/runner-handle.ts` (+ bộ hợp đồng `runner-handle.contract.ts`/test, `InProcessRunnerHandle`), `shard/protocol.ts`, `shard/remote-runner-handle.ts`, `shard/shard-main.ts`, `orchestrator/worker-pool.ts` (nơi dựng runtime tài khoản: `vitals`, `derivedMax`, `dataStale`...), `api/routes.ts` (nơi trả runtime), `ws/hub.ts`.
- Web: `types/index.ts` (`AccountRuntime.character?` đã khai báo), `hooks/useRealtime.ts` (`sanitizeCharacter` đã có), `components/AccountSidebar.tsx`, `AccountPanel.tsx`, `VitalBar.tsx`, `account-dashboard.ts`.
- Mã client chính thức (CHỈ ĐỌC, không sửa): `vendor/tutien2d-public-client/2026-10-06/src/core/config.js` (`REALMS` có `id`, `name`, `hpMax`, `mpMax`, `spMax`, `bpMax`, `expMax`), `entities/player.js` (trường `sp`, `bp`, `exp`, `expMax`, `spMax`, `bpMax`, `hpMax`, `mpMax`), `systems/progress.js` hoặc nơi định nghĩa `Progress` (`realmId`, `realm()`, `exp`), `ui/hud.js` (cách HUD hiển thị Thần Thức, Giáp, Đạo Hạnh: lấy từ đâu, tên trường nào).

Không chạm game thật, không mở mạng ngoài, không đọc `data/`/`.env*`, không sửa `vendor/` hay `auto-supervisor.ts`, không commit. Không tạo tài khoản qua server thật (bước thêm tài khoản gọi đăng nhập game thật): test dùng socket giả / `FakeRunner`/fixture có sẵn.

## Mục tiêu
Snapshot 500 ms của từng tài khoản đang chạy có thêm `character`:
`{ realmId: string|null, realmName: string|null, sp: number|null, spMax: number|null, bp: number|null, bpMax: number|null, exp: number|null, expMax: number|null, fresh: boolean, observedAt: number|null }`
và dashboard (thanh trái + tab Tổng quan) hiển thị đúng. Tài khoản chưa chạy / chưa vào game / chưa có số: toàn bộ `null` (hoặc `character: null`), KHÔNG thay bằng 0.

## Quy tắc dữ liệu (AGENTS.md)
- Chưa biết là `null`, không phải 0; không suy đoán. `realmName` lấy từ `REALMS` của chính client (đối chiếu `realmId`); id lạ → `realmName: null` và giữ `realmId`.
- `spMax`/`bpMax`/`expMax` ở client là giá trị mô hình (tính từ cảnh giới + trang bị), không có trên wire: ghi rõ trong tài liệu là "suy ra từ client, chưa xác minh live", đặt cạnh quy tắc `derivedMax`; không ghi vào `VitalSnapshot`.
- `fresh` chỉ true khi tài khoản đã vào game và client có số hữu hạn; ghi `observedAt` bằng thời điểm đọc. Không nói là "đã xác minh live".
- Chỉ ĐỌC trạng thái, không gửi lệnh nào lên game. Chỉ số liệu số học hữu hạn (kẹp `Number.isFinite`); chuỗi (`realmId`, `realmName`) cắt tối đa 64 ký tự và loại ký tự điều khiển.
- JSON thuần (chế độ shard): kết quả qua `JSON.parse(JSON.stringify())` không mất thông tin; trả bản sao, không giữ tham chiếu sống vào đối tượng vendor.
- Không in/log nội dung này ngoài runtime cho chủ sở hữu. Quyền xem như các trường runtime khác (chủ sở hữu/admin).

## Việc cần làm
1. **Runner**: thêm `character` vào `VendorRunnerSnapshot` + `getSnapshot` (một hàm riêng `getCharacter(player)`, thuần, dễ test). Đọc đúng trường của client: kiểm tra trong `entities/player.js` và HUD xem Thần Thức/Giáp/Đạo Hạnh được lưu ở `player.sp/bp/exp` hay nơi khác (`Progress`), và dùng đúng nguồn HUD dùng. Nếu có nhiều nguồn khác nhau, ghi rõ vào báo cáo.
2. **RunnerHandle + shard**: snapshot đi qua kênh hiện có (không thêm lệnh RPC mới); cập nhật kiểu, `protocol.ts`, `RemoteRunnerHandle`, bộ hợp đồng (`character` JSON thuần, null khi chưa vào game, chế độ stale của shard không để lại số cũ như số mới).
3. **WorkerPool/API/WS**: đưa `character` vào runtime tài khoản (cùng chỗ với `vitals`/`derivedMax`), gồm khi `dataStale` (stale → `character` cũ phải bị vô hiệu: đặt `null`/`fresh:false`, giống cách xử lý hiện tại với vitals). Tài khoản dừng/lỗi: `character: null`.
4. **Web**: `AccountRuntime.character` thêm `realmId`, `fresh`, `observedAt` (tuỳ chọn); `sanitizeCharacter` chịu thiếu/sai kiểu (giữ test cũ), `character` stale không được vẽ như số mới (hiện "—" hoặc nhãn "cũ" như HP/MP); thanh trái và tab Tổng quan hiển thị cảnh giới, Thần thức, Giáp, Đạo Hạnh (số/%); bỏ nhãn "chưa có dữ liệu" tạm thời nếu có.
5. Tài liệu: `docs/CONTROL_PLANE_API.md` (trường mới + quy tắc null/stale), `docs/UI_FEATURE_INVENTORY.md`, `docs/PLAN_UI_SIDEBAR.md` (đánh dấu giai đoạn 2 xong, nêu phần CHƯA XÁC MINH: nguồn cập nhật của sp/bp/exp, tần suất, độ tin cậy), `docs/SESSION_LOG.md` (mục mới ở ĐẦU), `docs/FIX_GUIDE.md`.

## Test và kiểm tra bắt buộc
- Mốc hiện tại: server 192/192, web 63/63 — ghi lại ở đầu báo cáo; không được tụt. Đếm server bằng `npx tsx --test` trên mọi `*.test.ts` trong `apps/server/src`.
- Test mới: `getCharacter` (đủ số, thiếu số, NaN/Infinity/âm, realmId lạ, chuỗi dài/ký tự điều khiển, chưa vào game → null); hợp đồng RunnerHandle (JSON thuần, bản sao, không rò tham chiếu); shard (kênh giả: số đi qua đúng, stale không để lại số cũ); WorkerPool (dừng/lỗi/stale → null); web sanitizer + hiển thị "—" cho null/stale + hiển thị đúng khi có số.
- Phá thử sửa TRỰC TIẾP NGUỒN, test phải FAIL gọn không treo, rồi khôi phục: (i) null → 0 cho sp/bp/exp, (ii) bỏ vô hiệu `character` khi `dataStale`, (iii) trả tham chiếu sống thay vì bản sao, (iv) `fresh` luôn true, (v) sanitizer web nhận chuỗi cho trường số.
- `pnpm build` (nếu `pnpm` không có trong PATH thử `%TEMP%\pnpmshim\pnpm.cmd`; nếu vẫn không chạy được thì nói rõ và chạy trực tiếp `tsc`/`vite build`/`vitest`), web test, từng file test liên quan, toàn bộ test server.
- Không dùng server thật với tài khoản giả (bước thêm tài khoản gọi game thật). Nếu cần xem giao diện: build tĩnh + máy chủ giả cục bộ (không mạng) phát `account_updated`/`initial_state`; nếu không có trình duyệt thì nói rõ là CHƯA xác minh trực quan.
- Báo cáo bằng bảng xong/chặn/chưa xác minh, kèm bằng chứng ngắn; KHÔNG tuyên bố xong nếu còn test fail. Nêu rõ những gì chỉ được suy ra từ mã client và chưa kiểm chứng live.
