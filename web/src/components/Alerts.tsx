import { useEffect, useState } from 'react';
import { api, clientId, setClientId, ALERT_LABELS, SIGNAL_LABELS, type Alert, type AlertEvent, type Signal } from '../lib/api';
import { feed } from '../lib/feed';

const time = (t: number) => new Date(t).toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
const dt = (t: number) => new Date(t).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });

interface Props { initialSym?: string; onPick: (s: string) => void }

export function Alerts({ initialSym, onPick }: Props) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [hist, setHist] = useState<AlertEvent[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [form, setForm] = useState({ sym: initialSym || '', type: 'MA20_CROSS_UP', value: '', repeat: true, note: '', telegramChatId: '' });
  const [err, setErr] = useState('');
  const [perm, setPerm] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'denied');

  const reload = () => {
    api<Alert[]>('/alerts').then(setAlerts).catch((e) => setErr(e.message));
    api<AlertEvent[]>('/alerts/history').then(setHist).catch(() => {});
  };
  useEffect(() => {
    reload();
    api<Signal[]>('/signals').then(setSignals).catch(() => {});
    const a = feed.onAlert(() => reload());
    const b = feed.onSignal((s) => setSignals((x) => [s, ...x].slice(0, 300)));
    return () => { a(); b(); };
  }, []);
  useEffect(() => { if (initialSym) setForm((f) => ({ ...f, sym: initialSym })); }, [initialSym]);

  const def = ALERT_LABELS[form.type];
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('');
    try {
      await api('/alerts', { method: 'POST', body: { ...form, sym: form.sym.trim().toUpperCase(), value: def.kind === 'level' ? Number(form.value) : null } });
      setForm((f) => ({ ...f, value: '', note: '' }));
      reload();
    } catch (e: any) { setErr(e.message); }
  };
  const toggle = async (a: Alert) => { await api(`/alerts/${a.id}`, { method: 'PATCH', body: { active: !a.active } }); reload(); };
  const del = async (a: Alert) => { await api(`/alerts/${a.id}`, { method: 'DELETE' }); reload(); };
  const askPerm = async () => setPerm(await Notification.requestPermission());

  return (
    <div className="page alerts">
      <section className="card">
        <h3>Tạo cảnh báo</h3>
        <form onSubmit={submit} className="aform">
          <label>Mã <input value={form.sym} onChange={(e) => setForm({ ...form, sym: e.target.value.toUpperCase() })} placeholder="VD: FPT" required maxLength={10} /></label>
          <label>Điều kiện
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {Object.entries(ALERT_LABELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </label>
          {def.kind === 'level' && (
            <label>Giá trị <input type="number" step="any" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} required /> <span className="muted">{def.unit}</span></label>
          )}
          <label><input type="checkbox" checked={form.repeat} onChange={(e) => setForm({ ...form, repeat: e.target.checked })} /> Lặp lại (báo mỗi lần điều kiện xảy ra lại)</label>
          <label>Ghi chú <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} maxLength={200} /></label>
          <label title="Cần cấu hình TELEGRAM_BOT_TOKEN trên server">Telegram chat ID (tuỳ chọn) <input value={form.telegramChatId} onChange={(e) => setForm({ ...form, telegramChatId: e.target.value })} maxLength={40} /></label>
          <button type="submit" className="primary">+ Thêm cảnh báo</button>
          {err && <span className="c-down">{err}</span>}
        </form>
        <div className="muted note">
          Cảnh báo được kiểm tra trên server theo từng lệnh khớp, nên vẫn chạy kể cả khi bạn đóng tab (thông báo sẽ hiện ở lịch sử, hoặc Telegram nếu có cấu hình).
          {perm !== 'granted' && typeof Notification !== 'undefined' && <> <button className="link" onClick={askPerm}>Bật thông báo trình duyệt</button></>}
        </div>
      </section>

      <section className="card">
        <h3>Mã đồng bộ thiết bị</h3>
        <div className="aform">
          <span>Mã của trình duyệt này: <code className="code">{clientId}</code></span>
          <button type="button" onClick={() => navigator.clipboard?.writeText(clientId)}>Sao chép</button>
          <SyncInput />
        </div>
        <div className="muted note">Dán mã này ở điện thoại/máy khác để dùng chung danh sách cảnh báo. Giữ bí mật — ai có mã đều xem/sửa được cảnh báo của bạn.</div>
      </section>

      <section className="card">
        <h3>Cảnh báo của tôi ({alerts.length})</h3>
        <table className="grid">
          <thead><tr><th>Mã</th><th>Điều kiện</th><th>Lặp</th><th>Đã báo</th><th>Lần cuối</th><th>Trạng thái</th><th /></tr></thead>
          <tbody>
            {alerts.map((a) => (
              <tr key={a.id} className={a.active ? '' : 'off'}>
                <td><a onClick={() => onPick(a.sym)}>{a.sym}</a></td>
                <td>{ALERT_LABELS[a.type]?.label} {a.value ?? ''} {a.note && <span className="muted">· {a.note}</span>}</td>
                <td>{a.repeat ? '✓' : ''}</td>
                <td>{a.firedCount}</td>
                <td>{a.lastFiredAt ? dt(a.lastFiredAt) : '—'}</td>
                <td><button className="link" onClick={() => toggle(a)}>{a.active ? '🟢 Đang bật' : '⚪ Tắt'}</button></td>
                <td><button className="icon" onClick={() => del(a)} title="Xoá">🗑</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!alerts.length && <div className="empty muted">Chưa có cảnh báo.</div>}
      </section>

      <div className="two">
        <section className="card">
          <h3>Lịch sử đã báo</h3>
          <ul className="feedlist">
            {hist.map((h) => <li key={h.id}><span className="muted">{dt(h.at)}</span> {h.msg}</li>)}
            {!hist.length && <li className="muted">Chưa có.</li>}
          </ul>
        </section>
        <section className="card">
          <h3>Tín hiệu toàn thị trường hôm nay <span className="muted">(realtime)</span></h3>
          <ul className="feedlist">
            {signals.map((s) => (
              <li key={s.id}>
                <span className="muted">{time(s.at)}</span>{' '}
                <a onClick={() => onPick(s.s)}><b>{s.s}</b></a>{' '}
                <span className={`tag ${s.type === 'MA20_CROSS_UP' ? 'buy' : s.type === 'MA20_CROSS_DOWN' ? 'sell' : ''}`}>{SIGNAL_LABELS[s.type] || s.type}</span>{' '}
                giá {s.price} · MA20 {s.ma20 ?? '—'} · RSI {s.rsi14 ?? '—'} · KL {s.volRatio ?? '—'}×
              </li>
            ))}
            {!signals.length && <li className="muted">Chưa có tín hiệu (chỉ phát sinh trong giờ giao dịch).</li>}
          </ul>
        </section>
      </div>
    </div>
  );
}

function SyncInput() {
  const [v, setV] = useState('');
  const ok = /^[\w-]{8,64}$/.test(v.trim());
  return (
    <>
      <input placeholder="Dán mã từ thiết bị khác" value={v} onChange={(e) => setV(e.target.value)} style={{ width: 300 }} />
      <button type="button" disabled={!ok} onClick={() => { if (confirm('Dùng mã này? Các cảnh báo của mã hiện tại sẽ không hiển thị nữa (vẫn được lưu).')) setClientId(v.trim()); }}>Dùng mã này</button>
    </>
  );
}
