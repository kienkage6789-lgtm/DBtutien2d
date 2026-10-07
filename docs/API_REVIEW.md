# TuTien2D API review

Ngày audit: **2026-10-06**  
Phạm vi: game WSS, Supabase auth adapter, backend REST/WS control-plane và các
điểm tích hợp bot trong workspace.

## 1. Kết luận điều hành

- `wss://game.tutien2d.online/` **mở được WebSocket handshake** trong probe live
  read-only. Chưa gửi `hello`, nên chưa xác minh authentication/game packets trên
  máy chủ thật.
- `pnpm build` **pass** cho cả core-client, automation-engine, server và web khi
  chạy ngoài sandbox bị giới hạn quyền đọc dependency.
- Giao thức hiện có một lõi đủ rõ để kết nối: `hello`, `ping/pong`, `welcome`,
  `state`, `map`, `status`, `cmd/ack`, `move`, `enter`, `attack`, `skill`, `chat`.
- Contract vẫn **chưa production-ready**: parser nhận `any`, chưa có runtime schema,
  chưa có idempotency contract, chưa có bảng mã lỗi/rate limit từ game server.
- Control-plane hiện **không có auth/RBAC và mở CORS**, trong khi bind `0.0.0.0`
  và có route thay đổi account/bot. Đây là blocker trước khi expose public.
- Hai script test chứa JWT tĩnh. Token này phải được revoke/rotate ngay cả khi đã
  hết hạn; fixture mới chỉ được dùng placeholder hoặc secret injection.

## 2. Evidence ledger

| Claim | Evidence | Result |
| --- | --- | --- |
| Game endpoint chấp nhận WSS transport | live probe ngoài sandbox, 2026-10-06; open rồi close 1000 | Confirmed transport-only |
| Client gửi `proto:10`, `snap:2` và hello fields | `packages/core-client/src/connection/socket-client.ts:131-140` | Confirmed in code |
| Auth có timeout và refresh/retry classification | `packages/core-client/src/auth/supabase-auth.ts:104-174`, `token-manager.ts:139-177` | Confirmed in code |
| ACK timeout mặc định 8 giây | `socket-client.ts:332-349` | Confirmed in code |
| Auto retry mutation game | Không có trong `sendCmd`; pending RPC bị reject khi close | Not implemented; không được giả định |
| Map select `khu` | `client.ts:473-479`, `routes.ts:113-165` | Not supported by current client contract |
| Full game command support như market/whisper | Chỉ thấy trong tài liệu cũ, không thấy trong client | Unverified |
| Backend auth/RBAC | `index.ts:18-22`, route file không có auth middleware | Confirmed missing |
| Internal WS auth/origin check | `apps/server/src/ws/hub.ts:15-35` | Confirmed missing |

## 3. Findings

### F-001 — Critical: control-plane không có authentication/authorization

- **Evidence:** `apps/server/src/index.ts:18-22` mount CORS mở và `/api`; tất cả
  route trong `apps/server/src/api/routes.ts:9-315` không có auth middleware.
  Server bind `0.0.0.0` tại `index.ts:44`.
- **Impact:** Bất kỳ client nào truy cập được port có thể đọc account/runtime/log,
  thêm credential, đổi password, start/stop/delete account, đổi bot config hoặc
  điều khiển orchestrator.
- **Recommendation:** đặt private bind/reverse proxy, auth middleware, RBAC theo
  tenant/account, CORS allowlist, audit log và deny-by-default.
- **Verified:** Có trong code; chưa thử khai thác live.

### F-002 — Critical: JWT tĩnh trong test source

- **Evidence:** `test_ws.mjs:9` và `test_ping.mjs:9` chứa chuỗi JWT trực tiếp.
- **Impact:** token có thể lọt vào git history, backup, CI log hoặc artifact; nếu
  còn hiệu lực thì có thể chiếm phiên game.
- **Recommendation:** revoke/rotate token ngay; xóa khỏi working tree/history theo
  quy trình secret-removal; test đọc `GAME_TEST_TOKEN` từ secret manager và không
  log payload.
- **Verified:** Có trong source; không in token trong báo cáo này.

### F-003 — High: không có runtime validation cho packet/ACK

- **Evidence:** `socket-client.ts:153-165` dùng `JSON.parse` rồi cast sang
  `GameInPacket`; `types.ts:208-217` cho phép fallback `{op:string; [key:string]:any}`.
- **Impact:** malformed/hostile packet có thể đi sâu vào state/bot; lỗi shape chỉ
  phát hiện muộn hoặc tạo state sai.
- **Recommendation:** schema validator ở boundary; reject/measure unknown op;
  validate ranges, required fields, cross-field invariants và giới hạn payload.
- **Verified:** Có trong code.

### F-004 — High: mutation không có idempotency contract

- **Evidence:** `sendCmd` tạo `rid` cục bộ từ 101 (`socket-client.ts:30,338`),
  chờ ACK và reject khi timeout/close (`346-363`, `383-389`); không có stable
  operation ID/deduplication. Chỉ một số ví dụ legacy có `requestId`.
