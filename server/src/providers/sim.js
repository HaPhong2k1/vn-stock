import { VpsProvider } from './vps.js';

/** Bước giá theo quy định sàn (nghìn đồng) */
export function tickSize(ex, price) {
  if (ex === 'HOSE') return price < 10 ? 0.01 : price < 50 ? 0.05 : 0.1;
  return 0.1;
}
const round = (v, t) => +(Math.round(v / t) * t).toFixed(2);

/**
 * Giả lập: lấy snapshot thật từ VPS làm điểm xuất phát rồi sinh lệnh khớp ngẫu nhiên
 * (tôn trọng trần/sàn, bước giá). Dùng để demo/kiểm thử ngoài giờ giao dịch.
 */
export class SimProvider extends VpsProvider {
  async start() {
    try { await this.loadGroups(); await this.resync(); }
    catch (e) { this.log.warn('[sim] không tải được snapshot thật, dùng dữ liệu mẫu', e.message); this.seed(); }
    this.status.connected = true;
    const syms = this.store.allSymbols().filter((s) => this.store.stocks.get(s).ref > 0);
    const hot = new Set(this.store.groups.VN30 || syms.slice(0, 30));
    setInterval(() => {
      const n = 40;
      for (let i = 0; i < n; i++) {
        const sym = Math.random() < 0.5 ? [...hot][Math.floor(Math.random() * hot.size)] : syms[Math.floor(Math.random() * syms.length)];
        this.tick(sym);
      }
      this.status.lastMsgAt = Date.now();
      for (const [code, ix] of this.store.indices) {
        const v = +(ix.value + (Math.random() - 0.5) * 0.6).toFixed(2);
        const ref = ix.value - (ix.chg || 0);
        this.store.patchIndex(code, { value: v, chg: +(v - ref).toFixed(2), chgPc: +(((v - ref) / ref) * 100).toFixed(2) });
      }
    }, 250);
  }

  tick(sym) {
    const st = this.store.stocks.get(sym);
    if (!st || !st.ref) return;
    const t = tickSize(st.ex, st.ref);
    const base = st.last || st.ref;
    let p = round(base + (Math.floor(Math.random() * 5) - 2) * t, t);
    p = Math.min(st.ceil, Math.max(st.floor, p));
    const vol = (1 + Math.floor(Math.random() * 50)) * 100;
    const b = [0, 1, 2].map((i) => [round(p - t * (i + 1), t), (1 + Math.floor(Math.random() * 300)) * 100]);
    const a = [0, 1, 2].map((i) => [round(p + t * i, t), (1 + Math.floor(Math.random() * 300)) * 100]);
    const now = new Date(Date.now() + 7 * 3600_000).toISOString().slice(11, 19);
    this.store.patchStock(sym, {
      last: p, lastVol: vol, totVol: st.totVol + vol,
      high: Math.max(st.high || p, p), low: Math.min(st.low || p, p),
      b: b.filter((x) => x[0] >= st.floor), a: a.filter((x) => x[0] <= st.ceil), t: now,
    });
  }

  seed() {
    const demo = { FPT: 51, VNM: 56.9, HPG: 27.5, VCB: 60, SSI: 30, MWG: 70, TCB: 25, VIC: 100, ACB: 24, MBB: 23 };
    this.store.groups = { VN30: Object.keys(demo), HOSE: Object.keys(demo), HNX: [], UPCOM: [], HNX30: [] };
    for (const [s, ref] of Object.entries(demo)) {
      this.store.patchStock(s, { ex: 'HOSE', ref, ceil: round(ref * 1.07, 0.1), floor: round(ref * 0.93, 0.1), last: ref });
    }
    this.store.patchIndex('10', { value: 1700, chg: 0, chgPc: 0 });
  }
}
