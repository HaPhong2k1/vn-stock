import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createChart, type IChartApi, type ISeriesApi, type SeriesMarker, type UTCTimestamp, LineStyle } from 'lightweight-charts';
import { sma, rsi, macd, bollinger, crossUp, crossDown } from '../../../shared/indicators.js';
import { useStock } from '../lib/hooks';
import { fmtPrice, fmtVol, priceClass } from '../lib/format';
import { api } from '../lib/api';
import { computeSMC } from '../../../shared/smc.js';
import { backtestEmaCross, BT_DEFAULTS, type BtOptions, type BtResult } from '../../../shared/strategy.js';
import { drawOverlay, SMC_UI_DEFAULTS, type SmcSettings } from '../lib/smcDraw';
import { Backtest } from './Backtest';
import { SymbolSearch } from './SymbolSearch';
import { useGlobal } from '../lib/hooks';

const load = <T,>(k: string, d: T): T => { try { return { ...d, ...JSON.parse(localStorage.getItem(k) || '{}') }; } catch { return d; } };
const saveLS = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* bỏ qua */ } };
const SMC_OPTS: [keyof SmcSettings, string][] = [
  ['internal', 'Cấu trúc nội bộ (internal)'], ['swing', 'Cấu trúc swing'], ['swingPoints', 'Điểm swing HH/HL/LH/LL'],
  ['strongWeak', 'Strong/Weak High/Low'], ['internalOB', 'Order block nội bộ'], ['swingOB', 'Order block swing'],
  ['eq', 'Đỉnh/đáy bằng (EQH/EQL)'], ['fvg', 'Fair Value Gap'], ['zones', 'Vùng Premium/Discount'], ['colorCandles', 'Tô màu nến theo xu hướng'],
  ['confluence', 'Lọc confluence (internal)'],
];

const VN = 7 * 3600; // hiển thị giờ VN trên trục thời gian (thư viện dùng UTC)
const RES = [['1', '1 phút'], ['5', '5 phút'], ['15', '15 phút'], ['1H', '1 giờ'], ['1D', 'Ngày'], ['1W', 'Tuần']] as const;
const SPAN: Record<string, number> = { '1': 5, '5': 15, '15': 40, '1H': 120, '1D': 730, '1W': 2500 };
const STEP: Record<string, number> = { '1': 60, '5': 300, '15': 900, '1H': 3600 };
const C = { up: '#0ecb81', down: '#f6465d', ma20: '#f0a020', ma50: '#3b82f6', bb: '#8b95a5', rsi: '#a855f7', macd: '#3b82f6', sig: '#f0a020' };

type Bar = { time: number; open: number; high: number; low: number; close: number; volume: number };
const T = (t: number) => (t + VN) as UTCTimestamp;
// Điểm chưa đủ dữ liệu => "whitespace" để 2 biểu đồ có cùng trục thời gian (đồng bộ cuộn/zoom)
const line = (bars: Bar[], vals: (number | null)[]) =>
  bars.map((b, i) => (vals[i] === null ? { time: T(b.time) } : { time: T(b.time), value: vals[i] as number }));

const INDEX_CODE: Record<string, string> = { VNINDEX: '10', VN30: '11', HNX: '02', HNX30: '12', UPCOM: '03' };