- **Impact:** caller retry sau timeout có thể bán/mua/đóng góp/gieo/thu hoạch hai lần.
- **Recommendation:** server hỗ trợ `operationId`/idempotency key ổn định và trả
  kết quả cũ khi duplicate; client chỉ retry theo allowlist từng command.
- **Verified:** Có trong code; server semantics chưa được xác minh.

### F-005 — High: internal dashboard WS broadcast không auth

- **Evidence:** `apps/server/src/ws/hub.ts:15-35` chấp nhận connection và gửi
  `initial_state`; `broadcast` gửi cùng snapshot tới mọi client; không origin/auth
  check.
- **Impact:** rò runtime, inventory, log và trạng thái account cho người có thể
  mở socket.
- **Recommendation:** authenticate handshake, authorize account scope, kiểm tra
  Origin, giới hạn message/connection, và tách snapshot nhạy cảm.
- **Verified:** Có trong code.

### F-006 — Medium: error/limit contract chưa chuẩn hóa

- **Evidence:** route trả lỗi từ `err.message` (`routes.ts:66-68`, `180-182`,
  `191-215`); `limit` parse trực tiếp (`268-279`) không clamp/validate; thiếu
  `requestId`, `Retry-After`, `retryable`.
- **Impact:** client khó phân biệt retryable/permanent/operator-action; có thể
  đọc log quá lớn hoặc lộ chi tiết nội bộ.
- **Recommendation:** schema lỗi chung, bounded pagination, correlation ID,
  redaction và status mapping cố định.
- **Verified:** Có trong code.

### F-007 — Medium: tài liệu cũ overclaim command support

- **Evidence:** bản `docs/GAME_API.md` trước audit liệt kê market/whisper/talisman.use
  và các command không có trong `core-client/src/client.ts`; parser chỉ có fallback.
- **Impact:** bot có thể gửi lệnh chưa tồn tại, tạo timeout hoặc side effect không
  dự đoán được; người vận hành tưởng tính năng đã được kiểm chứng.
- **Recommendation:** dùng registry code-backed trong tài liệu này; mọi command
  mới phải có packet capture/test contract và trạng thái bằng chứng.
- **Verified:** So sánh source/docs.

### F-008 — Medium: replay/determinism chưa được thiết kế

- **Evidence:** jitter và retry delay dùng `Math.random()` (`anti-detection/jitter.ts:31`,
  `token-manager.ts:146`); state cập nhật bằng `Date.now()`.
- **Impact:** không thể tái lập chính xác quyết định bot từ cùng input; khó debug
  duplicate/race và khó làm snapshot/replay evidence.
- **Recommendation:** inject clock/seeded PRNG cho policy; serialize event/order;
  thêm replay test nếu bot tiếp tục là worker dài hạn.
- **Verified:** Có trong code; chưa đo soak/replay.

## 4. Contract matrix

| Surface | Current contract | Status |
| --- | --- | --- |
| Game WSS | JSON text, hello proto/snap, ping/pong, packet stream, cmd/ack | Partial; schema chưa runtime-validated |
| Supabase auth | password/refresh grants, timeout 15s, retry network/429/5xx | Code-backed |
| Dashboard REST | `/api/accounts`, `/maps`, lifecycle, config, logs, orchestrator | Code-backed, unauthenticated |
| Dashboard WS | `/ws`, server-to-client runtime events | Code-backed, unauthenticated |
| API versioning | Không có URL/header/schema version cho control-plane | Missing |
| Pagination | `limit` query, không cursor/upper bound | Weak |
| Idempotency | Không có contract ổn định | Missing |

## 5. Verification record

### Build

Command: `pnpm build`  
Result: **pass** — core-client, web, automation-engine và server đều hoàn tất.

### Live transport probe

Probe: mở `wss://game.tutien2d.online/`, không gửi `hello`, không gửi token, đóng
ngay sau `open`.  
Result: **open**, sau đó **close code 1000**.  
Claim established: transport/TLS reachable.  
Claims not established: authentication, packet schema, ACK semantics, gameplay,
rate limits, command authorization.

### Tests not established

- Đã có focused vitals contract tests và training state-transition tests; đây là
  test phía client, chưa phải contract test đầy đủ với game server thật.
- Chưa có malformed-response cho toàn bộ opcode, duplicate-request, idempotency,
  deterministic replay, snapshot/restore hoặc soak report.
- Chưa có E2E với account credential hợp lệ; không dùng credential trong source để
  tự động hóa thêm.

## 6. Remediation order

1. Revoke/rotate token đã commit; loại secret khỏi test source và log.
2. Khóa control-plane vào private network; thêm auth/RBAC, CORS allowlist và WS origin/auth.
3. Thêm schema boundary + error envelope + bounded pagination.
4. Thiết kế idempotency/operation ID và retry policy theo command.
5. Bổ sung mock game server, contract rejection tests, timeout/rate-limit/duplicate tests.
6. Bổ sung clock/PRNG injection, replay/snapshot continuation và soak evidence.
7. Chỉ nâng trạng thái command `UNVERIFIED` sau khi có fixture packet đã redact và test pass.

