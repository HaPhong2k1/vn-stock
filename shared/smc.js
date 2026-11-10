// =====================================================================================================
// Smart Money Concepts — bản chuyển đổi sang JavaScript từ "Smart Money Concepts [LuxAlgo]" (Pine Script v5)
// © LuxAlgo — https://www.tradingview.com/script/CnB3fSph-Smart-Money-Concepts-SMC-LuxAlgo/
//
// Bản gốc được cấp phép Attribution-NonCommercial-ShareAlike 4.0 International (CC BY-NC-SA 4.0)
// https://creativecommons.org/licenses/by-nc-sa/4.0/
// File này là tác phẩm phái sinh và được phân phối theo CÙNG giấy phép CC BY-NC-SA 4.0:
// phải ghi nguồn LuxAlgo, KHÔNG dùng cho mục đích thương mại, chia sẻ lại theo cùng giấy phép.
// Thay đổi so với bản gốc: viết lại bằng JS, tách phần tính toán khỏi phần vẽ (vẽ ở web/src/lib/smcDraw.ts).
// =====================================================================================================

export const BULLISH = 1;
export const BEARISH = -1;
const BULLISH_LEG = 1;
const BEARISH_LEG = 0;

export const SMC_DEFAULTS = {
  swingsLength: 50,          // Show Swings Points length
  internalLength: 5,
  equalLength: 3,            // Bars Confirmation
  equalThreshold: 0.1,
  internalConfluence: false, // Confluence Filter
  orderBlockFilter: 'Atr',   // 'Atr' | 'Range'
  orderBlockMitigation: 'High/Low', // 'Close' | 'High/Low'
  fvgAutoThreshold: true,
  fvgExtend: 1,
};

const pivotNew = () => ({ currentLevel: NaN, lastLevel: NaN, crossed: false, barTime: NaN, barIndex: NaN });

/**
 * Chạy SMC trên toàn bộ nến (chế độ "Historical"), trả về dữ liệu để vẽ & làm tín hiệu.
 * @param {{time:number, open:number, high:number, low:number, close:number}[]} bars
 */
