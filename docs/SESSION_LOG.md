# Nhật ký phiên triển khai

## 2026-10-08 — Kết quả live probe offset (4 + 10 move đứng yên)

Chạy bởi Claude Code sau khi Codex sửa harness (Codex không chạy được build/live trong sandbox). Build 4/4 package pass; test harness và packet tap pass. Evidence redacted: `docs/evidence/packet-tap-2026-10-07T23-14-12-695Z.json` (thư mục evidence không nằm trong git).

| Quan sát | Giá trị |
|---|---|
| Đợt `offset-0` | 4 move `idle`, seq 1..4, tại (246,695); 0 gói `you`, 0 gói `you` trong 3 giây nghỉ |
| Đợt `offset-1` | 10 move `idle`, seq 5..14, cùng tọa độ |
| Gói `you` | đúng 1 gói, `seq=10`, tại 24777ms; move seq 10 gửi lúc 24686ms, trễ 91ms |
| Thời điểm `you` | sau move thứ 6 của đợt `offset-1`, 0.63 giây kể từ move đầu của đợt đó |
| Nội dung `you` | hp 225, mp 188, sp 78, bp 115, dn 0, fix 0; vị trí không đổi |

| Mô hình | Kết luận | Lý do |
|---|---|---|
| M1: server dựa vào seq (bội số 10) hoặc đếm tổng số move nhận được | **Ủng hộ** | `you` mang đúng `seq=10`, sau 6 move của đợt thứ hai |
| M2: đếm 10 move kể từ đầu luồng sau khoảng nghỉ | **Bác bỏ** | Sẽ cho `you` ở seq 14; thực tế `you` đến ở seq 10 và không có `you` nào sau seq 14 |
| M3: theo thời gian ~1 giây kể từ đầu luồng | **Bác bỏ (có lưu ý)** | `you` đến sau 0.63 giây, không phải ~1 giây; nhưng chỉ có một mẫu |

Chưa phân biệt được: "seq do client gửi % 10" và "tổng số move server đã nhận % 10" (cần gửi seq lệch, nên không thử). Một mẫu duy nhất, tiến trình mới khởi động, seq bắt đầu từ 1.

Hệ quả thiết kế `refreshVitals()`: gửi tối đa 10 move `idle` liên tiếp (khoảng 1 giây) tại tọa độ hiện tại sẽ chắc chắn đi qua một bội số của 10 nếu M1 đúng. Điều kiện an toàn vẫn như harness: không gục, không có quái trong 300 đơn vị, không move-to/điều hướng, context hiện hành, giới hạn tần suất (đề xuất khoảng 30 giây).

Trạng thái sau khi chạy: bot đã dừng bằng `POST /accounts/:id/stop`, server đã dừng, cổng 4000 giải phóng.

## 2026-10-08 — Mở rộng stationary probe offset (live chưa xác minh)

### Thay đổi

- Mở rộng `apps/server/src/debug/stationary-probe.ts` với mode `TUTIEN_PROBE_STATIONARY=offset`; mode mới gửi đúng hai đợt `4 + 10` move `idle`, cùng tọa độ/dir, nhịp 100ms, giữ guard và thời gian chờ 20 giây sau `IN_GAME` như harness cũ.
- Mode cũ `TUTIEN_PROBE_STATIONARY=1` giữ luồng A/B `10 idle + 10 walk` và short-circuit cũ; giá trị env khác `1`/`offset` tắt harness.
- Packet tap giữ dữ liệu redacted; đợt mới dùng nhãn `offset-0`/`offset-1`, ghi seq đầu/cuối, vị trí trước/sau, `you` với `seq/hp/mp/sp/bp/dn/fix/at/delayMs`, và thêm `youDuringPostMoveWait` để nhận biết `you` trong 3 giây nghỉ sau đợt 0.
- Test harness bao phủ 14 move, đúng hai đợt, guard hủy giữa chừng, env lạ tắt, env `1` giữ hành vi cũ; packet-tap test bao phủ trường nghỉ mới và redaction.

### Lệnh và kết quả thật

- `corepack pnpm build`: **bị chặn**; Corepack ban đầu không tạo được cache mặc định (`EPERM`), sau khi chuyển cache vào workspace thì script root gọi `pnpm` con không có trong PATH.
- `corepack pnpm --filter "@tutien2d/*" build`: **fail** tại `typescript@5.9.3/bin/tsc` trong `.pnpm` với `EPERM`.
- `corepack pnpm install --offline --frozen-lockfile` và thử store riêng: **bị chặn** với `ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK` / Access denied.
- Test source harness bằng Node 24 type-transform: **pass** (`server stationary-probe tests passed`). Packet-tap source test bằng Node 24 transform-types: **pass** (`core-client packet tap tests passed`).
- `node --test apps/server/src/debug/stationary-probe.test.mjs` và `node --test packages/core-client/test/packet-tap.test.mjs`: **chưa pass** vì `dist` chưa rebuild; lần lượt dùng artifact cũ nên mode offset không được nhận và trường `youDuringPostMoveWait` chưa có.
- Chưa restart server, chưa đăng nhập game, chưa gửi move thật và chưa tạo evidence mới vì build không pass. Kiểm tra port 4000 không có listener trong lần kiểm tra này.

