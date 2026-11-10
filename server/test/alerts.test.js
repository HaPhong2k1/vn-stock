import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';

process.env.ALERTS_FILE = path.join(os.tmpdir(), `alerts-test-${process.pid}.json`);
process.env.ALERT_COOLDOWN_MS = '0';
const { AlertEngine } = await import('../src/alerts.js');
const { createStorage } = await import('../src/storage.js');
const storage = await createStorage({ info() {}, warn() {} });

async function setup() {
  const store = new EventEmitter(); store.stocks = new Map([['FPT', { s: 'FPT', last: 50, chgPc: 0, totVol: 0 }]]);
  const analytics = new EventEmitter(); analytics.metrics = new Map([['FPT', { s: 'FPT', live: true, aboveMa20: false, ma20: 51 }]]);
  const eng = new AlertEngine(store, analytics, storage, { info() {}, warn() {} });
  await eng.init(); eng.alerts = []; eng.history = [];
  const fired = []; eng.onFire((e) => fired.push(e));
  const tick = (last, above) => {
    store.stocks.get('FPT').last = last;
    analytics.metrics.set('FPT', { s: 'FPT', live: true, aboveMa20: above, ma20: 51 });
    analytics.emit('metrics', analytics.metrics.get('FPT'));
  };
  return { eng, fired, tick };
}

test('MA20 cắt lên: chỉ báo khi chuyển từ dưới lên trên', async () => {
  const { eng, fired, tick } = await setup();
  eng.create('owner-123456', { sym: 'FPT', type: 'MA20_CROSS_UP', repeat: true });
  tick(50.5, false); assert.equal(fired.length, 0);
  tick(51.2, true); assert.equal(fired.length, 1);
  tick(51.5, true); assert.equal(fired.length, 1, 'không báo lại khi vẫn ở trên');
  tick(50.8, false); tick(51.3, true); assert.equal(fired.length, 2, 'cắt lên lần 2 => báo lại');
});

test('MA20 cắt lên: đang ở trên MA20 lúc tạo thì không báo ngay', async () => {
  const { eng, fired, tick } = await setup();
  tick(52, true);
  eng.create('owner-123456', { sym: 'FPT', type: 'MA20_CROSS_UP' });
  tick(52.1, true); assert.equal(fired.length, 0);
});

test('Giá ≥: báo một lần rồi tắt nếu không lặp', async () => {
  const { eng, fired, tick } = await setup();
  const a = eng.create('owner-123456', { sym: 'FPT', type: 'PRICE_GTE', value: 52 });
  tick(51, false); assert.equal(fired.length, 0);
  tick(52, true); assert.equal(fired.length, 1);
  assert.equal(a.active, false);
  tick(51, false); tick(53, true); assert.equal(fired.length, 1);
});
