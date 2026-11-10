import crypto from 'node:crypto';

const COOLDOWN_MS = Number(process.env.ALERT_COOLDOWN_MS || 15 * 60_000);

/**
 * Các loại điều kiện cảnh báo.
 * level: điều kiện trạng thái (báo ngay nếu đã đúng khi tạo).
 * event: sự kiện cắt (chỉ báo khi trạng thái chuyển từ sai -> đúng).
 */
export const ALERT_TYPES = {
  PRICE_GTE: { label: 'Giá ≥', kind: 'level', test: (st, m, v) => st.last > 0 && st.last >= v },
  PRICE_LTE: { label: 'Giá ≤', kind: 'level', test: (st, m, v) => st.last > 0 && st.last <= v },
  PCT_GTE: { label: '% thay đổi ≥', kind: 'level', test: (st, m, v) => st.last > 0 && st.chgPc >= v },
  PCT_LTE: { label: '% thay đổi ≤', kind: 'level', test: (st, m, v) => st.last > 0 && st.chgPc <= v },
  VOL_GTE: { label: 'Tổng KL ≥', kind: 'level', test: (st, m, v) => st.totVol >= v },
  VOLRATIO_GTE: { label: 'KL/TB20 phiên ≥', kind: 'level', test: (st, m, v) => m?.volRatio >= v },
  RSI_LTE: { label: 'RSI(14) ≤', kind: 'level', test: (st, m, v) => m?.rsi14 !== null && m?.rsi14 <= v },
  RSI_GTE: { label: 'RSI(14) ≥', kind: 'level', test: (st, m, v) => m?.rsi14 !== null && m?.rsi14 >= v },
  MA20_CROSS_UP: { label: 'Giá cắt lên MA20 (tín hiệu MUA)', kind: 'event', test: (st, m) => !!m?.live && !!m?.aboveMa20 },
  MA20_CROSS_DOWN: { label: 'Giá cắt xuống MA20', kind: 'event', test: (st, m) => !!m?.live && m?.aboveMa20 === false && m?.ma20 !== null },
  MACD_CROSS_UP: { label: 'MACD cắt lên Signal', kind: 'event', test: (st, m) => !!m?.live && m?.macdHist > 0 },
};

export class AlertEngine {
  constructor(store, analytics, storage, log = console) {
    this.store = store; this.analytics = analytics; this.storage = storage; this.log = log;
    this.alerts = [];
    this.history = []; // các lần kích hoạt
    this.state = new Map(); // id -> kết quả test lần trước (cho loại event)
    this.listeners = new Set();
    analytics.on('metrics', (m) => this.evaluate(m.s));
    store.on('stock', (st) => this.evaluate(st.s, true));
  }

  /** Nạp cảnh báo đã lưu (DB/file) khi khởi động */
  async init() {
    this.alerts = await this.storage.loadAlerts();
    this.history = await this.storage.loadHistory();
    this.log.info(`[alert] nạp ${this.alerts.length} cảnh báo`);
  }

  /**
   * Ghi bền vững theo hàng đợi tuần tự (giữ đúng thứ tự ghi), thử lại tối đa 3 lần.
   * Lỗi DB không làm dừng việc kiểm tra cảnh báo (trạng thái chính nằm trong bộ nhớ).
   */
  persist(fn) {
    this.queue = (this.queue || Promise.resolve()).then(async () => {
      for (let i = 0; ; i++) {
        try { return await fn(); } catch (e) {
          if (i >= 3) { this.log.warn('[alert] lưu thất bại', e.message); return; }
          await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
        }
      }
    });
    return this.queue;
  }
  flushed() { return this.queue || Promise.resolve(); }

  list(owner) { return this.alerts.filter((a) => a.owner === owner); }
  historyOf(owner) { return this.history.filter((h) => h.owner === owner).slice(0, 200); }

