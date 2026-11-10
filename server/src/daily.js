import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

/**
 * Kho nến ngày lịch sử của toàn thị trường (dùng tính MA/RSI/MACD cho bộ lọc & cảnh báo).
 * - Chỉ giữ các phiên ĐÃ KẾT THÚC (trước hôm nay); phiên hôm nay lấy từ dữ liệu realtime.
 * - Cache ra đĩa để khởi động lại không phải tải lại ~1.500 mã.
 */
const FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data/daily.json');
const DAYS = 420;

export const vnDate = (ms = Date.now()) => new Date(ms + 7 * 3600_000).toISOString().slice(0, 10);

/** Ngày làm việc (T2-T6) liền trước hôm nay = phiên cuối mà kho lịch sử cần có */
export function prevTradingDay(now = Date.now()) {
  let t = now + 7 * 3600_000 - 86400_000;
  while ([0, 6].includes(new Date(t).getUTCDay())) t -= 86400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Phiên hôm nay đã bắt đầu chưa (từ 9:00 ngày làm việc) => có nến "hôm nay" từ realtime */
export function todayStarted(now = Date.now()) {
  const d = new Date(now + 7 * 3600_000);
  return ![0, 6].includes(d.getUTCDay()) && d.getUTCHours() >= 9;
}

export class DailyStore {
  constructor(log = console) {
    this.log = log;
    this.bars = new Map(); // sym -> {t:[],c:[],h:[],l:[],v:[]}
    this.asOf = '';
    this.loading = false;
    this.progress = { done: 0, total: 0 };
    this.listeners = new Set();
  }

  loadCache() {
    try {
      const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      const first = Object.values(j.bars)[0];
      if (!first?.o) { this.log.info('[daily] cache định dạng cũ (thiếu giá mở cửa) → tải lại'); return; }
      this.asOf = j.asOf;
      for (const [s, b] of Object.entries(j.bars)) this.bars.set(s, b);
      this.log.info(`[daily] cache ${this.bars.size} mã, đến ngày ${this.asOf}`);
    } catch { /* chưa có cache */ }
  }

  saveCache() {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify({ asOf: this.asOf, bars: Object.fromEntries(this.bars) }));
  }

  async fetchOne(sym, today) {
    const to = Math.floor(Date.now() / 1000);
    const kind = /^VN30F/.test(sym) ? 'derivative' : 'stock';
    const url = `${config.historyApi}/${kind}?symbol=${sym}&resolution=1D&from=${to - DAYS * 86400}&to=${to}`;
    for (let i = 0; i < 3; i++) {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(15_000) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        const b = { t: [], o: [], c: [], h: [], l: [], v: [] };
        (j.t || []).forEach((t, k) => {
          if (vnDate(t * 1000) >= today) return; // bỏ phiên hôm nay (chưa chốt)
          b.t.push(t); b.o.push(j.o[k]); b.c.push(j.c[k]); b.h.push(j.h[k]); b.l.push(j.l[k]); b.v.push(j.v[k]);
        });
        return b;
      } catch (e) {
        if (i === 2) throw e;
        await new Promise((res) => setTimeout(res, 1000 * (i + 1)));
      }
    }
  }

  async refresh(symbols) {
    if (this.loading) return;
    this.loading = true;
    const today = vnDate();
    const target = prevTradingDay();
    const queue = [...symbols];
    this.progress = { done: 0, total: queue.length };
    const t0 = Date.now();
    let failed = 0;
    const worker = async () => {
      while (queue.length) {
        const s = queue.shift();
        try { this.bars.set(s, await this.fetchOne(s, today)); } catch { failed++; }
        this.progress.done++;
      }
    };
    await Promise.all(Array.from({ length: 10 }, worker));
    this.asOf = target;
    this.loading = false;
    this.saveCache();
    this.log.info(`[daily] tải ${symbols.length} mã (${failed} lỗi) trong ${Math.round((Date.now() - t0) / 1000)}s`);
    this.listeners.forEach((l) => l());
  }

  /** Tự cập nhật sau mỗi phiên */
  schedule(getSymbols) {
    const check = () => {
      const syms = getSymbols();
      if (!syms.length || this.loading) return;
      if (this.asOf !== prevTradingDay()) { this.refresh(syms).catch((e) => this.log.warn('[daily]', e.message)); return; }
      const missing = syms.filter((x) => !this.bars.has(x)); // mã mới (VD phái sinh) chưa có trong cache
      if (missing.length) this.refresh(missing).catch((e) => this.log.warn('[daily]', e.message));
    };
    check();
    setInterval(check, 10 * 60_000);
  }

  onUpdate(l) { this.listeners.add(l); }
}
