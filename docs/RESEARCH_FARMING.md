# Nghiên cứu: đổi hạt giống và trồng linh dược (Thảo Dược Cốc)

Cập nhật: 2026-10-13. Nguồn: mã client chính thức ở `vendor/tutien2d-public-client/2026-10-06` (`systems/farm.js`, `systems/quest.js`, `scenes/world.js`, `net/gateway.js`, `world/mapdata.js`, `systems/items.js`), CHỈ ĐỌC. Không chạm game thật. Hiện bot CHƯA có chức năng nào cho việc này.
Nhãn: **[Client]** đọc từ mã client; **[Suy ra]** tính từ dữ liệu client; **[Chưa xác minh]** cần thử live.

## 1. Tổng quan [Client]
Chuỗi: làm việc Dược Công → nhận điểm **Dược Công** → đổi **gói hạt** ở Đại Phu → gieo hạt vào **luống** → (tưới) → hái linh thảo → dùng luyện đan. Điều kiện mở: nhiệm vụ chính tuyến **giai đoạn ≥ 8** (`Quest.canOpenSeedMenu`). Trước đó luống bị khoá ("chưa được chủ vườn gật đầu").

- **Nơi trồng:** map `duoc_vien` "Thảo Dược Cốc" (shared): **10 luống** `plot_1..plot_10` ở ô (3..7, 4) và (3..7, 6). `Farm.PLOT_COUNT = 10`. Mỗi luống chứa tối đa một cây; thu hoạch được **+1 linh thảo** mỗi cây.
- **Đại Phu** ở map `duoc_vien` (NPC `dai_phu`): menu "Mở Quầy Đổi Hạt" và "Nhận Việc Dược Công".
- **Nước:** tưới làm cây chín nhanh hơn rất nhiều. Cần vật phẩm `linh_tuyen_thuy` (mỗi lần tưới tốn 1), HOẶC mở **nguồn nước vĩnh viễn** một lần: ở map `vuon_ca_nhan` (Vườn Cá Nhân), tương tác Hồ Nước (`ho_bich_thuy`) → "Múc nước" (`lake.scoop`) → cờ `ho_bich_thuy_da_muc`; sau đó tưới không tốn vật phẩm.

## 2. Hạt giống và thời gian [Client] (`Farm.SEEDS`)
| Hạt | Cây thu được | Phẩm | Chín khô | Chín khi tưới |
|---|---|---|---|---|
| `hat_linh_diep` | `linh_diep` | Phàm | 5 phút | 1 phút |
| `hat_huyet_thao` | `huyet_thao` | Phàm | 5 phút | 1 phút |
| `hat_thanh_tam` | `thanh_tam_hoa` | Phàm | 5 phút | 1 phút |
| `hat_linh_ngoc` | `linh_ngoc_diep` | Linh | 10 phút | 5 phút |
| `hat_xich_duong` | `xich_duong_thao` | Linh | 10 phút | 5 phút |
| `hat_bich_van` | `bich_van_diep` | Huyền | 15 phút | 8 phút |
| `hat_long_huyet` | `long_huyet_thao` | Huyền | 15 phút | 8 phút |
| `hat_truc_co_thao` | `truc_co_thao` | Địa | 60 phút | 30 phút |
| `hat_dia_linh_qua` | `dia_linh_qua` | Địa | 60 phút | 30 phút |
| `hat_ngu_hanh_thao` | `ngu_hanh_thao` | Địa thượng | 3 giờ | 1,5 giờ |
Tưới chỉ được một lần mỗi cây và chỉ khi chưa chín: nó rút thời gian còn lại theo tỉ lệ (`wet/grow`). Thời gian tính theo đồng hồ thật.

## 3. Đổi hạt: gói hạt [Client] (`Quest.SEED_PACKS`, lệnh `seed.buyPack {packId}`)
| Gói (`packId`) | Giá (Dược Công) | Mở khoá cảnh giới | Nhận |
|---|---|---|---|
| `pham` Gói Hạt Tụ Khí Đan | 2 | không | Linh Diệp x4, Huyết Thảo x4 |
| `linh` Gói Hạt Luyện Khí Đan | 5 | Luyện Khí 4 | Linh Ngọc Diệp x3, Xích Dương Thảo x3 |
| `huyen` Gói Hạt Phá Cảnh Đan | 10 | Luyện Khí 7 | Bích Vân Diệp x3, Long Huyết Thảo x3 |
| `dia` Gói Hạt Trúc Cơ Đan | 20 | Luyện Khí 10 | **Trúc Cơ Thảo x2, Địa Linh Hóa Quả x1** |
| `ngu_hanh` Hạt Ngũ Hành Thảo | 20 | Trúc Cơ 1 | Ngũ Hành Thảo x1, Thanh Tâm Hoa x3 |

