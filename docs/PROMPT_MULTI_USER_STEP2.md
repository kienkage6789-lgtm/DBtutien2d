# Nhiệm vụ: BƯỚC 2 hệ thống người dùng — thời hạn sử dụng, hạn mức bot, bộ quét tự ngắt

Đọc kỹ `docs/SPEC_MULTI_USER.md` (đã duyệt; làm đúng mục 6 và mục "Bước 2" của mục 10; phần mục 11 "Đã chốt thêm"), `AGENTS.md`, `docs/CONTROL_PLANE_API.md`, `docs/PROMPT_MULTI_USER_STEP1.md` (bước 1 đã làm, commit `0a7cf7c`), rồi mã hiện có: `apps/server/src/db/database.ts` (bảng `users` đã có `expires_at`, `max_bots`; `audit_log`; `addAuditLog`), `security/auth.ts`, `api/routes.ts`, `orchestrator/worker-pool.ts` (`startAccount`, `stopAccount`, `startAll(ownerId?)`, `stopAll(ownerId?)`, `stopAccountsForOwner`), `ws/hub.ts`, `config.ts`, và web: `App.tsx`, `lib/api.ts`, `types/index.ts`, `hooks/useRealtime.ts`, `components/Navbar.tsx`, `components/AccountCard.tsx`, `lib/dialogs.ts`. Test đầu-cuối đa người dùng: `apps/server/src/api/multi-user.e2e.test.ts` (chạy máy chủ thật bằng tsx với `DATA_DIR` tạm). Nếu prompt mâu thuẫn với mã thật hoặc đặc tả, báo rõ và chọn phương án an toàn hơn.

KHÔNG chạm game thật, KHÔNG mở mạng, KHÔNG đọc/in nội dung `data/`, `apps/server/data/`, `.env*` (test dùng thư mục tạm). Không commit. Không sửa `vendor/`, `headless/` (engine vendor, daily, walk, khu, auto-supervisor). Sandbox của bạn không build được: tự rà kiểu TypeScript, import (đuôi `.js` trong server), chuỗi tiếng Việt UTF-8; người giao việc sẽ chạy `pnpm build` và toàn bộ test.

## BÀI HỌC BẮT BUỘC (đã gặp ở các đợt trước)

1. Test không phụ thuộc thời gian thực: tiêm đồng hồ (`now: () => number`) vào bộ quét và hàm tính hạn; không `sleep` dài; chờ có điều kiện bằng thăm dò, cửa sổ vài giây. Test đầu-cuối chạy máy chủ thật nên không giả đồng hồ được: để đặt hạn sát hiện tại hãy dùng API admin đặt `expiresAt` = vài trăm ms trong tương lai hoặc API thu hồi, và chạy bộ quét bằng interval cấu hình ngắn qua biến môi trường kiểm thử (ví dụ `ENTITLEMENT_SWEEP_MS`) hoặc endpoint nội bộ chỉ bật trong kiểm thử; không để lộ endpoint kiểm thử trong bản chạy thật.
2. Tham số có giá trị mặc định khai báo kiểu tường minh.
3. Làm sạch chuỗi: đổi ký tự điều khiển thành khoảng trắng RỒI gộp khoảng trắng.
4. Không in/ghi log mật khẩu, token, băm. Lỗi `/api` dùng phong bì `{success:false,error,errorCode,requestId,retryable}` qua `sendError`; phản hồi thành công giữ dạng hiện có (`{success:true, data}`).
5. Kiểm tra hạn mức và tạo bản ghi phải nằm trong cùng một đoạn đồng bộ (không `await` giữa đọc số đếm và ghi) hoặc kiểm tra lại sau `await` (ví dụ sau `verifyLogin`), để hai yêu cầu đồng thời không vượt hạn mức.
6. Giữ nguyên hành vi của admin: admin KHÔNG bị kiểm hạn, hạn mức hay trần; principal `legacyToken` coi như admin.

## Việc cần làm

