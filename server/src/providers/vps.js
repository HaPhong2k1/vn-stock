import io from 'socket.io-client';
import { config } from '../config.js';
import { isTradingActive } from '../market-hours.js';

const EX = { STO: 'HOSE', STX: 'HNX', UPX: 'UPCOM' };
const num = (v) => {
  if (v === null || v === undefined || v === '') return undefined;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : undefined;
};

/** "50.9|8780|d" -> [50.9, 87800]; giá có thể là "ATO"/"ATC" */
function level(str) {
  if (typeof str !== 'string' || !str) return undefined;
  const [p, v] = str.split('|');
  const price = num(p) ?? p;          // giữ nguyên "ATO"/"ATC"
  return [price === 0 ? 0 : price, (num(v) || 0) * config.volMult];
}

/** Chuẩn hoá bản ghi VPS (snapshot REST hoặc message socket) -> patch nội bộ */
export function normalizeVps(x) {
  const p = {};
  const m = config.volMult;
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
      // Sau mỗi lần (re)connect phải đối soát để bù các message bị lỡ
      this.resync().catch(() => {});
    });
    s.on('disconnect', (why) => { this.status.connected = false; this.status.reconnects++; this.log.warn('[vps] disconnect', why); });
    s.on('connect_error', (e) => { this.status.errors++; this.log.warn('[vps] connect_error', e.message); });

    const onStock = (d) => {
      const x = d?.data ?? d;
      if (!x?.sym) return;
      this.status.lastMsgAt = Date.now();
      this.store.patchStock(x.sym, normalizeVps(x));
    };
    s.on('stock', onStock);
    s.on('board', onStock);
    s.on('stockps', () => { this.status.lastMsgAt = Date.now(); }); // thỏa thuận: bỏ qua trên bảng khớp lệnh
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
