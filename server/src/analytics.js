import { EventEmitter } from 'node:events';
import { sma, ema, rsi, macd, bollinger } from '../../shared/indicators.js';
import { todayStarted, vnDate } from './daily.js';
import { isTradingActive } from './market-hours.js';

const SIGNAL_DEDUPE_MS = Number(process.env.SIGNAL_DEDUPE_MS || 15 * 60_000);
const r2 = (v) => (v === null || v === undefined || !Number.isFinite(v) ? null : +v.toFixed(2));

/**
 * Tính chỉ báo cho từng mã = nến ngày lịch sử + nến "hôm nay" lấy từ giá realtime.
 * Ví dụ MA20 hôm nay = (19 giá đóng cửa trước + giá khớp hiện tại) / 20.
 * Phát sự kiện 'signal' khi trạng thái chuyển (VD: giá từ dưới MA20 vượt lên trên MA20).
 */
export class Analytics extends EventEmitter {
  constructor(store, daily, log = console) {
    super();
    this.store = store; this.daily = daily; this.log = log;
    this.metrics = new Map();
    this.dirty = new Set();
    this.signals = []; // nhật ký tín hiệu trong ngày
    this.signalDay = vnDate();
    store.on('stock', (st) => this.dirty.add(st.s));
    daily.onUpdate(() => { for (const s of store.stocks.keys()) this.dirty.add(s); });
    setInterval(() => this.flush(), 500);
  }

  flush() {
    if (vnDate() !== this.signalDay) { this.signals = []; this.signalDay = vnDate(); }
    if (!this.dirty.size) return;
    const list = [...this.dirty]; this.dirty.clear();
    for (const s of list) this.compute(s);
    this.emit('batch', list);
  }

  compute(sym) {
    const st = this.store.stocks.get(sym);
    const h = this.daily.bars.get(sym);
    if (!st || !h || h.c.length < 2) return;
    const live = todayStarted() && st.last > 0;
    const closes = live ? [...h.c, st.last] : h.c;
    const vols = live ? [...h.v, st.totVol] : h.v;
    const n = closes.length - 1;
    const ma20 = sma(closes, 20), ma50 = sma(closes, 50), ma200 = sma(closes, 200);
    const e9 = ema(closes, 9), e21 = ema(closes, 21);
    const rs = rsi(closes, 14);
    const md = macd(closes);
    const bb = bollinger(closes, 20, 2);
    const histVol = h.v.slice(-20);
    const avgVol20 = histVol.length ? histVol.reduce((a, b) => a + b, 0) / histVol.length : 0;
    const price = closes[n];
    const prevClose = closes[n - 1];
    const hi52 = Math.max(...h.h.slice(-250), live ? st.high || st.last : 0);
    const lo52 = Math.min(...h.l.slice(-250).filter((x) => x > 0), live && st.low ? st.low : Infinity);

    const m = {
      s: sym, ex: st.ex, price, chgPc: st.chgPc, totVol: st.totVol, value: st.avg * st.totVol / 1e6, // tỷ đồng
      ma20: r2(ma20[n]), ma50: r2(ma50[n]), ma200: r2(ma200[n]), ema9: r2(e9[n]), ema21: r2(e21[n]),
      rsi14: r2(rs[n]), macd: r2(md.line[n]), macdSig: r2(md.signal[n]), macdHist: r2(md.hist[n]),
      bbUp: r2(bb.upper[n]), bbLow: r2(bb.lower[n]),
      avgVol20: Math.round(avgVol20), volRatio: avgVol20 ? r2(vols[n] / avgVol20) : null,
      hi52: r2(hi52), lo52: r2(lo52 === Infinity ? null : lo52),
      distMa20: ma20[n] ? r2(((price - ma20[n]) / ma20[n]) * 100) : null,
      live,
      // --- Tín hiệu (theo nến ngày, phiên hiện tại so với phiên trước) ---
      aboveMa20: ma20[n] !== null && price > ma20[n],
      ma20CrossUp: ma20[n] !== null && ma20[n - 1] !== null && prevClose <= ma20[n - 1] && price > ma20[n],
      ma20CrossDown: ma20[n] !== null && ma20[n - 1] !== null && prevClose >= ma20[n - 1] && price < ma20[n],
      macdCrossUp: md.hist[n] !== null && md.hist[n - 1] !== null && md.hist[n - 1] <= 0 && md.hist[n] > 0,
      ema9CrossUp: e9[n] !== null && e9[n - 1] !== null && e9[n - 1] <= e21[n - 1] && e9[n] > e21[n],
      goldenCross: ma50[n] !== null && ma200[n - 1] !== null && ma50[n - 1] <= ma200[n - 1] && ma50[n] > ma200[n],
      u: Date.now(),
    };
    const prev = this.metrics.get(sym);
    this.metrics.set(sym, m);

    // Tín hiệu realtime: phát khi trạng thái chuyển trong giờ giao dịch
    if (prev && prev.live && m.live && (isTradingActive() || process.env.PROVIDER === 'sim')) {
      if (!prev.aboveMa20 && m.aboveMa20) this.pushSignal('MA20_CROSS_UP', m);
      if (prev.aboveMa20 && !m.aboveMa20) this.pushSignal('MA20_CROSS_DOWN', m);
      if (!prev.macdCrossUp && m.macdCrossUp) this.pushSignal('MACD_CROSS_UP', m);
    }
    this.emit('metrics', m, prev);
  }

  pushSignal(type, m) {
    // Bỏ tín hiệu trùng (cùng mã, cùng loại) trong 15 phút để tránh nhiễu khi giá dao động quanh MA20
    const key = `${m.s}:${type}`;
    this.lastSig ??= new Map();
    if (Date.now() - (this.lastSig.get(key) || 0) < SIGNAL_DEDUPE_MS) return;
    this.lastSig.set(key, Date.now());
    const sig = { id: `${m.s}-${type}-${Date.now()}`, type, s: m.s, price: m.price, ma20: m.ma20, rsi14: m.rsi14, volRatio: m.volRatio, at: Date.now() };
    this.signals.unshift(sig);
    if (this.signals.length > 500) this.signals.pop();
    this.emit('signal', sig);
  }

  rows() { return [...this.metrics.values()]; }
}
