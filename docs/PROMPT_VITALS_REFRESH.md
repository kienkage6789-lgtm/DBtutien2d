Đọc AGENTS.md trước, rồi docs/SESSION_LOG.md (hai mục mới nhất ở đầu file) và docs/FIX_GUIDE.md. Repo đã có git và working tree sạch; KHÔNG commit, để thay đổi trong working tree.

BỐI CẢNH ĐÃ XÁC MINH BẰNG LIVE
- HP tuyệt đối của chính mình chỉ đến qua `you` (hp, mp, sp, bp, dn, fix, seq), `hurt`, `revived`, và formation balance (chỉ mp). maxHp/maxMp là giá trị suy ra (`derivedMax`), không có trên wire.
- Gói `you` là phản hồi của lệnh `move`: server gửi `you` khi move có seq bội số của 10 (hoặc khi đã nhận được move thứ 10), KHÔNG cần dịch chuyển. Hai probe live: 10 move `idle` đứng yên (seq 1..10) -> đúng 1 `you` seq=10 sau ~1 giây, trễ 91 đến 106ms; 4 move rồi nghỉ 3 giây rồi 10 move (seq 5..14) -> `you` ở seq 10, không phải seq 14; 4 move đầu không kích ra `you`. Hạn chế: mỗi kiểu chỉ có một mẫu; chưa tách được "seq do client gửi % 10" khỏi "tổng số move server đã nhận % 10"; chưa thử khi nhân vật có quái ở gần; chưa thử st khác 'idle'.
- Khi nhân vật đứng yên đánh quái thì không có luồng move, nên HP chỉ cập nhật qua `hurt`. Sát thương luôn đi kèm `hurt` (server-authoritative), regen chỉ làm HP tăng, nên HP cũ là cận dưới an toàn trong thực tế, nhưng đây là suy luận, chưa xác minh với mọi nguồn sát thương (độc, hiệu ứng theo thời gian).
- Gate di chuyển là MỀM, gate tấn công/skill là NGHIÊM (xem resolveMoveVitalError / resolveStrictVitalError / strictVitalError trong apps/server/src/orchestrator/worker-pool.ts). Harness apps/server/src/debug/stationary-probe.ts đã có logic gửi burst move idle và các guard; hãy tái sử dụng/tách phần dùng chung thay vì viết lại, và KHÔNG làm đổi hành vi của harness (hai chế độ '1' và 'offset' vẫn như cũ, tắt mặc định).

NHIỆM VỤ: triển khai `vitalsAgeMs` và `refreshVitals()` (thay đổi nhỏ, tập trung, có test)

A. Tuổi dữ liệu HP/MP (`vitalsAgeMs`)
1. Runtime (apps/server/src/orchestrator/worker-pool.ts, getRuntimeInfo và object "chưa chạy", kiểu AccountRuntimeInfo): thêm `vitalsAgeMs: number | null` = max(0, now - vitals.observedAt), null nếu observedAt null hoặc vitals.status không phải 'fresh'. Tính ở backend, giống `mapContextAgeMs`.
2. Web: thêm vào type AccountRuntime (`vitalsAgeMs?: number | null`, `vitalsReceivedAt?: number` chỉ dùng ở client). `useRealtime.mergeAccountRuntime`: nhận vitalsAgeMs (null hoặc số hữu hạn >= 0), đóng dấu `vitalsReceivedAt = Date.now()` khi nhận; vitals có observedAt không được lùi (đã có kiểm tra, giữ nguyên). Thêm hàm thuần `resolveVitalsAge(account, now)` trong apps/web/src/lib (cùng kiểu resolveMapContext: tuổi = vitalsAgeMs + thời gian trôi từ lúc nhận, không bao giờ âm) và test Vitest.
3. UI (AccountCard): hiển thị tuổi cạnh HP/MP (ví dụ "225 · 3s trước"); khi tuổi > 5 giây thì làm mờ/đánh dấu "cũ"; khi chưa có thì "—" như hiện tại. Không bao giờ hiển thị giá trị chưa biết thành 0.
4. Hằng số (đặt ở một nơi dùng chung, có comment nguồn): VITALS_DISPLAY_STALE_MS = 5_000 (chỉ để UI đánh dấu); VITALS_ATTACK_MAX_AGE_MS = 30_000 (ngưỡng gate tấn công, ĐỀ XUẤT chưa xác minh, có thể chỉnh); VITALS_REFRESH_MIN_INTERVAL_MS = 30_000.

B. refreshVitals()
1. Module mới apps/server/src/orchestrator/vitals-refresh.ts, tiêm phụ thuộc (deps) như StationaryProbe để test được:
   refreshVitals(deps): Promise<{ status: 'refreshed' | 'skipped' | 'no_ack'; reason?: string; movesSent: number; ackLatencyMs?: number }>
2. Điều kiện bắt buộc, nếu không đạt trả 'skipped' kèm reason cụ thể, KHÔNG gửi gì:
   - game client đang kết nối; downed !== true; có vị trí hợp lệ và mapContext hiện hành;
   - không có moveTo accepted/running, không có navigation đang hoạt động;
   - không có attack/skill đang trong cửa sổ chờ xác nhận (OperationLedger ở packages/core-client/src/operation-ledger.ts, hoặc phase attacking của training nếu ledger không tiếp cận được; nêu rõ cách chọn trong báo cáo);
   - chưa có refresh nào trong VITALS_REFRESH_MIN_INTERVAL_MS gần nhất của tài khoản đó (giới hạn tần suất theo tài khoản, có test);
   - không có refresh khác đang chạy (khóa theo tài khoản).
   Tùy chọn `allowNearMonsters` mặc định FALSE: khi false và có quái trong 300 đơn vị thì 'skipped' với reason 'monster_within_300'. Chưa có bằng chứng an toàn khi có quái gần, nên đừng đặt mặc định true.
