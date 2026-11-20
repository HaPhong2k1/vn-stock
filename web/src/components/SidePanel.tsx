import { useEffect, useMemo, useState } from 'react';
import { useStock } from '../lib/hooks';
import { feed } from '../lib/feed';
import * as I from '../../../shared/indicators.js';

type Tab = 'watch' | 'tape' | 'info';
interface Props { sym: string; watch: string[]; onPick: (s: string) => void }

/** Bảng phụ bên phải biểu đồ toàn màn hình: Danh mục · Khớp lệnh · Thông tin */
export function SidePanel({ sym, watch, onPick }: Props) {
  const [tab, setTab] = useState<Tab>(() => { try { return (localStorage.getItem('sideTab') as Tab) || 'watch'; } catch { return 'watch'; } });
  useEffect(() => { try { localStorage.setItem('sideTab', tab); } catch { /* */ } }, [tab]);
  return (
    <div className="side-panel">
      <div className="side-tabs">
        {([['watch', '★ Danh mục'], ['tape', 'Khớp lệnh'], ['info', 'Thông tin']] as [Tab, string][]).map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      <div className="side-body">
        {tab === 'watch' && <Watch list={['VN30F1M', ...watch.filter((s) => s !== 'VN30F1M')]} cur={sym} onPick={onPick} />}
        {tab === 'tape' && <Tape sym={sym} />}
        {tab === 'info' && <Info sym={sym} />}
      </div>
    </div>
  );
}

function WatchRow({ s, cur, onPick }: { s: string; cur: string; onPick: (s: string) => void }) {
  const st = useStock(s);
  const px = st?.last || st?.ref;
  const pc = st?.last ? st.chgPc : 0;
  const cls = !st?.last || pc === 0 ? 'c-ref' : pc > 0 ? 'c-up' : 'c-down';
  return (
    <div className={`wl-row${s === cur ? ' on' : ''}`} onClick={() => onPick(s)}>
      <b>{s}</b>
      <span className={cls}>{px ? (px >= 1000 ? px.toFixed(1) : px.toFixed(2)) : '—'}</span>
      <span className={cls}>{st?.last ? `${pc > 0 ? '+' : ''}${pc.toFixed(2)}%` : ''}</span>
      <small className="muted">{st?.totVol ? (st.totVol >= 1e6 ? (st.totVol / 1e6).toFixed(1) + 'tr' : Math.round(st.totVol / 1e3) + 'k') : ''}</small>
    </div>
  );
}
function Watch({ list, cur, onPick }: { list: string[]; cur: string; onPick: (s: string) => void }) {
  return (
    <div>
      <div className="wl-row wl-head"><span>Mã</span><span>Giá</span><span>%</span><span>KL</span></div>
      {list.map((s) => <WatchRow key={s} s={s} cur={cur} onPick={onPick} />)}
      {list.length <= 1 && <div className="muted empty">Thêm mã vào danh mục bằng nút ★ trên bảng giá.</div>}
    </div>
  );
}

interface Trade { t: number; p: number; v: number; side: number; est: number }
function Tape({ sym }: { sym: string }) {
  const [data, setData] = useState<{ trades: Trade[]; unit: string } | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let dead = false;
    const load = () => fetch(`/api/trades?symbol=${sym}&limit=150`).then((r) => r.json()).then((j) => {
      if (dead) return;
      if (j.error) setErr(j.error); else { setData(j); setErr(''); }
    }).catch((e) => !dead && setErr(String(e)));
    load();
    const t = setInterval(load, 1500);
    return () => { dead = true; clearInterval(t); };
  }, [sym]);
  // ngưỡng "lệnh lớn": top 5% KL trong danh sách
  const big = useMemo(() => {
    const v = (data?.trades || []).map((x) => x.v).sort((a, b) => a - b);
    return v.length ? v[Math.floor(v.length * 0.95)] : Infinity;
  }, [data]);
  const sums = useMemo(() => {
    let b = 0, s = 0;
    for (const x of data?.trades || []) { if (x.side === 1) b += x.v; else if (x.side === -1) s += x.v; }
    return { b, s };
  }, [data]);
  if (err) return <div className="muted empty c-down">{err}</div>;
  if (!data) return <div className="muted empty">Đang tải…</div>;
  const fmtT = (t: number) => new Date((t + 7 * 3600) * 1000).toISOString().slice(11, 19);
  const n = (v: number) => v.toLocaleString('vi-VN');
  const tot = sums.b + sums.s;
  return (
    <div>
      <div className="tape-sum">
        <span className="c-up">M {n(sums.b)}</span>
        <div className="ps-bar"><i style={{ width: `${tot ? (sums.b / tot) * 100 : 50}%` }} /></div>
        <span className="c-down">B {n(sums.s)}</span>
      </div>
      <div className="tape-row tape-head"><span>Giờ</span><span>Giá</span><span>KL ({data.unit})</span><span>M/B</span></div>
      {data.trades.map((x, i) => (
        <div key={i} className={`tape-row ${x.side === 1 ? 'buy' : x.side === -1 ? 'sell' : ''}${x.v >= big ? ' big' : ''}`} title={x.est ? 'Ước lượng từ snapshot' : ''}>
          <span>{fmtT(x.t)}</span><span>{x.p >= 1000 ? x.p.toFixed(1) : x.p.toFixed(2)}</span><span>{n(x.v)}</span>
          <span>{x.side === 1 ? 'M' : x.side === -1 ? 'B' : 'ĐK'}{x.est ? '*' : ''}</span>
        </div>
      ))}
      {!data.trades.length && <div className="muted empty">Chưa có lệnh khớp (ngoài giờ giao dịch hoặc server mới khởi động).</div>}
      <div className="muted note" style={{ padding: '6px 8px' }}>M = mua chủ động, B = bán chủ động, ĐK = khớp định kỳ ATO/ATC. Dòng đậm = lệnh lớn (top 5%).</div>
    </div>
  );
}

