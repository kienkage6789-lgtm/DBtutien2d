Bạn đang làm việc trong dự án E:\game\tutien2d (monorepo pnpm: apps/server, apps/web, packages/core-client, packages/automation-engine). Dự án KHÔNG có .git. Đọc trước: docs/SESSION_LOG.md (mục mới nhất), docs/FIX_GUIDE.md (mục B, D), docs/evidence/packet-tap-2026-10-07T13-58-34-898Z.json.

BỐI CẢNH ĐÃ XÁC MINH (từ code client chính thức vendor/tutien2d-public-client/2026-10-06/src và từ evidence live)
- maxHp/maxMp KHÔNG có trên wire. Client chính thức tính hpMax = REALMS[realmId].hpMax + tổng ITEMS[equipment[slot]].hpBonus (mp tương tự mpMax/mpBonus). REALMS nằm ở core/config.js, ITEMS ở systems/items.js. Nhân vật live HP 225 / MP 188 = đúng luyen_khi_8, không có bonus trang bị.
- Lúc login client chính thức tự đặt hp = hpMax; welcome và state không mang HP. HP tuyệt đối của chính mình chỉ đến qua `you` (phản hồi lệnh move, mang seq, fix, hp, mp, sp, bp, dn), `hurt`, `revived`, và formation balance (chỉ mp). Nhân vật mình không nằm trong p/pf; hp trong p/pf của người khác là PHẦN TRĂM, không được ghi vào vitals.
- `dn` trong `you` là cờ đã gục. Gói `down` có left và lostExp; `revived` có hp, mp.
- Thứ tự login live: welcome@778ms, map@831ms, state@836ms, snap2@845ms.
- Realm nằm ở state.save.realm (không có state.realm). Trang bị nằm ở state.save.equipment (slot: ao, giap, giay, mu, nhan, phap_boi, phi_hanh, vu_khi), không phải state.equipment.
- Trong 90 và 120 giây đầu không có `you`. Lệnh move thủ công bị chặn 409 character_not_alive vì gate yêu cầu HP đã biết, trong khi HP chỉ đến sau khi di chuyển. Đây là vòng luẩn quẩn đã chặn cả MiniMap lẫn lần kiểm chứng gần nhất.

BỐN BƯỚC (làm đúng thứ tự, mỗi bước build + test xong rồi mới sang bước sau)

BƯỚC 1. Nới gate move-to bằng tín hiệu gục (`dn`), không dùng hp <= 0
1. Core-client: thêm trạng thái `downed: boolean | null` vào GameStateStore (null = chưa biết). Cập nhật: `you.dn` (boolean) -> gán; gói `down` -> true; gói `revived` -> false. Reset về null khi `welcome` và khi đổi context map/khu. Gói `you` không có dn thì không đổi giá trị. Phát qua runtime của worker (thêm `downed` vào AccountRuntimeInfo, object "chưa chạy" và type web, cho phép merge trong useRealtime với kiểm tra boolean|null).
2. Worker `requestMoveTo`: thay điều kiện `!dataStatus.hp || hp === null || hp <= 0` bằng:
   - nếu downed === true -> ném `character_down`;
   - nếu vitals.status === 'fresh' && hp !== null && hp <= 0 && source thuộc 'you' | 'hurt' -> ném `character_down`;
   - nếu vitals unknown hoặc downed === null -> CHO ĐI (không chặn).
   Giữ nguyên các kiểm tra context/location/validateMoveToTarget.
3. Giữ gate NGHIÊM cho `moveToTrainingArea`, tấn công và skill, nhưng đổi mã lỗi cho đúng nghĩa: vitals chưa biết -> `vitals_unknown`; gục -> `character_down`. Tuyệt đối không dùng `character_not_alive` cho trường hợp chưa biết.
4. API trả mã lỗi mới theo error envelope hiện có (errorCode, requestId, retryable). `vitals_unknown` retryable=true, `character_down` retryable=false. Frontend hiện thông điệp tiếng Việt tương ứng.
5. Test: downed true chặn; downed null + vitals unknown cho đi; hp=0 từ source 'state' (không phải you/hurt) KHÔNG đủ để kết luận gục; training vẫn chặn khi unknown; reset downed ở welcome.
6. Nếu workspace web chưa có Vitest, thêm `pnpm --filter @tutien2d/web add -D vitest` và script `"test": "vitest run"`, rồi tạo apps/web/src/lib/context.test.ts theo FIX_GUIDE mục A.8.

BƯỚC 2. Sửa hai bug đọc `save`
1. Worker (apps/server/src/orchestrator/worker-pool.ts, chỗ `if (typeof packet.realm === 'string' ...) entry.dataStatus.realm = true`, quanh dòng 840): chấp nhận realm là chuỗi không rỗng ở `packet.realm` HOẶC `packet.save.realm`. Cập nhật mọi chỗ khác đang tin `packet.realm` cấp trên. Sau sửa, runtime.dataStatus.realm phải là true và runtime.realm hiện đúng.
2. Core-client (game-state.ts, `updateState`): đọc trang bị từ `state.save.equipment` khi `state.equipment` không có (gốc thắng, giống cách gộp vitals). Kiểm tra mọi nơi dùng `state.equipment`, `questSave` hoặc `GameStateStore.equipment` để không vỡ hành vi cũ. Chỉ nhận object có giá trị string|null.
3. Test: state chỉ có save.realm + save.equipment -> realm và equipment được nạp; state có cả hai -> gốc thắng; payload sai kiểu bị bỏ qua.

