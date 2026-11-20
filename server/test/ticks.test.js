import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { TickCollector } from '../src/ticks.js';

const quiet = { info() {}, warn() {} };
function memStorage() {
  const m = new Map();
  return {
    m,
    async fpSave(s, k, d, data) { m.set(`${s}|${k}|${d}`, JSON.parse(JSON.stringify(data))); },
    async fpGet(s, k, from) { return [...m].filter(([key]) => { const [a, b, c] = key.split('|'); return a === s && b === k && c >= from; }).map(([key, data]) => ({ day: key.split('|')[2], data })); },
    async fpHas(s, k, d) { return m.has(`${s}|${k}|${d}`); },
  };
}
function setup() {
  const store = new EventEmitter();
  store.stocks = new Map([['VN30F1M', { s: 'VN30F1M', ex: 'PS', last: 1850, totVol: 1000, b: [[1849.9, 5]], a: [[1850, 5]] }]]);
  store.groups = { PS: ['VN30F1M'] };
  const storage = memStorage();
  const tc = new TickCollector(store, storage, quiet);
  return { store, storage, tc };
}
const tick = (store, patch) => { const st = store.stocks.get('VN30F1M'); Object.assign(st, patch); store.emit('stock', st); };

test('VN30F: ước lượng chiều theo giá chào, gộp nến 5 phút & ngày, lưu và khôi phục', async () => {
  const { store, storage, tc } = setup();
  await tc.pin(['VN30F1M']);
  tick(store, { last: 1850, totVol: 1010, b: [[1849.9, 5]], a: [[1850.1, 5]] }); // khớp tại giá bán cũ 1850 => mua chủ động
  tick(store, { last: 1849.9, totVol: 1015, b: [[1849.8, 5]], a: [[1850, 5]] }); // khớp tại giá mua cũ => bán chủ động
  const fp = await tc.footprint('VN30F1M', 300);
  assert.equal(fp.source, 'collector');
  assert.equal(fp.estimatedPct, 100);
  const rows = fp.bars.flatMap((b) => b.rows);
  assert.deepEqual(rows.find((r) => r[0] === 1850), [1850, 0, 10]);
  assert.deepEqual(rows.find((r) => r[0] === 1849.9), [1849.9, 5, 0]);
  const day = await tc.footprint('VN30F1M', 86400);
  assert.equal(day.bars.length, 1);
  assert.equal(day.bars[0].rows.reduce((a, r) => a + r[1] + r[2], 0), 15);
  // Lưu rồi khởi động lại => dữ liệu còn nguyên
  tc.syms.get('VN30F1M').dirty = true;
  await tc.persistPinned();
  const store2 = new EventEmitter(); store2.stocks = store.stocks; store2.groups = store.groups;
  const tc2 = new TickCollector(store2, storage, quiet);
  await tc2.pin(['VN30F1M']);
  const again = await tc2.footprint('VN30F1M', 900);
  assert.equal(again.bars.flatMap((b) => b.rows).reduce((a, r) => a + r[1] + r[2], 0), 15);
});

test('Không đếm trùng khi socket gửi tick có chiều rồi snapshot cập nhật cùng tổng KL', async () => {
  const { store, tc } = setup();
  await tc.pin(['VN30F1M']);
  tc.onTrade('VN30F1M', { lastPrice: 1851, lastVol: 7, totalVol: 1007, side: 'B', time: '10:00:00' }, 1);
  tick(store, { last: 1851, totVol: 1007 });
  const fp = await tc.footprint('VN30F1M', 60);
  const vol = fp.bars.flatMap((b) => b.rows).reduce((a, r) => a + r[1] + r[2], 0);
  assert.equal(vol, 7);
  assert.equal(fp.estimatedPct, 0);
});

test('Đang có lệnh khớp chính xác từ socket: snapshot đi trước không gây đếm ước lượng hay mất lệnh', async () => {
  const { store, tc } = setup();
  await tc.pin(['VN30F1M']);
  tc.onTrade('VN30F1M', { lastPrice: 1851, lastVol: 7, totalVol: 1007, side: 'B', time: '10:00:00' }, 1);
  tick(store, { last: 1851.2, totVol: 1020 });                       // snapshot đến trước
  tc.onTrade('VN30F1M', { lastPrice: 1851.2, lastVol: 13, totalVol: 1020, side: 'S', time: '10:00:01' }, 1); // lệnh tương ứng đến sau
  const fp = await tc.footprint('VN30F1M', 60);
  const rows = fp.bars.flatMap((b) => b.rows);
  assert.equal(rows.reduce((a, r) => a + r[1] + r[2], 0), 20);
  assert.deepEqual(rows.find((r) => r[0] === 1851.2), [1851.2, 13, 0]);
  assert.equal(fp.estimatedPct, 0);
});

test('Băng khớp lệnh: mới nhất trước, có chiều', async () => {
  const { tc } = setup();
  await tc.pin(['VN30F1M']);
  tc.onTrade('VN30F1M', { lastPrice: 1851, lastVol: 7, totalVol: 1007, side: 'B', time: '10:00:00' }, 1);
  tc.onTrade('VN30F1M', { lastPrice: 1850.9, lastVol: 3, totalVol: 1010, side: 'S', time: '10:00:02' }, 1);
  const r = await tc.trades('VN30F1M', 10);
  assert.equal(r.trades.length, 2);
  assert.deepEqual([r.trades[0].p, r.trades[0].v, r.trades[0].side], [1850.9, 3, -1]);
  assert.equal(r.unit, 'HĐ');
});
