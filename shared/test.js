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
// MA200 tuần: mốc đầu tuần
const { currentWeekStart, weekStarted } = await import('../server/src/daily.js');
// Thứ Bảy 14/11/2026 10:00 VN => tuần bắt đầu Thứ Hai 09/11/2026 00:00 UTC
const sat = Date.UTC(2026, 10, 14, 3, 0);
assert.equal(currentWeekStart(sat), Date.UTC(2026, 10, 9) / 1000);
assert.equal(weekStarted(sat), true);
// Thứ Hai 16/11 8:00 VN: tuần mới chưa có phiên
assert.equal(currentWeekStart(Date.UTC(2026, 10, 16, 1, 0)), Date.UTC(2026, 10, 16) / 1000);
assert.equal(weekStarted(Date.UTC(2026, 10, 16, 1, 0)), false);
// Chủ nhật 15/11 23:30 VN vẫn thuộc tuần 09/11
assert.equal(currentWeekStart(Date.UTC(2026, 10, 15, 16, 30)), Date.UTC(2026, 10, 9) / 1000);
console.log('week helpers OK');