### 1. Tính hạn và cấp hạn (server)
- Hàm thuần `computeGrant(currentExpiresAt: number | null, now: number, duration: '1d'|'7d'|'30d'): { from: number; to: number }`: `from = max(now, currentExpiresAt ?? 0)`, `to = from + duration` (1d = 86_400_000 ms, 7d = 7×, 30d = 30×). Cộng dồn khi gia hạn sớm. Có test biên (null, đã hết hạn, còn hạn, đúng lúc hết hạn).
- Bảng `grants` (theo đặc tả mục 3: `id`, `user_id`, `granted_by`, `duration`, `from_at`, `to_at`, `created_at`, khóa ngoại + xoá theo khi xoá người dùng) và hàm DB tương ứng; `ALTER`/tạo bảng idempotent trên DB bước 1 đã có.
- `POST /api/admin/users/:id/grant {duration: "1d"|"7d"|"30d"}` (chỉ admin): ghi `grants`, cập nhật `expires_at`, `audit_log` (`user_granted`), trả `publicUser` mới. Không cấp cho admin (409 `ADMIN_NOT_EXPIRING`) hoặc người đã bị khóa (409 `USER_DISABLED`).
- `POST /api/admin/users/:id/expiry {expiresAt: number|null}` (chỉ admin): đặt/xoá hạn tuyệt đối (null = chưa cấp, chạy bị chặn); dùng để thu hồi/chỉnh tay; `audit_log` (`user_expiry_set`); sau khi đặt hạn đã qua/null phải kích bộ quét ngay (mục 3).
- `PATCH /api/admin/users/:id` đã có `maxBots`: kiểm số nguyên 0..1000 (400 `MAX_BOTS_INVALID`); hạ dưới số tài khoản hiện có KHÔNG xoá gì, chỉ chặn thêm/chạy thêm (mục 2). Kích bộ quét sau khi đổi `maxBots`/`status`.
- Trạng thái quyền sử dụng (hàm thuần dùng chung, đồng hồ tiêm được): `entitlement(user, now) → { state: 'admin'|'active'|'expired'|'none'|'disabled', expiresAt, remainingMs }` (`none` = chưa cấp; `disabled` = bị khóa; admin luôn `admin`). Thêm vào `publicUser` và `/api/auth/me` các trường `entitlement`, và `usage: { accounts, running, maxBots }` (cho người dùng thường).

### 2. Ép hạn mức và quyền chạy
- Middleware `requireEntitlement`: người dùng thường có `state !== 'active'` → `403 ENTITLEMENT_EXPIRED` (hoặc `ENTITLEMENT_NONE`/`USER_DISABLED` theo trạng thái, message tiếng Việt rõ ràng, kèm `expiresAt`). Áp dụng cho MỌI route điều khiển bot dưới `/api/accounts/:id/**` ngoại trừ chỉ-đọc (`GET`), `stop`, `DELETE`, `PUT password` (người hết hạn vẫn được dừng/xoá/đổi mật khẩu tài khoản của mình, và vẫn đọc trạng thái): tức `start`, `restart`, `auto/start`, `auto/stop` (cho phép `auto/stop`), `khu` (POST), `move-to`, `daily/*`, `quest-probe` (đã admin), … Liệt kê rõ route nào bị chặn/được qua trong tài liệu; `POST /orchestrator/start-all` chặn tương tự (stop-all cho qua). Trong `workerPool.startAll(ownerId?)` bỏ qua tài khoản của người dùng không còn quyền (ghi log).
- `POST /api/accounts`: người dùng thường có `usage.accounts >= maxBots` → `403 QUOTA_BOTS` (message nêu rõ "x/maxBots"); chỉ cần quyền hạn mức, không cần còn hạn (người hết hạn vẫn thêm tài khoản được nếu còn chỗ — HOẶC chặn nếu bạn thấy an toàn hơn; chọn một, ghi rõ trong tài liệu). Kiểm tra lại sau `await verifyLogin` ngay trước `createAccount` (bài học 5).
- `start`/`restart`/`auto/start`/`start-all`: người dùng thường có số tài khoản đang chạy (không tính chính tài khoản này nếu đã chạy) `>= maxBots` → `409 BOT_LIMIT_REACHED`. Trần toàn máy chủ `MAX_TOTAL_RUNNERS` (biến môi trường, mặc định 0 = không giới hạn; ghi vào `config.ts` + tài liệu): tổng runner đang chạy `>=` trần (với cả admin) → `503 SERVER_CAPACITY`, `retryable: true`.
- Phản hồi lỗi cho UI: `errorCode` ổn định để web ánh xạ thông báo.