### Còn chờ xác minh

- Live probe `offset` với đúng một phiên game và `TUTIEN_PACKET_TAP=90` chưa chạy; `S`, `T`, `N`, seq đầu/cuối, HP/MP, `dn/fix`, vị trí trước/sau và việc có `you` trong khoảng nghỉ đều **chưa xác minh**.
- Không có evidence mới được tạo; không suy đoán kết luận M1/M2/M3 từ các lần probe trước.
- Thiết kế `refreshVitals()` chưa đổi trong nhiệm vụ này. Cần giữ nó phụ thuộc vào `you` authoritative, không phụ thuộc giả định server theo seq hay theo thời gian; số move tối thiểu bảo đảm `you` theo mô hình thực tế vẫn **chưa xác minh**.

## 2026-10-07 — Stationary move probe: `you` sau 10 move đứng yên

### Thay đổi

- Thêm harness debug một lần tại `apps/server/src/debug/stationary-probe.ts`, tắt mặc định và chỉ schedule khi `TUTIEN_PROBE_STATIONARY=1` và account vào `IN_GAME`. Harness chờ 20 giây, kiểm tra `downed`, quái gần, move-to, navigation, context và vị trí; nếu không an toàn thì ghi lý do và không gửi move.
- Đợt A gửi tối đa 10 move qua `TuTienClient.sendMove`, cùng kênh và callback `shouldSend` của move thường, nhịp 100ms, tọa độ làm tròn, `dir` hiện tại, `st: idle`. Đợt B `st: walk` chỉ chạy sau 15 giây nếu A không có `you`; live run không cần B.
- Packet tap lọc key cấu trúc `selfId`; không ghi token, tên, giá trị ID hay raw packet. Test tap kiểm tra batch, `st`, seq span, `you` và redaction.

### Đối chiếu protocol

- `vendor/tutien2d-public-client/2026-10-06/src/net/gateway.js` gửi `st:o.state`.
- `vendor/tutien2d-public-client/2026-10-06/src/entities/player.js` khởi tạo `state:"idle"` và trả về `idle` khi không có vector di chuyển. Đây là căn cứ để dùng `idle`, không phải giả định chưa xác minh.

### Lệnh và kết quả thật

- Live server dùng `TUTIEN_PACKET_TAP=90`, `TUTIEN_PROBE_STATIONARY=1`, một account duy nhất, không MiniMap, attack hay skill. Đã dùng route start/stop có sẵn; sau khi tap flush đã stop server, port `4000` không còn listen.
- Evidence redacted: [`docs/evidence/packet-tap-2026-10-07T15-34-28-827Z.json`](evidence/packet-tap-2026-10-07T15-34-28-827Z.json). Tap `durationMs=90021`, `outboundMoves=10`, `youPackets=1`, không có cancellation.
- Đợt A: `seqStart=1`, `seqEnd=10`, `st=idle`, tọa độ gửi `(246,695)`, `atStart=21344`, `atEnd=25312`; `you` duy nhất `seq=10` lúc `at=22414`, HP/MP/SP/BP `225/188/78/115`, `dn=0`, `fix=0`, delay `106ms` so với move gần nhất. Vì A đã có `you`, B không chạy.
- Vị trí runtime trước/sau A đều `(246,695)`, delta `0`; HP/MP `225/188` trùng `derivedMax` đã biết cho `luyen_khi_8`; không suy luận nguyên nhân.
- Test pass: stationary harness (guard, env off, one-shot/20 move bound/A short-circuit), packet tap, các JS test core không chạm `ws`, automation state-machine và server `.mjs` tests.
- Full workspace build/test chưa pass trong môi trường này: `pnpm` không có trên PATH; Corepack build bị script con `pnpm` không tìm thấy; TypeScript full server thiếu symlink `express`/kiểu; các test cần `ws`/`vitest` bị sandbox từ chối `EPERM`. Không ghi các ca này là pass.

### Kết luận probe

| Giả thuyết | Kết luận | Bằng chứng redacted |
|---|---|---|
| H1. `you` mỗi bội số seq 10, không cần dịch chuyển | **XÁC NHẬN** cho run này | A `seq 1..10`, `st=idle`, đúng 1 `you seq=10`; khoảng 1.07s từ đầu đợt, delay 106ms sau move cuối |
| H2. `st` idle/walk có ảnh hưởng | **CHƯA XÁC MINH** | A đã có `you` nên B `st=walk` không được chạy theo thiết kế |
| H3. `you` không đổi vị trí | **XÁC NHẬN** cho run này | `fix=0`, `dn=0`, `(246,695)` → `(246,695)`, delta 0 |

### Đề xuất thiết kế, chưa code

- Thêm `vitalsAgeMs` ở runtime, tính từ `vitals.observedAt`; khi chưa có authoritative snapshot thì để `null`, không thay bằng 0.
- Khi đánh quái đứng yên, đề xuất TTL HP nghiêm 5 giây; `hurt` là nguồn cập nhật duy nhất trong khoảng đó. Quá TTL thì gate attack/skill phải chặn và hiển thị stale, không suy ra HP.
- Nếu có thêm evidence xác nhận H1, thiết kế `refreshVitals()` dùng batch 10 move `idle`, chỉ khi không có quái trong 300, không attack/skill, không move-to/navigation, context/vị trí fresh, và rate-limit ví dụ 30 giây.

