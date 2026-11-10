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