### 3. Bộ quét `EntitlementWatcher` (ngắt kết nối toàn bộ bot khi hết hạn)
- Lớp trong `apps/server/src/orchestrator/` hoặc `security/` nhận `{ now: () => number, getUsers, stopAccountsForOwner, audit, log, notify }` (tiêm được); `start()` chạy ngay một lượt khi khởi động server, rồi lặp mỗi 30 s (`ENTITLEMENT_SWEEP_MS` ghi đè, tối thiểu 100 ms cho kiểm thử), `stop()` dọn timer (gọi trong shutdown, không giữ tiến trình sống khi test).
- Mỗi lượt: với người dùng THƯỜNG có `state` là `expired`/`none`/`disabled` mà còn tài khoản đang chạy → `stopAccountsForOwner(userId)` (dừng toàn bộ runner, không đụng cấu hình/dữ liệu), ghi `audit_log` (`entitlement_stop`, chỉ số lượng tài khoản đã dừng, lý do), ghi nhật ký từng tài khoản bị dừng (`level: warn`, mã/ngữ cảnh ngắn "Dừng do hết hạn sử dụng"), và gửi `system_alert` WS CHỈ cho chủ tài khoản đó (không phát cho người khác; xem cơ chế gửi theo chủ sở hữu ở `ws/hub.ts`). Không lặp thông báo mỗi 30 s: chỉ khi thực sự có tài khoản vừa bị dừng. Lỗi dừng của một người không làm bộ quét dừng/ném ra (bắt, ghi log, thử lại lượt sau); tránh chạy chồng hai lượt (cờ đang chạy).
- Kích bộ quét ngay (gọi `sweepNow()`) sau: cấp/đặt hạn/thu hồi, đổi `status`, đổi `maxBots`, xoá người dùng.
- Khi `maxBots` bị hạ xuống dưới số đang chạy: KHÔNG tự dừng bot (chỉ chặn chạy thêm) — ghi rõ trong tài liệu.
- Khởi động lại server: bot không tự chạy lại (giữ quy tắc AGENTS.md), nên chỉ cần kiểm tra lần đầu; xác nhận trong báo cáo cách `status` tài khoản được đặt lại khi khởi động hiện tại (không đổi hành vi nếu đã đúng).
- WS: kết nối của người dùng hết hạn vẫn mở được (xem trạng thái, nhận thông báo hết hạn); không đóng.

### 4. Giao diện web
- Thanh trên (người dùng thường): "Hạn dùng còn 2 ngày 3 giờ" (đếm ngược cập nhật mỗi 30–60 s theo giờ trình duyệt, tính từ `expiresAt` của server; dùng độ lệch `serverNow` nếu `/auth/me` cung cấp để tránh sai giờ máy), "Bot n/3" (số tài khoản/`maxBots`, và đang chạy m). Hết hạn/chưa cấp/bị khóa → banner đỏ rõ nguyên nhân ("Tài khoản đã hết hạn, liên hệ admin để gia hạn"); khóa nút Chạy/Bật Hết, Auto, và các điều khiển (đi map, đổi khu, nhiệm vụ) với chú thích; vẫn cho Dừng/Dừng Hết/xoá tài khoản/đổi mật khẩu. Hết chỗ (n ≥ maxBots) → khóa nút Thêm Tài Khoản kèm lý do.
- Ánh xạ lỗi `ENTITLEMENT_EXPIRED`, `ENTITLEMENT_NONE`, `USER_DISABLED`, `QUOTA_BOTS`, `BOT_LIMIT_REACHED`, `SERVER_CAPACITY` sang thông báo tiếng Việt qua `friendlyErrorMessage` trong `lib/dialogs.ts`; nhận `system_alert` hết hạn hiển thị thông báo (dùng `notify`, không `alert` gốc).
- Admin không hiện thanh hạn dùng/banner; KHÔNG làm tab quản trị ở bước này (bước 4). Giữ chiều ngang không tràn ở 334 px. Cập nhật `types/index.ts`, `lib/api.ts`, `useRealtime.ts` (sanitizer trả `undefined` khi sai kiểu). Vitest cho logic thuần của web (định dạng thời gian còn lại, quyết định khóa nút theo trạng thái; `pnpm --filter @tutien2d/web test`, hiện 34 test).

