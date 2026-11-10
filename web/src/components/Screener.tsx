import { useEffect, useMemo, useState } from 'react';
import { api, type Metrics } from '../lib/api';
import { fmtBig } from '../lib/format';

type Pred = (m: Metrics) => boolean;
const PRESETS: { key: string; label: string; hint: string; test: Pred }[] = [
  { key: 'ma20up', label: '🟢 Cắt lên MA20 (MUA)', hint: 'Phiên trước đóng cửa ≤ MA20, giá hiện tại > MA20', test: (m) => m.ma20CrossUp },
  { key: 'ma20down', label: '🔴 Cắt xuống MA20', hint: 'Phiên trước ≥ MA20, giá hiện tại < MA20', test: (m) => m.ma20CrossDown },
  { key: 'above20', label: 'Trên MA20', hint: 'Giá > MA20', test: (m) => m.aboveMa20 },
  { key: 'uptrend', label: 'Xu hướng tăng', hint: 'Giá > MA20 > MA50 > MA200', test: (m) => !!(m.ma20 && m.ma50 && m.ma200 && m.price > m.ma20 && m.ma20 > m.ma50 && m.ma50 > m.ma200) },
  { key: 'rsi30', label: 'RSI quá bán (<30)', hint: 'RSI(14) < 30', test: (m) => m.rsi14 !== null && m.rsi14 < 30 },
  { key: 'rsi70', label: 'RSI quá mua (>70)', hint: 'RSI(14) > 70', test: (m) => m.rsi14 !== null && m.rsi14 > 70 },
  { key: 'vol2x', label: 'KL đột biến (≥2× TB20)', hint: 'KL hôm nay ≥ 2 lần TB 20 phiên', test: (m) => (m.volRatio || 0) >= 2 },
  { key: 'macd', label: 'MACD cắt lên', hint: 'Histogram MACD chuyển từ âm sang dương', test: (m) => m.macdCrossUp },
  { key: 'ema', label: 'EMA9 cắt lên EMA21', hint: 'EMA9 vượt EMA21 phiên này', test: (m) => m.ema9CrossUp },
  { key: 'emaUp', label: '🟢 EMA10 cắt lên EMA20 (BUY)', hint: 'Chiến lược EMA cross (che_trader): EMA10 vượt EMA20 phiên này', test: (m) => m.emaCrossUp },
  { key: 'emaDown', label: '🔴 EMA10 cắt xuống EMA20 (SELL)', hint: 'EMA10 xuống dưới EMA20 phiên này', test: (m) => m.emaCrossDown },
  { key: 'smcChochUp', label: '◆ SMC: CHoCH tăng', hint: 'Smart Money Concepts (LuxAlgo): đổi cấu trúc sang tăng ở phiên này', test: (m) => m.smcBullChoch },
  { key: 'smcBosUp', label: '◆ SMC: BOS tăng', hint: 'Phá vỡ cấu trúc tăng (tiếp diễn) ở phiên này', test: (m) => m.smcBullBos },
  { key: 'smcTrendUp', label: '◆ SMC: xu hướng swing tăng', hint: 'Cấu trúc swing gần nhất là tăng', test: (m) => m.smcSwingTrend === 1 },
  { key: 'golden', label: 'Golden cross', hint: 'MA50 cắt lên MA200', test: (m) => m.goldenCross },
  { key: 'bbLow', label: 'Chạm dải Bollinger dưới', hint: 'Giá ≤ BB dưới', test: (m) => m.bbLow !== null && m.price <= m.bbLow },
  { key: 'hi52', label: 'Đỉnh 52 tuần', hint: 'Giá ≥ 99% đỉnh 52 tuần', test: (m) => !!m.hi52 && m.price >= m.hi52 * 0.99 },
];

type Col = { k: keyof Metrics; label: string; fmt?: (m: Metrics) => string; cls?: (m: Metrics) => string };
const pcCls = (v: number | null) => (v === null ? '' : v > 0 ? 'c-up' : v < 0 ? 'c-down' : 'c-ref');
const n2 = (v: number | null) => (v === null || v === undefined ? '—' : v.toFixed(2));
const COLS: Col[] = [
  { k: 's', label: 'Mã' }, { k: 'ex', label: 'Sàn' },
  { k: 'price', label: 'Giá', fmt: (m) => m.price.toFixed(2), cls: (m) => pcCls(m.chgPc) },
  { k: 'chgPc', label: '%', fmt: (m) => (m.chgPc > 0 ? '+' : '') + m.chgPc.toFixed(2), cls: (m) => pcCls(m.chgPc) },
  { k: 'ma20', label: 'MA20', fmt: (m) => n2(m.ma20) },
  { k: 'distMa20', label: '% vs MA20', fmt: (m) => n2(m.distMa20), cls: (m) => pcCls(m.distMa20) },
  { k: 'ma50', label: 'MA50', fmt: (m) => n2(m.ma50) },
  { k: 'rsi14', label: 'RSI14', fmt: (m) => n2(m.rsi14), cls: (m) => (m.rsi14 === null ? '' : m.rsi14 < 30 ? 'c-floor' : m.rsi14 > 70 ? 'c-ceil' : '') },
  { k: 'macdHist', label: 'MACD hist', fmt: (m) => n2(m.macdHist), cls: (m) => pcCls(m.macdHist) },
  { k: 'totVol', label: 'KL', fmt: (m) => fmtBig(m.totVol) },
  { k: 'volRatio', label: 'KL/TB20', fmt: (m) => (m.volRatio === null ? '—' : m.volRatio.toFixed(2) + '×') },
  { k: 'value', label: 'GTGD (tỷ)', fmt: (m) => m.value.toFixed(1) },
];