### Việc người dùng phải làm tay và rủi ro còn lại

- Nếu lặp lại: restart server với hai env trên, start đúng một account, không bấm MiniMap/attack/skill, chờ file tap flush rồi stop server.
- H2 `walk` chưa xác minh; một run A thành công không chứng minh mọi map, epoch, phiên bản server hay account khác. Move đứng yên vẫn là side effect có giới hạn và có thể bị server thay đổi quy tắc.

## 2026-10-07 — Training gate probe: gate mềm và `you` sau move thật

### Thay đổi

- `moveToTrainingArea` dùng `moveVitalErrorForEntry`: vitals unknown hoặc
  `downed=null` vẫn được di chuyển; chỉ `downed=true` hoặc HP 0 fresh từ nguồn
  `you`/`hurt` mới trả `character_down`.
- Training state machine vẫn giữ gate nghiêm cho tấn công: khi chưa có HP
  authoritative thì có thể phát `MOVE_TO_AREA`, nhưng không phát `ATTACK` và
  trả blocker `VITALS_UNKNOWN`. HP 0 từ `state` không đủ để kết luận gục.
- Packet tap được mở rộng thêm `outboundMoves`, chỉ ghi sau `sendRaw` thành công:
  `seq`, `x`, `y` đã làm tròn, `at` tương đối và `ep`; không ghi packet thô,
  token, selfId, tên nhân vật hay ID người chơi.

### Lệnh và kết quả thật

- `pnpm build`: pass cả 4 package.
- `pnpm --filter @tutien2d/web test`: 6/6 pass.
- Bộ test JavaScript core/automation/server: pass; test TypeScript server: 5/5
  pass. Test mới bao phủ gate di chuyển mềm, gate nghiêm tấn công và redaction
  outbound move.
- Live command dùng server foreground với
  `$env:TUTIEN_PACKET_TAP='150'`, `$env:TUTIEN_PACKET_TAP_DIR='docs/evidence'`
  rồi `node apps/server/dist/index.js`; sau đó dùng các route sẵn có
  `POST /api/accounts/:id/start` và
  `POST /api/accounts/:id/navigation/move-to`. Target được chọn bằng
  `findWalkPath`/`isWalkSegmentClear` từ walk-grid đã build, không tự viết game
  packet.
- Có một lần setup live ban đầu bị process server cũ giữ port `4000`; hai
  request move khi đó `arrived` nhưng không có tap file mới, nên không dùng làm
  bằng chứng. Sau đó đã dừng đúng process workspace, chạy server foreground
  với `TUTIEN_PACKET_TAP=150` trong cùng shell và thực hiện lại một probe sạch.
- Probe sạch dùng đúng một account, không attack/skill, không quái trong bán
  kính 300 và `downed` không phải `true`. Sau 20 giây idle, walk-grid/A* chọn
  điểm `(272,720)` cách vị trí đầu `(241,691)` `42.45px`; hai move high-level
  duy nhất là đi tới điểm này rồi quay lại điểm đầu. Cả hai request trả `202`
  `running` và kết thúc `arrived` sau 8 giây quan sát.
- Evidence redacted mới:
  [`docs/evidence/packet-tap-2026-10-07T14-59-31-958Z.json`](evidence/packet-tap-2026-10-07T14-59-31-958Z.json),
  `durationMs=150090`, `outboundMoves=90`, `youPackets=9`. Chín gói `you` có
  seq `10,20,30,40,50,60,70,80,90`, đều khớp move outbound gần nhất; độ trễ
  `98–113ms`; mọi gói có `hp=225`, `mp=188`, `dn=0`, `fix=0`, `sp=78`,
  `bp=115`. Không có `hurt`/`revived`; tap không chứa token/password/refresh
  token/selfId value.
- Runtime sau probe: `vitals.status=fresh`, `vitals.source=you`,
  `hp=225`, `mp=188`, `derivedMax=225/188 complete`, không có quái gần. Server
  đã dừng, port `4000` free.

### Kết luận và phần còn chờ

- Gate training: **xong**; unknown chỉ chặn combat, không chặn movement.
- Điểm A sau move có dịch chuyển thật: **xác nhận**. `you` là ACK/đồng bộ gắn
  với move khi có dịch chuyển; seq khớp và latency quan sát được `98–113ms`.
  Probe này chỉ chứng minh với quãng đường `42.45px`; chưa suy ra ngưỡng tối
  thiểu kích `you`.
- Cách chủ động đáng tin để lấy HP đã được kiểm chứng trong phạm vi này là một
  move ngắn có dịch chuyển thật qua cơ chế move-to; move về đúng tọa độ khi
  đứng yên của capture 120 giây trước vẫn **bác bỏ** cho trường hợp đứng yên.
- Hiệu ứng làm đổi `hpMax` theo thời gian: **chưa xác minh**; probe không dùng
  vật phẩm, không đổi trang bị, không vào chiến đấu và không có `hurt`/`revived`.

