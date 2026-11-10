import { WebSocketServer } from 'ws';
import { config } from './config.js';
import { sessionOf } from './market-hours.js';

/**
 * Phân phối realtime xuống trình duyệt.
 * - Client gửi {op:'sub', syms:[...]} -> nhận ngay snapshot các mã đó, sau đó chỉ nhận thay đổi.
 * - Thay đổi được gom theo chu kỳ flushMs (chỉ giữ trạng thái mới nhất => không sai lệch, giảm băng thông).
 * - Mỗi bản ghi có seq tăng dần để client loại bản cũ.
 */
export function createHub(server, store, provider, log = console) {
  const wss = new WebSocketServer({ server, path: '/ws', perMessageDeflate: { threshold: 1024 } });
  const dirty = new Set();
  const dirtyIx = new Set();
  store.on('stock', (st) => dirty.add(st.s));
  store.on('index', (ix) => dirtyIx.add(ix.code));

  const send = (ws, msg) => { if (ws.readyState === 1 && ws.bufferedAmount < 4e6) ws.send(JSON.stringify(msg)); };
  const statusMsg = () => ({
    type: 'status', session: sessionOf(), provider: config.provider,
    feed: { connected: provider.status.connected, lastMsgAt: provider.status.lastMsgAt, lastResyncAt: provider.status.lastResyncAt, reconnects: provider.status.reconnects },
    clients: wss.clients.size, now: Date.now(),
  });

  wss.on('connection', (ws) => {
    ws.subs = new Set();
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    send(ws, { ...statusMsg(), type: 'hello', groups: store.groups, indices: [...store.indices.values()] });
    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(raw); } catch { return; }
      if (m.op === 'sub' && Array.isArray(m.syms)) {
        const syms = m.syms.slice(0, 2000).map((s) => String(s).toUpperCase());
        ws.subs = new Set(syms);
        send(ws, { type: 'snap', d: syms.map((s) => store.stocks.get(s)).filter(Boolean), ts: Date.now() });
      } else if (m.op === 'auth' && typeof m.owner === 'string' && /^[\w-]{8,64}$/.test(m.owner)) {
        ws.owner = m.owner;
      } else if (m.op === 'ping') {
        send(ws, { type: 'pong', t: m.t, now: Date.now() });
      }
    });
  });

  setInterval(() => {
    if (!dirty.size && !dirtyIx.size) return;
    const rows = [...dirty].map((s) => store.stocks.get(s));
    const ix = [...dirtyIx].map((c) => store.indices.get(c));
    dirty.clear(); dirtyIx.clear();
    const ts = Date.now();
    for (const ws of wss.clients) {
      const d = rows.filter((r) => ws.subs.has(r.s));
      if (d.length) send(ws, { type: 'q', d, ts });
      if (ix.length) send(ws, { type: 'ix', d: ix, ts });
    }
  }, config.flushMs);

  setInterval(() => { const m = statusMsg(); for (const ws of wss.clients) send(ws, m); }, 2000);
  // Heartbeat: dọn kết nối chết
  setInterval(() => {
    for (const ws of wss.clients) { if (!ws.isAlive) { ws.terminate(); continue; } ws.isAlive = false; ws.ping(); }
  }, 15_000);
  log.info('[hub] websocket tại /ws');
  return {
    wss,
    broadcast: (msg) => { for (const ws of wss.clients) send(ws, msg); },
    sendTo: (owner, msg) => { for (const ws of wss.clients) if (ws.owner === owner) send(ws, msg); },
  };
}
