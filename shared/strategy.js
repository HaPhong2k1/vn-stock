// Chiến lược "EMA cross" + backtest (lấy ý tưởng từ "BUY and SELL - Backtest single EMA cross" của che_trader).
// Viết lại độc lập bằng JS, thêm phí/thuế và quy tắc T+2 của thị trường Việt Nam.

/** EMA kiểu TradingView (ta.ema): khởi tạo bằng giá trị nguồn đầu tiên */
export function emaTV(values, length) {
  const a = 2 / (length + 1);
  const out = new Array(values.length);
  for (let i = 0; i < values.length; i++) out[i] = i === 0 ? values[0] : a * values[i] + (1 - a) * out[i - 1];
  return out;
}

export const BT_DEFAULTS = {
  fast: 10, slow: 20,
  mode: 'long',          // 'long' = chỉ mua (thị trường cơ sở VN không cho bán khống) | 'longshort' như bản gốc
  capital: 100_000_000,  // vốn ban đầu (đồng)
  feeBuy: 0.15, feeSell: 0.15, taxSell: 0.1, // %
  lot: 100,
  tPlus: 2,              // T+2: chỉ bán được sau 2 phiên kể từ ngày mua (0 = bỏ qua)
  start: 0, end: Infinity, // giới hạn thời gian backtest (epoch giây)
};

const vnDay = (t) => Math.floor((t + 7 * 3600) / 86400);

/**
 * Tín hiệu: BUY khi EMA nhanh cắt lên EMA chậm, SELL khi cắt xuống (tính trên giá đóng cửa nến).
 * Lệnh khớp ở giá MỞ CỬA nến kế tiếp (giống mặc định của TradingView strategy).
 * @param {{time:number, open:number, high:number, low:number, close:number}[]} bars (giá: nghìn đồng)
 */
export function backtestEmaCross(bars, opts = {}) {
  const o = { ...BT_DEFAULTS, ...opts };
  const close = bars.map((b) => b.close);
  const ef = emaTV(close, o.fast), es = emaTV(close, o.slow);
  const signals = [];
  for (let i = 1; i < bars.length; i++) {
    if (ef[i] > es[i] && ef[i - 1] <= es[i - 1]) signals.push({ i, side: 'BUY', time: bars[i].time, price: bars[i].close });
    else if (ef[i] < es[i] && ef[i - 1] >= es[i - 1]) signals.push({ i, side: 'SELL', time: bars[i].time, price: bars[i].close });
  }

  // chỉ số phiên giao dịch (ngày) cho từng nến => dùng cho quy tắc T+2 ở mọi khung thời gian
  const dayIdx = []; let d = -1, prevDay = null;
  for (const b of bars) { const k = vnDay(b.time); if (k !== prevDay) { d++; prevDay = k; } dayIdx.push(d); }

  let cash = o.capital, pos = null; // pos: {side, qty, entryPrice, entryIndex, entryTime, cost}
  const trades = [];
  const equity = [];
  let pendingExit = null; // lệnh bán bị hoãn do T+2
  const sigAt = new Map(signals.map((s) => [s.i, s.side]));
  const inPeriod = (t) => t >= o.start && t <= o.end;
  const px = (p) => p * 1000; // nghìn đồng -> đồng

  const sellRate = 1 - (o.feeSell + o.taxSell) / 100, buyRate = 1 + o.feeBuy / 100;
  // LONG: mua bằng tiền mặt. SHORT (chỉ chế độ longshort): nhận tiền bán, nợ lại cổ phiếu.
  const open = (side, i) => {
    const price = px(bars[i].open);
    const qty = Math.floor(cash / (price * buyRate) / o.lot) * o.lot;
    if (qty <= 0) return;
    if (side === 'LONG') { const cost = qty * price * buyRate; cash -= cost; pos = { side, qty, entryPrice: bars[i].open, entryIndex: i, entryTime: bars[i].time, cost }; }
    else { const proceeds = qty * price * sellRate; cash += proceeds; pos = { side, qty, entryPrice: bars[i].open, entryIndex: i, entryTime: bars[i].time, cost: qty * price, proceeds }; }
  };
  const closePos = (i, price, reason) => {
    let pnl;
    if (pos.side === 'LONG') { const proceeds = pos.qty * px(price) * sellRate; cash += proceeds; pnl = proceeds - pos.cost; }
    else { const buyBack = pos.qty * px(price) * buyRate; cash -= buyBack; pnl = pos.proceeds - buyBack; }
    trades.push({ side: pos.side, qty: pos.qty, entryTime: pos.entryTime, entryPrice: pos.entryPrice, exitTime: bars[i].time, exitPrice: price, pnl, pnlPct: (pnl / pos.cost) * 100, bars: i - pos.entryIndex, reason });
    pos = null;
  };

  for (let i = 0; i < bars.length; i++) {
    // 1) Thực hiện lệnh từ tín hiệu của nến trước (khớp giá mở cửa nến này)
    const sig = sigAt.get(i - 1);
    const t = bars[i].time;
    const canSell = () => !pos || pos.side !== 'LONG' || !o.tPlus || dayIdx[i] - dayIdx[pos.entryIndex] >= o.tPlus;

    if (pendingExit && pos && canSell()) { closePos(i, bars[i].open, 'SELL (hoãn T+2)'); pendingExit = null; }
    if (sig && inPeriod(bars[i - 1].time)) {
      if (sig === 'BUY') {
        pendingExit = null;
        if (pos?.side === 'SHORT') closePos(i, bars[i].open, 'BUY');
        if (!pos) open('LONG', i);
      } else if (sig === 'SELL') {
        if (pos?.side === 'LONG') {
          if (canSell()) closePos(i, bars[i].open, 'SELL'); else pendingExit = true;
        }
        if (!pos && o.mode === 'longshort') open('SHORT', i);
      }
    }
    // 2) Giá trị tài khoản theo giá đóng cửa
    let eq = cash;
    if (pos?.side === 'LONG') eq += pos.qty * px(bars[i].close) * sellRate;
    if (pos?.side === 'SHORT') eq -= pos.qty * px(bars[i].close) * buyRate;
    equity.push({ time: t, value: eq });
  }
  const openTrade = pos ? { ...pos, lastPrice: bars[bars.length - 1].close } : null;

  // Thống kê
  const closed = trades;
  const wins = closed.filter((x) => x.pnl > 0);
  const grossWin = wins.reduce((a, x) => a + x.pnl, 0);
  const grossLoss = -closed.filter((x) => x.pnl <= 0).reduce((a, x) => a + x.pnl, 0);
  let peak = o.capital, maxDD = 0;
  for (const e of equity) { peak = Math.max(peak, e.value); maxDD = Math.max(maxDD, (peak - e.value) / peak); }
  const final = equity.length ? equity[equity.length - 1].value : o.capital;
  const firstIn = bars.findIndex((b) => inPeriod(b.time));
  const bh = firstIn >= 0 && bars.length ? (bars[bars.length - 1].close / bars[firstIn].open - 1) * 100 : 0;
  return {
    emaFast: ef, emaSlow: es, signals, trades, equity, openTrade,
    stats: {
      trades: closed.length, winRate: closed.length ? (wins.length / closed.length) * 100 : 0,
      netProfit: final - o.capital, netProfitPct: ((final - o.capital) / o.capital) * 100,
      profitFactor: grossLoss ? grossWin / grossLoss : (grossWin ? Infinity : 0),
      maxDrawdownPct: maxDD * 100, buyHoldPct: bh,
      avgTradePct: closed.length ? closed.reduce((a, x) => a + x.pnlPct, 0) / closed.length : 0,
    },
  };
}