## 2026-10-07 — HP fix: downed gate, save fallback, derived maxima và live move

### Thay đổi

- BƯỚC 1: giữ `downed: boolean | null` xuyên core/runtime/web; reset ở
  `welcome` và đổi map/khu; `you.dn`, `down`, `revived` là nguồn cập nhật duy
  nhất. Move-to cho phép vitals chưa biết hoặc `downed=null`; chỉ chặn
  `character_down` khi có tín hiệu gục đáng tin (`downed=true` hoặc HP 0 từ
  `you`/`hurt`). Training/attack vẫn giữ gate nghiêm và trả
  `vitals_unknown`/`character_down` đúng nghĩa.
- BƯỚC 2: worker đọc realm từ `packet.realm` hoặc `packet.save.realm` với
  top-level thắng; core đọc equipment từ `state.save.equipment` khi không có
  top-level hợp lệ. Live runtime đã có `dataStatus.realm=true`.
- BƯỚC 4: sinh bảng realm/item từ vendor bằng
  `node scripts/gen-derived-vitals.mjs`; thêm `deriveMaxima`, `derivedMax`
  tách khỏi `VitalSnapshot`, cảnh báo một lần khi HP/MP quan sát vượt max suy ra,
  UI và automation chỉ dùng tỷ lệ khi `derivedMax.complete=true`.
- Thêm Vitest cho web theo mục A.8 và test gate/realm/derived maxima.

### Lệnh và kết quả thật

- `node scripts/gen-derived-vitals.mjs`: pass, đọc 16 realm và 235 item từ
  `vendor/tutien2d-public-client/2026-10-06/src`; bảng Luyện Khí 8 là HP 225,
  MP 188.
- `pnpm --filter @tutien2d/web add -D vitest`: pass; `pnpm --filter
  @tutien2d/web test`: 1 file, 6 test pass.
- Bộ test JavaScript core/automation/server: 26 test pass; 5 test TypeScript
  server (contract, realm, gate): pass.
- `pnpm build`: pass cả 4 package.
- Live chạy server với `TUTIEN_PACKET_TAP=120`, đúng một account đã lưu. Sau
  login: `dataStatus.realm=true`, realm `luyen_khi_8`,
  `derivedMax={maxHp:225,maxMp:188,complete:true}`, vitals `unknown`, downed
  `null`.
- Chờ yên 20 giây, gửi đúng một move-to về tọa độ hiện tại. Request trả `202`
  với trạng thái `running`, sau 5 giây kết thúc `arrived`; không retry.
  Runtime vẫn `vitals.status=unknown`, `vitals.source=null`, không có `you`.
- Evidence redacted mới:
  [`docs/evidence/packet-tap-2026-10-07T14-28-11-588Z.json`](evidence/packet-tap-2026-10-07T14-28-11-588Z.json),
  `durationMs=120102`, `youPackets=[]`, `ops.you=0`, `ops.hurt=0`,
  `ops.revived=0`, không có raw packet. Login trong capture là
  `welcome@874ms → map@932ms → state@935ms → snap2@948ms`; realm và equipment
  vẫn nằm ở `state.save`.

### Kết luận và phần còn chờ

- BƯỚC 1, 2, 4: **xong**, đã build/test; live xác nhận realm và derived max.
- BƯỚC 3: **xong với kết luận bác bỏ giả thuyết** “move về đúng tọa độ khi
  đứng yên chủ động trả `you` để lấy HP”: move đã `arrived` nhưng 120 giây
  không có `you`. Không đo được seq/độ trễ/hp/mp/dn vì gói không đến.
- Hiệu ứng buff/thức ăn/trận pháp làm đổi max theo thời gian: **chưa xác minh**;
  live không có `you`/`hurt`/`revived` và không được chủ động dùng hiệu ứng.
- Server đã dừng sau capture; không còn listener ở port `4000`.

## 2026-10-07 — Live packet tap xác minh nguồn HP/MP

### Thay đổi trong phiên

- Chỉ sửa `packages/core-client/src/debug/packet-tap.ts`: tap giữ chế độ opt-in
  qua `TUTIEN_PACKET_TAP`, ghi tập key cấp op, 30 packet đầu theo thời điểm tương
  đối, metadata `state/save/equipment/realm`, các trường số allowlist và packet
  `you`; không ghi packet thô, token, selfId, tên nhân vật hoặc ID người chơi.
- Bổ sung đọc equipment nằm trong `state.save.equipment` (không chỉ
  `state.equipment`). Không sửa vitals, state machine, gate move-to, worker hay
  reducer nghiệp vụ.
- Evidence redacted mới:
  [`docs/evidence/packet-tap-2026-10-07T13-58-34-898Z.json`](evidence/packet-tap-2026-10-07T13-58-34-898Z.json).

### Lệnh và kết quả thật

- `pnpm --filter @tutien2d/core-client build`: pass sau khi chạy ngoài sandbox;
  lần chạy trong sandbox gặp `EPERM` khi runtime TypeScript đọc `node_modules`.
