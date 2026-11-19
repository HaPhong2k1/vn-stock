// Thư viện chỉ báo kỹ thuật dùng chung cho server (bộ lọc, cảnh báo) và web (biểu đồ).
// Mọi hàm nhận mảng số, trả mảng cùng độ dài; vị trí chưa đủ dữ liệu = null.

export function sma(values, period) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let prev = 0;
  for (let i = 0; i < period; i++) prev += values[i];
  prev /= period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) { prev = values[i] * k + prev * (1 - k); out[i] = prev; }
  return out;
}

/** RSI theo Wilder */
export function rsi(values, period = 14) {
  const out = new Array(values.length).fill(null);
  if (values.length <= period) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d > 0) gain += d; else loss -= d;
  }
  gain /= period; loss /= period;
  out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

export function macd(values, fast = 12, slow = 26, signal = 9) {
  const ef = ema(values, fast), es = ema(values, slow);
  const line = values.map((_, i) => (ef[i] !== null && es[i] !== null ? ef[i] - es[i] : null));
  const start = line.findIndex((v) => v !== null);
  const sig = new Array(values.length).fill(null);
  if (start >= 0) {
    const e = ema(line.slice(start), signal);
    e.forEach((v, i) => { sig[start + i] = v; });
  }
  const hist = line.map((v, i) => (v !== null && sig[i] !== null ? v - sig[i] : null));
  return { line, signal: sig, hist };
}

export function bollinger(values, period = 20, mult = 2) {
  const mid = sma(values, period);
  const upper = new Array(values.length).fill(null);
  const lower = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    let s = 0;
    for (let j = i - period + 1; j <= i; j++) s += (values[j] - mid[i]) ** 2;
    const sd = Math.sqrt(s / period);
    upper[i] = mid[i] + mult * sd; lower[i] = mid[i] - mult * sd;
  }
  return { mid, upper, lower };
}

/** Chỉ số i mà a cắt lên b: a[i-1] <= b[i-1] và a[i] > b[i] */
export function crossUp(a, b, i) {
  return i > 0 && a[i - 1] !== null && b[i - 1] !== null && a[i] !== null && b[i] !== null
    && a[i - 1] <= b[i - 1] && a[i] > b[i];
}
export function crossDown(a, b, i) {
  return i > 0 && a[i - 1] !== null && b[i - 1] !== null && a[i] !== null && b[i] !== null
    && a[i - 1] >= b[i - 1] && a[i] < b[i];
}

// ======================= Chỉ báo bổ sung (kiểu TradingView) =======================
// Quy ước: H/L/C/V là mảng cùng độ dài; trả về mảng (null khi chưa đủ dữ liệu).

const nulls = (n) => new Array(n).fill(null);
/** RMA (Wilder) — như ta.rma: khởi tạo bằng SMA */
export function rma(values, period) {
  const out = nulls(values.length);
  let sum = 0, cnt = 0, prev = null;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === null || v === undefined || Number.isNaN(v)) continue;
    if (prev === null) { sum += v; cnt++; if (cnt === period) { prev = sum / period; out[i] = prev; } }
    else { prev = (prev * (period - 1) + v) / period; out[i] = prev; }
  }
  return out;
}

export function wma(values, period) {
  const out = nulls(values.length), den = (period * (period + 1)) / 2;
  for (let i = period - 1; i < values.length; i++) {
    let s = 0;
    for (let j = 0; j < period; j++) s += values[i - j] * (period - j);
    out[i] = s / den;
  }
  return out;
}

export function trueRange(H, L, C) {
  return H.map((h, i) => (i === 0 ? h - L[i] : Math.max(h - L[i], Math.abs(h - C[i - 1]), Math.abs(L[i] - C[i - 1]))));
}
export const atr = (H, L, C, period = 14) => rma(trueRange(H, L, C), period);

const highest = (a, i, n) => { let m = -Infinity; for (let j = Math.max(0, i - n + 1); j <= i; j++) m = Math.max(m, a[j]); return m; };
const lowest = (a, i, n) => { let m = Infinity; for (let j = Math.max(0, i - n + 1); j <= i; j++) m = Math.min(m, a[j]); return m; };