export function computeSMC(bars, opts = {}) {
  const o = { ...SMC_DEFAULTS, ...opts };
  const n = bars.length;
  const H = bars.map((b) => b.high), L = bars.map((b) => b.low), C = bars.map((b) => b.close), O = bars.map((b) => b.open), T = bars.map((b) => b.time);

  const swingHigh = pivotNew(), swingLow = pivotNew();
  const internalHigh = pivotNew(), internalLow = pivotNew();
  const equalHigh = pivotNew(), equalLow = pivotNew();
  const swingTrend = { bias: 0 }, internalTrend = { bias: 0 };
  const trailing = { top: NaN, bottom: NaN, barTime: NaN, barIndex: NaN, lastTopTime: NaN, lastBottomTime: NaN };
  let swingOBs = [], internalOBs = [], fvgs = [];
  const parsedHighs = [], parsedLows = [];
  const out = { structures: [], swings: [], equals: [], obBreaks: [], fvgEvents: [], internalTrendByBar: new Array(n).fill(0) };

  // trạng thái "leg" riêng cho từng nơi gọi (giống var trong hàm Pine)
  const legState = { swing: { leg: 0, prev: 0 }, internal: { leg: 0, prev: 0 }, equal: { leg: 0, prev: 0 } };
  // lịch sử cho ta.crossover / ta.crossunder tại 4 nơi gọi
  const crossMem = { intBull: NaN, intBear: NaN, swBull: NaN, swBear: NaN };

  // ATR(200) = RMA của True Range; Range = trung bình cộng dồn TR
  let atr = NaN, trSum = 0, cumTR = 0, cumFvg = 0;
  const atrLen = 200;

  for (let i = 0; i < n; i++) {
    const tr = i === 0 ? H[i] - L[i] : Math.max(H[i] - L[i], Math.abs(H[i] - C[i - 1]), Math.abs(L[i] - C[i - 1]));
    cumTR += tr;
    if (i < atrLen) { trSum += tr; if (i === atrLen - 1) atr = trSum / atrLen; }
    else atr = (atr * (atrLen - 1) + tr) / atrLen;
    const volatility = o.orderBlockFilter === 'Atr' ? atr : (i > 0 ? cumTR / i : NaN);
    const highVol = (H[i] - L[i]) >= 2 * volatility;
    parsedHighs.push(highVol ? L[i] : H[i]);
    parsedLows.push(highVol ? H[i] : L[i]);

    // --- updateTrailingExtremes
    trailing.top = Math.max(H[i], trailing.top);
    trailing.lastTopTime = trailing.top === H[i] ? T[i] : trailing.lastTopTime;
    trailing.bottom = Math.min(L[i], trailing.bottom);
    trailing.lastBottomTime = trailing.bottom === L[i] ? T[i] : trailing.lastBottomTime;

    // --- deleteFairValueGaps
    fvgs = fvgs.filter((g) => !((L[i] < g.bottom && g.bias === BULLISH) || (H[i] > g.top && g.bias === BEARISH)));

    // --- getCurrentStructure
    const structure = (size, kind) => {
      const st = legState[kind];
      if (i >= size) {
        let hh = -Infinity, ll = Infinity;
        for (let k = i - size + 1; k <= i; k++) { if (H[k] > hh) hh = H[k]; if (L[k] < ll) ll = L[k]; }
        if (H[i - size] > hh) st.leg = BEARISH_LEG;
        else if (L[i - size] < ll) st.leg = BULLISH_LEG;
      }
      const change = i === 0 ? 0 : st.leg - st.prev;
      st.prev = st.leg;
      if (change === 0) return;
      const j = i - size;
      if (change === 1) { // pivot low
        const p = kind === 'equal' ? equalLow : kind === 'internal' ? internalLow : swingLow;
        if (kind === 'equal' && Math.abs(p.currentLevel - L[j]) < o.equalThreshold * atr) {
          out.equals.push({ type: 'EQL', fromTime: p.barTime, fromIndex: p.barIndex, fromPrice: p.currentLevel, toTime: T[j], toIndex: j, toPrice: L[j], at: i });
        }
        p.lastLevel = p.currentLevel; p.currentLevel = L[j]; p.crossed = false; p.barTime = T[j]; p.barIndex = j;
        if (kind === 'swing') {
          trailing.bottom = p.currentLevel; trailing.barTime = p.barTime; trailing.barIndex = p.barIndex; trailing.lastBottomTime = p.barTime;
          out.swings.push({ type: p.currentLevel < p.lastLevel ? 'LL' : 'HL', time: T[j], index: j, price: p.currentLevel });
        }
      } else { // pivot high
        const p = kind === 'equal' ? equalHigh : kind === 'internal' ? internalHigh : swingHigh;
        if (kind === 'equal' && Math.abs(p.currentLevel - H[j]) < o.equalThreshold * atr) {
          out.equals.push({ type: 'EQH', fromTime: p.barTime, fromIndex: p.barIndex, fromPrice: p.currentLevel, toTime: T[j], toIndex: j, toPrice: H[j], at: i });
        }
        p.lastLevel = p.currentLevel; p.currentLevel = H[j]; p.crossed = false; p.barTime = T[j]; p.barIndex = j;
        if (kind === 'swing') {
          trailing.top = p.currentLevel; trailing.barTime = p.barTime; trailing.barIndex = p.barIndex; trailing.lastTopTime = p.barTime;
          out.swings.push({ type: p.currentLevel > p.lastLevel ? 'HH' : 'LH', time: T[j], index: j, price: p.currentLevel });
        }
      }
    };
    structure(o.swingsLength, 'swing');
    structure(o.internalLength, 'internal');
    structure(o.equalLength, 'equal');

    // --- storeOrderBlock
    const storeOB = (p, internal, bias) => {
      const src = bias === BEARISH ? parsedHighs : parsedLows;
      let idx = p.barIndex, best = src[p.barIndex];
      for (let k = p.barIndex; k < i; k++) {
        if (bias === BEARISH ? src[k] > best : src[k] < best) { best = src[k]; idx = k; }
      }
      const list = internal ? internalOBs : swingOBs;
      if (list.length >= 100) list.pop();
      list.unshift({ high: parsedHighs[idx], low: parsedLows[idx], time: T[idx], index: idx, bias, createdAt: i });
    };

    // --- displayStructure
    const display = (internal) => {
      let bullishBar = true, bearishBar = true;
      if (o.internalConfluence) {
        bullishBar = H[i] - Math.max(C[i], O[i]) > Math.min(C[i], O[i] - L[i]);
        bearishBar = H[i] - Math.max(C[i], O[i]) < Math.min(C[i], O[i] - L[i]);
      }
      const trend = internal ? internalTrend : swingTrend;
      // bullish: close cắt lên đỉnh pivot
      let p = internal ? internalHigh : swingHigh;
      let extra = internal ? internalHigh.currentLevel !== swingHigh.currentLevel && bullishBar : true;
      let memKey = internal ? 'intBull' : 'swBull';
      let lvl = p.currentLevel;
      const crossUp = i > 0 && C[i] > lvl && C[i - 1] <= crossMem[memKey];
      crossMem[memKey] = lvl;
      if (crossUp && !p.crossed && extra) {
        const tag = trend.bias === BEARISH ? 'CHoCH' : 'BOS';
        p.crossed = true; trend.bias = BULLISH;
        out.structures.push({ tag, bias: BULLISH, internal, level: p.currentLevel, fromTime: p.barTime, fromIndex: p.barIndex, toTime: T[i], toIndex: i });
        storeOB(p, internal, BULLISH);
      }
      // bearish: close cắt xuống đáy pivot
      p = internal ? internalLow : swingLow;
      extra = internal ? internalLow.currentLevel !== swingLow.currentLevel && bearishBar : true;
      memKey = internal ? 'intBear' : 'swBear';
      lvl = p.currentLevel;
      const crossDn = i > 0 && C[i] < lvl && C[i - 1] >= crossMem[memKey];
      crossMem[memKey] = lvl;
      if (crossDn && !p.crossed && extra) {
        const tag = trend.bias === BULLISH ? 'CHoCH' : 'BOS';
        p.crossed = true; trend.bias = BEARISH;
        out.structures.push({ tag, bias: BEARISH, internal, level: p.currentLevel, fromTime: p.barTime, fromIndex: p.barIndex, toTime: T[i], toIndex: i });
        storeOB(p, internal, BEARISH);
      }
    };
    display(true);
    display(false);
    out.internalTrendByBar[i] = internalTrend.bias;

    // --- deleteOrderBlocks (bị "mitigate")
    const bearSrc = o.orderBlockMitigation === 'Close' ? C[i] : H[i];
    const bullSrc = o.orderBlockMitigation === 'Close' ? C[i] : L[i];
    const mitigate = (list, internal) => list.filter((ob) => {
      const broken = (bearSrc > ob.high && ob.bias === BEARISH) || (bullSrc < ob.low && ob.bias === BULLISH);
      if (broken) out.obBreaks.push({ internal, bias: ob.bias, at: i, high: ob.high, low: ob.low });
      return !broken;
    });
    internalOBs = mitigate(internalOBs, true);
    swingOBs = mitigate(swingOBs, false);

    // --- drawFairValueGaps (khung thời gian = khung biểu đồ)
    if (i >= 2) {
      const lastClose = C[i - 1], lastOpen = O[i - 1];
      const delta = (lastClose - lastOpen) / (lastOpen * 100);
      cumFvg += Math.abs(delta);
      const threshold = o.fvgAutoThreshold ? (cumFvg / i) * 2 : 0;
      const step = T[i] - T[i - 1];
      if (L[i] > H[i - 2] && lastClose > H[i - 2] && delta > threshold) {
        const g = { top: L[i], bottom: H[i - 2], bias: BULLISH, leftTime: T[i - 1], leftIndex: i - 1, rightIndex: i + o.fvgExtend, at: i, step };
        fvgs.unshift(g); out.fvgEvents.push(g);
      }
      if (H[i] < L[i - 2] && lastClose < L[i - 2] && -delta > threshold) {
        const g = { top: H[i], bottom: L[i - 2], bias: BEARISH, leftTime: T[i - 1], leftIndex: i - 1, rightIndex: i + o.fvgExtend, at: i, step };
        fvgs.unshift(g); out.fvgEvents.push(g);
      }
    }
  }

  out.internalOBs = internalOBs;
  out.swingOBs = swingOBs;
  out.fvgs = fvgs;
  out.trailing = { ...trailing };
  out.swingTrend = swingTrend.bias;
  out.internalTrend = internalTrend.bias;
  out.n = n;
  return out;
}

/** Tóm tắt tín hiệu SMC ở nến cuối (dùng cho bộ lọc / cảnh báo) */
export function smcLastBarSignals(smc) {
  const last = smc.n - 1;
  const at = smc.structures.filter((s) => s.toIndex === last);
  const has = (bias, tag, internal) => at.some((s) => s.bias === bias && s.tag === tag && (internal === undefined || s.internal === internal));
  return {
    smcBullChoch: has(BULLISH, 'CHoCH'), smcBearChoch: has(BEARISH, 'CHoCH'),
    smcBullBos: has(BULLISH, 'BOS'), smcBearBos: has(BEARISH, 'BOS'),
    smcSwingBullChoch: has(BULLISH, 'CHoCH', false),
    smcSwingTrend: smc.swingTrend, smcInternalTrend: smc.internalTrend,
  };
}
