# Footprint — hướng dẫn sử dụng & thực chiến

Tham khảo: [Optimus Futures — Footprint Charts](https://optimusfutures.com/blog/footprint-charts/) (bài viết của
một công ty môi giới, các ngưỡng như 300% là ví dụ của bài; phần "quy ước" bên dưới là thông lệ phổ biến, bài không nêu).

## 1. Footprint là gì
Footprint là biểu đồ nến **mở bên trong**: ở mỗi mức giá của nến, hiển thị KL khớp do **bán chủ động** (khớp vào giá
mua – cột trái, *Bid*) và **mua chủ động** (khớp vào giá bán – cột phải, *Ask*). Nhờ vậy thấy được *ai* đẩy giá.

Trên web: bấm **👣 Footprint** trong khung biểu đồ; **⚙** bên cạnh để chỉnh. Phóng to biểu đồ để hiện số.

| Ký hiệu | Ý nghĩa |
|---|---|
| `120k x 340k` | Bán chủ động 120k × Mua chủ động 340k tại mức giá đó |
| Màu nền ô | Xanh = delta dương (mua chủ động áp đảo), đỏ = âm; càng đậm càng mạnh |
| Vạch xanh mép phải / đỏ mép trái, số in đậm | **Imbalance** mua / bán (chéo, ≥ 300%) |
| Khung vàng | **POC** – mức giá KL lớn nhất của nến |
| Dải xanh/đỏ kéo sang phải | **Stacked imbalance** (≥ 3 dòng liên tiếp) – vùng hỗ trợ/kháng cự |
| `UA` | Unfinished auction – cực trị còn cả mua & bán ⇒ giá hay quay lại |
| `EX` | Exhaustion – lực chủ động cạn dần ở cực trị |
| `AB` | Absorption – chủ động rất mạnh ở cực trị nhưng nến đóng ngược lại (bị hấp thụ) |
| `▲Δ` / `▼Δ` | Phân kỳ delta: đáy mới nhưng delta dương / đỉnh mới nhưng delta âm |
| Số dưới nến | Delta nến và tổng KL (`ĐK` = KL khớp định kỳ ATO/ATC, không có bên chủ động) |
| Tab **Delta & CVD** | Cột = delta từng nến, đường vàng = CVD (delta cộng dồn) |

### Cách tính
- Delta (mỗi giá) = Ask − Bid; Delta nến = tổng các dòng; CVD = cộng dồn delta các nến.
- Imbalance mua tại giá *p*: `Ask[p] ≥ tỷ lệ × Bid[p − 1 dòng]`; bán: `Bid[p] ≥ tỷ lệ × Ask[p + 1 dòng]` (so chéo như bài viết).
- Unfinished auction: dòng cao/thấp nhất có cả Bid và Ask > 0 (finished = 0 ở một bên, VD `202 x 0` ở đỉnh).
- Exhaustion (quy ước): KL chủ động ở cực trị ≤ 10% KL lớn nhất cùng chiều trong nến.
- Absorption (quy ước): KL chủ động ở cực trị ≥ 2× KL trung bình/dòng nhưng nến đóng ở nửa ngược lại.

## 2. Đọc một nến trong 4 bước (theo bài viết)
1. **POC** ở đâu? POC ở đỉnh nến tăng = mua đuổi mạnh; POC ở đáy nến tăng = hấp thụ ở đáy rồi bật.
2. **Đỉnh/đáy** là UA hay đã hoàn tất? UA = mục tiêu giá quay lại.
3. **Imbalance / stacked**: chiều nào áp đảo, ở vùng giá nào.
4. **Delta so với giá đóng cửa**: đóng gần đỉnh + delta dương = mua thật; đóng gần đỉnh + delta âm = tăng "rỗng", dễ gãy.

## 3. Thiết lập thực chiến

> Nguyên tắc chung (bài viết nhấn mạnh): footprint là **công cụ xác nhận** tại một **vùng giá đã xác định trước**
> ở khung lớn hơn (đỉnh/đáy phiên trước, POC ngày, Order Block SMC, MA20/MA200...). Không vào lệnh chỉ vì một con số.

### A. Breakout có xác nhận (VN30F1M 5–15 phút, cổ phiếu khung ngày)
- **Bối cảnh:** giá phá kháng cự đã đánh dấu (đỉnh phiên trước, BOS của SMC, đỉnh nền tích luỹ).
- **Xác nhận:** nến phá có **stacked imbalance mua**, **delta dương lớn** (so với các nến trước) và **CVD đi lên**.
- **Vào lệnh:** khi nến xác nhận đóng cửa, hoặc chờ giá **retest vùng stacked** mà không xuất hiện imbalance bán.
- **Cắt lỗ:** dưới dòng thấp nhất của vùng stacked 1–2 bước giá (VN30F: 1–2 điểm).
- **Chốt lời:** UA phía trên, POC/vùng KL lớn kế tiếp, hoặc R:R ≥ 1:2.
- **Loại bỏ:** phá vỡ với KL mỏng, delta phẳng/âm ⇒ bài viết cảnh báo dễ "fail" quay lại vùng cũ.

