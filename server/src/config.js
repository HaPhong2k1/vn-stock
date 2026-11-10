// Cấu hình qua biến môi trường
export const config = {
  port: Number(process.env.PORT || 8080),
  // vps = dữ liệu thật (VPS public feed), sim = giả lập để demo ngoài giờ giao dịch
  provider: process.env.PROVIDER || 'vps',
  // Chu kỳ gom thay đổi gửi xuống client (ms). Nhỏ hơn = nhanh hơn, tốn băng thông hơn.
  flushMs: Number(process.env.FLUSH_MS || 100),
  // Chu kỳ đối soát lại toàn bộ snapshot từ REST (ms) để chống lệch dữ liệu
  resyncMs: Number(process.env.RESYNC_MS || 60_000),
  // Socket không có message quá thời gian này trong giờ giao dịch => reconnect
  staleMs: Number(process.env.STALE_MS || 30_000),
  // VPS trả khối lượng theo đơn vị 10 cổ phiếu
  volMult: Number(process.env.VOL_MULT || 10),
  vps: {
    rest: 'https://bgapidatafeed.vps.com.vn',
    socket: 'https://bgdatafeed.vps.com.vn',
  },
  historyApi: 'https://services.entrade.com.vn/chart-api/v2/ohlcs',
};
