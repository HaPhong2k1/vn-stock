import { config } from './config.js';
import { vnDate, todayStarted, prevTradingDay } from './daily.js';

/**
 * Thu thập lệnh khớp (tick) & dựng dữ liệu Footprint (KL mua/bán chủ động theo từng mức giá).
 *
 * Nguồn dữ liệu:
 *  1. Cổ phiếu: VPS getliststocktrade — từng lệnh khớp của phiên kèm chiều chủ động
 *     side 'B' = mua chủ động (khớp vào giá bán → cột ASK), 'S' = bán chủ động (khớp vào giá mua → cột BID),
 *     '' = khớp định kỳ ATO/ATC (không có bên chủ động) ⇒ CHÍNH XÁC.
 *  2. Message realtime có side (socket) ⇒ chính xác.
 *  3. VN30F (VPS không có danh sách lệnh khớp phái sinh): khi tổng KL tăng Δ, ghi Δ tại giá khớp cuối;
 *     chiều suy theo quy tắc giá chào (≥ giá bán tốt nhất trước đó ⇒ mua chủ động, ≤ giá mua tốt nhất ⇒ bán
 *     chủ động, ở giữa ⇒ quy tắc tick) ⇒ ƯỚC LƯỢNG, được đánh dấu.
 *
 * Lưu trữ: mỗi mã giữ nến 1 phút (mỗi nến có các dòng giá). Khung 5/15/30/60 phút gộp từ nến phút.
 * Khung NGÀY: hồ sơ footprint của mỗi phiên được lưu vào DB (VPS chỉ cho danh sách lệnh của phiên gần nhất,
 * nên lịch sử khung ngày được tích luỹ dần từ khi chạy hệ thống).
 */
const MAX_IDLE = 30 * 60_000;
const DAY_TF = 86400;
const FP_TOP = Number(process.env.FP_TOP || 100); // số mã thanh khoản cao nhất được lưu footprint ngày mỗi phiên

const toEpoch = (day, hms) => {
  const [h, m, s] = String(hms || '00:00:00').split(':').map(Number);
  const [Y, M, D] = day.split('-').map(Number);
  return Date.UTC(Y, M - 1, D, h - 7, m, s || 0) / 1000;
};
/** Mốc thời gian nến ngày (giống DNSE: 09:00 giờ VN = 02:00 UTC) */
const dayBarTime = (day) => { const [Y, M, D] = day.split('-').map(Number); return Date.UTC(Y, M - 1, D, 2) / 1000; };
const vnHM = () => { const d = new Date(Date.now() + 7 * 3600_000); return d.getUTCHours() * 60 + d.getUTCMinutes(); };

const newBar = (t, p) => ({ t, o: p, h: p, l: p, c: p, rows: new Map(), auction: 0 });
function addToBar(b, p, v, side) {
  b.h = Math.max(b.h, p); b.l = Math.min(b.l, p); b.c = p;
  const k = p.toFixed(2);
  const row = b.rows.get(k) || [p, 0, 0];
  if (side === 1) row[2] += v; else if (side === -1) row[1] += v; else b.auction += v;
  b.rows.set(k, row);
}
/** Gộp nhiều nến (đã sắp theo thời gian) thành 1 nến */
function merge(bars, t) {
  const out = newBar(t, bars[0].o);
  for (const b of bars) {
    out.h = Math.max(out.h, b.h); out.l = Math.min(out.l, b.l); out.c = b.c; out.auction += b.auction;
    for (const [k, [p, bid, ask]] of b.rows) {
      const r = out.rows.get(k) || [p, 0, 0];
      r[1] += bid; r[2] += ask; out.rows.set(k, r);
    }
  }
  return out;
}
const serialize = (b) => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, auction: b.auction, rows: [...b.rows.values()].sort((x, y) => x[0] - y[0]) });
const deserialize = (d) => ({ ...d, rows: new Map(d.rows.map((r) => [r[0].toFixed(2), [...r]])) });