- `node --test packages/core-client/test/packet-tap.test.mjs`: pass.
- `pnpm build`: pass cả 4 package.
- Bộ 10 file test JavaScript hiện có của core/automation/server: pass (15 test
  cases). Lần chạy trong sandbox bị `EPERM` khi đọc module `ws`, chạy lại ngoài
  sandbox đã pass. `pnpm --filter @tutien2d/web exec vitest run` chưa chạy được vì
  workspace web không có executable `vitest`.
- Chạy server bằng `TUTIEN_PACKET_TAP=120` và thư mục evidence đã chỉ định; dùng
  đúng một account đã lưu. Runtime đạt `IN_GAME` và
  `mapContextIsCurrent=true`.
- Giữ yên 20 giây: connection vẫn `IN_GAME`, vitals vẫn `unknown`, tọa độ không
  đổi. Sau đó gửi đúng một request qua route move-to có sẵn, về đúng tọa độ hiện
  tại; server trả `409 character_not_alive`, tức bị chặn trước khi transmit move
  packet. Chờ thêm 5 giây không có `you`; không retry.
- Tap chạy đủ `durationMs=120006`. Trình tự packet đầu quan sát được:
  `welcome@778ms → map@831ms → state@836ms → snap2@845ms`; giữa các mốc có
  `status`, `bosses`, `formation`, `hon`, `khoiloi` và các packet khác.
- `state` có key cấp trên `op, reason, save`, không có `state.realm`.
  Realm nằm chính xác ở `state.save.realm=luyen_khi_8`. Equipment cũng nằm trong
  `state.save.equipment`: `ao=bach_y`, `giap=null`, `giay=null`, `mu=null`,
  `nhan=null`, `phap_boi=truc_diep_boi`, `phi_hanh=phi_diep`,
  `vu_khi=thiet_kiem`.
- Runtime sau capture xác nhận `dataStatus.realm=false`, `runtime.realm` rỗng.
  Đây là hành vi khớp code hiện tại: listener `state` của worker chỉ bật cờ khi
  `packet.realm` cấp trên là chuỗi; nó không xét `packet.save.realm`. Vì vậy
  `save.realm` có thật nhưng chưa được phản ánh vào cờ dataStatus.
- Evidence có `youPackets=[]`, không có `hurt` hoặc `revived`. Do move bị gate
  chặn, chưa đo được độ trễ gửi–nhận, seq khớp, hay hp/mp/dn trong `you`.
  Không có cơ hội an toàn để so sánh HP/MP trước–sau hiệu ứng; phần hpMax theo
  thời gian vẫn là **chưa xác minh**.
- Sau khi flush evidence và kiểm tra xong, đã dừng server; port `4000` không còn
  ở trạng thái listen.

### Kết luận đối chiếu giả thuyết

- A — **chưa xác minh**: không thể suy ra move đứng yên sẽ tạo `you` khi request
  còn bị `character_not_alive` chặn trước transmit. Chưa có bằng chứng để coi
  đây là cách chủ động đáng tin lấy HP.
- B — **xác nhận một phần**: thứ tự login và nguồn realm đã xác nhận; key đúng là
  `state.save.realm`, không phải `state.realm`. Equipment có các slot/ID nêu
  trên. Lý do `dataStatus.realm=false` đã xác định theo nhánh worker nói trên.
- C — **chưa xác minh**: 120 giây không có `hurt`/`revived` và không có hiệu ứng
  thụ động quan sát được, nên không có cặp giá trị để kết luận hpMax thay đổi.

## 2026-10-07 — Điều phối và nghiệm thu bộ fix FIX_GUIDE

### Đã triển khai

- Điều phối 3 sub-agent Luna mức suy luận vừa theo ba phạm vi không chồng lấn:
  frontend A/E.4, server security/API E.1–E.6 và core/automation B–D.
- Frontend sửa freshness/map context, merge theo timestamp, MiniMap click,
  geometry backoff; thêm API token qua `sessionStorage`, Bearer REST và WebSocket
  subprotocol `bearer`.
- Server mặc định bind loopback; bind public bắt buộc `API_TOKEN` tối thiểu 32
  ký tự; thêm origin/auth WS, request ID, giới hạn JSON/pagination và error envelope.
- Core/automation sửa vitals lấy từ `state.save`, thêm `selfPresence` tách khỏi
  HP authoritative, policy liveness an toàn, packet tap redacted, monster counters
  và operation ledger chống retry mù attack/skill.
- Bổ sung truyền `selfPresence` qua worker/dashboard và cập nhật checklist trong
  [`FIX_GUIDE.md`](FIX_GUIDE.md).

### Nghiệm thu

- `pnpm build`: 4/4 package pass.
- 25 test JavaScript và 3 contract test TypeScript pass.
- Public bind thiếu token bị từ chối; loopback không token vẫn hoạt động.
- Packet tap mặc định tắt; không ghi packet thô, token, ID hoặc tên nhân vật.

### Live UI smoke — 2026-10-07

- `http://127.0.0.1:3000/` render dashboard thành công; dữ liệu tài khoản/catalog
  từ REST hiển thị và trạng thái WebSocket chuyển sang `Realtime Kết Nối`.
