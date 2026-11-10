import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import express from 'express';
import compression from 'compression';
import { config } from './config.js';
import { MarketStore } from './market-store.js';
import { VpsProvider } from './providers/vps.js';
import { SimProvider } from './providers/sim.js';
import { createHub } from './ws-hub.js';
import { getHistory } from './history.js';
import { sessionOf } from './market-hours.js';
import { DailyStore } from './daily.js';
import { Analytics } from './analytics.js';
import { AlertEngine, ALERT_TYPES } from './alerts.js';
import { createStorage } from './storage.js';
import { startKeepAlive } from './keepalive.js';

const store = new MarketStore();
const provider = config.provider === 'sim' ? new SimProvider(store) : new VpsProvider(store);
const daily = new DailyStore();
daily.loadCache();
const analytics = new Analytics(store, daily);
const storage = await createStorage();
const alerts = new AlertEngine(store, analytics, storage);
await alerts.init();
const app = express();
app.use(compression());
app.use(express.json({ limit: '20kb' }));

// Danh tính đơn giản theo trình duyệt (UUID lưu localStorage). Khi lên production nên thay bằng đăng nhập thật.
const owner = (req) => {
  const id = String(req.get('x-client-id') || '');
  if (!/^[\w-]{8,64}$/.test(id)) throw Object.assign(new Error('thiếu x-client-id'), { status: 401 });
  return id;
};
const wrap = (fn) => (req, res) => { try { res.json(fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };

app.get('/api/screener', wrap(() => ({ asOf: daily.asOf, loading: daily.loading, progress: daily.progress, rows: analytics.rows() })));
app.get('/api/signals', wrap(() => analytics.signals));
app.get('/api/alerts/types', wrap(() => Object.fromEntries(Object.entries(ALERT_TYPES).map(([k, v]) => [k, { label: v.label, kind: v.kind }]))));
app.get('/api/alerts', wrap((req) => alerts.list(owner(req))));
app.get('/api/alerts/history', wrap((req) => alerts.historyOf(owner(req))));
app.post('/api/alerts', wrap((req) => alerts.create(owner(req), req.body || {})));
app.patch('/api/alerts/:id', wrap((req) => alerts.update(owner(req), req.params.id, req.body || {})));
app.delete('/api/alerts/:id', wrap((req) => { alerts.remove(owner(req), req.params.id); return { ok: true }; }));

app.get('/api/health', (_req, res) => res.json({
  ok: true, provider: config.provider, session: sessionOf(), symbols: store.stocks.size,
  feed: provider.status, lastFeedAt: store.lastFeedAt,
  storage: storage.kind, alerts: alerts.alerts.length,
  history: { asOf: daily.asOf, loading: daily.loading, progress: daily.progress, symbols: daily.bars.size },
}));
app.get('/api/groups', (_req, res) => res.json(store.groups));
app.get('/api/stock/:sym', (req, res) => {
  const st = store.stocks.get(req.params.sym.toUpperCase());
  st ? res.json(st) : res.status(404).json({ error: 'không tìm thấy mã' });
});
app.get('/api/indices', (_req, res) => res.json([...store.indices.values()]));
app.get('/api/history', async (req, res) => {
  try { res.json(await getHistory(req.query)); }
  catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

// Phục vụ frontend đã build (web/dist)
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api|\/ws).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const server = http.createServer(app);
const hub = createHub(server, store, provider);
analytics.on('signal', (sig) => hub.broadcast({ type: 'sig', d: sig }));
alerts.onFire((ev, a) => hub.sendTo(ev.owner, { type: 'alert', d: ev, alert: a }));
server.listen(config.port, () => console.log(`[server] http://localhost:${config.port} (provider=${config.provider})`));
startKeepAlive();
provider.start()
  .then(() => daily.schedule(() => store.allSymbols()))
  .catch((e) => { console.error('[provider] khởi động lỗi', e); });
