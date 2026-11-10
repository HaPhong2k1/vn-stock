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

### API
- `GET /api/health` – trạng thái feed, số mã, phiên
- `GET /api/groups` – danh sách mã theo nhóm
- `GET /api/stock/:sym` – snapshot 1 mã
- `GET /api/indices` – các chỉ số
- `GET /api/history?symbol=FPT&resolution=1D&from=&to=` – nến (1, 5, 15, 30, 1H, 1D, 1W)
- `WS /ws` – gửi `{"op":"sub","syms":["FPT","VNM"]}`; nhận `hello`, `snap`, `q` (thay đổi), `ix` (chỉ số), `status`, `pong`

## ⚠️ Lưu ý pháp lý về nguồn dữ liệu
Các endpoint VPS/DNSE dùng ở đây là API công khai **không chính thức** — phù hợp học tập/cá nhân, có thể đổi
định dạng hoặc chặn bất cứ lúc nào. Muốn chạy thương mại phải dùng nguồn có giấy phép:
SSI FastConnect Data, DNSE Market Data (MQTT), hoặc mua dữ liệu trực tiếp từ HOSE/HNX (qua đơn vị phân phối).
Kiến trúc provider tách riêng (`server/src/providers/`) để thay nguồn mà không sửa phần còn lại.
