import io from 'socket.io-client';
import { config } from '../config.js';
import { isTradingActive } from '../market-hours.js';

const EX = { STO: 'HOSE', STX: 'HNX', UPX: 'UPCOM', DVX: 'PS' };
// Hợp đồng tương lai VN30: mã KRX (VD 41I1GB000) -> mã quen thuộc theo kỳ hạn
const DERIV_ALIASES = ['VN30F1M', 'VN30F2M', 'VN30F1Q', 'VN30F2Q'];
const vnToday = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
/** Phiên phái sinh: 8:45–14:45 (T2–T6) */
function derivActive() {
  const d = new Date(Date.now() + 7 * 3600_000), m = d.getUTCHours() * 60 + d.getUTCMinutes();
  return ![0, 6].includes(d.getUTCDay()) && m >= 8 * 60 + 44 && m <= 14 * 60 + 46 && !(m > 11 * 60 + 31 && m < 12 * 60 + 59);
}
const num = (v) => {
  if (v === null || v === undefined || v === '') return undefined;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : undefined;
};

/** "50.9|8780|d" -> [50.9, 87800]; giá có thể là "ATO"/"ATC" */
function levelM(str, mult = config.volMult) {
  if (typeof str !== 'string' || !str) return undefined;
  const [p, v] = str.split('|');
  const price = num(p) ?? p;          // giữ nguyên "ATO"/"ATC"
  return [price === 0 ? 0 : price, (num(v) || 0) * mult];
}

/** Chuẩn hoá bản ghi VPS (snapshot REST hoặc message socket) -> patch nội bộ */
export function normalizeVps(x, m = x?.marketId === 'DVX' ? 1 : config.volMult) {
  const p = {};
  const level = (str) => levelM(str, m);
  if (x.marketId && EX[x.marketId]) p.ex = EX[x.marketId];
  if (num(x.r) !== undefined) p.ref = num(x.r);
  if (num(x.c) !== undefined) p.ceil = num(x.c);
  if (num(x.f) !== undefined) p.floor = num(x.f);
  if (num(x.openPrice) !== undefined) p.open = num(x.openPrice);
  if (num(x.lastPrice) !== undefined) p.last = num(x.lastPrice);
  const lv = num(x.lastVolume ?? x.lastVol);
  if (lv !== undefined) p.lastVol = lv * m;
  const tv = num(x.lot ?? x.totalVol);
  if (tv !== undefined) p.totVol = tv * m;
  const hi = num(x.highPrice ?? x.hp); if (hi !== undefined) p.high = hi;
  const lo = num(x.lowPrice ?? x.lp); if (lo !== undefined) p.low = lo;
  const av = num(x.avePrice ?? x.ap); if (av !== undefined) p.avg = av;
  const fb = num(x.fBVol); if (fb !== undefined) p.fB = fb * m;
  const fs = num(x.fSVolume ?? x.fSVol); if (fs !== undefined) p.fS = fs * m;
  const room = num(x.fRoom); if (room !== undefined) p.room = room; // room NN tính theo cổ phiếu
  if (x.time) p.t = String(x.time);
  const oi = num(x.oi); if (oi !== undefined && m === 1) p.oi = oi; // khối lượng mở (phái sinh)

  // Snapshot: g1-g3 = dư mua (tốt nhất trước), g4-g6 = dư bán
  if (!x.side && x.g4 !== undefined) {
    const b = [level(x.g1), level(x.g2), level(x.g3)];
    const a = [level(x.g4), level(x.g5), level(x.g6)];
    if (b.every(Boolean)) p.b = b;
    if (a.every(Boolean)) p.a = a;
  } else if (x.side === 'B' || x.side === 'S') {
    // Socket "board": side B/S, g1-g3 là 3 bước giá của phía đó
    const lv3 = [level(x.g1), level(x.g2), level(x.g3)];
    if (lv3.every(Boolean)) p[x.side === 'B' ? 'b' : 'a'] = lv3;
  }
  return p;
}

export function normalizeVpsIndex(x) {
  const [chg, pc, value, up, down, ref] = String(x.ot || '').split('|');
  const cur = num(x.cIndex);
  return {
    value: cur,
    chg: num(chg),
    chgPc: num(String(pc || '').replace('%', '')),
    vol: num(x.vol),
    val: num(value),                // triệu đồng
    up: num(up), down: num(down), nochg: num(ref),
    status: x.status || undefined,
    t: x.time || undefined,
  };
}

