import { EventEmitter } from 'node:events';

/**
 * Bộ nhớ trạng thái thị trường (nguồn sự thật duy nhất ở server).
 * Giá: nghìn đồng. Khối lượng: cổ phiếu.
 * Mỗi lần mã thay đổi -> tăng seq, đánh dấu dirty để hub gom gửi đi.
 */
export class MarketStore extends EventEmitter {
  constructor() {
    super();
    this.stocks = new Map();   // sym -> Stock
    this.indices = new Map();  // code -> Index
    this.groups = {};          // VN30/HOSE/HNX/UPCOM/HNX30 -> [sym]
    this.seq = 0;
    this.lastFeedAt = 0;
  }

  emptyStock(sym) {
    return {
      s: sym, ex: '', ref: 0, ceil: 0, floor: 0, open: 0,
      last: 0, lastVol: 0, chg: 0, chgPc: 0, high: 0, low: 0, avg: 0, totVol: 0,
      b: [[0, 0], [0, 0], [0, 0]], a: [[0, 0], [0, 0], [0, 0]],
      fB: 0, fS: 0, room: 0, t: '', seq: 0, u: 0,
    };
  }

  /** Gộp các trường đã chuẩn hoá vào mã; chỉ phát sự kiện khi có thay đổi thật. */
  patchStock(sym, patch, { source = 'feed' } = {}) {
    let st = this.stocks.get(sym);
    if (!st) { st = this.emptyStock(sym); this.stocks.set(sym, st); }
    let changed = false;
    for (const k in patch) {
      const v = patch[k];
      if (v === undefined || (typeof v === 'number' && Number.isNaN(v))) continue;
      if (k === 'b' || k === 'a') {
        if (JSON.stringify(st[k]) !== JSON.stringify(v)) { st[k] = v; changed = true; }
      } else if (st[k] !== v) { st[k] = v; changed = true; }
    }
    if (changed) {
      // Tính lại thay đổi so với tham chiếu để luôn nhất quán
      if (st.ref && st.last) {
        st.chg = +(st.last - st.ref).toFixed(2);
        st.chgPc = +((st.chg / st.ref) * 100).toFixed(2);
      }
      st.seq = ++this.seq;
      st.u = Date.now();
      if (source === 'feed') this.lastFeedAt = st.u;
      this.emit('stock', st);
    }
    return st;
  }

  patchIndex(code, patch, { source = 'feed' } = {}) {
    let ix = this.indices.get(code);
    if (!ix) { ix = { code, name: INDEX_NAMES[code] || code }; this.indices.set(code, ix); }
    let changed = false;
    for (const k in patch) {
      if (patch[k] !== undefined && ix[k] !== patch[k]) { ix[k] = patch[k]; changed = true; }
    }
    if (changed) {
      ix.u = Date.now();
      if (source === 'feed') this.lastFeedAt = ix.u;
      this.emit('index', ix);
    }
  }

  allSymbols() { return [...this.stocks.keys()]; }
}

export const INDEX_NAMES = {
  '10': 'VN-INDEX', '11': 'VN30', '02': 'HNX-INDEX', '12': 'HNX30', '03': 'UPCOM',
};
