// Phân tích Footprint (bid x ask) — dùng chung web & kiểm thử.
// Định nghĩa theo tài liệu Optimus Futures "Footprint Charts" + quy ước phổ biến (ghi rõ chỗ là quy ước).
//  - bid  = KL bán chủ động (khớp vào giá mua), ask = KL mua chủ động (khớp vào giá bán)
//  - Delta (mỗi giá) = ask − bid; Delta nến = tổng delta các dòng; CVD = cộng dồn delta các nến trong ngày
//  - POC = dòng có tổng KL lớn nhất trong nến
//  - Imbalance chéo: mua: ask[p] ≥ ratio × bid[p − 1 dòng]; bán: bid[p] ≥ ratio × ask[p + 1 dòng] (mặc định 300%)
//  - Stacked imbalance: ≥ N dòng imbalance cùng chiều liên tiếp (quy ước phổ biến N = 3; bài viết không nêu số)
//  - Unfinished auction: dòng cao/thấp nhất của nến có cả bid lẫn ask > 0 (giá hay quay lại "hoàn tất")
//  - Exhaustion: KL chủ động ở cực trị co lại rất nhỏ so với KL lớn nhất cùng chiều trong nến (quy ước: ≤ 10%)
//  - Absorption: KL chủ động rất lớn dồn ở cực trị nhưng nến đóng cửa quay ngược (quy ước: ≥ 2× KL TB/dòng)
//  - Delta divergence: nến lập đỉnh mới nhưng delta âm, hoặc lập đáy mới nhưng delta dương

export const FP_DEFAULTS = { ratio: 3, minVol: 0, stack: 3, exhaustPct: 0.1, absorbMult: 2 };

/** Bước giá theo sàn (đơn vị giá của dữ liệu: nghìn đồng với cổ phiếu, điểm với VN30F) */
export function tickOf(ex, price) {
  if (ex === 'PS') return 0.1;
  if (ex === 'HOSE') return price < 10 ? 0.01 : price < 50 ? 0.05 : 0.1;
  if (ex === 'HNX' || ex === 'UPCOM') return 0.1;
  return 0.01;
}

/** Tự chọn số bước giá mỗi dòng để nến có khoảng ≤ ~14 dòng */
export function autoRowSize(bars, tick) {
  const ranges = bars.map((b) => b.h - b.l).filter((x) => x > 0).sort((a, b) => a - b);
  const med = ranges.length ? ranges[Math.floor(ranges.length / 2)] : tick;
  const ticks = Math.max(1, Math.ceil(med / tick / 14));
  const nice = [1, 2, 4, 5, 10, 20, 25, 50, 100].find((n) => n >= ticks) || ticks;
  return +(nice * tick).toFixed(6);
}

const key = (p, row) => Math.round(Math.floor(p / row + 1e-9) * row * 1e6) / 1e6;

/**
 * @param bars [{t,o,h,l,c,rows:[[price,bid,ask]],auction}]  (rows theo từng bước giá)
 * @param row  kích thước dòng (giá)
 */
export function analyzeFootprint(bars, row, opts = {}) {
  const o = { ...FP_DEFAULTS, ...opts };
  let cvd = 0;
  const out = [];
  for (let bi = 0; bi < bars.length; bi++) {
    const b = bars[bi];
    const m = new Map();
    for (const [p, bid, ask] of b.rows) {
      const k = key(p, row);
      const r = m.get(k) || { p: k, bid: 0, ask: 0 };
      r.bid += bid; r.ask += ask; m.set(k, r);
    }
    const rows = [...m.values()].sort((x, y) => x.p - y.p);
    let vol = 0, delta = 0, poc = null, maxBid = 0, maxAsk = 0;
    for (const r of rows) {
      r.vol = r.bid + r.ask; r.delta = r.ask - r.bid;
      vol += r.vol; delta += r.delta;
      if (!poc || r.vol > poc.vol) poc = r;
      maxBid = Math.max(maxBid, r.bid); maxAsk = Math.max(maxAsk, r.ask);
    }
    // Imbalance chéo
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i], below = rows[i - 1], above = rows[i + 1];
      const bidBelow = below && Math.abs(below.p - (r.p - row)) < row / 2 ? below.bid : 0;
      const askAbove = above && Math.abs(above.p - (r.p + row)) < row / 2 ? above.ask : 0;
      // dòng dưới cùng không có giá thấp hơn để so chéo (và ngược lại với dòng trên cùng)
      r.buyImb = i > 0 && r.ask > 0 && r.ask >= o.minVol && r.ask >= o.ratio * bidBelow;
      r.sellImb = i < rows.length - 1 && r.bid > 0 && r.bid >= o.minVol && r.bid >= o.ratio * askAbove;
    }
    // Stacked imbalance
    const stacks = [];
    for (const side of ['buyImb', 'sellImb']) {
      let start = -1;
      for (let i = 0; i <= rows.length; i++) {
        const okRow = i < rows.length && rows[i][side] && (start < 0 || Math.abs(rows[i].p - rows[i - 1].p - row) < row / 2);
        if (okRow) { if (start < 0) start = i; continue; }
        if (start >= 0 && i - start >= o.stack) stacks.push({ dir: side === 'buyImb' ? 1 : -1, from: rows[start].p, to: rows[i - 1].p, n: i - start });
        start = i < rows.length && rows[i][side] ? i : -1;
      }
    }
    const top = rows[rows.length - 1], bot = rows[0];
    const avgRow = rows.length ? vol / rows.length : 0;
    const mid = (b.h + b.l) / 2;
    cvd += delta;
    const prev = out[bi - 1];
    out.push({
      t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, auction: b.auction || 0,
      rows, vol, delta, cvd, poc: poc?.p ?? null, maxVol: poc?.vol || 0, stacks,
      unfinishedHigh: !!top && rows.length > 1 && top.bid > 0 && top.ask > 0,
      unfinishedLow: !!bot && rows.length > 1 && bot.bid > 0 && bot.ask > 0,
      exhaustHigh: rows.length >= 3 && maxAsk > 0 && top.ask <= o.exhaustPct * maxAsk,
      exhaustLow: rows.length >= 3 && maxBid > 0 && bot.bid <= o.exhaustPct * maxBid,
      absorbLow: rows.length >= 3 && bot.bid >= o.absorbMult * avgRow && b.c > mid,   // bán mạnh ở đáy nhưng không xuống được
      absorbHigh: rows.length >= 3 && top.ask >= o.absorbMult * avgRow && b.c < mid,  // mua mạnh ở đỉnh nhưng không lên được
      divBear: !!prev && b.h > prev.h && delta < 0,
      divBull: !!prev && b.l < prev.l && delta > 0,
    });
  }
  return out;
}