- Mở/đóng panel API token và modal `Thêm Tài Khoản` thành công; không nhập hoặc
  gửi token/mật khẩu trong smoke test.
- `http://127.0.0.1:3001/` hiển thị UI nhưng WebSocket bị từ chối do origin mặc
  định chưa allow port `3001`; cổng chuẩn `3000` hoạt động đúng.
- Wrapper `pnpm dev` hiện lỗi môi trường cục bộ do thiếu dependency `yargs` của
  `concurrently`; live test đã chạy qua các service đang lắng nghe cổng chuẩn.

### Còn chờ xác minh live

- Chạy packet tap 90 giây để xác định nguồn HP thực tế.
- Thử map có quái để kết luận parser hay protocol không gửi monster.
- Chưa xác nhận ACK/observation cho attack/skill; không tự retry.
- Schema packet E.8 chưa bật vì protocol còn biến thể chưa capture.
- Smoke click MiniMap đã được chạy ở mục live verification 2026-10-07 bên dưới;
  chuỗi move-to thành công vẫn còn chờ vì backend chặn khi vitals chưa fresh.

## 2026-10-07 — Live verification MiniMap, vitals, monsters và reconnect

### Thay đổi trong phiên

- Restart server và build lại web; bổ sung thông báo reconnect đúng yêu cầu:
  `Kết nối realtime bị từ chối: kiểm tra API token và origin được phép.`
- Không sửa parser vitals hoặc reducer quái sau capture: giữ nguyên nguyên tắc
  chỉ sửa khi packet evidence chứng minh nguồn dữ liệu.
- Đưa bản packet tap redacted vào
  [`docs/evidence/packet-tap-2026-10-07T13-19-41-452Z.json`](evidence/packet-tap-2026-10-07T13-19-41-452Z.json).

### Lệnh và kết quả thật

- `pnpm --filter @tutien2d/web build`: pass.
- Restart `pnpm --filter @tutien2d/server dev`, start lại account đã lưu; runtime
  vào `IN_GAME`, `mapContextIsCurrent=true`, context age quan sát được 56–98 ms.
- Hard refresh dashboard tại `http://127.0.0.1:3000/`; MiniMap hiển thị trạng thái
  cho phép click. Click đầu tiên tạo POST `navigation/move-to`, nhưng server trả
  `409 character_not_alive`; `moveTo=null`, vị trí giữ nguyên vì vitals lúc đó
  còn `unknown`. Đây là backend fail-safe, không phải UI chặn request.
- Packet tap `TUTIEN_PACKET_TAP=90` ghi `durationMs=90094`, có `state` nhưng không
  có vital field trong `state.save`/gốc packet; `selfEntries=[]`; `p` và `pf` có
  `hp` nhưng evidence không chứng minh được đó là HP self, cũng không xác minh
  được phần trăm hay tuyệt đối. Sau khi reconnect ổn định, runtime thật đạt
  `vitals.status=fresh`, `vitals.source=you`; UI hiển thị HP `225 / —`, MP
  `188 / —`. Không ghi giá trị `p.hp` vào vitals.
- POST điều hướng portal tới `thanh_truc_lam` trả `202 navigation_started`; state
  kết thúc `arrived` tại `x=240,y=63`. Sau 30 giây: monsters `13 → 12`,
  `monsterRowsSeen 93 → 247`, `monsterPatchRowsSeen 570 → 1622`,
  `lastMonsterRowsAt` được cập nhật và `worldReceived +300`. Kết quả bác bỏ giả
  thuyết worker đang lọc bỏ toàn bộ quái; không sửa id số.
- Kiểm tra reconnect: code dừng sau 5 lần thất bại liên tiếp, reset ở `onopen`
  và khi đổi token; build xác nhận chuỗi cảnh báo mới.
- `pnpm build`: pass cả 4 package; 25 test JavaScript và 3 contract test
  TypeScript pass. `pnpm --filter @tutien2d/web exec vitest run` chưa chạy được vì
  workspace web không có executable Vitest/test script.

### Còn chờ xác minh

- MiniMap chưa đạt chuỗi `accepted/running → arrived|blocked|failed`: click đã
  tạo request nhưng bị chặn có lý do `character_not_alive` trước khi tạo ledger.
- Packet tap hiện không có `you` trong file 90 giây; runtime sau đó xác nhận
  source `you`, nhưng shape packet `you` và quan hệ `selfId` với `p/pf` vẫn cần
  capture riêng nếu muốn kết luận tuyệt đối.
- `selfPresence.hpPercent` vẫn chưa có vì max HP chưa xuất hiện; UI chỉ có HP
  thật và để max là `—`.
- Việc vận hành thủ công chưa thực hiện: rotate token game cũ từng nằm trong
  `test_ws.mjs`/`test_ping.mjs`; đặt `API_TOKEN` và `ENCRYPTION_SECRET` trong
  `.env` nếu mở ngoài localhost; `git init` và thêm `.gitignore` cho `.env`,
  `data/`, `node_modules/`, `apps/web/dist/`, `docs/evidence/`.

## 2026-10-06 — Chuyển map bắt buộc qua portal: triển khai và live smoke

### Phát hiện và nguyên nhân

