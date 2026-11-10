import assert from 'node:assert/strict';
import { sma, ema, rsi, macd, crossUp } from './indicators.js';
assert.deepEqual(sma([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
const e = ema([1, 2, 3, 4, 5, 6], 3); assert.equal(e[2], 2); assert.equal(e[3], 3); assert.equal(e[5], 5);
const up = Array.from({ length: 30 }, (_, i) => i + 1); assert.equal(rsi(up)[29], 100);
const m = macd(Array.from({ length: 60 }, (_, i) => 10 + Math.sin(i / 3))); assert.ok(m.hist[59] !== null);
// giá 9,9,9 -> MA3 = 9; nhảy lên 12 => cắt lên
const px = [10, 8, 9, 12]; const ma = sma(px, 3);
assert.equal(crossUp(px, ma, 3), true); assert.equal(crossUp(px, ma, 2), false);
// RSI chuẩn (ví dụ Wilder): kiểm tra nằm trong 0..100
for (const v of rsi(Array.from({ length: 50 }, () => Math.random() * 100))) if (v !== null) assert.ok(v >= 0 && v <= 100);
console.log('indicators OK');