export class TickCollector {
  constructor(store, storage, log = console) {
    this.store = store; this.storage = storage; this.log = log;
    this.syms = new Map();
    this.day = vnDate();
    this.session = this.sessionDay();
    this.dailyDone = '';
    store.on('stock', (st) => this.onStockEvent(st));
    setInterval(() => this.gc(), 5 * 60_000).unref();
    setInterval(() => this.persistPinned().catch((e) => this.log.warn('[ticks] lưu phút lỗi', e.message)), 60_000).unref();
    setInterval(() => this.maybeCollectDaily(), 10 * 60_000).unref();
  }

  sessionDay() { return todayStarted() ? vnDate() : prevTradingDay(); }

  rollDay() {
    if (vnDate() === this.day) return;
    // sang ngày mới: lưu nốt dữ liệu phái sinh của phiên cũ rồi xoá bộ nhớ
    this.persistPinned().catch(() => {});
    for (const [s, e] of this.syms) if (!e.pinned) this.syms.delete(s); else this.resetEntry(e);
    this.day = vnDate();
  }

  resetEntry(e) {
    const st = this.store.stocks.get(e.sym);
    Object.assign(e, { min: new Map(), lastTot: st?.totVol || 0, lastPrice: st?.last || 0, lastSide: 0, backfilled: false, estVol: 0, exactVol: 0, dirty: false });
  }

  entry(sym) {
    this.rollDay();
    const sess = this.sessionDay();
    if (sess !== this.session) {
      // phiên mới bắt đầu (9:00): lưu dữ liệu phái sinh của phiên cũ dưới đúng ngày cũ rồi làm mới
      const old = this.session;
      for (const e of this.syms.values()) {
        if (e.pinned && e.min.size) {
          const bars = [...e.min.values()].sort((a, b) => a.t - b.t).map(serialize);
          const prof = { ...serialize(merge(bars.map(deserialize), dayBarTime(old))), est: e.estVol > e.exactVol };
          this.storage.fpSave(e.sym, 'M', old, { bars, estVol: e.estVol, exactVol: e.exactVol }).catch(() => {});
          this.storage.fpSave(e.sym, 'D', old, prof).catch(() => {});
        }
        this.resetEntry(e);
      }
      this.session = sess;
    }
    let e = this.syms.get(sym);
    if (!e) {
      e = { sym, lastAccess: Date.now(), viewedDay: '' };
      this.resetEntry(e);
      const st = this.store.stocks.get(sym);
      e.prevBid = st?.b?.[0]?.[0]; e.prevAsk = st?.a?.[0]?.[0];
      this.syms.set(sym, e);
    }
    return e;
  }

  /** Luôn theo dõi (VN30F) + khôi phục dữ liệu phút đã lưu của phiên hôm nay sau khi khởi động lại */
  async pin(syms) {
    for (const s of syms) {
      const e = this.entry(s); e.pinned = true;
      try {
        const rows = await this.storage.fpGet(s, 'M', this.session);
        const today = rows.find((r) => r.day === this.session);
        if (today) {
          for (const b of today.data.bars) e.min.set(b.t, deserialize(b));
          e.estVol += today.data.estVol || 0; e.exactVol += today.data.exactVol || 0;
          this.log.info(`[ticks] ${s}: khôi phục ${today.data.bars.length} nến phút đã lưu`);
        }
      } catch (err) { this.log.warn('[ticks] khôi phục lỗi', err.message); }
    }
  }

  gc() {
    const now = Date.now();
    for (const [s, e] of this.syms) if (!e.pinned && now - e.lastAccess > MAX_IDLE) this.syms.delete(s);
  }

  add(e, t, p, v, side, est) {
    const mt = Math.floor(t / 60) * 60;
    let b = e.min.get(mt);
    if (!b) { b = newBar(mt, p); e.min.set(mt, b); }
    addToBar(b, p, v, side);
    if (est) e.estVol += v; else e.exactVol += v;
    e.lastPrice = p; if (side) e.lastSide = side; e.dirty = true;
  }

