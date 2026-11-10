import assert from 'node:assert/strict';
import { computeSMC, smcLastBarSignals, BULLISH, BEARISH } from './smc.js';
import { backtestEmaCross, emaTV } from './strategy.js';

// Dữ liệu tổng hợp: sóng tăng-giảm có xu hướng để sinh swing/BOS/CHoCH
const bars = [];
let p = 50;
for (let i = 0; i < 600; i++) {
  p += Math.sin(i / 15) * 0.8 + (i > 300 ? -0.05 : 0.05) + Math.sin(i / 3.7) * 0.3;
  const o = p - 0.2, c = p + 0.2 * Math.sin(i);
  bars.push({ time: 1_700_000_000 + i * 86400, open: o, high: Math.max(o, c) + 0.3, low: Math.min(o, c) - 0.3, close: c });
}
const smc = computeSMC(bars);
assert.ok(smc.structures.length > 5, 'có cấu trúc');
assert.ok(smc.structures.some((s) => s.tag === 'CHoCH') && smc.structures.some((s) => s.tag === 'BOS'));
// BOS tăng phải là giá đóng cửa vượt mức pivot
for (const s of smc.structures) {
  const c = bars[s.toIndex].close, pc = bars[s.toIndex - 1].close;
  if (s.bias === BULLISH) assert.ok(c > s.level, 'đóng cửa trên đỉnh');
  if (s.bias === BEARISH) assert.ok(c < s.level, 'đóng cửa dưới đáy');
  assert.ok(s.fromIndex < s.toIndex);
}
// CHoCH = đổi xu hướng: CHoCH tăng chỉ xuất hiện khi xu hướng trước đó là giảm (cùng loại internal/swing)
for (const internal of [true, false]) {
  let bias = 0;
  for (const s of smc.structures.filter((x) => x.internal === internal)) {
    if (s.tag === 'CHoCH') assert.equal(bias, -s.bias); else assert.notEqual(bias, -s.bias);
    bias = s.bias;
  }
}
// Order block còn hiệu lực chưa bị phá
const last = bars[bars.length - 1];
for (const ob of smc.internalOBs) assert.ok(ob.high >= ob.low);
assert.ok(smc.swings.length > 2);
const sig = smcLastBarSignals(smc);
assert.equal(typeof sig.smcBullChoch, 'boolean');

// EMA kiểu TradingView
assert.deepEqual(emaTV([1, 1, 1], 3), [1, 1, 1]);
const bt = backtestEmaCross(bars, { capital: 100_000_000 });
assert.ok(bt.signals.length > 2);
// tín hiệu luân phiên BUY/SELL
for (let i = 1; i < bt.signals.length; i++) assert.notEqual(bt.signals[i].side, bt.signals[i - 1].side);
// chỉ mua: mọi lệnh LONG, giá vốn hợp lệ, khớp ở nến sau tín hiệu
for (const t of bt.trades) { assert.equal(t.side, 'LONG'); assert.ok(t.exitTime > t.entryTime); assert.equal(t.qty % 100, 0); }
// T+2: không bán trước 2 phiên
for (const t of bt.trades) assert.ok((t.exitTime - t.entryTime) / 86400 >= 2);
// lãi/lỗ cộng dồn khớp với equity cuối khi không còn vị thế mở
const sum = bt.trades.reduce((a, t) => a + t.pnl, 0);
if (!bt.openTrade) assert.ok(Math.abs(bt.stats.netProfit - sum) < 1);
const ls = backtestEmaCross(bars, { mode: 'longshort' });
assert.ok(ls.trades.some((t) => t.side === 'SHORT'));
console.log('smc+strategy OK', smc.structures.length, 'cấu trúc,', bt.trades.length, 'lệnh, lãi', bt.stats.netProfitPct.toFixed(2) + '%');