### B. Hấp thụ (absorption) đảo chiều tại hỗ trợ
- **Bối cảnh:** giá về vùng hỗ trợ (POC ngày trước, Order Block tăng, MA200, đáy phiên trước).
- **Tín hiệu:** nến có `AB` ở đáy (bán chủ động lớn dồn ở đáy nhưng không làm giá giảm tiếp), thường kèm `EX`
  hoặc `▲Δ` (đáy mới nhưng delta dương).
- **Vào lệnh:** chờ nến kế tiếp **delta chuyển dương** hoặc giá vượt đỉnh nến AB.
- **Cắt lỗ:** dưới đáy nến AB. **Chốt lời:** POC phía trên / UA / kháng cự gần nhất.
- Ngược lại ở kháng cự (`AB` ở đỉnh, `▼Δ`) ⇒ chốt lời vị thế mua hoặc mở Short VN30F.

### C. Phân kỳ delta cuối sóng
- Giá lập **đỉnh mới nhưng delta âm** (`▼Δ`) và/hoặc `EX` ở đỉnh ⇒ lực mua cạn: **không mua đuổi**, chốt lời dần.
- Với VN30F: Short khi giá phá đáy của nến phân kỳ, cắt lỗ trên đỉnh nến đó.
- CVD đi xuống trong khi giá đi ngang/tăng ⇒ cảnh báo phân phối.

### D. Unfinished auction làm mục tiêu
- `UA` ở đỉnh/đáy thường được giá quay lại "hoàn tất" ⇒ dùng làm **điểm chốt lời** hoặc điểm chờ vào ngược khi tới nơi.

### E. Cổ phiếu cơ sở — khung Ngày
- **POC ngày** = mức giá được giao dịch nhiều nhất ⇒ hỗ trợ/kháng cự cho các phiên sau.
- **Ngày tăng nhưng delta âm** (đóng cửa xanh, bán chủ động áp đảo) ⇒ khả năng phân phối/kéo xả, thận trọng.
- **Ngày breakout + stacked imbalance mua + delta dương** ⇒ dòng tiền chủ động thật; kết hợp bộ lọc
  *📅 Tuần: giá trên MA200* hoặc *cắt lên MA20* để chọn mã.
- Nhớ **T+2**: tín hiệu bán xuất hiện sớm vẫn phải chờ hàng về.

## 4. Cài đặt gợi ý
| Thị trường | Khung | Dòng (bước giá) | Imbalance | Stacked | KL tối thiểu |
|---|---|---|---|---|---|
| VN30F1M | 5 phút | Tự động (≈ 0,2–0,5 điểm) | 300% | 3 | 20–50 HĐ |
| VN30F1M | 15 phút | 0,5–1 điểm (5–10 tick) | 300% | 3 | 50–100 HĐ |
| VN30F1M | Ngày | Tự động (≈ 2–5 điểm) | 300% | 3 | 500 HĐ |
| Cổ phiếu VN30 | Ngày | Tự động | 300% | 3 | 10.000–50.000 CP |

Bài viết khuyên chọn thị trường **thanh khoản cao** (mã ít giao dịch cho quá ít lệnh mỗi dòng ⇒ imbalance không đáng tin).
Ở Việt Nam nên dùng cho **VN30F1M** và nhóm **VN30 / thanh khoản cao**.

## 5. Sai lầm thường gặp & giới hạn dữ liệu
- Đọc footprint **không có bối cảnh khung lớn** ("chỉ là những con số").
- Giao dịch quanh **tin tức**: một đợt KL đột biến làm méo toàn bộ nến.
- Dùng cho **mã kém thanh khoản**.
- **ATO/ATC** là khớp định kỳ, không có bên chủ động (hiển thị riêng `ĐK`).
- **Dữ liệu trên web này:**
  - Cổ phiếu: từng lệnh khớp thật kèm chiều mua/bán chủ động từ VPS ⇒ chính xác.
  - **VN30F:** socket VPS gửi từng lệnh khớp phái sinh kèm chiều mua/bán chủ động ⇒ chính xác. Chỉ khi mất kết nối
    mới ước lượng từ snapshot 2 giây (suy chiều theo giá chào; tỷ lệ % ước lượng hiện trên biểu đồ). VPS không có danh sách
    lệnh khớp phái sinh trong quá khứ ⇒ chỉ có dữ liệu từ lúc server chạy trong phiên.
  - **Khung Ngày:** VPS chỉ cho dữ liệu phiên gần nhất ⇒ lịch sử footprint ngày được **lưu dần mỗi phiên** (sau 15:05,
    cho VN30, HNX30, top 100 thanh khoản và các mã đã xem). Cần `DATABASE_URL` để không mất khi server khởi động lại.
- Kết quả quá khứ không đảm bảo tương lai; luôn đặt cắt lỗ.
