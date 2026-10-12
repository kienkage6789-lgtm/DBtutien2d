# Nghiên cứu chức năng Tổ đội (party / "PT")

Cập nhật: 2026-10-12. Nguồn: mã client chính thức ở `vendor/tutien2d-public-client/2026-10-06` (`net/gateway.js`, `ui/hud.js`, `scenes/world.js`, `core/config.js`), CHỈ ĐỌC. Không chạm game thật. Repo hiện CHƯA có mã nào xử lý tổ đội (không có trong `apps/server`, `packages/*`, `apps/web`).

Nhãn: **[Client]** đọc từ mã client; **[Chưa xác minh]** cần thử live.

## 1. Luật [Client]
- Tối đa **6 người** (`CONFIG.PARTY.MAX_MEMBERS`). Mời trong tầm **180 px** (`INVITE_RANGE`). Lời mời hết hạn sau **30 s** (`INVITE_TTL_MS`). Giãn cách mời **1,5 s** (`INVITE_COOLDOWN_MS`). Đồng bộ chỉ số thành viên mỗi 250 ms (`VITAL_SYNC_MS`).
- Chỉ để cùng vào Bí Cảnh: lời mời ghi rõ "không chia ké Đạo Hạnh hay chiến lợi phẩm".
- Không mời được khi: đã cùng tổ đội, tổ đội đã 6/6, Bí Cảnh đang mở (`activeRunId`), đứng xa quá 180 px. Khi Bí Cảnh đang mở thì không rời, nhường đội trưởng hay đuổi người được (nút bị khoá ở UI; máy chủ có kiểm lại không là chưa xác minh).

## 2. Lệnh client gửi [Client]
Tất cả là `{op:"party", act, ...}` qua `partySend`, chỉ các khoá `targetId | memberId | inviteId | dungeonId | propId | itemId` được gắn thêm:

| Hành động | `act` | Tham số | Ghi chú |
|---|---|---|---|
| Mời | `invite` | `targetId` | mời người chơi ở gần |
| Chấp nhận / từ chối | `accept` / `decline` | `inviteId` | quá hạn thì client tự huỷ, không gửi |
| Rời | `leave` | — | |
| Đuổi | `kick` | `memberId` | chỉ đội trưởng |
| Nhường đội trưởng | `promote` | `memberId` | chỉ đội trưởng |
| Vào phó bản | `enter_dungeon` | `dungeonId` | đội trưởng; xem `docs/RESEARCH_HUYET_XICH.md` |

## 3. Gói máy chủ gửi về (`op:"party"`, trường `act`) [Client]
- `invite {inviteId, fromId, fromName, expiresAt}`: nhận lời mời.
- `state {partyId, leaderId, revision, maxMembers, activeRunId?, members:[{id, name, order, online, downed, mapId, hp}]}`: trạng thái tổ đội. Client bỏ qua gói có `revision` cũ hơn gói đang giữ. `hp` ở đây là chỉ số thành viên, KHÔNG dùng thay vitals của mình (quy tắc dự án: HP người khác là phần trăm).
- `clear {why}`: rời/giải tán (`kicked`, `offline`, `solo_end`, ...).
- `sent`, `joined`, `declined`, `expired {why}`, `invite_closed {inviteId, why}`, `deny {why}` (lý do từ chối bằng chữ).
- `dungeon_closed {why: expired|collapsed|yl_thua|yl_sup}`, `huyet_state`, `huyet_thu`, `huyet_thu_huy`, `huyet_notice {text}`.
- Các `act` bắt đầu bằng `yl_` thuộc phó bản Yên Lang, không phải tổ đội thường.

## 4. Điều bot đã có và còn thiếu
Hiện KHÔNG có: tuần tự hoá `state` thành dữ liệu runtime, API/giao diện cho lời mời, bộ điều phối nhiều tài khoản. Client vendor đã có sẵn `Gateway.party`, `partyInvite`, `partyAnswer`, `partyLeave`, `partyKick`, `partyPromote`, `partyEnterDungeon`, `partyIsLeader`, `partyMember`; runner vendor có thể gọi các hàm này nên không cần dựng lại giao thức.

## 5. Việc nên làm theo thứ tự (chưa làm)
1. **Chỉ đọc**: đưa `Gateway.party` (tên, `online`, `downed`, `mapId`, `leaderId`, `activeRunId`) vào API chỉ đọc/dashboard cho chủ tài khoản. Không gửi lệnh.
2. **Nhận lời mời giữa các tài khoản của chủ dự án**: API nhận (`accept`) lời mời từ danh sách `partyPending` chỉ khi người mời thuộc cùng chủ sở hữu (tránh nhận lời mời của người lạ).
3. **Mời**: chỉ mời tài khoản của chính mình, kiểm khoảng cách < 180 px và giãn cách 1,5 s; không retry mù.
4. Rời/nhường đội trưởng/đuổi: sau cùng, kèm xác nhận hai bước trên giao diện.

## 6. Cần xác minh live (chưa xác minh)
- Hình dạng thật của gói `state`, nhất là `hp` và `order`.
- Máy chủ có chặn `leave/kick/promote` khi Bí Cảnh đang mở không (UI chặn, server chưa rõ).
- Hai tài khoản cùng chủ, cùng IP/khác proxy có bị hạn chế mời nhau không.
- Đội trưởng đổi giữa chừng, tài khoản offline: `clear {why:"offline"}` có xoá cả đội không.
