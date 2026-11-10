import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Lưu trữ cảnh báo bền vững.
 * - Có DATABASE_URL (Postgres, VD Neon miễn phí) => lưu vào DB, không mất khi server khởi động lại/deploy.
 * - Không có => lưu file JSON (chỉ phù hợp chạy trên máy cá nhân).
 */
export async function createStorage(log = console) {
  const url = process.env.DATABASE_URL;
  const s = url ? new PgStorage(url, log) : new FileStorage(log);
  await s.init();
  log.info(`[storage] dùng ${s.kind}`);
  return s;
}

class FileStorage {
  kind = 'file JSON';
  constructor(log) {
    this.log = log;
    this.file = process.env.ALERTS_FILE || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data/alerts.json');
    this.data = { alerts: [], history: [] };
  }
  async init() { try { this.data = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { /* trống */ } }
  flush() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    this.data.history = this.data.history.slice(0, 1000);
    fs.writeFileSync(this.file, JSON.stringify(this.data));
  }
  async loadAlerts() { return this.data.alerts || []; }
  async loadHistory() { return this.data.history || []; }
  async upsertAlert(a) {
    const i = this.data.alerts.findIndex((x) => x.id === a.id);
    if (i >= 0) this.data.alerts[i] = a; else this.data.alerts.push(a);
    this.flush();
  }
  async deleteAlert(id) { this.data.alerts = this.data.alerts.filter((x) => x.id !== id); this.flush(); }
  async insertEvent(ev) { this.data.history.unshift(ev); this.flush(); }
}

class PgStorage {
  kind = 'PostgreSQL';
  constructor(url, log) { this.url = url; this.log = log; }
  async init() {
    const { default: pg } = await import('pg');
    const local = /localhost|127\.0\.0\.1|\/tmp|host=\//.test(this.url);
    this.pool = new pg.Pool({
      connectionString: this.url, max: 5, idleTimeoutMillis: 30_000,
      ssl: local ? false : { rejectUnauthorized: false },
    });
    this.pool.on('error', (e) => this.log.warn('[storage] pg', e.message));
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS alerts (
        id TEXT PRIMARY KEY, owner TEXT NOT NULL, data JSONB NOT NULL, updated_at TIMESTAMPTZ DEFAULT now());
      CREATE INDEX IF NOT EXISTS alerts_owner ON alerts(owner);
      CREATE TABLE IF NOT EXISTS alert_events (
        id TEXT PRIMARY KEY, owner TEXT NOT NULL, at BIGINT NOT NULL, data JSONB NOT NULL);
      CREATE INDEX IF NOT EXISTS alert_events_owner_at ON alert_events(owner, at DESC);`);
  }
  async loadAlerts() { return (await this.pool.query('SELECT data FROM alerts')).rows.map((r) => r.data); }
  async loadHistory() {
    // 200 lần báo gần nhất của mỗi người dùng
    const q = `SELECT data FROM (SELECT data, at, row_number() OVER (PARTITION BY owner ORDER BY at DESC) rn FROM alert_events) t
               WHERE rn <= 200 ORDER BY at DESC`;
    return (await this.pool.query(q)).rows.map((r) => r.data);
  }
  async upsertAlert(a) {
    await this.pool.query(
      `INSERT INTO alerts(id, owner, data) VALUES ($1,$2,$3)
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`, [a.id, a.owner, a]);
  }
  async deleteAlert(id) { await this.pool.query('DELETE FROM alerts WHERE id = $1', [id]); }
  async insertEvent(ev) {
    await this.pool.query('INSERT INTO alert_events(id, owner, at, data) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [ev.id, ev.owner, ev.at, ev]);
  }
}