interface Props { onPick: (s: string) => void; onQuickAlert: (s: string) => void; watch: Set<string> }

export function Screener({ onPick, onQuickAlert, watch }: Props) {
  const [data, setData] = useState<{ asOf: string; loading: boolean; progress: { done: number; total: number }; rows: Metrics[] } | null>(null);
  const [presets, setPresets] = useState<string[]>(['ma20up']);
  const [ex, setEx] = useState('ALL');
  const [minValue, setMinValue] = useState(1);     // GTGD tối thiểu (tỷ) để lọc mã thanh khoản kém
  const [minAvgVol, setMinAvgVol] = useState(100_000);
  const [onlyWatch, setOnlyWatch] = useState(false);
  const [sort, setSort] = useState<{ k: keyof Metrics; dir: 1 | -1 }>({ k: 'value', dir: -1 });
  const [err, setErr] = useState('');

  useEffect(() => {
    let dead = false;
    const load = () => api('/screener').then((d) => { if (!dead) { setData(d); setErr(''); } }).catch((e) => !dead && setErr(e.message));
    load();
    const t = setInterval(load, 3000); // cập nhật realtime 3s/lần
    return () => { dead = true; clearInterval(t); };
  }, []);

  const rows = useMemo(() => {
    if (!data) return [];
    const preds = PRESETS.filter((p) => presets.includes(p.key)).map((p) => p.test);
    const out = data.rows.filter((m) =>
      (ex === 'ALL' || m.ex === ex) && m.value >= minValue && m.avgVol20 >= minAvgVol
      && (!onlyWatch || watch.has(m.s)) && preds.every((p) => p(m)));
    return out.sort((a, b) => {
      const x = a[sort.k] as any, y = b[sort.k] as any;
      if (x === y) return 0;
      if (x === null) return 1; if (y === null) return -1;
      return (x > y ? 1 : -1) * sort.dir;
    });
  }, [data, presets, ex, minValue, minAvgVol, onlyWatch, watch, sort]);

  const toggle = (k: string) => setPresets((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));

  return (
    <div className="page">
      <div className="filters">
        <div className="chips">
          {PRESETS.map((p) => (
            <button key={p.key} title={p.hint} className={presets.includes(p.key) ? 'on' : ''} onClick={() => toggle(p.key)}>{p.label}</button>
          ))}
        </div>
        <div className="frow">
          <label>Sàn <select value={ex} onChange={(e) => setEx(e.target.value)}>{['ALL', 'HOSE', 'HNX', 'UPCOM'].map((x) => <option key={x}>{x}</option>)}</select></label>
          <label>GTGD hôm nay ≥ <input type="number" value={minValue} min={0} step={1} onChange={(e) => setMinValue(+e.target.value)} /> tỷ</label>
          <label>KL TB20 ≥ <input type="number" value={minAvgVol} min={0} step={50000} onChange={(e) => setMinAvgVol(+e.target.value)} /></label>
          <label><input type="checkbox" checked={onlyWatch} onChange={(e) => setOnlyWatch(e.target.checked)} /> Chỉ danh mục</label>
          <span className="muted">
            {data ? `${rows.length} / ${data.rows.length} mã · lịch sử đến ${data.asOf || '…'}` : 'Đang tải…'}
            {data?.loading && ` · đang tải lịch sử ${data.progress.done}/${data.progress.total}`}
            {err && <span className="c-down"> · {err}</span>}
          </span>
        </div>
        <div className="muted note">Tín hiệu tính theo nến ngày; phiên hôm nay dùng giá khớp realtime (MA20 = 19 phiên trước + giá hiện tại). Trong phiên, tín hiệu có thể xuất hiện rồi mất nếu giá quay lại dưới MA20 — chỉ xác nhận khi đóng cửa.</div>
      </div>
      <div className="table-wrap">
        <table className="grid">
          <thead>
            <tr>
              {COLS.map((c) => (
                <th key={c.k} onClick={() => setSort((s) => ({ k: c.k, dir: s.k === c.k ? (-s.dir as 1 | -1) : -1 }))}>
                  {c.label}{sort.k === c.k ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
              <th>Tín hiệu</th><th />
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 300).map((m) => (
              <tr key={m.s} onClick={() => onPick(m.s)}>
                {COLS.map((c) => <td key={c.k} className={c.cls?.(m) || ''}>{c.fmt ? c.fmt(m) : String(m[c.k])}</td>)}
                <td className="tags">
                  {m.ma20CrossUp && <span className="tag buy">MUA · MA20↑</span>}
                  {m.ma20CrossDown && <span className="tag sell">MA20↓</span>}
                  {m.macdCrossUp && <span className="tag">MACD↑</span>}
                  {m.ema9CrossUp && <span className="tag">EMA9↑</span>}
                  {m.emaCrossUp && <span className="tag buy">BUY · EMA10↑20</span>}
                  {m.emaCrossDown && <span className="tag sell">SELL · EMA10↓20</span>}
                  {m.smcBullChoch && <span className="tag buy">CHoCH↑</span>}
                  {m.smcBearChoch && <span className="tag sell">CHoCH↓</span>}
                  {m.smcBullBos && <span className="tag">BOS↑</span>}
                  {m.goldenCross && <span className="tag">Golden</span>}
                </td>
                <td><button className="icon" title="Tạo cảnh báo" onClick={(e) => { e.stopPropagation(); onQuickAlert(m.s); }}>🔔</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > 300 && <div className="muted empty">Hiển thị 300 / {rows.length} mã — thu hẹp bộ lọc để xem thêm.</div>}
        {data && !rows.length && <div className="empty">Không có mã nào thỏa điều kiện.</div>}
      </div>
    </div>
  );
}
