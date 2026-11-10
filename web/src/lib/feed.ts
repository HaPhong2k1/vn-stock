import type { FeedStatus, Index, Stock } from './types';
import { clientId, type AlertEvent, type Signal } from './api';

type Listener = () => void;

/**
 * Kho dữ liệu phía client + kết nối WebSocket.
 * - Mỗi mã có danh sách listener riêng => chỉ dòng thay đổi mới render lại.
 * - Bỏ qua bản ghi có seq cũ hơn (chống đảo thứ tự).
 * - Tự kết nối lại (backoff) và đăng ký lại danh sách mã => nhận snapshot mới, không lệch dữ liệu.
 */
class Feed {
  stocks = new Map<string, Stock>();
  indices = new Map<string, Index>();
  groups: Record<string, string[]> = {};
  status: FeedStatus | null = null;
  conn: 'connecting' | 'open' | 'closed' = 'connecting';
  latency = 0;          // RTT trình duyệt <-> server (ms)
  lastUpdate = 0;       // thời điểm nhận batch gần nhất
  clockSkew = 0;

  private ws: WebSocket | null = null;
  private subs: string[] = [];
  private symListeners = new Map<string, Set<Listener>>();
  private globalListeners = new Set<Listener>();
  private retry = 0;
  private sigListeners = new Set<(s: Signal) => void>();
  private alertListeners = new Set<(e: AlertEvent) => void>();

  onSignal(l: (s: Signal) => void) { this.sigListeners.add(l); return () => { this.sigListeners.delete(l); }; }
  onAlert(l: (e: AlertEvent) => void) { this.alertListeners.add(l); return () => { this.alertListeners.delete(l); }; }

  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    this.conn = 'connecting'; this.emitGlobal();
    ws.onopen = () => {
      this.retry = 0; this.conn = 'open';
      ws.send(JSON.stringify({ op: 'auth', owner: clientId }));
      if (this.subs.length) ws.send(JSON.stringify({ op: 'sub', syms: this.subs }));
      this.emitGlobal();
    };
    ws.onmessage = (ev) => this.onMessage(JSON.parse(ev.data));
    ws.onclose = () => {
      this.conn = 'closed'; this.emitGlobal();
      const delay = Math.min(10_000, 500 * 2 ** this.retry++);
      setTimeout(() => this.connect(), delay);
    };
    ws.onerror = () => ws.close();
  }

  startPing() {
    setInterval(() => {
      if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ op: 'ping', t: performance.now() }));
    }, 5000);
  }

  subscribe(syms: string[]) {
    this.subs = [...new Set(syms)];
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ op: 'sub', syms: this.subs }));
  }

  private onMessage(m: any) {
    switch (m.type) {
      case 'hello':
        this.groups = m.groups || {};
        for (const ix of m.indices || []) this.indices.set(ix.code, ix);
        this.status = m; this.emitGlobal(); break;
      case 'snap':
      case 'q':
        for (const st of m.d as Stock[]) {
          const cur = this.stocks.get(st.s);
          if (m.type === 'q' && cur && cur.seq >= st.seq) continue;
          this.stocks.set(st.s, st);
          this.symListeners.get(st.s)?.forEach((l) => l());
        }
        this.lastUpdate = Date.now();
        if (m.type === 'snap') this.emitGlobal();
        break;
      case 'ix':
        for (const ix of m.d as Index[]) this.indices.set(ix.code, ix);
        this.emitGlobal(); break;
      case 'status':
        this.status = m; this.clockSkew = Date.now() - m.now; this.emitGlobal(); break;
      case 'sig':
        this.sigListeners.forEach((l) => l(m.d)); break;
      case 'alert':
        this.alertListeners.forEach((l) => l(m.d)); break;
      case 'pong':
        this.latency = Math.round(performance.now() - m.t); this.emitGlobal(); break;
    }
  }

  onSymbol(sym: string, l: Listener) {
    let set = this.symListeners.get(sym);
    if (!set) { set = new Set(); this.symListeners.set(sym, set); }
    set.add(l);
    return () => { set!.delete(l); };
  }
  onGlobal(l: Listener) { this.globalListeners.add(l); return () => { this.globalListeners.delete(l); }; }
  private emitGlobal() { this.globalListeners.forEach((l) => l()); }
}

export const feed = new Feed();
