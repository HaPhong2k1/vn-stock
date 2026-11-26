import { config } from './config.js';
import { todayStarted, vnDate } from './daily.js';

/**
 * Nến cho biểu đồ — chính xác & realtime.
 *
 * Vấn đề: API nến của DNSE trễ ở các khung gộp sẵn (5/15/30 phút, 1 giờ trễ 5–20 phút trong phiên),
 * trong khi nến 1 phút của DNSE gần như realtime. Vì vậy:
 *  - Lịch sử dài: lấy đúng khung từ DNSE.
 *  - Phần gần đây (3 ngày): tự gộp từ nến 1 phút DNSE.
 *  - Phiên hôm nay: ưu tiên nến 1 phút dựng từ TỪNG LỆNH KHỚP (VPS: cổ phiếu có danh sách lệnh khớp đầy đủ,
 *    phái sinh lấy từ socket kể từ lúc server chạy) — đúng đến từng lệnh, không trễ.
 *  - Ngày/Tuần: nến cuối ghép giá Mở/Cao/Thấp/Khớp/Tổng KL realtime của sàn.
 */
const INDEX = new Set(['VNINDEX', 'VN30', 'HNX', 'HNX30', 'UPCOM', 'HNXINDEX', 'UPCOMINDEX']);
export const TF = { '1': 60, '5': 300, '15': 900, '30': 1800, '1H': 3600 };
const cache = new Map();
const kindOf = (s) => (INDEX.has(s) ? 'index' : /^VN30F/.test(s) ? 'derivative' : 'stock');
const dayBarTime = (day) => { const [Y, M, D] = day.split('-').map(Number); return Date.UTC(Y, M - 1, D, 2) / 1000; };
const weekStart = (t) => { const d = new Date((t + 7 * 3600) * 1000); const dow = (d.getUTCDay() + 6) % 7; return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow) / 1000; };

