// Elliott Wave Analyzer Pro ("Ahmad PRO") — port từ Pine Script v5 sang JavaScript.
// Mã gốc: This Pine Script™ is subject to the terms of the Mozilla Public License 2.0
// https://mozilla.org/MPL/2.0/ — file này là tác phẩm phái sinh, cũng theo MPL 2.0.
//
// Giữ nguyên thuật toán: zigzag pivot -> nhận dạng Impulse / Zigzag / Flat / Triangle / Diagonal / WXY / WXYXZ,
// chọn mẫu có độ tin cậy cao nhất, sinh tín hiệu (BUY / TAKE PROFIT / ACCUMULATE, hoặc Long/Short khi bật đòn bẩy),
// điểm khuyến nghị tổng hợp (EW + EMA + RSI + MACD + Stoch + ADX + đa khung thời gian).
// Bỏ phần "Precious Metals" (chỉ dành cho XAUUSD/XAGUSD).
//
// Đầu ra gồm các "lệnh vẽ" giống Pine (label/line/box theo chỉ số nến) để web vẽ lên canvas.
import { ema, rsi, macd, stochastic, adx, atr, sma, bollinger } from './indicators.js';

export const EW_DEFAULTS = {
  useLeverage: false, leverageX: 3, riskPct: 2,
  pivotLen: 8, minWavePct: 0.3,
  showZones: true, showTargets: true, zoneWidth: 25, showFib: false,
  showImp: true, showZig: true, showFlt: true, showTri: true, showDia: true, showCpx: true,
  showCorr: true, showSig: true, showLns: true, showPnl: true, showTADetail: false,
};
export const EW_COLORS = {
  imp: '#2962FF', zig: '#FF6D00', flt: '#FFD600', tri: '#AA00FF', dia: '#00BFA5', cpx: '#D500F9',
  buy: '#00E676', sel: '#FF1744', tp: '#00B0FF', fib: '#787B86', accum: '#00BCD4', white: '#FFFFFF',
};

// na-semantics: null/undefined/NaN = na. So sánh với na luôn false (dùng NaN), nz() = 0.
const isNa = (x) => x === null || x === undefined || Number.isNaN(x);
const V = (x) => (isNa(x) ? NaN : x);
const nz = (x, d = 0) => (isNa(x) ? d : x);

/** ta.pivothigh / ta.pivotlow: trả về chỉ số nến tâm nếu là pivot (xác nhận sau `len` nến) */
function isPivot(src, c, len, high) {
  if (c - len < 0 || c + len >= src.length) return false;
  const v = src[c];
  for (let j = c - len; j < c; j++) if (high ? src[j] > v : src[j] < v) return false;
  for (let j = c + 1; j <= c + len; j++) if (high ? src[j] >= v : src[j] <= v) return false;
  return true;
}

function tfBias(e50, e200, cl) {
  const a = nz(e50), b = nz(e200);
  if (cl > a && a > b) return 2;
  if (a > b) return 1;
  if (cl < a && a < b) return -2;
  if (a < b) return -1;
  return 0;
}

const last = (a) => (a.length ? a[a.length - 1] : null);

/**
 * @param bars nến của biểu đồ (time, open, high, low, close, volume), cũ -> mới
 * @param opts EW_DEFAULTS
 * @param htf { d?: bars ngày, w?: bars tuần } — để tính xu hướng đa khung (mặc định dùng chính bars)
 */