  /** Lệnh khớp từng giao dịch (socket). mult = hệ số KL (cổ phiếu 10, phái sinh 1). */
  onTrade(sym, x, mult) {
    const e = this.syms.get(sym);
    if (!e) return;
    const tot = Number(x.totalVol ?? x.lot) * mult;
    const v = Number(x.lastVol ?? x.lastVolume) * mult;
    const p = Number(x.lastPrice);
    if (!(tot > e.lastTot) || !(v > 0) || !(p > 0)) return;
    const side = x.side === 'B' ? 1 : x.side === 'S' ? -1 : x.side === '' ? 0 : null;
    if (side === null) return; // không có chiều => để cơ chế ước lượng xử lý
    this.add(e, x.time ? toEpoch(this.session, x.time) : Math.floor(Date.now() / 1000), p, v, side, false);
    e.lastTot = tot; e.lastExactAt = Date.now();
  }

  /** Ước lượng từ chênh lệch tổng KL giữa 2 lần cập nhật (VN30F / khi không có tick có chiều) */
  onStockEvent(st) {
    const e = this.syms.get(st.s);
    if (!e) return;
    // Đang nhận lệnh khớp chính xác từ socket => không ước lượng, không đẩy lastTot (tránh bỏ sót lệnh đến sau snapshot)
    if (Date.now() - (e.lastExactAt || 0) < 15_000) { e.prevBid = st.b?.[0]?.[0]; e.prevAsk = st.a?.[0]?.[0]; return; }
    if (st.totVol > e.lastTot && st.last > 0 && e.lastTot > 0) {
      const v = st.totVol - e.lastTot, p = st.last;
      let side;
      if (typeof e.prevAsk === 'number' && e.prevAsk > 0 && p >= e.prevAsk) side = 1;
      else if (typeof e.prevBid === 'number' && e.prevBid > 0 && p <= e.prevBid) side = -1;
      else side = p > e.lastPrice ? 1 : p < e.lastPrice ? -1 : e.lastSide || 1;
      this.add(e, Math.floor(Date.now() / 1000), p, v, side, true);
    }
    if (st.totVol > e.lastTot) e.lastTot = st.totVol;
    e.prevBid = st.b?.[0]?.[0]; e.prevAsk = st.a?.[0]?.[0];
  }