async function dnse(symbol, resolution, from, to, ttlMs) {
  const kind = kindOf(symbol);
  const key = `${kind}:${symbol}:${resolution}:${Math.floor(from / 3600)}:${Math.floor(to / (ttlMs / 1000))}`;
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.data;
  const r = await fetch(`${config.historyApi}/${kind}?symbol=${symbol}&resolution=${resolution}&from=${from}&to=${to}`, { signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw Object.assign(new Error(`history HTTP ${r.status}`), { status: 502 });
  const j = await r.json();
  const data = (j.t || []).map((t, i) => ({ time: t, open: j.o[i], high: j.h[i], low: j.l[i], close: j.c[i], volume: j.v[i] }));
  cache.set(key, { data, exp: Date.now() + ttlMs });
  if (cache.size > 3000) cache.delete(cache.keys().next().value);
  return data;
}

/** Gộp nến (đã sắp xếp) theo khung tf giây */
export function aggregate(bars, tf) {
  const out = [];
  for (const b of bars) {
    const t = Math.floor(b.time / tf) * tf;
    const last = out[out.length - 1];
    if (last && last.time === t) { last.high = Math.max(last.high, b.high); last.low = Math.min(last.low, b.low); last.close = b.close; last.volume += b.volume; }
    else out.push({ time: t, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume });
  }
  return out;
}

export class Candles {
  constructor(store, ticks, daily) { this.store = store; this.ticks = ticks; this.daily = daily; }

  /** Nến 1 phút gần đây: DNSE 1m (3 ngày) + đè bằng nến từ lệnh khớp ở những phút server có dữ liệu đầy đủ */
  async recentMinutes(symbol) {
    const now = Math.floor(Date.now() / 1000);
    const m1 = await dnse(symbol, '1', now - 3 * 86400, now, 5_000);
    const map = new Map(m1.map((b) => [b.time, b]));
    if (!INDEX.has(symbol) && this.store.stocks.has(symbol)) {
      try {
        const tk = await Promise.race([this.ticks.minuteBars(symbol), new Promise((r) => setTimeout(() => r(null), 8000))]);
        // Phút đã đóng: giữ DNSE (khớp với các nền tảng khác). Phút DNSE chưa có / đang chạy: dùng nến từ lệnh khớp realtime.
        const lastD = m1.length ? m1[m1.length - 1].time : 0;
        if (tk) for (const b of tk.bars) if (b.time >= tk.completeFrom && b.time >= lastD) map.set(b.time, b);
      } catch { /* dùng DNSE */ }
    }
    return [...map.values()].sort((a, b) => a.time - b.time);
  }

  async get(symbol, res, { from, to, recent } = {}) {
    symbol = String(symbol || '').toUpperCase();
    if (!/^[A-Z0-9]{2,12}$/.test(symbol)) throw Object.assign(new Error('symbol không hợp lệ'), { status: 400 });
    if (!TF[res] && res !== '1D' && res !== '1W') throw Object.assign(new Error('resolution không hợp lệ'), { status: 400 });
    const now = Math.floor(Date.now() / 1000);
    to = Number(to) || now; from = Number(from) || to - (TF[res] ? 5 : 730) * 86400;
    if (recent) from = Math.max(from, now - (TF[res] ? 2 : 40) * 86400);

    if (TF[res]) {
      const tf = TF[res];
      const [base, mins] = await Promise.all([recent ? Promise.resolve([]) : dnse(symbol, res, from, to, 30_000), this.recentMinutes(symbol)]);
      if (!mins.length) return base;
      const cutoff = Math.ceil(mins[0].time / tf) * tf; // từ mốc này nến được dựng lại đầy đủ từ nến 1 phút
      const agg = aggregate(mins.filter((b) => b.time >= cutoff), tf);
      return [...base.filter((b) => b.time < cutoff && b.time >= from), ...agg.filter((b) => b.time >= from)];
    }

    // ----- Ngày / Tuần
    const bars = recent ? await dnse(symbol, res, from, to, 15_000) : await dnse(symbol, res, from, to, 30_000);
    const out = bars.map((b) => ({ ...b }));
    const today = vnDate(), tDay = dayBarTime(today);
    let todayBar = null;
    if (todayStarted()) {
      const st = this.store.stocks.get(symbol);
      if (st?.last > 0) todayBar = { time: tDay, open: st.open || st.last, high: Math.max(st.high || st.last, st.last), low: Math.min(st.low || st.last, st.last), close: st.last, volume: st.totVol };
      else {
        const mins = (await this.recentMinutes(symbol)).filter((b) => b.time >= tDay - 2 * 3600);
        if (mins.length) todayBar = aggregate(mins, 86400 * 10).map((b) => ({ ...b, time: tDay }))[0];
      }
    }
    if (!todayBar) return out;
    if (res === '1D') {
      const i = out.findIndex((b) => b.time === tDay);
      if (i >= 0) out[i] = todayBar; else if (!out.length || out[out.length - 1].time < tDay) out.push(todayBar);
      return out;
    }
    // Tuần: các ngày đã đóng của tuần này (kho nến ngày) + hôm nay
    const ws = weekStart(tDay);
    const h = this.daily.bars.get(symbol);
    const days = [];
    if (h) for (let i = 0; i < h.t.length; i++) if (h.t[i] >= ws && h.t[i] < tDay) days.push({ open: h.o?.[i] ?? h.c[i], high: h.h[i], low: h.l[i], close: h.c[i], volume: h.v[i] });
    days.push(todayBar);
    const wk = { time: ws, open: days[0].open, high: Math.max(...days.map((d) => d.high)), low: Math.min(...days.map((d) => d.low)), close: todayBar.close, volume: days.reduce((a, d) => a + d.volume, 0) };
    const last = out[out.length - 1];
    if (last && weekStart(last.time) === ws) {
      // giữ mốc thời gian DNSE; nếu kho ngày thiếu dữ liệu (VD chỉ số) thì không làm mất giá trị DNSE
      out[out.length - 1] = h ? { ...wk, time: last.time } : { ...last, high: Math.max(last.high, wk.high), low: Math.min(last.low, wk.low), close: wk.close };
    } else if (!last || last.time < ws) out.push(wk);
    return out;
  }
}
