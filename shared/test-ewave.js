import test from 'node:test';
import assert from 'node:assert/strict';
import { computeEW } from './ewave.js';

// Dựng nến từ chuỗi điểm xoay (nội suy tuyến tính, mỗi đoạn `seg` nến)
function build(points, seg = 15, tail = []) {
  const px = [];
  for (let k = 0; k < points.length - 1; k++) for (let j = 0; j < seg; j++) px.push(points[k] + ((points[k + 1] - points[k]) * j) / seg);
  px.push(points[points.length - 1], ...tail);
  return px.map((p, i) => ({ time: i * 86400, open: p, high: p + 0.05, low: p - 0.05, close: p, volume: 1000 }));
}

test('nhận dạng sóng đẩy 1-2-3-4-5 tăng và tín hiệu chốt lời (SPOT)', () => {
  const bars = build([13, 10, 20, 14, 36, 31, 41], 15, [40.8, 40.6, 40.5, 40.4, 40.3, 40.2, 40.1, 40.0, 39.9, 39.8]);
  const r = computeEW(bars);
  assert.equal(r.pat, 'Impulse (1-2-3-4-5)');
  assert.equal(r.dir, 'Bullish');
  assert.equal(r.conf, 97); // 50 + W2 60% (12) + W3 2.2×W1 (10) + W4 22.7% (12) + W5 = W1 (8) + luân phiên (5)
  assert.equal(r.sig, 'TAKE PROFIT');
  assert.deepEqual(r.labels.filter((l) => /^[1-5]$/.test(l.text)).map((l) => l.text), ['1', '2', '3', '4', '5']);
});

test('chế độ đòn bẩy: sóng đẩy tăng hoàn tất => SHORT với 3 mục tiêu', () => {
  const bars = build([13, 10, 20, 14, 36, 31, 41], 15, [40.8, 40.6, 40.5, 40.4, 40.3, 40.2, 40.1, 40.0, 39.9, 39.8]);
  const r = computeEW(bars, { useLeverage: true });
  assert.equal(r.sig, 'SELL (Short)');
  const range = 41.05 - 9.95; // đỉnh sóng 5 - đáy sóng 0 (high/low)
  assert.ok(Math.abs(r.tgt1 - (39.8 - range * 0.382)) < 1e-9);
  assert.ok(r.stp > 41.05);
});

test('zigzag A-B-C giảm => BUY với vùng mua / vùng bán', () => {
  const bars = build([5, 10, 30, 20, 26, 14], 15, [14.3, 14.6, 14.9, 15.2, 15.5, 15.8, 16.1, 16.4, 16.7, 17]);
  const r = computeEW(bars);
  assert.equal(r.type, 2);
  assert.equal(r.dir, 'Bearish');
  assert.equal(r.sig, 'BUY');
  assert.ok(r.buyBot < r.buyTop && r.sellBot < r.sellTop && r.sellBot > r.buyTop);
  assert.ok(r.boxes.some((b) => b.text === 'BUY ZONE') && r.boxes.some((b) => b.text === 'SELL ZONE'));
});