async function getJSON(url, retries = 3) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (i >= retries) throw e;
      await new Promise((res) => setTimeout(res, 500 * 2 ** i));
    }
  }
}

const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

export class VpsProvider {
  constructor(store, log = console) {
    this.store = store;
    this.log = log;
    this.socket = null;
    this.status = { connected: false, lastMsgAt: 0, reconnects: 0, lastResyncAt: 0, errors: 0 };
  }

  async loadGroups() {
    const r = config.vps.rest;
    const [hose, hnx, upcom, vn30, hnx30] = await Promise.all(
      ['hose', 'hnx', 'upcom', 'VN30', 'HNX30'].map((g) => getJSON(`${r}/getlistckindex/${g}`)),
    );
    this.store.groups = { VN30: vn30, HNX30: hnx30, HOSE: hose, HNX: hnx, UPCOM: upcom };
    this.symbols = [...new Set([...hose, ...hnx, ...upcom])];
    for (const [ex, list] of [['HOSE', hose], ['HNX', hnx], ['UPCOM', upcom]]) {
      for (const s of list) this.store.patchStock(s, { ex }, { source: 'snapshot' });
    }
    await this.loadDerivatives().catch((e) => this.log.warn('[vps] phái sinh lỗi', e.message));
  }

  /** Xác định VN30F1M/F2M/F1Q/F2Q = các HĐ tương lai VN30 còn hiệu lực, xếp theo ngày đáo hạn */
  async loadDerivatives() {
    const r = config.vps.rest;
    const all = await getJSON(`${r}/getlistallstock`);
    const codes = (all || []).filter((x) => x.type === 'D' && /^41I1/.test(x.stock_code)).map((x) => x.stock_code);
    if (!codes.length) return;
    const rows = await getJSON(`${r}/getpsalldatalsnapshot/${codes.join(',')}`);
    const today = vnToday();
    const live = (rows || []).map((x) => ({ x, mat: String(x.matureDate || '').split('/').reverse().join('-') }))
      .filter((c) => c.mat && c.mat >= today).sort((a, b) => a.mat.localeCompare(b.mat));
    const next = new Map(live.slice(0, DERIV_ALIASES.length).map((c, i) => [c.x.sym, DERIV_ALIASES[i]]));
    const prev = this.derivAlias || new Map();
    this.derivAlias = next;
    this.derivCodes = [...next.keys()];
    this.store.groups.PS = DERIV_ALIASES.filter((a) => [...next.values()].includes(a));
    for (const c of live.slice(0, DERIV_ALIASES.length)) {
      const alias = next.get(c.x.sym);
      // chuyển kỳ hạn (rollover): HĐ khác => tạo lại dòng để không lẫn dữ liệu HĐ cũ
      if ([...prev.entries()].some(([code, a]) => a === alias && code !== c.x.sym)) this.store.stocks.delete(alias);
      this.store.patchStock(alias, { ...normalizeVps(c.x, 1), ex: 'PS', code: c.x.sym, mat: c.mat }, { source: 'snapshot' });
    }
    if (this.socket?.connected && this.derivCodes.length) this.socket.emit('regs', JSON.stringify({ action: 'join', list: this.derivCodes.join(',') }));
    this.log.info(`[vps] phái sinh: ${[...next].map(([c, a]) => `${a}=${c}`).join(', ')}`);
  }

  /** Cập nhật phái sinh từ snapshot REST (dự phòng cho socket, 2s/lần trong phiên) */
  async pollDerivatives() {
    if (!this.derivCodes?.length) return;
    const rows = await getJSON(`${config.vps.rest}/getpsalldatalsnapshot/${this.derivCodes.join(',')}`, 0);
    for (const x of rows || []) this.applyDeriv(x);
  }

  applyDeriv(x) {
    const alias = this.derivAlias?.get(x?.sym);
    if (!alias) return false;
    const patch = normalizeVps(x, 1);
    const cur = this.store.stocks.get(alias);
    if (cur && patch.totVol !== undefined && patch.totVol < cur.totVol) return true; // dữ liệu cũ hơn
    this.store.patchStock(alias, patch);
    return true;
  }

