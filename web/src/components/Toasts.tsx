import { useEffect, useState } from 'react';
import { feed } from '../lib/feed';
import type { AlertEvent } from '../lib/api';

/** Hiện thông báo khi cảnh báo kích hoạt: toast trong trang + Notification hệ điều hành + tiếng bíp */
export function Toasts() {
  const [items, setItems] = useState<AlertEvent[]>([]);
  useEffect(() => feed.onAlert((ev) => {
    setItems((x) => [ev, ...x].slice(0, 5));
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== ev.id)), 12_000);
    try {
      if (Notification.permission === 'granted') new Notification('🔔 Cảnh báo giá', { body: ev.msg, tag: ev.id });
    } catch { /* không hỗ trợ */ }
    try {
      const ctx = new AudioContext(); const o = ctx.createOscillator(); const g = ctx.createGain();
      o.frequency.value = 880; g.gain.value = 0.08; o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.25);
    } catch { /* bỏ qua */ }
  }), []);
  return (
    <div className="toasts">
      {items.map((i) => (
        <div key={i.id} className="toast" onClick={() => setItems((x) => x.filter((y) => y.id !== i.id))}>🔔 {i.msg}</div>
      ))}
    </div>
  );
}
