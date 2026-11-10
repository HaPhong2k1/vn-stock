import { config } from './config.js';

// Proxy + cache dữ liệu nến lịch sử (DNSE/Entrade), tránh CORS và giảm tải nguồn.
const cache = new Map();
const INDEX = new Set(['VNINDEX', 'VN30', 'HNX', 'HNX30', 'UPCOM', 'HNXINDEX', 'UPCOMINDEX']);
const RES = new Set(['1', '5', '15', '30', '1H', '1D', '1W']);

export async function getHistory({ symbol, resolution = '1D', from, to }) {
  symbol = String(symbol || '').toUpperCase();
  if (!/^[A-Z0-9]{2,12}$/.test(symbol)) throw Object.assign(new Error('symbol không hợp lệ'), { status: 400 });
  if (!RES.has(resolution)) throw Object.assign(new Error('resolution không hợp lệ'), { status: 400 });
  const now = Math.floor(Date.now() / 1000);
  to = Number(to) || now;
  from = Number(from) || to - (resolution.endsWith('D') || resolution === '1W' ? 365 * 2 : 5) * 86400;
  const kind = INDEX.has(symbol) ? 'index' : /^VN30F/.test(symbol) ? 'derivative' : 'stock';
  const key = `${kind}:${symbol}:${resolution}:${from}:${Math.floor(to / 30)}`; // cache 30s
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.data;
  const url = `${config.historyApi}/${kind}?symbol=${symbol}&resolution=${resolution}&from=${from}&to=${to}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw Object.assign(new Error(`history HTTP ${r.status}`), { status: 502 });
  const j = await r.json();
  const data = (j.t || []).map((t, i) => ({ time: t, open: j.o[i], high: j.h[i], low: j.l[i], close: j.c[i], volume: j.v[i] }));
  cache.set(key, { data, exp: Date.now() + 30_000 });
  if (cache.size > 2000) cache.delete(cache.keys().next().value);
  return data;
}