BƯỚC 3. Chạy lại điểm A với gate đã nới (cần phiên game thật)
1. Build, restart server, chạy TUTIEN_PACKET_TAP=120, đăng nhập bot (MỘT phiên duy nhất, không tạo phiên thứ hai bằng cùng tài khoản).
2. Không làm gì 20 giây đầu. Sau đó gửi đúng MỘT lệnh move về tọa độ hiện tại của nhân vật bằng cơ chế move-to có sẵn (không tự viết packet). Chờ 5 giây. Lặp tối đa 3 lần cách nhau 10 giây. Không tấn công, không skill, không di chuyển sang tọa độ khác.
3. Từ evidence mới ghi: có gói `you` không; độ trễ từ lúc gửi đến lúc nhận (ms); `you.seq` có khớp seq của move không; hp, mp, sp, bp, dn trong you; HP/MP có bằng 225/188 không.
4. Kết luận rõ: đây có phải cách chủ động đáng tin để lấy HP không. Nếu `you` không đến khi đứng yên thì ghi "bác bỏ" và dừng bước 4 phần dùng you để đối chiếu (vẫn làm phần tính toán), KHÔNG tự thêm cơ chế khác.
5. Nếu server vẫn chặn move đứng yên (ví dụ game từ chối cùng tọa độ), ghi nguyên văn mã lỗi, không retry.

BƯỚC 4. maxHp/maxMp suy ra, tách khỏi vitals tuyệt đối
1. Tạo script sinh bảng (ví dụ scripts/gen-derived-vitals.mjs) đọc vendor core/config.js (REALMS) và systems/items.js (ITEMS), xuất file TS `packages/core-client/src/state/derived-vitals.generated.ts` chứa: REALM_MAX = { [realmId]: { hpMax, mpMax } } và ITEM_BONUS = { [itemId]: { hpBonus, mpBonus } } (chỉ item có bonus khác 0). Đầu file ghi rõ nguồn là vendor/tutien2d-public-client/2026-10-06 và lệnh sinh lại. Nếu script không parse tin cậy được do file đã minify, ghi rõ cách đã làm và kiểm tra bằng đối chiếu ít nhất luyen_khi_8 -> 225/188.
2. Tạo `derived-vitals.ts` với hàm thuần:
   deriveMaxima(realmId, equipment) -> { maxHp, maxMp, source: 'derived', complete: boolean }
   - complete=false nếu realm không có trong bảng hoặc có item đang mặc không có trong ITEM_BONUS (item không bonus phải được phân biệt với item không biết; chỉ coi là "không bonus" khi item có trong bảng ITEMS).
   - Nếu realm không biết thì maxHp/maxMp = null.
3. KHÔNG ghi giá trị suy ra vào `VitalSnapshot` hay `vitals.maxHp`. Thêm riêng `derivedMax: { maxHp, maxMp, complete, source: 'derived', observedAt }` vào state/runtime/type web. Tính lại khi `state` đến hoặc realm/equipment đổi.
4. Đối chiếu an toàn: khi nhận `you`/`hurt`/`revived` có hp > derivedMax.maxHp (hoặc mp > maxMp) -> đặt `derivedMax.complete = false` và ghi log cảnh báo một lần (có thể có buff/thức ăn/trận pháp). Không dùng hp từ you để tự nâng max.
5. UI (AccountCard): hiển thị `225 / 225 (suy ra)` khi có HP tuyệt đối và derivedMax; chỉ hiện `—` khi không có. Khi complete=false thêm dấu `~`. Không hiển thị giá trị suy ra như dữ liệu server.
6. Training/automation chỉ được dùng tỉ lệ HP khi derivedMax.complete=true; ngược lại coi tỉ lệ là unknown.
7. Test: luyen_khi_8 không trang bị -> 225/188 complete; item có hpBonus -> cộng đúng; item lạ -> complete=false; realm lạ -> null; hp > max -> complete=false.

QUY TẮC AN TOÀN
- Không in token, JWT, mật khẩu, refresh token, selfId, tên nhân vật hay id người chơi ra chat, log hay evidence. Packet tap giữ chế độ redacted, mặc định tắt.
- Không coi hp trong p/pf là HP tuyệt đối. Không dùng hp <= 0 một mình để kết luận gục.
- Không gửi lệnh tấn công, skill hay di chuyển tự động ngoài đúng lệnh ở bước 3. Không retry mù.
- Không nới allowlist origin, không tắt auth, không sửa phần bảo mật.
- Mỗi bước: `pnpm build` pass, test liên quan pass, không làm vỡ test cũ (hiện 25 test JS + 3 contract test TS).
- Phần chưa xác minh được ghi "chưa xác minh", không suy đoán.

KẾT QUẢ CẦN GIAO
- Cập nhật docs/SESSION_LOG.md (mục mới: thay đổi, lệnh đã chạy, kết quả thật, mục còn chờ xác minh) và checklist/giả định ở cuối docs/FIX_GUIDE.md (đánh dấu giả định nào đã được xác nhận hoặc bác bỏ; sửa chỗ guide ghi `state.equipment` thành `state.save.equipment`).
- Evidence mới (nếu chạy bước 3): docs/evidence/packet-tap-*.json đã redact.
- Bảng cuối cùng:

| Bước | Trạng thái (xong / chặn / chưa xác minh) | Bằng chứng ngắn |
|---|---|---|
| 1. Gate move-to + downed | | |
| 2. realm/equipment từ save | | |
| 3. you khi đứng yên | | |
| 4. derived max | | |

- Kèm danh sách việc người dùng phải làm tay (nếu có) và các điểm còn rủi ro.