/** Stochastic %K (làm mượt) & %D */
export function stochastic(H, L, C, kLen = 14, kSmooth = 3, dLen = 3) {
  const raw = C.map((c, i) => {
    if (i < kLen - 1) return null;
    const hh = highest(H, i, kLen), ll = lowest(L, i, kLen);
    return hh === ll ? 50 : ((c - ll) / (hh - ll)) * 100;
  });
  const k = smaN(raw, kSmooth), d = smaN(k, dLen);
  return { k, d };
}
/** SMA bỏ qua null ở đầu chuỗi */
function smaN(values, period) {
  const out = nulls(values.length);
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) continue;
    let s = 0, ok = true;
    for (let j = i - period + 1; j <= i; j++) { if (values[j] === null) { ok = false; break; } s += values[j]; }
    if (ok) out[i] = s / period;
  }
  return out;
}

export function stochRsi(C, rsiLen = 14, stochLen = 14, kSmooth = 3, dLen = 3) {
  const r = rsi(C, rsiLen);
  const raw = r.map((v, i) => {
    if (v === null || i < stochLen - 1) return null;
    let hh = -Infinity, ll = Infinity;
    for (let j = i - stochLen + 1; j <= i; j++) { if (r[j] === null) return null; hh = Math.max(hh, r[j]); ll = Math.min(ll, r[j]); }
    return hh === ll ? 50 : ((v - ll) / (hh - ll)) * 100;
  });
  const k = smaN(raw, kSmooth), d = smaN(k, dLen);
  return { k, d };
}

/** ADX / DMI (Wilder) */
export function adx(H, L, C, len = 14) {
  const n = H.length, plusDM = nulls(n), minusDM = nulls(n);
  for (let i = 1; i < n; i++) {
    const up = H[i] - H[i - 1], dn = L[i - 1] - L[i];
    plusDM[i] = up > dn && up > 0 ? up : 0;
    minusDM[i] = dn > up && dn > 0 ? dn : 0;
  }
  const tr = trueRange(H, L, C); tr[0] = null;
  const atrS = rma(tr, len), pS = rma(plusDM, len), mS = rma(minusDM, len);
  const pdi = nulls(n), mdi = nulls(n), dx = nulls(n);
  for (let i = 0; i < n; i++) {
    if (atrS[i] === null || pS[i] === null || mS[i] === null || atrS[i] === 0) continue;
    pdi[i] = (100 * pS[i]) / atrS[i]; mdi[i] = (100 * mS[i]) / atrS[i];
    const s = pdi[i] + mdi[i];
    dx[i] = s === 0 ? 0 : (100 * Math.abs(pdi[i] - mdi[i])) / s;
  }
  return { adx: rma(dx, len), pdi, mdi };
}

export function cci(H, L, C, len = 20) {
  const tp = C.map((c, i) => (H[i] + L[i] + c) / 3);
  const m = sma(tp, len);
  return tp.map((v, i) => {
    if (m[i] === null) return null;
    let dev = 0;
    for (let j = i - len + 1; j <= i; j++) dev += Math.abs(tp[j] - m[i]);
    dev /= len;
    return dev === 0 ? 0 : (v - m[i]) / (0.015 * dev);
  });
}

export function williamsR(H, L, C, len = 14) {
  return C.map((c, i) => {
    if (i < len - 1) return null;
    const hh = highest(H, i, len), ll = lowest(L, i, len);
    return hh === ll ? -50 : ((hh - c) / (hh - ll)) * -100;
  });
}

export function obv(C, V) {
  const out = new Array(C.length);
  out[0] = 0;
  for (let i = 1; i < C.length; i++) out[i] = out[i - 1] + (C[i] > C[i - 1] ? V[i] : C[i] < C[i - 1] ? -V[i] : 0);
  return out;
}

export function mfi(H, L, C, V, len = 14) {
  const tp = C.map((c, i) => (H[i] + L[i] + c) / 3);
  return tp.map((_, i) => {
    if (i < len) return null;
    let pos = 0, neg = 0;
    for (let j = i - len + 1; j <= i; j++) {
      const f = tp[j] * V[j];
      if (tp[j] > tp[j - 1]) pos += f; else if (tp[j] < tp[j - 1]) neg += f;
    }
    return neg === 0 ? 100 : 100 - 100 / (1 + pos / neg);
  });
}