  /** Tải toàn bộ lệnh khớp của phiên (cổ phiếu) từ VPS. ≈3MB với mã thanh khoản cao. */
  async backfill(sym, force = false) {
    const e = this.entry(sym);
    if ((e.backfilled && !force) || e.loading) return e.loading;
    e.loading = (async () => {
      const r = await fetch(`${config.vps.rest}/getliststocktrade/${sym}`, { signal: AbortSignal.timeout(30_000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const rows = (await r.json()) || [];
      rows.sort((a, b) => a.sequence - b.sequence);
      const live = [...e.min.values()];
      const lastListT = rows.length ? toEpoch(this.session, rows[rows.length - 1].time) : 0;
      this.resetEntry(e);
      let tot = 0;
      for (const x of rows) {
        const v = Number(x.lastVol) * config.volMult, p = Number(x.lastPrice);
        if (!(v > 0) || !(p > 0)) continue;
        this.add(e, toEpoch(this.session, x.time), p, v, x.side === 'B' ? 1 : x.side === 'S' ? -1 : 0, false);
        tot = Math.max(tot, Number(x.totalVol) * config.volMult);
      }
      for (const b of live) if (b.t > lastListT) e.min.set(b.t, b); // nến phút realtime đến sau khi chụp danh sách
      e.lastTot = Math.max(tot, this.store.stocks.get(sym)?.totVol || 0);
      e.backfilled = true;
      this.log.info(`[ticks] ${sym}: ${rows.length} lệnh khớp`);
    })().finally(() => { e.loading = null; });
    return e.loading;
  }

  dayProfile(e) {
    const mins = [...e.min.values()].sort((a, b) => a.t - b.t);
    return mins.length ? merge(mins, dayBarTime(this.session)) : null;
  }

  /** Lưu dữ liệu phút + hồ sơ ngày của các mã luôn theo dõi (VN30F) */
  async persistPinned() {
    for (const e of this.syms.values()) {
      if (!e.pinned || !e.dirty || !e.min.size) continue;
      e.dirty = false;
      const bars = [...e.min.values()].sort((a, b) => a.t - b.t).map(serialize);
      await this.storage.fpSave(e.sym, 'M', this.session, { bars, estVol: e.estVol, exactVol: e.exactVol });
      await this.storage.fpSave(e.sym, 'D', this.session, { ...serialize(this.dayProfile(e)), est: e.estVol > e.exactVol });
    }
  }

  /** Sau 15:05 mỗi phiên: lưu hồ sơ footprint ngày cho VN30, HNX30, mã đã xem và top thanh khoản */
  async maybeCollectDaily(force = false) {
    const d = new Date(Date.now() + 7 * 3600_000);
    if (!force && ([0, 6].includes(d.getUTCDay()) || vnHM() < 15 * 60 + 5)) return;
    const day = this.sessionDay();
    if (this.dailyDone === day || this.collecting) return;
    this.collecting = true;
    try {
      const g = this.store.groups;
      const top = [...this.store.stocks.values()].filter((s) => s.ex !== 'PS' && s.totVol > 0)
        .sort((a, b) => b.avg * b.totVol - a.avg * a.totVol).slice(0, FP_TOP).map((s) => s.s);
      const viewed = [...this.syms.values()].filter((e) => !e.pinned).map((e) => e.sym);
      const list = [...new Set([...(g.VN30 || []), ...(g.HNX30 || []), ...viewed, ...top])];
      let n = 0;
      for (const sym of list) {
        try {
          if (await this.storage.fpHas(sym, 'D', day)) continue;
          await this.backfill(sym, true);
          const prof = this.dayProfile(this.syms.get(sym));
          if (prof) { await this.storage.fpSave(sym, 'D', day, serialize(prof)); n++; }
          if (!viewed.includes(sym)) this.syms.delete(sym); // giải phóng bộ nhớ
        } catch (err) { this.log.warn(`[ticks] lưu ngày ${sym} lỗi`, err.message); }
      }
      await this.persistPinned();
      this.dailyDone = day;
      this.log.info(`[ticks] đã lưu footprint ngày ${day}: ${n} mã mới (${list.length} mã trong danh sách)`);
    } finally { this.collecting = false; }
  }

  /**
   * Dữ liệu footprint: tf = 60/300/900/1800/3600 (giây) hoặc 86400 (ngày).
   * Trả về nến với rows = [[giá, KL bán chủ động (bid), KL mua chủ động (ask)]] theo từng bước giá.
   */
  async footprint(sym, tf) {
    const st = this.store.stocks.get(sym);
    if (!st) throw Object.assign(new Error('Mã không tồn tại'), { status: 404 });
    const e = this.entry(sym);
    e.lastAccess = Date.now();
    if (st.ex !== 'PS' && !e.backfilled) await this.backfill(sym);
    const total = e.exactVol + e.estVol;
    const meta = {
      symbol: sym, tf, estimatedPct: total ? Math.round((e.estVol / total) * 100) : (st.ex === 'PS' ? 100 : 0),
      source: st.ex === 'PS' ? 'collector' : 'vps-trades', session: this.session,
    };
    if (tf === DAY_TF) {
      const from = new Date(Date.now() - 400 * 86400_000).toISOString().slice(0, 10);
      const hist = (await this.storage.fpGet(sym, 'D', from)).filter((r) => r.day !== this.session).map((r) => ({ ...r.data, est: !!r.data.est }));
      const today = this.dayProfile(e);
      const bars = [...hist, ...(today ? [{ ...serialize(today), est: meta.estimatedPct > 50 }] : [])];
      return { ...meta, days: bars.length, bars };
    }
    const groups = new Map();
    for (const b of [...e.min.values()].sort((a, c) => a.t - c.t)) {
      const bt = Math.floor(b.t / tf) * tf;
      if (!groups.has(bt)) groups.set(bt, []);
      groups.get(bt).push(b);
    }
    return { ...meta, bars: [...groups].map(([t, list]) => serialize(merge(list, t))) };
  }
}
