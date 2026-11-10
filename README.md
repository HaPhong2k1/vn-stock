# VN Stock Realtime — Bảng giá chứng khoán Việt Nam

Bảng giá realtime HOSE / HNX / UPCOM (~1.500 mã), chỉ số VN-INDEX, VN30, HNX, HNX30, UPCOM,
biểu đồ nến cập nhật theo từng lệnh khớp, sổ lệnh 3 bước giá, giao dịch khối ngoại, danh mục theo dõi.

## Chạy nhanh

```bash
npm run install:all
npm run build          # build frontend vào web/dist
npm start              # http://localhost:8080 (dữ liệu thật)
npm run start:sim      # chế độ giả lập: lấy snapshot thật rồi sinh lệnh khớp ngẫu nhiên (demo ngoài giờ)
```

Phát triển: `npm run dev:server` + `npm run dev:web` (Vite ở http://localhost:5173, proxy `/api` và `/ws`).

## Tính năng phân tích

### Bộ lọc cổ phiếu (tab 🔎)
Quét toàn bộ ~1.500 mã, cập nhật 3 giây/lần. Bộ lọc có sẵn (kết hợp được nhiều cái): **Cắt lên MA20 (MUA)**,
cắt xuống MA20, trên MA20, xu hướng tăng (giá > MA20 > MA50 > MA200), RSI < 30 / > 70, KL đột biến ≥ 2× TB20,
MACD cắt lên, EMA9 cắt EMA21, Golden cross, chạm Bollinger dưới, đỉnh 52 tuần. Lọc thêm theo sàn, GTGD, KL TB20.

**Tín hiệu MUA "giá cắt lên MA20"** (nến ngày):
`đóng cửa phiên trước ≤ MA20 phiên trước` **và** `giá khớp hiện tại > MA20 hôm nay`,
với MA20 hôm nay = (19 giá đóng cửa trước + giá khớp hiện tại) / 20. Trong phiên tín hiệu có thể bật/tắt khi giá
dao động quanh MA20; chỉ xác nhận khi đóng cửa.

### Cảnh báo (tab 🔔)
Kiểm tra trên **server** theo từng lệnh khớp (vẫn chạy khi đóng trình duyệt). Loại: giá ≥/≤, % thay đổi, tổng KL,
KL/TB20, RSI ≥/≤, **giá cắt lên MA20**, cắt xuống MA20, MACD cắt lên. Thông báo: toast + thông báo trình duyệt
+ tiếng bíp, và Telegram (đặt `TELEGRAM_BOT_TOKEN` trên server, nhập chat ID khi tạo cảnh báo).
Chống nhiễu: mỗi cảnh báo cách nhau tối thiểu `ALERT_COOLDOWN_MS` (mặc định 15 phút); tín hiệu trùng bị gộp trong `SIGNAL_DEDUPE_MS`.
Cảnh báo gắn với ID ẩn danh của trình duyệt (chưa có đăng nhập).

### Biểu đồ chỉ báo
MA20, MA50, Bollinger(20,2), RSI(14), MACD(12,26,9), mũi tên MUA/BÁN tại các điểm giá đóng cửa cắt MA20; nến cuối và
chỉ báo cập nhật realtime. Nút tạo cảnh báo nhanh ngay trong khung chi tiết mã.

Mã nguồn chỉ báo dùng chung server/web: `shared/indicators.js` (kiểm thử: `npm test`).

## Kiến trúc

```
 VPS socket.io (push từng lệnh khớp/sổ lệnh/chỉ số) ──┐
 VPS REST snapshot (đối soát 60s + sau reconnect) ────┼─► MarketStore (server, nguồn sự thật)
 DNSE REST (nến lịch sử, cache 30s) ──────────────────┘        │  seq tăng dần mỗi thay đổi
                                                               ▼
                                         WS hub /ws: gom thay đổi mỗi 100ms, chỉ gửi mã client đăng ký
                                                               ▼
                         React: kho dữ liệu ngoài React, mỗi dòng tự subscribe mã của mình,
                         bảng ảo hoá, nháy màu khi đổi, nến cuối cập nhật realtime
```

### Các cơ chế đảm bảo độ chính xác
| Rủi ro | Cách xử lý |
|---|---|
| Mất message khi rớt kết nối nguồn | Sau mỗi lần (re)connect tự tải lại toàn bộ snapshot REST |
| Lệch dần do message lỗi/thiếu | Đối soát snapshot định kỳ (`RESYNC_MS`, mặc định 60s) trong giờ giao dịch |
| Snapshot cũ ghi đè dữ liệu socket mới | Bỏ snapshot nếu tổng KL nhỏ hơn dữ liệu hiện có |
| Socket "treo" (còn kết nối nhưng không có dữ liệu) | Watchdog: im lặng > `STALE_MS` (30s) trong giờ GD → kết nối lại |
| Đảo thứ tự gói tin tới client | Mỗi bản ghi có `seq`; client bỏ bản có seq cũ |
| Client rớt mạng | Tự reconnect (backoff) → đăng ký lại → nhận snapshot mới |
| Nghẽn client chậm | Gom theo lô, chỉ trạng thái mới nhất; bỏ gửi khi buffer > 4MB (client sẽ nhận lại ở lô sau) |
| +/- và % không khớp giá | Server tự tính lại từ giá khớp và tham chiếu |

### Biến môi trường (server)
| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `PORT` | 8080 | Cổng HTTP/WS |
| `PROVIDER` | `vps` | `vps` (thật) hoặc `sim` (giả lập) |
| `FLUSH_MS` | 100 | Chu kỳ đẩy dữ liệu xuống trình duyệt |
| `RESYNC_MS` | 60000 | Chu kỳ đối soát snapshot |
| `STALE_MS` | 30000 | Ngưỡng coi feed bị treo |
| `VOL_MULT` | 10 | VPS trả KL theo lô 10 CP |
| `ALERT_COOLDOWN_MS` | 900000 | Khoảng cách tối thiểu giữa 2 lần báo của 1 cảnh báo |
| `SIGNAL_DEDUPE_MS` | 900000 | Gộp tín hiệu trùng mã/loại |
| `TELEGRAM_BOT_TOKEN` | — | Bật gửi cảnh báo qua Telegram |

### API
- `GET /api/health` – trạng thái feed, số mã, phiên
- `GET /api/groups` – danh sách mã theo nhóm
- `GET /api/stock/:sym` – snapshot 1 mã
- `GET /api/indices` – các chỉ số
- `GET /api/history?symbol=FPT&resolution=1D&from=&to=` – nến (1, 5, 15, 30, 1H, 1D, 1W)
- `GET /api/screener` – chỉ báo + tín hiệu của toàn thị trường
- `GET /api/signals` – nhật ký tín hiệu trong ngày
- `GET/POST /api/alerts`, `PATCH/DELETE /api/alerts/:id`, `GET /api/alerts/history` (header `x-client-id`)
- `WS /ws` – gửi `{"op":"sub","syms":["FPT","VNM"]}`; nhận `hello`, `snap`, `q` (thay đổi), `ix` (chỉ số), `status`, `pong`

## ⚠️ Lưu ý pháp lý về nguồn dữ liệu
Các endpoint VPS/DNSE dùng ở đây là API công khai **không chính thức** — phù hợp học tập/cá nhân, có thể đổi
định dạng hoặc chặn bất cứ lúc nào. Muốn chạy thương mại phải dùng nguồn có giấy phép:
SSI FastConnect Data, DNSE Market Data (MQTT), hoặc mua dữ liệu trực tiếp từ HOSE/HNX (qua đơn vị phân phối).
Kiến trúc provider tách riêng (`server/src/providers/`) để thay nguồn mà không sửa phần còn lại.