export function StockDetail({ sym, onClose, wide, onWide, full, onFull, onPick }: { sym: string; onClose: () => void; wide: boolean; onWide: () => void; full: boolean; onFull: () => void; onPick: (s: string) => void }) {
  const stock = useStock(sym);
  const g = useGlobal();
  // Chỉ số (VNINDEX, VN30...): dựng dữ liệu "giả cổ phiếu" từ chỉ số realtime để header & nến cuối vẫn cập nhật
  const ixCode = INDEX_CODE[sym];
  const ix = ixCode ? g.indices.get(ixCode) : undefined;
  const ixLast = ix?.value, ixChg = ix?.chg, ixPc = ix?.chgPc;
  const st = useMemo(() => stock || (ixLast ? {
    s: sym, ex: 'INDEX', ref: ixLast - (ixChg || 0), ceil: Infinity, floor: 0, open: 0, last: ixLast, lastVol: 0, chg: ixChg || 0, chgPc: ixPc || 0,
    high: 0, low: 0, avg: 0, totVol: 0, b: [], a: [], fB: 0, fS: 0, room: 0, t: '', seq: 0, u: 0,
  } as any : undefined), [stock, sym, ixLast, ixChg, ixPc]);
  const isIndex = !!ixCode;
  const [search, setSearch] = useState<string | null>(null);
  // Gõ chữ/số khi đang xem biểu đồ => mở hộp tìm kiếm (giống TradingView/Fiant); Ctrl+K cũng mở
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (search !== null) return;
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearch(''); return; }
      if (!e.ctrlKey && !e.metaKey && !e.altKey && /^[a-zA-Z0-9]$/.test(e.key)) { e.preventDefault(); setSearch(e.key.toUpperCase()); }
    };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [search]);
  const [res, setRes] = useState<string>('1D');
  const [ov, setOv] = useState({ ma20: true, ma50: true, bb: false, signals: true });
  const [osc, setOsc] = useState<'RSI' | 'MACD'>('RSI');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [legend, setLegend] = useState<{ ma20?: number | null; ma50?: number | null; rsi?: number | null; macd?: number | null }>({});
  const el = useRef<HTMLDivElement>(null);
  const redrawRef = useRef<() => void>(() => {});
  const el2 = useRef<HTMLDivElement>(null);
  const s = useRef<Record<string, any>>({});
  const bars = useRef<Bar[]>([]);
  const lastTot = useRef(0);
  const [smcS, setSmcS] = useState<SmcSettings>(() => load('smc', SMC_UI_DEFAULTS));
  const [ema, setEma] = useState(() => load('emaCross', { enabled: false, showBt: false }));
  const [bt, setBt] = useState<BtOptions>(() => load('btOpts', BT_DEFAULTS as BtOptions));
  const [btRes, setBtRes] = useState<BtResult | null>(null);
  const [smcOpen, setSmcOpen] = useState(false);
  useEffect(() => saveLS('smc', smcS), [smcS]);
  useEffect(() => saveLS('emaCross', ema), [ema]);
  useEffect(() => saveLS('btOpts', { ...bt, end: undefined }), [bt]);
  const overlay = useRef<HTMLCanvasElement>(null);
  const drawState = useRef<{ smc: any; idx: Map<number, number>; fill: any }>({ smc: null, idx: new Map(), fill: null });
  const opts = useRef({ ov, osc, smcS, ema, bt });
  opts.current = { ov, osc, smcS, ema, bt };
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  const redraw = useCallback(() => {
    const x = s.current;
    if (!overlay.current || !x.chart) return;
    const d = drawState.current;
    drawOverlay(overlay.current, x.chart, x.candle, d.smc, opts.current.smcS, d.idx, d.fill, dark);
  }, [dark]);

  // Tạo 2 biểu đồ: giá (+MA/BB/khối lượng) và dao động (RSI/MACD), đồng bộ trục thời gian
  useEffect(() => {
    const dark = matchMedia('(prefers-color-scheme: dark)').matches;
    const base = {
      autoSize: true,
      layout: { background: { color: 'transparent' }, textColor: dark ? '#c9d1d9' : '#333' },
      grid: { vertLines: { color: dark ? '#222a35' : '#eee' }, horzLines: { color: dark ? '#222a35' : '#eee' } },
      timeScale: { timeVisible: true, secondsVisible: false, lockVisibleTimeRangeOnResize: true },
    };
    const c = createChart(el.current!, { ...base, rightPriceScale: { scaleMargins: { top: 0.08, bottom: 0.22 } } });
    const c2 = createChart(el2.current!, { ...base, rightPriceScale: { minimumWidth: 60 } });
    c.priceScale('right').applyOptions({ minimumWidth: 60 });
    const x = s.current;
    x.candle = c.addCandlestickSeries({ upColor: C.up, downColor: C.down, borderVisible: false, wickUpColor: C.up, wickDownColor: C.down });
    x.vol = c.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'v', lastValueVisible: false, priceLineVisible: false });
    c.priceScale('v').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    const ln = (color: string, extra = {}) => c.addLineSeries({ color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, ...extra });
    x.ma20 = ln(C.ma20, { lineWidth: 2 }); x.ma50 = ln(C.ma50);
    x.bbU = ln(C.bb, { lineStyle: LineStyle.Dashed }); x.bbL = ln(C.bb, { lineStyle: LineStyle.Dashed });
    x.emaF = ln('#00BCD4', { lineWidth: 2 }); x.emaS = ln('#FF9800', { lineWidth: 2 });
    x.rsi = c2.addLineSeries({ color: C.rsi, lineWidth: 1, priceLineVisible: false });
    x.rsi.createPriceLine({ price: 70, color: C.down, lineStyle: LineStyle.Dotted, lineWidth: 1, axisLabelVisible: true });
    x.rsi.createPriceLine({ price: 30, color: C.up, lineStyle: LineStyle.Dotted, lineWidth: 1, axisLabelVisible: true });
    x.macdH = c2.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false });
    x.macdL = c2.addLineSeries({ color: C.macd, lineWidth: 1, priceLineVisible: false });
    x.macdS = c2.addLineSeries({ color: C.sig, lineWidth: 1, priceLineVisible: false });
    let syncing = false;
    const sync = (from: IChartApi, to: IChartApi) => from.timeScale().subscribeVisibleLogicalRangeChange((r) => {
      if (syncing || !r) return; syncing = true; to.timeScale().setVisibleLogicalRange(r); syncing = false;
    });
    sync(c, c2); sync(c2, c);
    x.chart = c; x.chart2 = c2;
    // Vẽ lại lớp SMC khi cuộn/zoom/đổi kích thước/kéo thang giá
    let raf = 0;
    const schedule = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => redrawRef.current()); };
    c.timeScale().subscribeVisibleLogicalRangeChange(schedule);
    c.timeScale().subscribeSizeChange(schedule);
    const box = el.current!;
    ['pointermove', 'wheel', 'pointerup', 'dblclick'].forEach((ev) => box.addEventListener(ev, schedule, { passive: true }));
    const ro = new ResizeObserver(schedule); ro.observe(box);
    return () => { ro.disconnect(); cancelAnimationFrame(raf); c.remove(); c2.remove(); };
  }, []);

  /** Tính lại toàn bộ chỉ báo từ mảng nến và vẽ lại */
  const render = useCallback((fit = false) => {
    const b = bars.current, x = s.current;
    if (!x.candle) return;
    const { ov, osc, smcS, ema, bt } = opts.current;
    const closes = b.map((v) => v.close);
    // Smart Money Concepts (LuxAlgo)
    const smc = smcS.enabled && b.length > 10 ? computeSMC(b, { swingsLength: smcS.swingLength, internalConfluence: smcS.confluence }) : null;
    // EMA cross + backtest
    const btr = ema.enabled && b.length > 3 ? backtestEmaCross(b, bt) : null;
    const m20 = sma(closes, 20), m50 = sma(closes, 50), bb = bollinger(closes, 20, 2), r = rsi(closes, 14), md = macd(closes);
    const tc = smc && smcS.colorCandles ? (i: number) => (smc.internalTrendByBar[i] === 1 ? '#089981' : '#F23645') : null;
    x.candle.setData(b.map((v, i) => (tc ? { ...v, time: T(v.time), color: tc(i), wickColor: tc(i), borderColor: tc(i) } : { ...v, time: T(v.time) })));
    x.emaF.setData(btr ? line(b, btr.emaFast) : []);
    x.emaS.setData(btr ? line(b, btr.emaSlow) : []);
    x.vol.setData(b.map((v) => ({ time: T(v.time), value: v.volume, color: v.close >= v.open ? C.up + '55' : C.down + '55' })));
    x.ma20.setData(ov.ma20 ? line(b, m20) : []);
    x.ma50.setData(ov.ma50 ? line(b, m50) : []);
    x.bbU.setData(ov.bb ? line(b, bb.upper) : []); x.bbL.setData(ov.bb ? line(b, bb.lower) : []);
    x.rsi.setData(osc === 'RSI' ? line(b, r) : []);
    x.macdL.setData(osc === 'MACD' ? line(b, md.line) : []);
    x.macdS.setData(osc === 'MACD' ? line(b, md.signal) : []);
    x.macdH.setData(osc === 'MACD' ? b.map((v, i) => (md.hist[i] === null ? { time: T(v.time) } : { time: T(v.time), value: md.hist[i]!, color: md.hist[i]! >= 0 ? C.up + '99' : C.down + '99' })) : []);
    // Đánh dấu tín hiệu: giá đóng cửa cắt lên MA20 = MUA, cắt xuống = BÁN
    const marks: SeriesMarker<UTCTimestamp>[] = [];
    if (ov.signals) {
      for (let i = 1; i < b.length; i++) {
        if (crossUp(closes, m20, i)) marks.push({ time: T(b[i].time), position: 'belowBar', color: C.up, shape: 'arrowUp', text: 'MUA' });
        else if (crossDown(closes, m20, i)) marks.push({ time: T(b[i].time), position: 'aboveBar', color: C.down, shape: 'arrowDown', text: 'BÁN' });
      }
    }
    if (btr) {
      for (const sg of btr.signals) {
        marks.push(sg.side === 'BUY'
          ? { time: T(sg.time), position: 'belowBar', color: '#1B8112', shape: 'arrowUp', text: 'BUY' }
          : { time: T(sg.time), position: 'aboveBar', color: '#FF5733', shape: 'arrowDown', text: 'SELL' });
      }
    }
    marks.sort((p, q) => (p.time as number) - (q.time as number));
    x.candle.setMarkers(marks);
    drawState.current = { smc, idx: new Map(b.map((v, i) => [v.time, i])), fill: btr ? { fast: btr.emaFast, slow: btr.emaSlow } : null };
    setBtRes(btr);
    requestAnimationFrame(() => redrawRef.current());
    const n = b.length - 1;
    setLegend({ ma20: m20[n], ma50: m50[n], rsi: r[n], macd: md.hist[n] });
    if (fit) { x.chart.timeScale().fitContent(); }
  }, []);

  redrawRef.current = redraw;
  useEffect(() => { render(); }, [ov, osc, smcS, ema, bt, render]);

  useEffect(() => {
    let dead = false;
    setErr('');
    const to = Math.floor(Date.now() / 1000);
    fetch(`/api/history?symbol=${sym}&resolution=${res}&from=${to - SPAN[res] * 86400}&to=${to}`)
      .then((r) => r.json())
      .then((rows: Bar[] | { error: string }) => {
        if (dead) return;
        if (!Array.isArray(rows)) { setErr(rows.error); return; }
        bars.current = rows; lastTot.current = 0;
        render(true);
        // hiển thị khoảng ~120 nến gần nhất cho dễ nhìn
        if (rows.length > 120) {
          const r = { from: rows.length - 120, to: rows.length + 5 };
          s.current.chart.timeScale().setVisibleLogicalRange(r);
          requestAnimationFrame(() => s.current.chart.timeScale().setVisibleLogicalRange(r)); // sau khi biểu đồ phụ đồng bộ
        }
      })
      .catch((e) => !dead && setErr(String(e)));
    return () => { dead = true; };
  }, [sym, res, render]);

  // Cập nhật nến cuối theo từng lệnh khớp; vẽ lại tối đa ~3 lần/giây
  const pending = useRef(false);
  useEffect(() => {
    const b = bars.current;
    if (!st || !st.last || !b.length) return;
    const now = Math.floor(Date.now() / 1000);
    let bar = b[b.length - 1];
    let append = false;
    if (res === '1D' || res === '1W') {
      const today = new Date((now + VN) * 1000).toISOString().slice(0, 10);
      const barDay = new Date((bar.time + VN) * 1000).toISOString().slice(0, 10);
      if (res === '1D' && today !== barDay && new Date((now + VN) * 1000).getUTCHours() >= 9) {
        bar = { time: Date.parse(today + 'T02:00:00Z') / 1000, open: st.open || st.last, high: st.last, low: st.last, close: st.last, volume: 0 };
        append = true;
      }
      bar = { ...bar, close: st.last, high: Math.max(bar.high, st.high || st.last), low: Math.min(bar.low, st.low || st.last), volume: res === '1D' && !isIndex ? st.totVol : bar.volume };
    } else {
      const step = STEP[res];
      const bucket = Math.floor(now / step) * step;
      const delta = lastTot.current && !isIndex ? Math.max(0, st.totVol - lastTot.current) : 0;
      if (bucket > bar.time) { bar = { time: bucket, open: st.last, high: st.last, low: st.last, close: st.last, volume: delta }; append = true; }
      else bar = { ...bar, close: st.last, high: Math.max(bar.high, st.last), low: Math.min(bar.low, st.last), volume: bar.volume + delta };
    }
    lastTot.current = st.totVol;
    if (append) b.push(bar); else b[b.length - 1] = bar;
    if (!pending.current) { pending.current = true; setTimeout(() => { pending.current = false; render(); }, 300); }
  }, [st, res, render, isIndex]);

  const quickAlert = async (type: string, value?: number) => {
    try {
      await api('/alerts', { method: 'POST', body: { sym, type, value: value ?? null, repeat: type.includes('CROSS') } });
      setMsg('✓ Đã tạo cảnh báo'); setTimeout(() => setMsg(''), 3000);
    } catch (e: any) { setMsg(e.message); }
  };

  const pc = (p: any) => (st ? priceClass(p, st) : '');
  const f2 = (v?: number | null) => (v === null || v === undefined ? '—' : v.toFixed(2));
  return (
    <div className={`detail${full ? ' full' : ''}`}>
      <div className="detail-head">
        <div>
          <button className="sym-btn" onClick={() => setSearch('')} title="Tìm mã khác (hoặc gõ chữ bất kỳ)">🔍 <b className="d-sym">{sym}</b></button> <span className="muted">{st?.ex === 'PS' ? `Phái sinh · HĐ ${st.code} · đáo hạn ${st.mat?.split('-').reverse().join('/')}` : isIndex ? 'Chỉ số' : st?.ex}</span>
          {st && <span className={`d-price ${pc(st.last)}`}>{isIndex ? st.last.toFixed(2) : fmtPrice(st.last || st.ref)} <small>{st.chg > 0 ? '+' : ''}{st.chg?.toFixed(2)} ({st.chgPc?.toFixed(2)}%)</small></span>}
        </div>
        <div>
          <button className="expand" title={full ? 'Thoát toàn màn hình (Esc)' : 'Mở rộng biểu đồ toàn màn hình'} onClick={onFull}>{full ? '🗗 Thu nhỏ' : '⛶ Toàn màn hình'}</button>
          {!full && <button className="close" title={wide ? 'Thu hẹp khung' : 'Nới rộng khung'} onClick={onWide}>{wide ? '⇥' : '⇤'}</button>}
          <button className="close" onClick={onClose}>✕</button>
        </div>
      </div>
      <div className="res-tabs">
        {RES.map(([k, label]) => <button key={k} className={res === k ? 'on' : ''} onClick={() => setRes(k)}>{label}</button>)}
      </div>
      <div className="res-tabs ind">
        <button className={ov.ma20 ? 'on' : ''} onClick={() => setOv({ ...ov, ma20: !ov.ma20 })}><i style={{ background: C.ma20 }} />MA20 {f2(legend.ma20)}</button>
        <button className={ov.ma50 ? 'on' : ''} onClick={() => setOv({ ...ov, ma50: !ov.ma50 })}><i style={{ background: C.ma50 }} />MA50 {f2(legend.ma50)}</button>
        <button className={ov.bb ? 'on' : ''} onClick={() => setOv({ ...ov, bb: !ov.bb })}><i style={{ background: C.bb }} />Bollinger</button>
        <button className={ov.signals ? 'on' : ''} onClick={() => setOv({ ...ov, signals: !ov.signals })}>▲ Tín hiệu MA20</button>
        <button className={smcS.enabled ? 'on' : ''} onClick={() => setSmcS({ ...smcS, enabled: !smcS.enabled })}>◆ SMC</button>
        <button className="gear" onClick={() => setSmcOpen((v) => !v)} title="Cài đặt SMC">⚙</button>
        <button className={ema.enabled ? 'on' : ''} onClick={() => setEma({ ...ema, enabled: !ema.enabled })}><i style={{ background: '#00BCD4' }} />EMA {bt.fast}/{bt.slow} BUY/SELL</button>
        {ema.enabled && !full && <button className={ema.showBt ? 'on' : ''} onClick={() => setEma({ ...ema, showBt: !ema.showBt })}>📈 Backtest</button>}
      </div>
      {smcOpen && (
        <div className="smc-panel">
          <div className="smc-grid">
            <label>Chế độ <select value={smcS.mode} onChange={(e) => setSmcS({ ...smcS, mode: e.target.value as SmcSettings['mode'] })}><option value="Historical">Historical</option><option value="Present">Present</option></select></label>
            <label>Độ dài swing <input type="number" min={10} max={200} value={smcS.swingLength} onChange={(e) => setSmcS({ ...smcS, swingLength: Math.max(10, +e.target.value) })} /></label>
            {SMC_OPTS.map(([k, label]) => (
              <label key={k}><input type="checkbox" checked={!!smcS[k]} onChange={(e) => setSmcS({ ...smcS, [k]: e.target.checked, enabled: true })} /> {label}</label>
            ))}
            <label>Số OB nội bộ <input type="number" min={1} max={20} value={smcS.internalOBCount} onChange={(e) => setSmcS({ ...smcS, internalOBCount: +e.target.value })} /></label>
            <label>Số OB swing <input type="number" min={1} max={20} value={smcS.swingOBCount} onChange={(e) => setSmcS({ ...smcS, swingOBCount: +e.target.value })} /></label>
          </div>
          <div className="muted note">Smart Money Concepts © LuxAlgo — giấy phép CC BY-NC-SA 4.0 (chỉ dùng phi thương mại).</div>
        </div>
      )}
      <div className="chart" ref={el}>
        <canvas ref={overlay} className="overlay" />
        {err && <div className="err">Không tải được biểu đồ: {err}</div>}
      </div>
      <div className="res-tabs ind">
        <button className={osc === 'RSI' ? 'on' : ''} onClick={() => setOsc('RSI')}>RSI(14) {f2(legend.rsi)}</button>
        <button className={osc === 'MACD' ? 'on' : ''} onClick={() => setOsc('MACD')}>MACD(12,26,9) {f2(legend.macd)}</button>
      </div>
      <div className="chart osc" ref={el2} />
      {!full && ema.enabled && ema.showBt && <Backtest res={btRes} opts={bt} onChange={setBt} intraday={res !== '1D' && res !== '1W'} />}
      {!full && !isIndex && <div className="quick">
        <button onClick={() => quickAlert('MA20_CROSS_UP')}>🔔 Báo khi cắt lên MA20</button>
        {st?.last ? <button onClick={() => quickAlert('PRICE_GTE', +(st.last * 1.03).toFixed(2))}>🔔 Giá ≥ {(st.last * 1.03).toFixed(2)} (+3%)</button> : null}
        {st?.last ? <button onClick={() => quickAlert('PRICE_LTE', +(st.last * 0.97).toFixed(2))}>🔔 Giá ≤ {(st.last * 0.97).toFixed(2)} (−3%)</button> : null}
        <span className="muted">{msg}</span>
      </div>}
      {st && !full && !isIndex && (
        <div className="detail-grid">
          <table className="book">
            <thead><tr><th>KL mua</th><th>Giá mua</th><th>Giá bán</th><th>KL bán</th></tr></thead>
            <tbody>
              {[0, 1, 2].map((i) => (
                <tr key={i}>
                  <td className={pc(st.b[i]?.[0])}>{fmtVol(st.b[i]?.[1])}</td>
                  <td className={pc(st.b[i]?.[0])}>{fmtPrice(st.b[i]?.[0])}</td>
                  <td className={pc(st.a[i]?.[0])}>{fmtPrice(st.a[i]?.[0])}</td>
                  <td className={pc(st.a[i]?.[0])}>{fmtVol(st.a[i]?.[1])}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <dl className="stats">
            <dt>Tham chiếu</dt><dd className="c-ref">{fmtPrice(st.ref)}</dd>
            <dt>Trần / Sàn</dt><dd><span className="c-ceil">{fmtPrice(st.ceil)}</span> / <span className="c-floor">{fmtPrice(st.floor)}</span></dd>
            <dt>Mở cửa</dt><dd className={pc(st.open)}>{fmtPrice(st.open)}</dd>
            <dt>Cao / Thấp</dt><dd><span className={pc(st.high)}>{fmtPrice(st.high)}</span> / <span className={pc(st.low)}>{fmtPrice(st.low)}</span></dd>
            <dt>Tổng KL</dt><dd>{fmtVol(st.totVol)}</dd>
            <dt>Giá trị ước tính</dt><dd>{st.avg && st.totVol ? ((st.ex === 'PS' ? (st.avg * st.totVol * 100_000) / 1e9 : (st.avg * st.totVol) / 1e6)).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + ' tỷ' : ''}</dd>
            {st.ex === 'PS' && <><dt>OI (KL mở)</dt><dd>{fmtVol(st.oi)}</dd></>}
            <dt>NN mua / bán</dt><dd>{fmtVol(st.fB)} / {fmtVol(st.fS)}</dd>
            <dt>NN ròng</dt><dd className={st.fB - st.fS >= 0 ? 'c-up' : 'c-down'}>{fmtVol(st.fB - st.fS)}</dd>
          </dl>
        </div>
      )}
      {search !== null && <SymbolSearch initial={search} onClose={() => setSearch(null)} onSelect={(x) => { setSearch(null); if (x !== sym) onPick(x); }} />}
    </div>
  );
}