### 5. Test (server)
`cd apps/server && npx tsx --test <file>`, mỗi file một lệnh. Giữ nguyên test hiện có. Thêm:
- `computeGrant` và `entitlement` (biên, cộng dồn, admin, khóa).
- `EntitlementWatcher` với đồng hồ giả và pool giả: dừng khi hết hạn/chưa cấp/khóa; không động đến admin và người còn hạn; không thông báo lặp; lỗi một người không chặn người khác; không chạy chồng; `sweepNow` sau khi đổi trạng thái.
- Hợp đồng: người dùng hết hạn gọi từng route điều khiển nhận 403 đúng mã, các route cho phép (đọc, stop, delete, đổi mật khẩu) vẫn qua; `QUOTA_BOTS` ở bot thứ `maxBots + 1` (dùng DB seed, không đăng nhập game); `BOT_LIMIT_REACHED`; `SERVER_CAPACITY`; hai yêu cầu `POST /accounts` đồng thời không vượt hạn mức nếu test được ở mức hàm/DB.
- Mở rộng `multi-user.e2e.test.ts` (hoặc file e2e mới cùng cách chạy): admin cấp 1d cho người dùng mới → người đó chạy được (dùng lỗi sau khi qua cổng kiểm quyền, ví dụ tài khoản seed không đăng nhập thật được — phân biệt "bị chặn quyền" với "lỗi khởi động game"; KHÔNG để test cố mở kết nối game thật: nếu không thể, chỉ kiểm cổng quyền bằng route gọi được mà không chạm mạng, hoặc đặt cờ kiểm thử làm `workerPool.startAccount` giả — nêu rõ cách bạn làm); đặt hạn qua → bộ quét (interval ngắn qua biến môi trường kiểm thử) dừng runner giả/ghi audit → người dùng nhận 403; thu hồi/gia hạn lại → chạy được; `maxBots` nâng/hạ; admin không bị ảnh hưởng.
- Giữ test mutation nhỏ nếu hữu ích: bỏ `requireEntitlement` thì test phải fail.

### 6. Tài liệu
Cập nhật `docs/CONTROL_PLANE_API.md` (route cấp hạn/đặt hạn, trạng thái entitlement, `usage`, các mã lỗi mới, danh sách route chặn/được qua khi hết hạn, biến `MAX_TOTAL_RUNNERS`, `ENTITLEMENT_SWEEP_MS`), `docs/SESSION_LOG.md` (mục ĐẦU), checklist cuối `docs/FIX_GUIDE.md`, ghi "bước 2 đã triển khai (offline)" vào mục trạng thái của `docs/SPEC_MULTI_USER.md`; nêu rõ ví dụ lệnh `curl` để admin cấp hạn cho tới khi có giao diện quản trị (bước 4), không in token.

## Báo cáo cuối

File sửa/thêm, quyết định thiết kế (nơi kiểm quyền, xử lý hết hạn khi đang `startAccount` dở, việc cho/không cho người hết hạn thêm tài khoản, cách kích bộ quét, cờ/biến kiểm thử), những gì CHƯA xác minh (đồng hồ lệch giữa máy chủ/trình duyệt, hành vi bộ quét khi nhiều trăm người dùng, dừng runner đang giữa chừng nhiệm vụ, trần `MAX_TOTAL_RUNNERS` chưa đo RAM), lệnh người giao việc cần chạy. Không tuyên bố build/test pass nếu không chạy được.
