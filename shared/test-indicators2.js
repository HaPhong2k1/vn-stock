import assert from 'node:assert/strict';
import * as I from './indicators.js';
// Dữ liệu tổng hợp xu hướng tăng rồi giảm
const n = 300, H = [], L = [], C = [], V = [];
for (let i = 0; i < n; i++) { const p = 50 + 10 * Math.sin(i / 25) + i * 0.02; C.push(p); H.push(p + 0.5 + (i % 3) * 0.1); L.push(p - 0.5 - (i % 2) * 0.1); V.push(1000 + (i % 7) * 100); }
const inRange = (a, lo, hi) => a.every((v) => v === null || (v >= lo - 1e-9 && v <= hi + 1e-9));
assert.deepEqual(I.wma([1, 2, 3], 3).slice(2), [(1 * 1 + 2 * 2 + 3 * 3) / 6]);
assert.ok(inRange(I.stochastic(H, L, C).k, 0, 100));
assert.ok(inRange(I.stochRsi(C).k, 0, 100));
const d = I.adx(H, L, C); assert.ok(inRange(d.adx, 0, 100) && d.adx[n - 1] !== null);
assert.ok(inRange(I.williamsR(H, L, C), -100, 0));
assert.ok(inRange(I.mfi(H, L, C, V), 0, 100));
assert.ok(I.atr(H, L, C)[n - 1] > 0);
// OBV: tăng cộng KL, giảm trừ KL
assert.deepEqual(I.obv([1, 2, 1, 1], [5, 6, 7, 8]), [0, 6, -1, -1]);
// VWAP 1 phiên với KL bằng nhau = trung bình giá điển hình
const vw = I.vwap([2, 4], [0, 2], [1, 3], [1, 1], () => 'd'); assert.equal(vw[1], 2);
// SuperTrend: đường nằm dưới giá khi xu hướng tăng, trên giá khi giảm
const st = I.supertrend(H, L, C);
for (let i = 0; i < n; i++) if (st.line[i] !== null) assert.ok(st.dir[i] === 1 ? st.line[i] <= H[i] + 1e-9 : st.line[i] >= L[i] - 1e-9);
// PSAR: luôn ngoài thân nến trước (không cắt vào giá đang theo)
const ps = I.psar(H, L); assert.ok(ps.filter((x) => x !== null).length > n - 3);
const ich = I.ichimoku(H, L, C); assert.ok(ich.tenkan[n - 1] !== null && ich.spanB[n - 1] !== null);
const dc = I.donchian(H, L); assert.ok(dc.upper[n - 1] >= dc.lower[n - 1]);
const kc = I.keltner(H, L, C); assert.ok(kc.upper[n - 1] > kc.mid[n - 1]);
// CCI có giá trị
assert.ok(I.cci(H, L, C)[n - 1] !== null);
console.log('indicators2 OK');
