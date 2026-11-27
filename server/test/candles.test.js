import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregate, bucket4H, monthStart } from '../src/candles.js';

const vn = (s) => Date.parse(s + '+07:00') / 1000;
test('nến 4H theo phiên: 09:00 = sáng, 13:00 = chiều', () => {
  assert.equal(bucket4H(vn('2026-11-27T09:00:00')), vn('2026-11-27T09:00:00'));
  assert.equal(bucket4H(vn('2026-11-27T11:00:00')), vn('2026-11-27T09:00:00'));
  assert.equal(bucket4H(vn('2026-11-27T13:00:00')), vn('2026-11-27T13:00:00'));
  assert.equal(bucket4H(vn('2026-11-27T14:45:00')), vn('2026-11-27T13:00:00'));
  const bars = ['09:00', '10:00', '11:00', '13:00', '14:00'].map((h, i) => ({ time: vn(`2026-11-27T${h}:00`), open: i + 1, high: i + 2, low: i, close: i + 1.5, volume: 10 }));
  const out = aggregate(bars, bucket4H);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], { time: vn('2026-11-27T09:00:00'), open: 1, high: 4, low: 0, close: 3.5, volume: 30 });
  assert.deepEqual(out[1], { time: vn('2026-11-27T13:00:00'), open: 4, high: 6, low: 3, close: 5.5, volume: 20 });
});
test('nến tháng', () => {
  assert.equal(monthStart(Date.UTC(2026, 10, 27, 2) / 1000), Date.UTC(2026, 10, 1) / 1000);
  assert.equal(monthStart(Date.UTC(2026, 10, 30, 18) / 1000), Date.UTC(2026, 11, 1) / 1000); // 01:00 ngày 1/12 giờ VN
});
