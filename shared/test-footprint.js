import assert from 'node:assert/strict';
import { analyzeFootprint, autoRowSize, tickOf } from './footprint.js';

// Ví dụ trong bài: 410 ask tại 5001.00 so với 120 bid tại 5000.75 = 3.4:1 => imbalance mua
let [b] = analyzeFootprint([{ t: 0, o: 5000.75, h: 5001, l: 5000.75, c: 5001, rows: [[5000.75, 120, 50], [5001, 30, 410]] }], 0.25);
assert.equal(b.rows[1].buyImb, true);
assert.equal(b.delta, (50 - 120) + (410 - 30));
assert.equal(b.poc, 5001);
// Ví dụ delta trong bài: 1514 ask − 688 bid = +826
[b] = analyzeFootprint([{ t: 0, o: 1, h: 1, l: 1, c: 1, rows: [[1, 688, 1514]] }], 0.1);
assert.equal(b.rows[0].delta, 826);

// Stacked: 3 dòng imbalance mua liên tiếp
const rows = [[10.0, 100, 10], [10.1, 10, 400], [10.2, 10, 400], [10.3, 10, 400], [10.4, 100, 20]];
[b] = analyzeFootprint([{ t: 0, o: 10, h: 10.4, l: 10, c: 10.3, rows }], 0.1);
assert.ok(b.stacks.some((s) => s.dir === 1 && s.n >= 3), 'có stacked mua');
// Unfinished: dòng cao nhất 10.4 có cả bid & ask; finished: 0 một bên
assert.equal(b.unfinishedHigh, true);
[b] = analyzeFootprint([{ t: 0, o: 10, h: 10.2, l: 10, c: 10.2, rows: [[10, 0, 17], [10.1, 50, 50], [10.2, 202, 0]] }], 0.1);
assert.equal(b.unfinishedHigh, false); assert.equal(b.unfinishedLow, false);
// Exhaustion: ask tại đỉnh 9 so với max 330
[b] = analyzeFootprint([{ t: 0, o: 10, h: 10.3, l: 10, c: 10.3, rows: [[10, 50, 330], [10.1, 40, 200], [10.2, 30, 60], [10.3, 5, 9]] }], 0.1);
assert.equal(b.exhaustHigh, true);
// Divergence: đỉnh cao hơn nhưng delta âm
const two = analyzeFootprint([
  { t: 0, o: 10, h: 10.1, l: 10, c: 10.1, rows: [[10, 10, 100], [10.1, 10, 100]] },
  { t: 60, o: 10.1, h: 10.2, l: 10.1, c: 10.1, rows: [[10.1, 200, 10], [10.2, 100, 10]] },
], 0.1);
assert.equal(two[1].divBear, true);
assert.equal(two[1].cvd, two[0].delta + two[1].delta);
// Gộp dòng
[b] = analyzeFootprint([{ t: 0, o: 10, h: 10.15, l: 10, c: 10.1, rows: [[10, 1, 2], [10.05, 3, 4], [10.1, 5, 6], [10.15, 7, 8]] }], 0.1);
assert.deepEqual(b.rows.map((r) => [r.p, r.bid, r.ask]), [[10, 4, 6], [10.1, 12, 14]]);
assert.equal(tickOf('HOSE', 45.7), 0.05); assert.equal(tickOf('PS', 1850), 0.1);
assert.equal(autoRowSize([{ h: 47.55, l: 46.9 }], 0.05), 0.05);
console.log('footprint OK');