  create(owner, { sym, type, value, repeat = false, note = '', telegramChatId = '' }) {
    sym = String(sym || '').toUpperCase();
    if (!this.store.stocks.has(sym)) throw Object.assign(new Error('Mã không tồn tại'), { status: 400 });
    if (!ALERT_TYPES[type]) throw Object.assign(new Error('Loại cảnh báo không hợp lệ'), { status: 400 });
    const v = value === null || value === '' || value === undefined ? NaN : Number(value);
    if (ALERT_TYPES[type].kind === 'level' && !Number.isFinite(v)) throw Object.assign(new Error('Giá trị không hợp lệ'), { status: 400 });
    if (this.list(owner).length >= 200) throw Object.assign(new Error('Tối đa 200 cảnh báo'), { status: 400 });
    const a = { id: crypto.randomUUID(), owner, sym, type, value: ALERT_TYPES[type].kind === 'level' ? v : null, repeat: !!repeat, note: String(note).slice(0, 200), telegramChatId: String(telegramChatId || '').slice(0, 40), active: true, createdAt: Date.now(), firedCount: 0, lastFiredAt: 0 };
    this.alerts.push(a);
    this.persist(() => this.storage.upsertAlert(a));
    // Với loại sự kiện: ghi nhận trạng thái hiện tại làm mốc để chỉ báo khi có lần cắt MỚI
    const st = this.store.stocks.get(sym);
    if (ALERT_TYPES[type].kind === 'event') this.state.set(a.id, ALERT_TYPES[type].test(st, this.analytics.metrics.get(sym), a.value));
    this.evaluate(sym);
    return a;
  }

  update(owner, id, patch) {
    const a = this.alerts.find((x) => x.id === id && x.owner === owner);
    if (!a) throw Object.assign(new Error('Không tìm thấy'), { status: 404 });
    if ('active' in patch) { a.active = !!patch.active; this.state.delete(a.id); }
    this.persist(() => this.storage.upsertAlert(a));
    if (a.active) this.evaluate(a.sym);
    return a;
  }

  remove(owner, id) {
    const n = this.alerts.length;
    this.alerts = this.alerts.filter((x) => !(x.id === id && x.owner === owner));
    if (this.alerts.length === n) throw Object.assign(new Error('Không tìm thấy'), { status: 404 });
    this.state.delete(id);
    this.persist(() => this.storage.deleteAlert(id));
  }

  evaluate(sym, priceOnly = false) {
    const st = this.store.stocks.get(sym);
    if (!st) return;
    const m = this.analytics.metrics.get(sym);
    for (const a of this.alerts) {
      if (a.sym !== sym || !a.active) continue;
      const def = ALERT_TYPES[a.type];
      if (priceOnly && !a.type.startsWith('PRICE') && !a.type.startsWith('PCT') && a.type !== 'VOL_GTE') continue;
      const ok = def.test(st, m, a.value);
      const before = this.state.get(a.id);
      this.state.set(a.id, ok);
      if (!ok) continue;
      // level: báo khi lần đầu đúng (hoặc vừa chuyển sai->đúng nếu lặp lại)
      // event: chỉ báo khi chuyển sai->đúng, không báo ở lần đánh giá đầu tiên sau khởi động
      if (def.kind === 'event' && before !== false) continue;
      if (def.kind === 'level' && before === true) continue;
      // Chống "nhiễu": giá dao động quanh MA20 có thể cắt lên/xuống liên tục -> mỗi cảnh báo tối thiểu cách nhau COOLDOWN
      if (a.lastFiredAt && Date.now() - a.lastFiredAt < COOLDOWN_MS) continue;
      this.fire(a, st, m);
    }
  }

  fire(a, st, m) {
    a.firedCount++; a.lastFiredAt = Date.now();
    if (!a.repeat) a.active = false;
    const def = ALERT_TYPES[a.type];
    const msg = `${a.sym}: ${def.label}${a.value !== null && def.kind === 'level' ? ' ' + a.value : ''} — giá ${st.last} (${st.chgPc > 0 ? '+' : ''}${st.chgPc}%)${m?.ma20 ? `, MA20 ${m.ma20}` : ''}${m?.rsi14 ? `, RSI ${m.rsi14}` : ''}`;
    const ev = { id: crypto.randomUUID(), alertId: a.id, owner: a.owner, sym: a.sym, type: a.type, msg, price: st.last, at: Date.now() };
    this.history.unshift(ev);
    if (this.history.length > 5000) this.history.length = 5000;
    this.persist(() => this.storage.insertEvent(ev));
    this.persist(() => this.storage.upsertAlert(a));
    this.log.info('[alert]', msg);
    this.listeners.forEach((l) => l(ev, a));
    if (a.telegramChatId && process.env.TELEGRAM_BOT_TOKEN) {
      fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: a.telegramChatId, text: `🔔 ${msg}` }),
      }).catch((e) => this.log.warn('[telegram]', e.message));
    }
  }

  onFire(l) { this.listeners.add(l); }
}