## 4. Kiếm Dược Công [Client] (`Quest.seedTaskList`, lệnh `seed.start/collect/complete/...`)
Mỗi việc có trần lượt mỗi ngày (mặc định 3, `SEED_TASK_DAILY_LIMIT`), làm xong về giao Đại Phu:
| Việc | Loại | Dược Công | Kèm Linh Thạch | Trần lượt/ngày |
|---|---|---|---|---|
| Linh Chi dưới chân núi (`linh_chi`) | hái | 1 | 10 | 3 |
| Cá làm dược liệu (`cau_ca`) | câu cá | 4 | 30 | 3 |
| Đưa người về làng (`ho_tong_chau`) | hộ tống | 2 | 25 | 3 |
| Trúc Tâm dẫn dược (`truc_gia`) | hái | 1 | 15 | 3 |
| Thu gom dược mộc (`duoc_moc`) | hái | 3 | 20 | 3 |
| Thắng trận Đại Hội (`dai_hoi`) | đấu | 10 | 100 | 1 |
[Suy ra] Tối đa mỗi ngày **43 Dược Công** nếu làm đủ mọi lượt (3×(1+4+2+1+3) + 10). Mỗi lần chỉ có một việc đang làm (`hasActiveSeedQuest`). Năm việc đầu trùng với các việc hằng ngày mà bot ĐÃ có (`docs/PROMPT_DAILY_*.md`), riêng "Thắng trận Đại Hội" thì bot chưa làm.

## 5. Lệnh game liên quan [Client] (`net/gateway.js`)
`farm.sow {plot, seed}`, `farm.water {plot}`, `farm.harvest {plot}`, `seed.buyPack {packId}`, `seed.start {taskId}`, `seed.collect {propId}`, `seed.complete`, `seed.escortComplete`, `seed.cancel`, `lake.scoop`. Máy chủ là nơi quyết định (client gửi lệnh qua `Gateway.cmd`, cập nhật theo phản hồi). [Chưa xác minh] hình dạng thật của ACK, lý do từ chối (`why`), việc luống là riêng từng người chơi hay dùng chung trên map shared.

## 6. Giá trị thực tế [Suy ra]
- Mỗi gói `dia` (20 Dược Công) chỉ cho 2 hạt Trúc Cơ Thảo và 1 hạt Địa Linh Hóa Quả, mỗi hạt ra 1 cây. Trúc Cơ Đan cần 50 Trúc Cơ Thảo + 30 Địa Linh Hóa Quả (xem `docs/RESEARCH_HUYET_XICH.md`): từ vườn thuần tuý cần ~30 gói = 600 Dược Công = hơn 14 ngày làm đủ mọi việc. Huyết Xích (12 thảo + 5 quả mỗi lượt, tối đa 5 lượt/ngày) bổ sung, nên vườn là nguồn phụ chứ không thay được.
- Gói `pham` (2 Dược Công) đổi nhiều hạt nhất theo điểm, hợp cho đan cấp thấp.
- 10 luống, hạt Địa chín 60 phút (30 phút nếu tưới): thông lượng tối đa ~10 cây/giờ khô, đủ cho lượng hạt có được từ Dược Công; luống không phải điểm nghẽn.

## 7. Bot đã có và còn thiếu
Có: đăng nhập, di chuyển giữa map (qua cổng), việc hằng ngày cho 5 việc Dược Công, đọc túi đồ (có `Inventory.count`).
Thiếu: nhận/giao việc Dược Công qua Đại Phu (kiểm tra bot đã xử lý bước nhận việc/giao việc chưa), `seed.buyPack`, `farm.sow`/`water`/`harvest`, `lake.scoop`, đồng hồ theo từng luống (thời gian chín), theo dõi trạng thái luống từ gói máy chủ.

## 8. Đề xuất lộ trình (chưa làm)
1. **Chỉ đọc:** hiển thị trên dashboard Dược Công đang có, trạng thái 10 luống (trống/đang lớn/chín, còn bao lâu), hạt trong túi. Cần xác định gói máy chủ nào mang trạng thái luống (chưa biết).
2. **Đổi hạt:** nút "Đổi gói hạt" (xác nhận hai bước; chọn gói; kiểm điều kiện cảnh giới và điểm) qua `seed.buyPack`.
3. **Trồng:** "Gieo/tưới/thu hoạch tất cả" tuần tự, mỗi lệnh chờ ACK, không retry mù; chỉ khi ở đúng map `duoc_vien`, bot đứng đủ gần luống, và không có `hurt`.
4. **Mở nước vĩnh viễn:** một lần ở Vườn Cá Nhân (`lake.scoop`).
5. Tự động theo lịch: gieo → tưới → chờ → thu → gieo lại, giữ ranh giới an toàn (`hurtCount`, một phiên mỗi tài khoản).
Mỗi bước cần thử live với một tài khoản, có người giám sát, ghi gói tin đã che dữ liệu.

## 9. Cần xác minh live
Hình dạng ACK của `seed.*`/`farm.*`; luống riêng hay chung; khoảng cách tối thiểu tới luống/Đại Phu/Hồ Nước; giới hạn tần suất lệnh; giờ đổi ngày của trần lượt Dược Công (client dùng giờ Việt Nam); `Quest.stage ≥ 8` của tài khoản thật.