/** VWAP reset theo phiên (key(i) trả về khoá phiên, VD ngày) */
export function vwap(H, L, C, V, key) {
  const out = nulls(C.length);
  let pv = 0, vv = 0, k = null;
  for (let i = 0; i < C.length; i++) {
    const kk = key(i);
    if (kk !== k) { pv = 0; vv = 0; k = kk; }
    const tp = (H[i] + L[i] + C[i]) / 3;
    pv += tp * V[i]; vv += V[i];
    out[i] = vv ? pv / vv : tp;
  }
  return out;
}

/** SuperTrend (ATR, hệ số) — như ta.supertrend; dir: 1 = xu hướng tăng, -1 = giảm */
export function supertrend(H, L, C, len = 10, mult = 3) {
  const a = atr(H, L, C, len), n = C.length;
  const line = nulls(n), dir = nulls(n);
  let upPrev = null, dnPrev = null, dirPrev = 1, stPrev = null;
  for (let i = 0; i < n; i++) {
    if (a[i] === null) continue;
    const hl2 = (H[i] + L[i]) / 2;
    let up = hl2 - mult * a[i], dn = hl2 + mult * a[i];
    if (upPrev !== null && C[i - 1] > upPrev) up = Math.max(up, upPrev);
    if (dnPrev !== null && C[i - 1] < dnPrev) dn = Math.min(dn, dnPrev);
    let d;
    if (stPrev === null) d = 1;
    else if (stPrev === dnPrev) d = C[i] > dn ? 1 : -1;
    else d = C[i] < up ? -1 : 1;
    const st = d === 1 ? up : dn;
    line[i] = st; dir[i] = d;
    upPrev = up; dnPrev = dn; dirPrev = d; stPrev = st;
  }
  return { line, dir };
}

/** Parabolic SAR */
export function psar(H, L, start = 0.02, inc = 0.02, max = 0.2) {
  const n = H.length, out = nulls(n);
  if (n < 2) return out;
  let up = H[1] >= H[0], af = start, ep = up ? H[1] : L[1], sar = up ? L[0] : H[0];
  out[1] = sar;
  for (let i = 2; i < n; i++) {
    sar = sar + af * (ep - sar);
    if (up) {
      sar = Math.min(sar, L[i - 1], L[i - 2]);
      if (L[i] < sar) { up = false; sar = ep; ep = L[i]; af = start; }
      else if (H[i] > ep) { ep = H[i]; af = Math.min(max, af + inc); }
    } else {
      sar = Math.max(sar, H[i - 1], H[i - 2]);
      if (H[i] > sar) { up = true; sar = ep; ep = H[i]; af = start; }
      else if (L[i] < ep) { ep = L[i]; af = Math.min(max, af + inc); }
    }
    out[i] = sar;
  }
  return out;
}

/** Ichimoku: mây (spanA/B) đã dịch tới trước `disp` nến (phần vượt quá nến cuối bị cắt) */
export function ichimoku(H, L, C, conv = 9, base = 26, spanB = 52, disp = 26) {
  const n = C.length;
  const mid = (len) => H.map((_, i) => (i < len - 1 ? null : (highest(H, i, len) + lowest(L, i, len)) / 2));
  const tenkan = mid(conv), kijun = mid(base), sb = mid(spanB);
  const spanA = nulls(n), spanBo = nulls(n), chikou = nulls(n);
  for (let i = 0; i < n; i++) {
    const j = i - disp + 1; // giá trị tại i được vẽ ở i + disp - 1 (như TradingView)
    if (j >= 0) {
      if (tenkan[j] !== null && kijun[j] !== null) spanA[i] = (tenkan[j] + kijun[j]) / 2;
      spanBo[i] = sb[j];
    }
    if (i + disp - 1 < n) chikou[i] = C[i + disp - 1];
  }
  return { tenkan, kijun, spanA, spanB: spanBo, chikou };
}

export function donchian(H, L, len = 20) {
  const upper = H.map((_, i) => (i < len - 1 ? null : highest(H, i, len)));
  const lower = L.map((_, i) => (i < len - 1 ? null : lowest(L, i, len)));
  return { upper, lower, mid: upper.map((u, i) => (u === null ? null : (u + lower[i]) / 2)) };
}

export function keltner(H, L, C, len = 20, mult = 2) {
  const mid = ema(C, len), a = atr(H, L, C, len);
  return { mid, upper: mid.map((m, i) => (m === null || a[i] === null ? null : m + mult * a[i])), lower: mid.map((m, i) => (m === null || a[i] === null ? null : m - mult * a[i])) };
}
