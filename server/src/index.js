import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import express from 'express';
import { config } from './config.js';
import { MarketStore } from './market-store.js';
import { VpsProvider } from './providers/vps.js';
import { SimProvider } from './providers/sim.js';
import { createHub } from './ws-hub.js';
import { getHistory } from './history.js';
import { sessionOf } from './market-hours.js';

const store = new MarketStore();
const provider = config.provider === 'sim' ? new SimProvider(store) : new VpsProvider(store);
const app = express();

app.get('/api/health', (_req, res) => res.json({
  ok: true, provider: config.provider, session: sessionOf(), symbols: store.stocks.size,
  feed: provider.status, lastFeedAt: store.lastFeedAt,
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
createHub(server, store, provider);
server.listen(config.port, () => console.log(`[server] http://localhost:${config.port} (provider=${config.provider})`));
provider.start().catch((e) => { console.error('[provider] khởi động lỗi', e); });