function Info({ sym }: { sym: string }) {
  const st = useStock(sym);
  const [daily, setDaily] = useState<{ time: number; open: number; high: number; low: number; close: number; volume: number }[]>([]);
  useEffect(() => {
    const to = Math.floor(Date.now() / 1000);
    fetch(`/api/history?symbol=${sym}&resolution=1D&from=${to - 420 * 86400}&to=${to}`).then((r) => r.json()).then((j) => Array.isArray(j) && setDaily(j)).catch(() => {});
  }, [sym]);
  const v = useMemo(() => {
    if (daily.length < 2) return null;
    const last = st?.last || daily[daily.length - 1].close;
    const C = daily.map((b) => b.close), H = daily.map((b) => b.high), L = daily.map((b) => b.low), V = daily.map((b) => b.volume);
    const ret = (n: number) => (C.length > n ? ((last / C[C.length - 1 - n]) - 1) * 100 : null);
    const y = new Date().getFullYear();
    const ytdI = daily.findIndex((b) => new Date((b.time + 7 * 3600) * 1000).getUTCFullYear() === y);
    const atr = I.atr(H, L, C, 14), r = I.rsi(C, 14), sto = I.stochastic(H, L, C), e200 = I.ema(C, 200), m20 = I.sma(C, 20);
    const n = C.length - 1;
    // tuần: gộp nến ngày
    const wk: number[] = []; let lastW = -1;
    for (const b of daily) { const w = Math.floor((b.time / 86400 + 3) / 7); if (w !== lastW) { wk.push(b.close); lastW = w; } else wk[wk.length - 1] = b.close; }
    const rw = I.rsi(wk, 14), m20w = I.sma(wk, 20);
    const avgV = V.slice(-21, -1).reduce((a, x) => a + x, 0) / Math.max(1, Math.min(20, V.length - 1));
    return {
      perf: [['1T', ret(5)], ['1Th', ret(21)], ['3Th', ret(63)], ['6Th', ret(126)], ['YTD', ytdI > 0 ? ((last / C[ytdI - 1]) - 1) * 100 : null], ['1N', ret(250)]] as [string, number | null][],
      atr: atr[n], rsiD: r[n], stoD: sto.k[n], e200: e200[n] ? ((last / e200[n]!) - 1) * 100 : null, m20: m20[n] ? ((last / m20[n]!) - 1) * 100 : null,
      rsiW: rw[rw.length - 1], m20W: m20w[m20w.length - 1] ? ((last / m20w[m20w.length - 1]!) - 1) * 100 : null, avgV,
    };
  }, [daily, st?.last]);
  if (!st && !v) return <div className="muted empty">Đang tải…</div>;
  const lo = st?.low || 0, hi = st?.high || 0, px = st?.last || st?.ref || 0;
  const pos = hi > lo ? ((px - lo) / (hi - lo)) * 100 : 50;
  const pct = (x: number | null | undefined) => (x === null || x === undefined ? '—' : `${x > 0 ? '+' : ''}${x.toFixed(2)}%`);
  const cls = (x: number | null | undefined) => (!x ? '' : x > 0 ? 'c-up' : 'c-down');
  const used = v?.atr && hi > lo ? ((hi - lo) / v.atr) * 100 : null;
  return (
    <div className="info">
      {st && <>
        <div className="info-px"><b className={cls(st.chg)}>{px >= 1000 ? px.toFixed(1) : px.toFixed(2)}</b> <span className={cls(st.chg)}>{pct(st.chgPc)} hôm nay</span></div>
        <div className="info-range">
          <small>{lo || '—'}</small>
          <div className="range-bar"><i style={{ left: `${pos}%` }} /></div>
          <small>{hi || '—'}</small>
        </div>
        <div className="muted note">Biên độ ngày {hi > lo ? (hi - lo).toFixed(2) : '—'}{used !== null ? ` · ${used.toFixed(0)}% ATR14 (${v!.atr!.toFixed(2)})` : ''}</div>
        {v?.avgV ? <div className="muted note">KL hôm nay {((st.totVol / v.avgV) * 100).toFixed(0)}% so với TB 20 phiên</div> : null}
      </>}
      {v && <>
        <div className="info-h">Hiệu suất</div>
        <div className="perf">{v.perf.map(([k, x]) => <div key={k}><small>{k}</small><b className={cls(x)}>{pct(x)}</b></div>)}</div>
        <div className="info-h">Động lượng</div>
        <table className="mom">
          <thead><tr><th /><th>RSI14</th><th>Stoch</th><th>vs MA20</th><th>vs EMA200</th></tr></thead>
          <tbody>
            <tr><td>Ngày</td><td className={rsiCls(v.rsiD)}>{f1(v.rsiD)}</td><td>{f1(v.stoD)}</td><td className={cls(v.m20)}>{pct(v.m20)}</td><td className={cls(v.e200)}>{pct(v.e200)}</td></tr>
            <tr><td>Tuần</td><td className={rsiCls(v.rsiW)}>{f1(v.rsiW)}</td><td>—</td><td className={cls(v.m20W)}>{pct(v.m20W)}</td><td>—</td></tr>
          </tbody>
        </table>
        <div className="trend">Xu hướng: {v.e200 === null ? '—' : v.e200 > 0 && (v.m20 || 0) > 0 ? <b className="c-up">▲ Tăng</b> : v.e200 < 0 && (v.m20 || 0) < 0 ? <b className="c-down">▼ Giảm</b> : <b className="c-ref">◆ Đi ngang</b>}</div>
      </>}
      {feed.status?.session === 'CLOSED' && <div className="muted note">Thị trường đóng cửa — số liệu theo phiên gần nhất.</div>}
    </div>
  );
}
const f1 = (x?: number | null) => (x === null || x === undefined ? '—' : x.toFixed(1));
const rsiCls = (x?: number | null) => (x === null || x === undefined ? '' : x >= 70 ? 'c-ceil' : x <= 30 ? 'c-floor' : '');