3. Hành động: gửi tối đa 10 move `idle` (nhịp 100ms, đúng tọa độ và dir hiện tại, dùng sendMove có sẵn), dừng sớm ngay khi nhận `you` mới (đăng ký listener `you` trước khi gửi, gỡ listener khi xong). Sau move cuối chờ tối đa 1500ms cho `you`. Nhận `you` -> 'refreshed' (ghi ackLatencyMs); không nhận -> 'no_ack' (KHÔNG tự gửi lại, KHÔNG retry). Sau khi chạy, vitals phải được cập nhật qua đường có sẵn (syncCanonicalVitals), không ghi trực tiếp.
4. Nối vào hệ thống:
   - API: POST /api/accounts/:id/vitals/refresh (đi qua requireAuth và error envelope hiện có). Trả kết quả refreshVitals; 'skipped' trả 409 với errorCode theo reason (ví dụ VITALS_REFRESH_RATE_LIMITED, VITALS_REFRESH_NOT_ALLOWED), retryable đúng nghĩa (rate limit = true, downed = false). Cập nhật docs/CONTROL_PLANE_API.md hoặc docs/API_REFERENCE.md.
   - UI: một nút nhỏ "Làm mới HP" ở AccountCard, bị khóa khi bot chưa IN_GAME hoặc khi đang chạy; hiện lỗi từ envelope.
   - Training: ở pha tấn công của state machine (packages/automation-engine/src/training/state-machine.ts), khi vitals chưa biết hoặc tuổi > VITALS_ATTACK_MAX_AGE_MS: thử yêu cầu refresh qua một hook được tiêm (requestVitalsRefresh) tối đa một lần mỗi VITALS_REFRESH_MIN_INTERVAL_MS; nếu 'skipped' hoặc 'no_ack' thì blocker `VITALS_UNKNOWN` (chưa từng biết) hoặc `VITALS_STALE` (đã biết nhưng quá cũ) chỉ chặn TẤN CÔNG, không dừng cả training. Nhận `hurt` làm tuổi về 0 như hiện nay. Không nới gate nghiêm: vitals phải fresh và tuổi trong ngưỡng.
5. Tỉ lệ HP: chỉ tính hp/maxHp khi derivedMax.complete === true; ngược lại coi tỉ lệ là chưa biết. Không ghi derivedMax vào VitalSnapshot.

C. Test (bắt buộc, không làm vỡ test cũ)
- vitals-refresh: skip cho từng điều kiện (disconnected, downed, move-to, navigation, attack đang chờ, rate limit, đang chạy, quái gần khi allowNearMonsters=false, thiếu vị trí/context); dừng sớm khi có you ở move thứ k; không retry khi no_ack; tối đa đúng 10 move; listener được gỡ trong mọi nhánh kể cả lỗi; khóa theo tài khoản; rate limit tính theo tài khoản.
- API route: auth bắt buộc, mã lỗi và retryable đúng.
- web: resolveVitalsAge (không âm khi now < receivedAt, cộng thời gian trôi, null khi không có), merge không cho observedAt lùi, UI helper nếu tách.
- state machine: stale -> hỏi refresh một lần rồi blocker VITALS_STALE chỉ ở pha tấn công; pha di chuyển vẫn chạy khi HP unknown.

QUY TẮC AN TOÀN (nhắc lại từ AGENTS.md)
- KHÔNG chạy server, KHÔNG đăng nhập game, KHÔNG gửi bất kỳ packet thật nào. Sandbox của bạn cũng không dựng được môi trường live; kiểm chứng live sẽ do người dùng làm.
- Không in token, JWT, mật khẩu, selfId, tên nhân vật hay id người chơi. Không đọc data/ hay .env.
- Không thêm cơ chế gửi move/tấn công nào ngoài refreshVitals() (tối đa 10 move idle, một lần mỗi 30 giây mỗi tài khoản). Không retry mù. Không bypass gate nghiêm của tấn công/skill.
- Không nới allowlist origin, không tắt auth. Route mới phải qua requireAuth.
- Nếu pnpm không có trong PATH của sandbox hoặc build bị chặn bởi EPERM: thử `corepack pnpm`, hoặc chạy tsc trực tiếp từng package bằng node_modules/typescript/bin/tsc, rồi chạy node --test cho các test .mjs. Nêu rõ lệnh nào chạy được, lệnh nào bị chặn. KHÔNG tuyên bố build pass nếu chưa chạy.
- Phần chưa xác minh ghi "chưa xác minh". Các ngưỡng 5s/30s/30s là đề xuất, phải đặt thành hằng số có tên và ghi rõ trong tài liệu là chưa xác minh.

KẾT QUẢ CẦN GIAO
- Cập nhật docs/SESSION_LOG.md (mục mới ở ĐẦU file: thay đổi, lệnh đã chạy, kết quả thật, mục chờ xác minh live) và checklist cuối docs/FIX_GUIDE.md.
- Bảng cuối:

| Hạng mục | Trạng thái (xong / chặn / chưa xác minh) | Bằng chứng ngắn |
|---|---|---|
| A. vitalsAgeMs (backend + web + UI) | | |
| B. refreshVitals + API + nút UI | | |
| B. Tích hợp training (VITALS_STALE) | | |
| C. Test | | (số test pass/fail theo từng lệnh) |
| Build | | |

- Kèm danh sách kịch bản live người dùng cần chạy để xác nhận (ví dụ: refresh khi đứng yên không quái; refresh khi bị rate limit; refresh khi có quái gần với allowNearMonsters=false), và các điểm còn rủi ro.