- Direct `enter(mapId)` từ vị trí bất kỳ không bypass được game server; nhân vật
  phải đi vào ô portal của map hiện tại.
- Packet `move` của public client bắt đầu `seq=1`, gửi stream khoảng 10Hz và
  dùng `ep` của map. Bản cũ bắt đầu từ `seq=2` và đưa movement vào jitter action
  300–700ms.
- A* chỉ trên tile center chưa đủ vì nhân vật có collision rectangle; route cần
  kiểm tra `lineClear` theo rectangle 16×12 và re-plan theo server echo.

### Đã triển khai

- Thêm catalog edge portal đã xác minh, static collision grid và A* collision-aware.
- Thêm state machine `planning → moving_to_portal → waiting_map_confirmation →
  arrived/failed`, retry hữu hạn và authoritative map confirmation.
- Sửa core movement: sequence bắt đầu từ 1, chỉ tăng sau khi transmit thành công,
  làm tròn tọa độ như public client, không qua action jitter.
- API/UI trả `navigation_started`, `operationId`, route và runtime phase; không
  còn báo thành công chỉ vì raw packet đã được gửi.
- Thêm [PORTAL_NAVIGATION.md](PORTAL_NAVIGATION.md) và evidence đã redact.

### Live verification

- `tan_vien/K4 (252,883)` → portal `(7,29)` → `thanh_truc_lam/K1 (240,63)`:
  `arrived`.
- Chiều ngược `thanh_truc_lam/K1 (240,63)` → portal `(7,0)` →
  `tan_vien/K1 (240,927)`: `arrived`.
- Build và các unit checks liên quan đạt; xem
  [`docs/evidence/2026-10-06-portal-navigation-smoke.json`](evidence/2026-10-06-portal-navigation-smoke.json).

### Giới hạn còn lại

- Protocol chọn `khu` chưa được xác minh; `farmKhu` chưa thể ép server đổi khu.
- Catalog portal hiện là các edge đã kiểm chứng trong public client snapshot;
  map gated hoặc edge chưa có trong catalog sẽ trả `blocked` thay vì bypass.

## 2026-10-06 — Audit protocol và bản đồ theo dữ liệu quan sát

### Audit repo

- Audit xác nhận packet map có `mapId`, `khu`, `soKhu`, `p` và `e`; dữ liệu `state` và `status` là hai nguồn/nhóm packet riêng.
- Trước patch không có catalog map toàn cục trong server; public client snapshot có `WorldMap.LAYOUT`/`MapData` và portal metadata.
- Public game UI chỉ được dùng để xác nhận trải nghiệm bản đồ; UI công khai không tiết lộ protocol nội bộ.

### Đã cập nhật

- Core bổ sung alias HP/MP và `soKhu`; reset entity khi đổi map hoặc khu để tránh giữ người chơi/quái từ context cũ.
- Backend bổ sung catalog map public-client qua `GET /api/maps`, enrich bằng packet live; thao tác chuyển map qua `POST /api/accounts/:id/map/enter`, cùng kiểm tra freshness và context cho runtime snapshot.
- UI liệt kê 16 map có tên hiển thị, đánh dấu `Catalog`/`Đã thấy live`, cho phép chọn map và hiển thị trạng thái chờ packet xác nhận; danh sách khu chỉ để xem vì chưa có command chọn khu. Entity chỉ được hiển thị trong đúng map/khu context.
- [Claim lịch sử — đã superseded bởi audit 2026-10-06] Phân tích nguyên nhân ảnh chụp trạng thái sai từng ghi HP/MP lấy từ `status` và alias. Contract hiện hành không dùng `status` làm vitals: `status` chỉ là effect; vitals lấy từ field chuẩn của `state` hoặc các packet self `you`/`hurt`/`revived` khi thực sự xuất hiện. Giá trị mặc định, snapshot cũ và race từ context map/khu trước có thể khiến giao diện hiển thị thiếu hoặc sai dữ liệu.

### Kiểm tra

- `pnpm build`: đạt.
- Smoke test protocol: đạt.
- `GET /api/maps`: đạt, trả `source=public_client_catalog`, 16 map.
- Smoke direct-enter lịch sử: `enter(thanh_truc_lam)` trả `request_sent`; sau 4 giây chưa có packet đích, runtime vẫn `tan_vien`. Kết quả này đã được supersede bởi live portal smoke ở phần trên; direct-enter vẫn không phải contract hợp lệ.

### Giới hạn còn lại

- Chưa có command protocol để chọn khu.
- Catalog là metadata từ public client snapshot, không phải allowlist server và không chứng minh mọi map đều mở khóa.
- Live portal smoke hai chiều đã được bổ sung ở phần trên; các map/edge khác vẫn cần kiểm chứng riêng trước khi đưa vào catalog.

## 2026-10-06 — Giảm tự động hóa và xác nhận trạng thái game

### Phạm vi phiên

- Team gồm 3 nhánh Luna mức suy luận vừa, lần lượt xử lý automation/core-client, backend/runtime snapshot và giao diện.
- Mục tiêu là giảm số chức năng chạy đồng thời, hiển thị trạng thái có nguồn dữ liệu rõ ràng và để người vận hành bật Auto farm có chủ đích.

