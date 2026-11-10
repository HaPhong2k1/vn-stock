import { useCallback, useEffect, useMemo, useState } from 'react';
import { feed } from './lib/feed';
import { useGlobal } from './lib/hooks';
import { IndexBar } from './components/IndexBar';
import { StatusBar } from './components/StatusBar';
import { PriceBoard } from './components/PriceBoard';
import { StockDetail } from './components/StockDetail';

const TABS = ['WATCH', 'VN30', 'HOSE', 'HNX30', 'HNX', 'UPCOM'] as const;
const LABEL: Record<string, string> = { WATCH: '★ Danh mục', VN30: 'VN30', HOSE: 'HOSE', HNX30: 'HNX30', HNX: 'HNX', UPCOM: 'UPCOM' };

function loadWatch(): string[] {
  try { return JSON.parse(localStorage.getItem('watch') || '["FPT","VNM","HPG","SSI","MWG","VCB"]'); } catch { return []; }
}

export default function App() {
  const f = useGlobal();
  const [tab, setTab] = useState<string>(() => { try { return localStorage.getItem('tab') || 'VN30'; } catch { return 'VN30'; } });
  const [watch, setWatch] = useState<string[]>(loadWatch);
  const [q, setQ] = useState('');
  const [pick, setPick] = useState<string | null>(null);
  const watchSet = useMemo(() => new Set(watch), [watch]);

  useEffect(() => { try { localStorage.setItem('watch', JSON.stringify(watch)); localStorage.setItem('tab', tab); } catch { /* ignore */ } }, [watch, tab]);

  const groupsKey = Object.keys(f.groups).join();
  const syms = useMemo(() => {
    const base = tab === 'WATCH' ? watch : [...(f.groups[tab] || [])].sort();
    const qq = q.trim().toUpperCase();
    return qq ? base.filter((s) => s.includes(qq)) : base;
  }, [tab, watch, q, groupsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Đăng ký realtime cho các mã của tab hiện tại + mã đang xem chi tiết
  useEffect(() => { feed.subscribe(pick ? [...syms, pick] : syms); }, [syms, pick]);

  const toggleWatch = useCallback((s: string) => setWatch((w) => (w.includes(s) ? w.filter((x) => x !== s) : [...w, s])), []);

  const allSyms = useMemo(() => new Set(Object.values(f.groups).flat()), [groupsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const onSearchEnter = () => {
    const s = q.trim().toUpperCase();
    if (allSyms.has(s)) { setPick(s); setQ(''); }
  };

  return (
    <div className="app">
      <header>
        <div className="brand">📈 VN Stock <small>Realtime</small></div>
        <IndexBar />
      </header>
      <nav className="toolbar">
        {TABS.map((t) => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{LABEL[t]}</button>
        ))}
        <input placeholder="Tìm mã (Enter để xem chi tiết)" value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onSearchEnter()} />
        <span className="muted count">{syms.length} mã · Giá: nghìn đồng · KL: cổ phiếu</span>
      </nav>
      <main className={pick ? 'with-detail' : ''}>
        <PriceBoard syms={syms} watch={watchSet} onPick={setPick} onToggleWatch={toggleWatch} />
        {pick && <StockDetail key={pick} sym={pick} onClose={() => setPick(null)} />}
      </main>
      <StatusBar />
    </div>
  );
}