export function computeEW(bars, opts = {}, htf = {}) {
  const o = { ...EW_DEFAULTS, ...opts };
  const C = EW_COLORS;
  const n = bars.length;
  const H = bars.map((b) => b.high), L = bars.map((b) => b.low), CL = bars.map((b) => b.close), VO = bars.map((b) => b.volume || 0);
  const out = { pat: 'Scanning...', dir: '—', conf: 0, sub: '', phase: 0, type: 0, sig: '—', rec: 'HOLD', score: 0,
    ent: null, stp: null, tgt1: null, tgt2: null, tgt3: null, buyBot: null, buyTop: null, sellBot: null, sellTop: null,
    labels: [], lines: [], boxes: [], pivots: [], ta: null, tf: null, depth: null, opts: o, n };
  if (n < 3) return out;
  const i = n - 1; // bar_index cuối

  // ── Chỉ báo kỹ thuật
  const atrA = atr(H, L, CL, 14);
  const e20 = ema(CL, 20), e50 = ema(CL, 50), e200 = ema(CL, 200);
  const rsiA = rsi(CL, 14);
  const md = macd(CL, 12, 26, 9);
  const st = stochastic(H, L, CL, 14, 1, 3); // ta.stoch thô + SMA3
  const dm = adx(H, L, CL, 14);
  const volSma = sma(VO, 20);
  const hh = (a, k, len) => { let m = -Infinity; for (let j = Math.max(0, k - len + 1); j <= k; j++) m = Math.max(m, a[j]); return k < 0 ? NaN : m; };
  const ll = (a, k, len) => { let m = Infinity; for (let j = Math.max(0, k - len + 1); j <= k; j++) m = Math.min(m, a[j]); return k < 0 ? NaN : m; };
  // ta.highest(high, 50) cần đủ 50 nến
  const recentHigh = i >= 49 ? hh(H, i, 50) : NaN, recentLow = i >= 49 ? ll(L, i, 50) : NaN;
  const prevSwingHigh = i - 50 >= 49 ? hh(H, i - 50, 50) : NaN, prevSwingLow = i - 50 >= 49 ? ll(L, i - 50, 50) : NaN;
  const bb = bollinger(CL, 20, 2);
  const close = CL[i];
  const atrVal = V(atrA[i]), ema20 = V(e20[i]), ema50 = V(e50[i]), ema200 = V(e200[i]), rsiVal = V(rsiA[i]);
  const macdLine = V(md.line[i]), macdSignal = V(md.signal[i]), macdHist = V(md.hist[i]), macdHistPrev = V(md.hist[i - 1]);
  const stochK = V(st.k[i]), stochD = V(st.d[i]), adxVal = V(dm.adx[i]);
  const volRatio = nz(VO[i]) / nz(volSma[i], 1);
  const bbMid = V(bb.mid[i]), bbUpper = V(bb.upper[i]), bbLower = V(bb.lower[i]);
  const bbWidth = (nz(bbUpper - bbLower) / nz(bbMid, 1)) * 100;
  const higherHighs = recentHigh > nz(prevSwingHigh), higherLows = recentLow > nz(prevSwingLow);

  // ── Đa khung thời gian: giá trị nến tuần/ngày hiện tại (đang chạy), như request.security không lookahead
  const tfv = (bs) => {
    const c = (bs && bs.length ? bs : bars).map((b) => b.close);
    return { e50: V(last(ema(c, 50))), e200: V(last(ema(c, 200))), rsi: V(last(rsi(c, 14))), close: V(last(c)) };
  };
  const W = tfv(htf.w), D = tfv(htf.d);
  const wBias = tfBias(W.e50, W.e200, nz(W.close)), dBias = tfBias(D.e50, D.e200, nz(D.close)), cBias = tfBias(ema50, ema200, close);
  const tfAlign = wBias + dBias + cBias;

  // ── Zigzag pivot engine
  const pvP = [], pvB = [], pvD = [];
  const addPivot = (price, b, dir) => {
    const sz = pvP.length;
    if (sz > 0) {
      const ld = pvD[sz - 1], lp = pvP[sz - 1];
      if (dir === ld) {
        if ((dir === 1 && price > lp) || (dir === -1 && price < lp)) { pvP[sz - 1] = price; pvB[sz - 1] = b; }
      } else if (Math.abs(price - lp) >= (lp * o.minWavePct) / 100) { pvP.push(price); pvB.push(b); pvD.push(dir); }
    } else { pvP.push(price); pvB.push(b); pvD.push(dir); }
  };
  const len = Math.max(2, Math.round(o.pivotLen));
  for (let t = 0; t < n; t++) {
    const c = t - len;
    if (c < 0) continue;
    if (isPivot(H, c, len, true)) addPivot(H[c], c, 1);
    if (isPivot(L, c, len, false)) addPivot(L[c], c, -1);
    while (pvP.length > 50) { pvP.shift(); pvB.shift(); pvD.shift(); }
  }
  out.pivots = pvP.map((p, k) => ({ p, b: pvB[k], d: pvD[k] }));
  const sz = pvP.length;
  const fp = (back) => { const k = sz - 1 - back; return k >= 0 ? [pvP[k], pvB[k], pvD[k]] : [NaN, NaN, 0]; };

  // ── Bộ nhận dạng (giữ nguyên quy tắc & điểm của bản gốc)
  const impulse = () => {
    const [p0, , d0] = fp(5), [p1, , d1] = fp(4), [p2, , d2] = fp(3), [p3, , d3] = fp(2), [p4, , d4] = fp(1), [p5, , d5] = fp(0);
    let v = false, dr = '', c = 0;
    if (!isNa(p0) && !isNa(p5)) {
      const score = (w1, w2r, w3, w4r, w5, w13) => {
        let c = 50;
        const pct2 = (w2r / w1) * 100, pct4 = w3 > 0 ? (w4r / w3) * 100 : 0;
        if (pct2 >= 50 && pct2 <= 85.4) c += 12; else if (pct2 >= 38.2 && pct2 < 50) c += 6;
        if (w3 >= w1 * 2.618) c += 13; else if (w3 >= w1 * 1.618) c += 10; else if (w3 > w1) c += 4;
        if (pct4 >= 14.6 && pct4 <= 38.2) c += 12; else if (pct4 > 38.2 && pct4 <= 50) c += 6;
        const w5pct1 = (w5 / w1) * 100, w5pct13 = w13 > 0 ? (w5 / w13) * 100 : 0;
        if (w5pct1 >= 90 && w5pct1 <= 110) c += 8; else if (w5pct13 >= 55 && w5pct13 <= 70) c += 8; else if (w5 >= w1 * 0.618 && w5 <= w1 * 1.618) c += 3;
        if ((pct2 > 50 && pct4 < 30) || (pct2 < 50 && pct4 > 23.6)) c += 5;
        return c;
      };
      if (d0 === -1 && d1 === 1 && d2 === -1 && d3 === 1 && d4 === -1 && d5 === 1) {
        const w1 = p1 - p0, w2r = p1 - p2, w3 = p3 - p2, w4r = p3 - p4, w5 = p5 - p4, w13 = p3 - p0;
        const r1 = w2r < w1 && w2r > 0, r2 = !(w3 < w1 && w3 < w5), r3 = p4 > p1;
        if (r1 && r2 && r3 && p2 > p0 && w1 > 0 && w3 > 0 && w5 > 0) { v = true; dr = 'Bullish'; c = score(w1, w2r, w3, w4r, w5, w13); }
      }
      if (!v && d0 === 1 && d1 === -1 && d2 === 1 && d3 === -1 && d4 === 1 && d5 === -1) {
        const w1 = p0 - p1, w2r = p2 - p1, w3 = p2 - p3, w4r = p4 - p3, w5 = p4 - p5, w13 = p0 - p3;
        const r1 = w2r < w1 && w2r > 0, r2 = !(w3 < w1 && w3 < w5), r3 = p4 < p1;
        if (r1 && r2 && r3 && p2 < p0 && w1 > 0 && w3 > 0 && w5 > 0) { v = true; dr = 'Bearish'; c = score(w1, w2r, w3, w4r, w5, w13); }
      }
    }
    return [v, dr, c];
  };

  const zigzag = () => {
    const [p0, , d0] = fp(3), [p1, , d1] = fp(2), [p2, , d2] = fp(1), [p3, , d3] = fp(0);
    let v = false, dr = '', c = 0;
    if (!isNa(p0) && !isNa(p3)) {
      const sc = (bR, cR, beyond) => {
        let c = 50;
        if (bR >= 50 && bR <= 78.6) c += 15; else if (bR >= 38.2 && bR < 50) c += 8;
        if (cR >= 100 && cR <= 161.8) c += 15; else if (cR >= 61.8 && cR < 100) c += 10;
        if (cR >= 95 && cR <= 105) c += 5;
        if (beyond) c += 5;
        return c;
      };
      if (d0 === 1 && d1 === -1 && d2 === 1 && d3 === -1) {
        const wA = p0 - p1, wB = p2 - p1, wC = p2 - p3;
        if (wA > 0 && wC > 0) {
          const bR = (wB / wA) * 100, cR = (wC / wA) * 100;
          if (bR < 100 && bR >= 30 && p2 < p0) { v = true; dr = 'Bearish'; c = sc(bR, cR, p3 < p1); }
        }
      }
      if (!v && d0 === -1 && d1 === 1 && d2 === -1 && d3 === 1) {
        const wA = p1 - p0, wB = p1 - p2, wC = p3 - p2;
        if (wA > 0 && wC > 0) {
          const bR = (wB / wA) * 100, cR = (wC / wA) * 100;
          if (bR < 100 && bR >= 30 && p2 > p0) { v = true; dr = 'Bullish'; c = sc(bR, cR, p3 > p1); }
        }
      }
    }
    return [v, dr, c];
  };

  const flat = () => {
    const [p0, , d0] = fp(3), [p1, , d1] = fp(2), [p2, , d2] = fp(1), [p3, , d3] = fp(0);
    let v = false, dr = '', c = 0, ft = '';
    if (!isNa(p0) && !isNa(p3)) {
      if (d0 === 1 && d1 === -1 && d2 === 1 && d3 === -1) {
        const wA = p0 - p1, wB = p2 - p1, wC = p2 - p3;
        if (wA > 0 && wC > 0) {
          const bR = (wB / wA) * 100;
          if (bR >= 90) {
            v = true; dr = 'Bearish'; c = 48;
            if (bR >= 90 && bR <= 105) { ft = 'Regular Flat'; c += 15; }
            else if (bR > 105 && p2 > p0) { ft = 'Expanded Flat'; c += 12; }
            else if (bR > 100 && p3 > p1) { ft = 'Running Flat'; c += 10; }
            else ft = 'Flat';
            const cR = (wC / wA) * 100;
            if (cR >= 100 && cR <= 165) c += 12; else if (cR >= 61.8 && cR < 100) c += 6;
          }
        }
      }
      if (!v && d0 === -1 && d1 === 1 && d2 === -1 && d3 === 1) {
        const wA = p1 - p0, wB = p1 - p2, wC = p3 - p2;
        if (wA > 0 && wC > 0) {
          const bR = (wB / wA) * 100;
          if (bR >= 90) {
            v = true; dr = 'Bullish'; c = 48;
            if (bR >= 90 && bR <= 105) { ft = 'Regular Flat'; c += 15; }
            else if (bR > 105 && p2 < p0) { ft = 'Expanded Flat'; c += 12; }
            else if (bR > 100 && p3 < p1) { ft = 'Running Flat'; c += 10; }
            else ft = 'Flat';
            const cR = (wC / wA) * 100;
            if (cR >= 100 && cR <= 165) c += 12; else if (cR >= 61.8 && cR < 100) c += 6;
          }
        }
      }
    }
    return [v, dr, c, ft];
  };

  const triangle = () => {
    const [p0, , d0] = fp(5), [p1, , d1] = fp(4), [p2, , d2] = fp(3), [p3, , d3] = fp(2), [p4, , d4] = fp(1), [p5, , d5] = fp(0);
    let v = false, dr = '', c = 0, tt = '';
    if (!isNa(p0) && !isNa(p5)) {
      let h0 = NaN, h1 = NaN, h2 = NaN, l0 = NaN, l1 = NaN, l2 = NaN;
      if (d0 === 1 && d1 === -1 && d2 === 1 && d3 === -1 && d4 === 1 && d5 === -1) { h0 = p0; h1 = p2; h2 = p4; l0 = p1; l1 = p3; l2 = p5; }
      if (d0 === -1 && d1 === 1 && d2 === -1 && d3 === 1 && d4 === -1 && d5 === 1) { h0 = p1; h1 = p3; h2 = p5; l0 = p0; l1 = p2; l2 = p4; }
      if (!isNa(h0)) {
        const hFall = h1 < h0 && h2 < h1, lRise = l1 > l0 && l2 > l1;
        const hFlat = Math.abs(h1 - h0) / h0 < 0.02 && Math.abs(h2 - h1) / h1 < 0.02;
        const lFlat = Math.abs(l1 - l0) / l0 < 0.02 && Math.abs(l2 - l1) / l1 < 0.02;
        const hRise = h1 > h0 && h2 > h1, lFall = l1 < l0 && l2 < l1;
        const range0 = h0 - l0, range2 = h2 - l2;
        if (hFall && lRise) { v = true; tt = 'Contracting Triangle'; c = 60; dr = d0 === 1 ? 'Bearish' : 'Bullish'; if (range2 < range0) c += 15; }
        else if (hFlat && lRise) { v = true; tt = 'Ascending Triangle'; c = 55; dr = 'Bullish'; }
        else if (hFall && lFlat) { v = true; tt = 'Descending Triangle'; c = 55; dr = 'Bearish'; }
        else if (hRise && lFall) { v = true; tt = 'Expanding Triangle'; c = 45; dr = d0 === 1 ? 'Bearish' : 'Bullish'; if (range2 > range0) c += 10; }
        if (v && (tt === 'Contracting Triangle' || tt === 'Ascending Triangle' || tt === 'Descending Triangle')) {
          const wA = Math.abs(p1 - p0), wC = Math.abs(p3 - p2), wE = Math.abs(p5 - p4);
          if (wC < wA && wE < wC) c += 10;
        }
      }
    }
    return [v, dr, c, tt];
  };

  const diagonal = () => {
    const [p0, , d0] = fp(5), [p1, , d1] = fp(4), [p2, , d2] = fp(3), [p3, , d3] = fp(2), [p4, , d4] = fp(1), [p5, , d5] = fp(0);
    let v = false, dr = '', c = 0, dt = '';
    if (!isNa(p0) && !isNa(p5)) {
      const run = (overlap, w1, w2r, w3, w4r, w5, trending, dir) => {
        const converging = w3 < w1 && w5 < w3, expanding = w3 > w1 && w5 > w3;
        if (overlap && converging && trending) {
          v = true; dr = dir; dt = 'Ending Diagonal'; c = 58;
          if (w5 <= w3 * 0.618) c += 10;
          if (w1 > 0) { const p2r = (w2r / w1) * 100; if (p2r >= 50 && p2r <= 90) c += 6; }
          if (w3 > 0) { const p4r = (w4r / w3) * 100; if (p4r >= 38.2 && p4r <= 80) c += 6; }
        } else if (overlap && expanding && trending) { v = true; dr = dir; dt = 'Leading Diagonal'; c = 50; if (w3 > w1 * 1.2) c += 5; }
        else if (overlap && trending) { v = true; dr = dir; dt = 'Diagonal'; c = 45; }
      };
      if (d0 === -1 && d1 === 1 && d2 === -1 && d3 === 1 && d4 === -1 && d5 === 1)
        run(p4 < p1, p1 - p0, p1 - p2, p3 - p2, p3 - p4, p5 - p4, p5 > p3 && p3 > p1, 'Bullish');
      if (!v && d0 === 1 && d1 === -1 && d2 === 1 && d3 === -1 && d4 === 1 && d5 === -1)
        run(p4 > p1, p0 - p1, p2 - p1, p2 - p3, p4 - p3, p4 - p5, p5 < p3 && p3 < p1, 'Bearish');
    }
    return [v, dr, c, dt];
  };

  const wxy = () => {
    const [p0, , d0] = fp(6), [p1, , d1] = fp(5), [p2, , d2] = fp(4), [p3, , d3] = fp(3), [p4, , d4] = fp(2), [p5, , d5] = fp(1), [p6, , d6] = fp(0);
    let v = false, dr = '', c = 0, ct = '';
    if (!isNa(p0) && !isNa(p6)) {
      const run = (wW, wX, wY, overall, dir) => {
        if (wW > 0 && wY > 0 && overall > 0) {
          const xPct = (wX / wW) * 100;
          if (xPct >= 30 && xPct <= 90) {
            v = true; dr = dir; c = 48; ct = 'Double Zigzag (WXY)';
            if (xPct >= 38.2 && xPct <= 78.6) c += 12;
            const yToW = (wY / wW) * 100;
            if (yToW >= 61.8 && yToW <= 161.8) c += 10;
            if (yToW >= 90 && yToW <= 110) { c += 5; ct = 'Double Three (WXY)'; }
          }
        }
      };
      if (d0 === 1 && d1 === -1 && d2 === 1 && d3 === -1 && d4 === 1 && d5 === -1 && d6 === 1) run(p0 - p1, p2 - p1, p4 - p5, p0 - p5, 'Bearish');
      if (!v && d0 === -1 && d1 === 1 && d2 === -1 && d3 === 1 && d4 === -1 && d5 === 1 && d6 === -1) run(p1 - p0, p1 - p2, p5 - p4, p5 - p0, 'Bullish');
    }
    return [v, dr, c, ct];
  };

  const wxyxz = () => {
    let v = false, dr = '', c = 0;
    if (sz >= 10) {
      const pp = pvP.slice(sz - 10), dd = pvD.slice(sz - 10);
      let alternates = true;
      for (let k = 1; k <= 9; k++) if (dd[k] === dd[k - 1]) alternates = false;
      if (alternates) {
        const overallMove = Math.abs(pp[9] - pp[0]);
        let maxSwing = 0;
        for (let k = 0; k <= 8; k++) maxSwing = Math.max(maxSwing, Math.abs(pp[k + 1] - pp[k]));
        if (maxSwing > 0 && overallMove / maxSwing < 1.5) {
          v = true; dr = pp[9] > pp[0] ? 'Bullish' : 'Bearish'; c = 42;
          const ratio = overallMove / maxSwing;
          if (ratio < 1.0) c += 10;
          if (ratio < 0.5) c += 8;
        }
      }
    }
    return [v, dr, c];
  };

  // ── Bảng kỹ thuật (luôn trả về để hiển thị panel)
  out.ta = { ema50, ema200, rsi: rsiVal, macdLine, macdSignal, stochK, stochD, adx: adxVal };
  out.tf = { align: tfAlign, wBias, dBias, cBias, wRsi: W.rsi, dRsi: D.rsi };
  out.depth = { volRatio, bbPos: close > nz(bbUpper) ? 'Above BB' : close < nz(bbLower) ? 'Below BB' : close > nz(bbMid) ? 'Upper Half' : 'Lower Half',
    squeeze: nz(bbWidth) < 3, aboveMid: close > nz(bbMid), higherHighs, higherLows };

  if (sz < 4) return out;

  const [vImp, drImp, cImp] = impulse();
  const [vZig, drZig, cZig] = zigzag();
  const [vFlt, drFlt, cFlt, sFlt] = flat();
  const [vTri, drTri, cTri, sTri] = triangle();
  const [vDia, drDia, cDia, sDia] = diagonal();
  const [vWxy, drWxy, cWxy, sWxy] = wxy();
  const [vWxz, drWxz, cWxz] = wxyxz();

  let bestConf = 0, bestPat = 'No Pattern', bestDir = '—', bestSub = '', bestType = 0;
  if (vImp && cImp > bestConf && o.showImp) { bestConf = cImp; bestPat = 'Impulse (1-2-3-4-5)'; bestDir = drImp; bestType = 1; }
  if (vDia && cDia > bestConf && o.showDia) { bestConf = cDia; bestPat = sDia; bestDir = drDia; bestSub = sDia; bestType = 5; }
  if (vTri && cTri > bestConf && o.showTri) { bestConf = cTri; bestPat = sTri; bestDir = drTri; bestSub = sTri; bestType = 4; }
  if (vWxz && cWxz > bestConf && o.showCpx) { bestConf = cWxz; bestPat = 'Triple Three (WXYXZ)'; bestDir = drWxz; bestType = 7; }
  if (vWxy && cWxy > bestConf && o.showCpx) { bestConf = cWxy; bestPat = sWxy; bestDir = drWxy; bestSub = sWxy; bestType = 6; }
  if (vFlt && cFlt > bestConf && o.showFlt) { bestConf = cFlt; bestPat = sFlt; bestDir = drFlt; bestSub = sFlt; bestType = 3; }
  if (vZig && cZig > bestConf && o.showZig) { bestConf = cZig; bestPat = 'Zigzag (A-B-C)'; bestDir = drZig; bestType = 2; }
  Object.assign(out, { pat: bestPat, dir: bestDir, conf: bestConf, sub: bestSub, type: bestType,
    phase: { 1: 5, 2: 3, 3: 3, 4: 5, 5: 5, 6: 3, 7: 5 }[bestType] || 0 });

  // ── Lệnh vẽ
  const lbl = (x, y, text, color, isHigh) => out.labels.push({ x, y, text, color, style: isHigh ? 'down' : 'up', bg: color, bgT: 85, size: 'small' });
  const ln = (x1, y1, x2, y2, color, extra = {}) => out.lines.push({ x1, y1, x2, y2, color, width: 2, style: 'solid', t: 0, ...extra });
  const drawSeq = (start, names, clr) => {
    for (let k = 0; k < names.length + 1; k++) {
      const idx = start + k;
      if (idx < 0 || idx >= sz) continue;
      if (k > 0) {
        const nm = names[k - 1];
        if (nm !== ' ') lbl(pvB[idx], pvP[idx], nm, clr, pvD[idx] === 1);
        if (o.showLns && idx - 1 >= 0) ln(pvB[idx - 1], pvP[idx - 1], pvB[idx], pvP[idx], clr);
      }
    }
  };
  if (bestType === 1 || bestType === 5) {
    const clr = bestType === 1 ? C.imp : C.dia;
    drawSeq(sz - 6, ['1', '2', '3', '4', '5'], clr);
    if (bestType === 5) {
      ln(pvB[sz - 6], pvP[sz - 6], pvB[sz - 2], pvP[sz - 2], clr, { width: 1, style: 'dashed', t: 60 });
      ln(pvB[sz - 5], pvP[sz - 5], pvB[sz - 3], pvP[sz - 3], clr, { width: 1, style: 'dashed', t: 60 });
    }
  } else if (bestType === 2 || bestType === 3) {
    drawSeq(sz - 4, ['A', 'B', 'C'], bestType === 2 ? C.zig : C.flt);
  } else if (bestType === 4) {
    drawSeq(sz - 6, ['A', 'B', 'C', 'D', 'E'], C.tri);
    ln(pvB[sz - 6], pvP[sz - 6], pvB[sz - 2], pvP[sz - 2], C.tri, { width: 1, style: 'dashed', t: 50, extend: true });
    ln(pvB[sz - 5], pvP[sz - 5], pvB[sz - 3], pvP[sz - 3], C.tri, { width: 1, style: 'dashed', t: 50, extend: true });
  } else if (bestType === 6) {
    drawSeq(sz - 7, [' ', ' ', 'W', 'X', 'Y', ' '], C.cpx);
  } else if (bestType === 7) {
    drawSeq(sz - 10, [' ', ' ', 'W', 'X', ' ', 'Y', 'X', ' ', 'Z'], C.cpx);
  }

  // ── Đánh dấu vùng điều chỉnh
  const corrMark = (startIdx, endIdx, name, clr, primary) => {
    if (!o.showCorr || startIdx < 0 || endIdx <= startIdx) return null;
    let hi = -1e10, lo = 1e10;
    const bS = pvB[startIdx], bE = pvB[endIdx];
    for (let k = startIdx; k <= endIdx; k++) { hi = Math.max(hi, pvP[k]); lo = Math.min(lo, pvP[k]); }
    const pad = (hi - lo) * 0.03, lw = primary ? 2 : 1, a = primary ? 40 : 65;
    ln(bS, hi + pad, bE, hi + pad, clr, { style: 'dotted', width: lw, t: a });
    ln(bS, lo - pad, bE, lo - pad, clr, { style: 'dotted', width: lw, t: a });
    ln(bS, hi + pad, bS, lo - pad, clr, { style: 'dotted', width: 1, t: a });
    ln(bE, hi + pad, bE, lo - pad, clr, { style: 'dotted', width: 1, t: a });
    out.labels.push({ x: Math.round((bS + bE) / 2), y: hi + pad * 2, text: name, color: clr, t: primary ? 15 : 45, style: 'none', size: 'tiny' });
    return [bE, lo - pad, hi + pad];
  };
  let corrEnd = null;
  if (o.showCorr) {
    if ((bestType === 1 || bestType === 5) && sz >= 6) {
      const cc = bestType === 1 ? C.zig : C.dia;
      corrMark(sz - 5, sz - 4, 'W2', cc, false);
      corrMark(sz - 3, sz - 2, 'W4', cc, false);
    }
    if (bestType === 2) corrEnd = corrMark(sz - 4, sz - 1, 'Zigzag (A-B-C)', C.zig, true);
    else if (bestType === 3) corrEnd = corrMark(sz - 4, sz - 1, bestSub || 'Flat', C.flt, true);
    else if (bestType === 4) corrEnd = corrMark(sz - 6, sz - 1, bestSub || 'Triangle', C.tri, true);
    else if (bestType === 6 && sz >= 7) corrEnd = corrMark(sz - 7, sz - 1, 'W-X-Y', C.cpx, true);
    else if (bestType === 7 && sz >= 10) corrEnd = corrMark(sz - 10, sz - 1, 'W-X-Y-X-Z', C.cpx, true);
    if (bestType !== 2 && vZig && o.showZig && sz >= 4) corrMark(sz - 4, sz - 1, 'Zigzag', C.zig, false);
    if (bestType !== 3 && vFlt && o.showFlt && sz >= 4) corrMark(sz - 4, sz - 1, sFlt, C.flt, false);
    if (bestType !== 4 && vTri && o.showTri && sz >= 6) corrMark(sz - 6, sz - 1, sTri, C.tri, false);
  }
  const corrEndBar = corrEnd ? corrEnd[0] : null;

  // ── Tín hiệu
  let sig = 'HOLD', ent = NaN, stp = NaN, tgt1 = NaN, tgt2 = NaN, tgt3 = NaN, sellBot = NaN, sellTop = NaN, buyBot = NaN, buyTop = NaN;
  const lastPP = pvP[sz - 1], lastBB = pvB[sz - 1];
  const atrBuf = isNa(atrVal) ? close * 0.01 : atrVal;
  const pmStopMult = 1;
  let expectUp = false, expectDown = false, refHigh = NaN, refLow = NaN, waveRange = NaN;
  if (bestType > 0) {
    if (bestType === 1 || bestType === 5) {
      if (bestDir === 'Bullish') { expectDown = true; refHigh = pvP[sz - 1]; refLow = pvP[sz - 6]; }
      else { expectUp = true; refHigh = pvP[sz - 6]; refLow = pvP[sz - 1]; }
      waveRange = refHigh - refLow;
    } else if (bestType === 2 || bestType === 3) {
      if (bestDir === 'Bearish') { expectUp = true; refHigh = pvP[sz - 4]; refLow = pvP[sz - 1]; }
      else { expectDown = true; refHigh = pvP[sz - 1]; refLow = pvP[sz - 4]; }
      waveRange = refHigh - refLow;
    } else if (bestType === 4) {
      if (bestDir === 'Bullish') expectUp = true; else expectDown = true;
      refHigh = pvP[sz - 6]; refLow = pvP[sz - 5];
      if (refHigh < refLow) [refHigh, refLow] = [refLow, refHigh];
      waveRange = Math.abs(refHigh - refLow);
    } else if (bestType === 6 || bestType === 7) {
      if (bestDir === 'Bearish') expectUp = true; else expectDown = true;
      const s0 = bestType === 6 ? sz - 7 : sz - 10;
      if (s0 >= 0) {
        refHigh = pvP[s0]; refLow = lastPP;
        if (refHigh < refLow) [refHigh, refLow] = [refLow, refHigh];
        waveRange = refHigh - refLow;
      }
    }
  }
  if (!isNa(waveRange) && waveRange > 0) {
    if (expectUp) {
      ent = close; stp = nz(refLow, close) - atrBuf * pmStopMult;
      if (o.useLeverage) {
        sig = 'BUY (Long)';
        if (bestType === 2 || bestType === 6 || bestType === 7) { const w1 = waveRange / 0.618; tgt1 = close + w1; tgt2 = close + w1 * 1.618; tgt3 = close + w1 * 2.618; }
        else if (bestType === 4 || bestType === 3) { tgt1 = close + waveRange * 0.618; tgt2 = close + waveRange; tgt3 = close + waveRange * 1.618; }
        else { tgt1 = close + waveRange * 0.382; tgt2 = close + waveRange * 0.5; tgt3 = close + waveRange * 0.618; }
      } else {
        sig = 'BUY';
        if (bestType === 2 || bestType === 6 || bestType === 7) { const w1 = waveRange / 0.618; tgt1 = close + w1 * 1.618; sellBot = close + w1; sellTop = close + w1 * 1.618; }
        else if (bestType === 4 || bestType === 3) { tgt1 = close + waveRange; sellBot = close + waveRange * 0.618; sellTop = close + waveRange; }
        else { tgt1 = close + waveRange * 0.618; sellBot = close + waveRange * 0.5; sellTop = close + waveRange * 0.618; }
      }
    }
    if (expectDown) {
      if (o.useLeverage) {
        sig = 'SELL (Short)'; ent = close; stp = nz(refHigh, close) + atrBuf * pmStopMult;
        tgt1 = close - waveRange * 0.382; tgt2 = close - waveRange * 0.5; tgt3 = close - waveRange * 0.618;
      } else { sig = 'TAKE PROFIT'; ent = close; stp = NaN; tgt1 = NaN; sellBot = NaN; sellTop = NaN; }
    }
  }
  // Điểm tích luỹ cho nhà đầu tư khi thị trường giảm (chỉ chế độ SPOT)
  if (!o.useLeverage && (sig === 'HOLD' || sig === 'TAKE PROFIT')) {
    let a = 0;
    if (rsiVal < 35) a += 2;
    if (rsiVal < 25) a += 1;
    if (nz(stochK) < 25) a += 1;
    if (nz(stochK) < 25 && nz(stochK) > nz(stochD)) a += 1.5;
    if (close < ema200) a += 1;
    if (nz(macdHist) > nz(macdHistPrev)) a += 1;
    if (expectDown && bestType > 0) a += 0.5;
    if (bestType === 1 && bestDir === 'Bearish') a += 1;
    if (a >= 3.5) {
      const decline = nz(recentHigh) - close;
      if (decline > 0) { sig = 'ACCUMULATE'; ent = close; stp = close - atrBuf * 2 * pmStopMult; tgt1 = close + decline * 0.618; sellBot = close + decline * 0.5; sellTop = close + decline; }
    }
  }

  // ── Khuyến nghị tổng hợp
  let score = 0;
  if (expectUp) { score += 3; if (bestConf >= 70) score += 1; }
  if (expectDown) { score -= 3; if (bestConf >= 70) score -= 1; }
  if (close > ema20 && ema20 > ema50 && ema50 > ema200) score += 2;
  else if (close > ema50 && ema50 > ema200) score += 1;
  else if (close < ema50 && ema50 < ema200) score -= 1;
  else if (close < ema20 && ema20 < ema50 && ema50 < ema200) score -= 2;
  if (rsiVal < 30) score += 2; else if (rsiVal < 40) score += 1; else if (rsiVal > 70) score -= 2; else if (rsiVal > 60) score -= 1;
  if (nz(macdLine) > nz(macdSignal) && nz(macdHist) > 0) score += 1;
  else if (nz(macdLine) > nz(macdSignal) && nz(macdHist) > nz(macdHistPrev)) score += 0.5;
  if (nz(macdLine) < nz(macdSignal) && nz(macdHist) < 0) score -= 1;
  else if (nz(macdLine) < nz(macdSignal) && nz(macdHist) < nz(macdHistPrev)) score -= 0.5;
  if (nz(stochK) < 20 && nz(stochK) > nz(stochD)) score += 1.5; else if (nz(stochK) < 30) score += 0.5;
  if (nz(stochK) > 80 && nz(stochK) < nz(stochD)) score -= 1.5; else if (nz(stochK) > 70) score -= 0.5;
  if (nz(adxVal) > 25) score *= 1.15;
  if (tfAlign >= 4) score += 2.5; else if (tfAlign >= 2) score += 1.5; else if (tfAlign <= -4) score -= 2.5; else if (tfAlign <= -2) score -= 1.5;
  const wRsi = nz(W.rsi);
  if (wRsi < 30) score += 1.5; else if (wRsi < 40) score += 0.5;
  if (wRsi > 70) score -= 1.5; else if (wRsi > 60) score -= 0.5;
  let rec;
  if (score >= 5) rec = 'STRONG BUY'; else if (score >= 2) rec = 'BUY'; else if (score >= -2) rec = 'HOLD';
  else if (o.useLeverage) rec = score >= -5 ? 'SELL' : 'STRONG SELL'; else rec = 'ACCUMULATE';

  // ── Vùng mua/bán + mục tiêu
  const zw = Math.round(o.zoneWidth);
  if (o.showSig && sig !== 'HOLD') {
    const buyAnchor = corrEndBar !== null ? corrEndBar : i, buyZoneEnd = buyAnchor + zw;
    if ((sig === 'BUY' || sig === 'BUY (Long)' || sig === 'ACCUMULATE') && !isNa(stp)) {
      const zoneTop = nz(ent, close) + atrBuf * 0.3, zoneBot = nz(stp, close - atrBuf);
      buyTop = zoneTop; buyBot = zoneBot;
      if (o.showZones) {
        const zc = sig === 'ACCUMULATE' ? C.accum : C.buy;
        out.boxes.push({ x1: buyAnchor, x2: buyZoneEnd, top: zoneTop, bot: zoneBot, color: zc, bgT: 92, borderT: 50, dash: true, text: sig === 'ACCUMULATE' ? 'ACCUMULATE' : 'BUY ZONE', textT: 20 });
        if (corrEnd) ln(corrEndBar, lastPP, buyAnchor + 3, zoneTop, zc, { style: 'arrow', t: 40 });
      }
    }
    if (!o.useLeverage && !isNa(sellBot) && !isNa(sellTop) && o.showZones) {
      const s0 = buyZoneEnd + 2, s1 = s0 + Math.round(zw * 0.6);
      out.boxes.push({ x1: s0, x2: s1, top: sellTop, bot: sellBot, color: C.tp, bgT: 90, borderT: 45, dash: false, text: 'SELL ZONE', textT: 15 });
      if (!isNa(buyTop)) ln(buyZoneEnd, buyTop, s0, sellBot, C.tp, { style: 'dotted', width: 1, t: 55 });
    }
    if (sig === 'SELL (Short)' && o.useLeverage && o.showZones && !isNa(stp)) {
      out.boxes.push({ x1: buyAnchor, x2: buyZoneEnd, top: nz(stp, close + atrBuf), bot: nz(ent, close) - atrBuf * 0.3, color: C.sel, bgT: 92, borderT: 50, dash: true, text: 'SHORT', textT: 20 });
    }
    const sigBar = corrEndBar !== null ? corrEndBar + 2 : lastBB;
    if (sig === 'BUY' || sig === 'BUY (Long)' || sig === 'ACCUMULATE') out.labels.push({ x: sigBar, y: lastPP, text: sig, color: C.white, bg: sig === 'ACCUMULATE' ? C.accum : C.buy, bgT: 0, style: 'up', size: 'normal' });
    else if (sig === 'SELL (Short)') out.labels.push({ x: sigBar, y: lastPP, text: 'SHORT', color: C.white, bg: C.sel, bgT: 0, style: 'down', size: 'normal' });
    else if (sig === 'TAKE PROFIT') out.labels.push({ x: sigBar, y: lastPP, text: 'TAKE PROFIT', color: C.white, bg: C.tp, bgT: 0, style: 'down', size: 'normal' });

    const target = (lvl, name, clr) => {
      ln(i - 3, lvl, i + zw, lvl, clr, { style: 'dashed', width: 2 });
      out.labels.push({ x: i + zw + 2, y: lvl, text: `${name}  ${fmt(lvl)}`, color: clr, style: 'none', size: 'small', align: 'left' });
    };
    if (o.showTargets) {
      if (o.useLeverage) {
        const tc = sig.includes('BUY') ? C.buy : C.sel;
        if (!isNa(tgt1)) target(tgt1, 'T1', tc);
        if (!isNa(tgt2)) target(tgt2, 'T2', tc);
        if (!isNa(tgt3)) target(tgt3, 'T3', tc);
      } else if (!isNa(tgt1)) target(tgt1, 'Wave Target', C.tp);
    }
    if (!isNa(stp)) target(stp, 'STOP', C.sel);
    if (!isNa(ent)) {
      ln(i - 3, ent, i + zw, ent, C.white, { width: 1, entry: true });
      out.labels.push({ x: i + zw + 2, y: ent, text: `Entry  ${fmt(ent)}`, color: C.white, style: 'none', size: 'small', align: 'left', entry: true });
    }
  }
  if (o.showFib && bestType > 0 && !isNa(refHigh) && !isNa(refLow)) {
    const rng = refHigh - refLow;
    if (rng > 0) for (const [r, nm] of [[0.236, '23.6%'], [0.382, '38.2%'], [0.5, '50.0%'], [0.618, '61.8%'], [0.786, '78.6%']]) {
      const lvl = refLow + rng * r;
      ln(i - 2, lvl, i + 25, lvl, C.fib, { style: 'dotted', width: 1, t: 50 });
      out.labels.push({ x: i + 26, y: lvl, text: `${nm}  ${fmt(lvl)}`, color: C.fib, style: 'none', size: 'tiny', align: 'left' });
    }
  }
  const nn = (x) => (isNa(x) ? null : x);
  Object.assign(out, { sig, rec, score, ent: nn(ent), stp: nn(stp), tgt1: nn(tgt1), tgt2: nn(tgt2), tgt3: nn(tgt3),
    buyBot: nn(buyBot), buyTop: nn(buyTop), sellBot: nn(sellBot), sellTop: nn(sellTop) });
  return out;
}

function fmt(v) { return Math.abs(v) >= 1000 ? v.toFixed(1) : v.toFixed(2); }