### Đã cập nhật

- Nhật ký giao diện mặc định thu gọn (collapsed); người dùng có thể mở để xem log.
- Auto farm là chức năng tự động duy nhất đang được bật hỗ trợ trong luồng chạy hiện tại, có công tắc bật/tắt. Khi chạy, bot chỉ điều hướng về map/điểm farm đã cấu hình và chỉ farm khi snapshot xác nhận đúng vị trí.
- Snapshot bản đồ và giao diện dùng dữ liệu runtime để hiển thị nhân vật, người chơi, quái và điểm farm; không tự đặt marker khi thiếu dữ liệu.
- Trạng thái cảnh giới, HP và MP có cờ `dataStatus` riêng. UI chỉ trình bày chỉ số khi dữ liệu hợp lệ, tránh hiển thị giá trị mặc định như dữ liệu thật.
- Automation legacy tạm khóa: quest ngày, quest chính, hang động, bán đồ, hồi phục và mua vật phẩm. Thao tác bán đồ/điểm danh thủ công cũng tạm khóa trong giao diện.
- Build `pnpm build` đạt sau follow-up và rà soát tích hợp.

### Giới hạn và rủi ro còn lại

- Protocol hiện chưa có lệnh chọn khu (`khu`); nếu nhân vật ở sai khu, việc chuyển khu vẫn cần thao tác ngoài automation.
- Chưa có kiểm thử end-to-end với game server thật. Snapshot, chuyển map và đồng bộ dữ liệu cần được xác nhận khi chạy với phiên game thực tế.
- Danh sách người chơi/quái chỉ có thể hiển thị khi packet tương ứng thực sự cung cấp dữ liệu; khi thiếu packet, UI phải báo chưa có dữ liệu.
- `dataStatus` cho biết packet có dữ liệu hợp lệ theo parser hiện tại, nhưng chưa chứng minh server gửi cập nhật liên tục hoặc đúng nhịp thời gian thực.
- Các automation cũ và thao tác manual đang bị khóa ở luồng giao diện/chạy bot; cần rà soát mọi API hoặc đường gọi khác trước khi khẳng định chúng bị vô hiệu hóa tuyệt đối.
- Rủi ro bảo mật đã ghi ở phiên trước, gồm xác thực/phân quyền API và WebSocket, CORS mở, cùng token hardcode trong script test, chưa được xử lý trong phiên này.

## 2026-10-06 — Tách quest, điều hướng farm và bản đồ xác nhận vị trí

### Mục tiêu

- Tách riêng lựa chọn tự động quest chính tuyến, quest ngày và bí cảnh.
- Cho phép cấu hình điểm farm và tự chuyển map/di chuyển tới điểm đó.
- Hiển thị vị trí nhân vật và điểm farm trên dashboard.
- Sửa các lỗi liên quan được phát hiện trong phiên rà soát trước.

### Đã triển khai

- Thêm `autoMainQuest`, `autoDailyQuest`, `autoCaveQuest` và giữ fallback cho `autoDaily`/`autoCave` cũ.
- Thêm `autoTravelToFarm`, `farmMapId`, `farmKhu`, `farmX`, `farmY`.
- Thêm lệnh client `enterMap()` sử dụng packet `op: "enter"`.
- Điều hướng farm có sai số 3 đơn vị và cooldown 30 giây; khác khu sẽ cảnh báo vì API hiện chưa có lệnh chọn khu.
- Dashboard hiển thị map, khu, tọa độ hiện tại, tọa độ farm và trạng thái đúng/lệch map hoặc điểm.
- Cập nhật cấu hình dạng partial bằng deep merge cho `sellRules`, `minRetain` và `delayRangeMs`.
- Sửa daily check-in: chỉ ghi nhận thành công hoặc đã điểm danh; tự nhận diện lại theo ngày.
- Sửa daily quest: chỉ complete sau khi `seed.start` và `seed.collect` thành công.
- Chống timer cũ của bot chạy tiếp sau chuỗi stop/start.
- Ghi log theo cơ chế debounce và flush database khi shutdown.
- Không phát `proxyUrl` ra public WebSocket snapshot.

### Giới hạn đã biết

- Packet hiện có `enter(mapId)` nhưng chưa có packet chọn `khu`; đổi khu vẫn cần thao tác thủ công.
- Bản đồ dashboard là bản đồ tọa độ minh họa, không phải địa hình game thật.
- Quest chính hiện chỉ thử `quest.turnIn`; chưa có state machine di chuyển, hội thoại và chiến đấu hoàn chỉnh.
- `proxyUrl` đã được loại khỏi snapshot public nhưng luồng kết nối proxy thực tế vẫn cần hoàn thiện/kiểm thử riêng.
- API/WS vẫn cần lớp xác thực và phân quyền độc lập; phiên này chưa mở rộng phạm vi sang hardening toàn hệ thống.

### Kiểm tra

- `pnpm build`: đạt.
- Kiểm tra import runtime workspace package: đạt.
- Chưa có bộ test tự động cho WebSocket/game server; cần bổ sung mock protocol cho các luồng quest và farm.