  /** Đối soát: tải lại toàn bộ snapshot. Chỉ áp dụng nếu snapshot không "cũ" hơn dữ liệu socket. */
  async resync() {
    const r = config.vps.rest;
    const t0 = Date.now();
    let n = 0;
    for (const part of chunk(this.symbols, 100)) {
      try {
        const rows = await getJSON(`${r}/getliststockdata/${part.join(',')}`);
        for (const row of rows || []) {
          if (!row?.sym) continue;
          const patch = normalizeVps(row);
          const cur = this.store.stocks.get(row.sym);
          if (cur && patch.totVol !== undefined && patch.totVol < cur.totVol) continue; // socket đã đi trước
          this.store.patchStock(row.sym, patch, { source: 'snapshot' });
          n++;
        }
      } catch (e) { this.status.errors++; this.log.warn('[vps] snapshot lỗi', e.message); }
    }
    try { await this.pollDerivatives(); } catch (e) { this.status.errors++; this.log.warn('[vps] phái sinh lỗi', e.message); }
    try {
      const idx = await getJSON(`${r}/getlistindexdetail/10,11,02,12,03`);
      for (const x of idx || []) if (x?.mc) this.store.patchIndex(x.mc, normalizeVpsIndex(x), { source: 'snapshot' });
    } catch (e) { this.status.errors++; this.log.warn('[vps] index lỗi', e.message); }
    this.status.lastResyncAt = Date.now();
    this.log.info(`[vps] resync ${n} mã trong ${Date.now() - t0}ms`);
  }

  connectSocket() {
    if (this.socket) { this.socket.removeAllListeners(); this.socket.close(); }
    const s = io(config.vps.socket, {
      transports: ['websocket'], reconnection: true,
      reconnectionDelay: 1000, reconnectionDelayMax: 10_000,
    });
    this.socket = s;
    s.on('connect', () => {
      this.status.connected = true;
      this.log.info('[vps] socket connected');
      for (const part of chunk(this.symbols, 200)) {
        s.emit('regs', JSON.stringify({ action: 'join', list: part.join(',') }));
      }
      if (this.derivCodes?.length) s.emit('regs', JSON.stringify({ action: 'join', list: this.derivCodes.join(',') }));
      // Sau mỗi lần (re)connect phải đối soát để bù các message bị lỡ
      this.resync().catch(() => {});
    });
    s.on('disconnect', (why) => { this.status.connected = false; this.status.reconnects++; this.log.warn('[vps] disconnect', why); });
    s.on('connect_error', (e) => { this.status.errors++; this.log.warn('[vps] connect_error', e.message); });

    const onStock = (d) => {
      const x = d?.data ?? d;
      if (!x?.sym) return;
      this.status.lastMsgAt = Date.now();
      if (this.applyDeriv({ ...x, marketId: 'DVX' })) return; // phái sinh: KL theo hợp đồng
      this.store.patchStock(x.sym, normalizeVps(x));
    };
    s.on('stock', onStock);
    s.on('board', onStock);
    s.on('stockps', onStock); // phái sinh
    s.on('boardps', onStock);
    s.on('index', (d) => {
      const x = d?.data ?? d;
      if (!x?.mc) return;
      this.status.lastMsgAt = Date.now();
      this.store.patchIndex(x.mc, normalizeVpsIndex(x));
    });
  }

  async start() {
    await this.loadGroups();
    await this.resync();
    this.connectSocket();
    // Đối soát định kỳ trong giờ giao dịch
    setInterval(() => { if (isTradingActive()) this.resync().catch(() => {}); }, config.resyncMs);
    setInterval(() => { if (derivActive()) this.pollDerivatives().catch(() => {}); }, 2_000);
    // kiểm tra chuyển kỳ hạn HĐ tương lai
    setInterval(() => this.loadDerivatives().catch(() => {}), 30 * 60_000);
    // Watchdog: socket "im lặng" bất thường => kết nối lại
    setInterval(() => {
      if (!isTradingActive()) return;
      const silent = Date.now() - (this.status.lastMsgAt || 0);
      if (silent > config.staleMs) {
        this.log.warn(`[vps] feed im lặng ${silent}ms -> reconnect`);
        this.status.lastMsgAt = Date.now();
        this.connectSocket();
      }
    }, 5_000);
  }
}