## 10. Đối chiếu trước triển khai dashboard — 2026-10-13

- **[Client] Nguồn đọc:** `Farm.state` được khởi tạo trong `systems/farm.js`; `Farm.load(t.farm)` được gọi trong `Quest.load()` khi nạp save. Gateway xử lý gói `state` có `save` bằng `Utils.store.set(PROGRESS_KEY, t.save)` rồi gọi `Quest.load()`. `Progress.duocCong` được nạp từ `state.save.duocCong`; `Quest.save()` serialize `duocCong`, túi và các tiến độ. Client source cho thấy cập nhật qua gói `state` là đường đồng bộ; chưa xác minh live server luôn gửi `state` sau từng lệnh vườn/đổi gói hay cấu trúc ACK cụ thể.
- **[Client] Gửi lệnh:** `farm.sow`, `farm.harvest`, `farm.water`, `Quest.buySeedPack` được Gateway bọc bằng `we(...)`. Hàm gốc thay đổi state/túi/điểm đồng bộ trước, wrapper mới gửi `Gateway.cmd(...)`. Headless nên gửi `Gateway.cmd` trực tiếp qua hàm runner ACK (ghép `rid` + `cmd`) để không áp dụng cục bộ thêm lần nữa và có thể chờ đúng ACK. Sau ACK phải đọc lại state/túi/điểm đồng bộ; nếu số lượng hoặc Dược Công không đổi đúng như mong đợi thì dừng `GARDEN_COUNT_MISMATCH`. Không tự hoàn tác dữ liệu cục bộ: save có thể đã được server xác nhận/ghi lại và một rollback dự đoán có nguy cơ lệch thêm; cần chờ state authoritative hoặc dừng để người dùng làm mới.
- **[Client] Khoảng cách:** nhánh `herb_plot` dùng kiểm tra tương tác trong bán kính `r:34`; 10 props `plot_1..plot_10` của `duoc_vien` nằm ở ô (3..7,4) và (3..7,6). Tâm ô tính `tx*32+16, ty*32+16`. Prop NPC `dai_phu` nằm ở ô (14,8), bán kính tương tác `r:48`. Thao tác headless đi tới trước khi gửi lệnh: luống trong ≤26 px, Đại Phu ≤38 px (chừa biên lần lượt 8/10 px). Vị trí prop được đọc từ `P.MapData.get('duoc_vien')` nếu có; fallback tọa độ lấy từ `world/mapdata.js`, chỉ dùng cho map `duoc_vien`. Nếu nhân vật đã trong ngưỡng thì không gọi walk. Mọi lệnh dùng `WalkNavigator` và `abortOnHurt`; sau walk, checkpoint sát trước khi gửi kiểm tra down/Auto/hurt/huỷ/kết nối. Máy chủ có kiểm tra khoảng cách hay không vẫn **chưa xác minh live**.
- **[Chưa xác minh live]:** ACK thật của `farm.*`/`seed.buyPack`, lý do từ chối; có phát `state` cập nhật sau mỗi lệnh hay không; luống cá nhân hay dùng chung; khoảng cách server; giới hạn tần suất; stage của tài khoản thật. Không gửi lệnh thử trên game thật trong giai đoạn này.

## 11. Tình trạng tính năng

Đổi gói, gieo, đếm ngược, thu hoạch, tưới các luống đang lớn và múc nguồn nước vĩnh viễn đã được nối vào thao tác vườn tuần tự. Tưới chỉ chọn luống `growing` chưa tưới; khi chưa có cờ `ho_bich_thuy_da_muc`, hậu kiểm cần trừ đúng một `linh_tuyen_thuy`. Múc nước dùng `lake.scoop` một lần tại `vuon_ca_nhan`, hậu kiểm cờ nguồn. Các điều kiện này đọc từ client code; ACK/state authoritative, khoảng cách server và hành vi thật vẫn **chưa xác minh live**. Kết quả build/test thật được ghi ở đầu `docs/SESSION_LOG.md`.

## 12. Thao tác tưới và múc nước trên dashboard — 2026-10-13

- Luống ở `duoc_vien`; `Farm.canWater` yêu cầu luống có cây, chưa tưới và chưa chín. Nguồn tưới là cờ vĩnh viễn `ho_bich_thuy_da_muc` hoặc một `linh_tuyen_thuy` cho mỗi lần tưới.
- Ao `ho_bich_thuy` nằm ở `vuon_ca_nhan` ô (12,4), bán kính client 48 px. Server operation đi tới bán kính an toàn trong cùng map; không tự chuyển bản đồ.
- Các lệnh được thực hiện tuần tự qua ACK, không retry, hủy khi down/reconnect/Auto/hurt/stop và hậu kiểm `watered`/`remainSec`, số Linh Tuyền Thủy hoặc cờ nguồn.
- ACK, khoảng cách máy chủ, nguồn nước và state sau lệnh trên server thật **chưa xác minh live**.
