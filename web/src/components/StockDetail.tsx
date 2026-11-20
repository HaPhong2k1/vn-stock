import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createChart, type IChartApi, type ISeriesApi, type SeriesMarker, type UTCTimestamp, LineStyle, PriceScaleMode } from 'lightweight-charts';
import { sma, rsi, macd, bollinger, crossUp, crossDown } from '../../../shared/indicators.js';
import { useStock } from '../lib/hooks';
import { fmtPrice, fmtVol, priceClass } from '../lib/format';
import { api } from '../lib/api';
import { computeSMC } from '../../../shared/smc.js';
import { backtestEmaCross, BT_DEFAULTS, type BtOptions, type BtResult } from '../../../shared/strategy.js';
import { drawOverlay, drawFootprint, SMC_UI_DEFAULTS, FP_UI_DEFAULTS, type SmcSettings, type FpSettings, type FpDraw } from '../lib/smcDraw';
import { analyzeFootprint, autoRowSize, tickOf } from '../../../shared/footprint.js';
import { Backtest } from './Backtest';
import { SymbolSearch } from './SymbolSearch';
import { useGlobal } from '../lib/hooks';
import { INDICATORS, IND_BY_ID, type IndResult } from '../lib/indicatorDefs';
import { IndicatorDialog, type BuiltIn } from './IndicatorDialog';
import { DrawToolbar } from './DrawToolbar';
import { SidePanel } from './SidePanel';
import { TimeMap, drawShape, hitTest, loadDrawings, saveDrawings, TOOLS, type Drawing, type Pt, type Tool } from '../lib/drawings';

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
// Khung có footprint (giây); khung Tuần không hỗ trợ
const FP_TF: Record<string, number> = { '1': 60, '5': 300, '15': 900, '1H': 3600, '1D': 86400 };
const RES_LABEL: Record<string, string> = { '1': '1 phút', '5': '5 phút', '15': '15 phút', '1H': '1 giờ', '1D': 'Ngày', '1W': 'Tuần' };
const C = { up: '#0ecb81', down: '#f6465d', ma20: '#f0a020', ma50: '#3b82f6', bb: '#8b95a5', rsi: '#a855f7', macd: '#3b82f6', sig: '#f0a020' };

// Các đường MA (SMA giá đóng cửa) bật/tắt được
const MAS = [
  { k: 'ma6', n: 6, color: '#e91e63', w: 1 },
  { k: 'ma10', n: 10, color: '#00bcd4', w: 1 },
  { k: 'ma20', n: 20, color: '#f0a020', w: 2 },
  { k: 'ma50', n: 50, color: '#3b82f6', w: 1 },
  { k: 'ma200', n: 200, color: '#9c27b0', w: 2 },
] as const;
type MaKey = typeof MAS[number]['k'];

type Bar = { time: number; open: number; high: number; low: number; close: number; volume: number };
const T = (t: number) => (t + VN) as UTCTimestamp;
// Điểm chưa đủ dữ liệu => "whitespace" để 2 biểu đồ có cùng trục thời gian (đồng bộ cuộn/zoom)
const line = (bars: Bar[], vals: (number | null)[]) =>
  bars.map((b, i) => (vals[i] === null ? { time: T(b.time) } : { time: T(b.time), value: vals[i] as number }));

// Kiểu biểu đồ
const CHART_TYPES = [['candles', 'Nến'], ['ha', 'Heikin Ashi'], ['bars', 'Thanh OHLC'], ['line', 'Đường'], ['area', 'Vùng']] as const;
type ChartType = typeof CHART_TYPES[number][0];
/** Nến Heikin Ashi */
function heikinAshi(b: Bar[]): Bar[] {
  const out: Bar[] = [];
  for (let i = 0; i < b.length; i++) {
    const c = (b[i].open + b[i].high + b[i].low + b[i].close) / 4;
    const o = i === 0 ? (b[i].open + b[i].close) / 2 : (out[i - 1].open + out[i - 1].close) / 2;
    out.push({ ...b[i], open: o, close: c, high: Math.max(b[i].high, o, c), low: Math.min(b[i].low, o, c) });
  }
  return out;
}
// Chọn nhanh khoảng thời gian (như TradingView): khoảng -> khung thời gian phù hợp + số ngày lịch
const RANGES: { k: string; res: string; days: number | 'ytd' | 'all' }[] = [
  { k: '1N', res: '1', days: 1 }, { k: '5N', res: '5', days: 5 }, { k: '1T', res: '1H', days: 31 }, { k: '3T', res: '1D', days: 92 },
  { k: '6T', res: '1D', days: 183 }, { k: 'YTD', res: '1D', days: 'ytd' }, { k: '1 năm', res: '1D', days: 365 }, { k: 'Tất cả', res: '1W', days: 'all' },
];

const INDEX_CODE: Record<string, string> = { VNINDEX: '10', VN30: '11', HNX: '02', HNX30: '12', UPCOM: '03' };

export function StockDetail({ sym, onClose, wide, onWide, full, onFull, onPick, watch = [] }: { sym: string; onClose: () => void; wide: boolean; onWide: () => void; full: boolean; onFull: () => void; onPick: (s: string) => void; watch?: string[] }) {
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
  const [ov, setOv] = useState(() => load('chartOv', { ma6: false, ma10: false, ma20: true, ma50: true, ma200: false, bb: false, signals: true }));
  useEffect(() => saveLS('chartOv', ov), [ov]);
  const [osc, setOsc] = useState<string>(() => { try { return localStorage.getItem('osc') || 'rsi'; } catch { return 'rsi'; } });
  useEffect(() => { try { localStorage.setItem('osc', osc); } catch { /* */ } }, [osc]);
  const [inds, setInds] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('inds') || '[]'); } catch { return []; } });
  useEffect(() => saveLS('inds', inds), [inds]);
  const [indOpen, setIndOpen] = useState(false);
  const [chartType, setChartType] = useState<ChartType>(() => { try { return (localStorage.getItem('chartType') as ChartType) || 'candles'; } catch { return 'candles'; } });
  useEffect(() => { try { localStorage.setItem('chartType', chartType); } catch { /* */ } }, [chartType]);
  const [logScale, setLogScale] = useState(false);
  const [autoScale, setAutoScale] = useState(true);
  const [sideOpen, setSideOpen] = useState(() => { try { return localStorage.getItem('sideOpen') !== '0'; } catch { return true; } });
  useEffect(() => { try { localStorage.setItem('sideOpen', sideOpen ? '1' : '0'); } catch { /* */ } }, [sideOpen]);
  const [ohlc, setOhlc] = useState<Bar | null>(null);
  const pendingRange = useRef<string | null>(null);
  const [rangeKey, setRangeKey] = useState<string | null>(null);
  // ---- Replay (tua lại thị trường)
  const [replay, setReplay] = useState<{ mode: 'off' | 'select' | 'on'; idx: number; playing: boolean; speed: number }>({ mode: 'off', idx: 0, playing: false, speed: 1 });
  const replayRef = useRef(replay);
  replayRef.current = replay;
  // ---- Công cụ vẽ
  const [tool, setTool] = useState<Tool>('cursor');
  const [drawColor, setDrawColor] = useState(() => { try { return localStorage.getItem('drawColor') || '#2962ff'; } catch { return '#2962ff'; } });
  useEffect(() => { try { localStorage.setItem('drawColor', drawColor); } catch { /* */ } }, [drawColor]);
  const [magnet, setMagnet] = useState(false);
  const [keepTool, setKeepTool] = useState(false);
  const [hideDraw, setHideDraw] = useState(false);
  const [drawings, setDrawingsRaw] = useState<Drawing[]>(() => loadDrawings(sym));
  // Lịch sử để hoàn tác (Ctrl+Z) mọi thao tác: vẽ, tẩy, xoá
  const drawHist = useRef<Drawing[][]>([]);
  const setDrawings = useCallback((fn: (d: Drawing[]) => Drawing[]) => setDrawingsRaw((cur) => {
    const next = fn(cur);
    if (next !== cur) { drawHist.current.push(cur); if (drawHist.current.length > 100) drawHist.current.shift(); }
    return next;
  }), []);
  const undoDraw = useCallback(() => { const prev = drawHist.current.pop(); if (prev) setDrawingsRaw(prev); }, []);
  useEffect(() => saveDrawings(sym, drawings), [sym, drawings]);
  const [selId, setSelId] = useState<string | null>(null);
  const pendingDraw = useRef<{ type: Drawing['type']; p1: Pt; p2: Pt } | null>(null);
  const drawCv = useRef<HTMLCanvasElement>(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [legend, setLegend] = useState<Partial<Record<string, number | null>>>({});
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
  const drawState = useRef<{ smc: any; idx: Map<number, number>; fill: any; fp: FpDraw | null }>({ smc: null, idx: new Map(), fill: null, fp: null });
  const [fpS, setFpS] = useState<FpSettings>(() => load('fp', FP_UI_DEFAULTS));
  useEffect(() => saveLS('fp', fpS), [fpS]);
  const [fpOpen, setFpOpen] = useState(false);
  const [fpInfo, setFpInfo] = useState<{ n: number; est: number; days?: number; err?: string } | null>(null);
  const fpRaw = useRef<any>(null);
  const fpZoomed = useRef(false);
  const opts = useRef({ ov, osc, smcS, ema, bt, fpS, res, st, inds, chartType });
  opts.current = { ov, osc, smcS, ema, bt, fpS, res, st, inds, chartType };
  const drawRef = useRef({ drawings, hideDraw, selId, tool });
  drawRef.current = { drawings, hideDraw, selId, tool };
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  const redraw = useCallback(() => {
    const x = s.current;
    if (!overlay.current || !x.chart) return;
    const d = drawState.current;
    drawOverlay(overlay.current, x.chart, x.candle, d.smc, opts.current.smcS, d.idx, d.fill, dark);
    if (d.fp) drawFootprint(overlay.current, x.chart, x.candle, d.fp, d.idx, dark);
    // ---- hình vẽ
    const cv = drawCv.current;
    if (cv) {
      const w = x.chart.timeScale().width(), h = cv.parentElement!.clientHeight - x.chart.timeScale().height();
      const dpr = window.devicePixelRatio || 1;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.width = w + 'px'; cv.style.height = h + 'px'; }
      const ctx = cv.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
      const { drawings, hideDraw, selId } = drawRef.current;
      const c = { chart: x.chart, series: x.candle, tm: new TimeMap(bars.current.map((b) => b.time)), w, h };
      if (!hideDraw) for (const dr of drawings) drawShape(ctx, c, dr, dark, dr.id === selId);
      const pd = pendingDraw.current;
      if (pd) drawShape(ctx, c, { id: 'pending', type: pd.type, pts: pd.type === 'hline' || pd.type === 'vline' || pd.type === 'text' ? [pd.p1] : [pd.p1, pd.p2], color: drawColor }, dark, true);
    }
  }, [dark, drawColor]);

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
    for (const m of MAS) x[m.k] = ln(m.color, { lineWidth: m.w });
    x.bbU = ln(C.bb, { lineStyle: LineStyle.Dashed }); x.bbL = ln(C.bb, { lineStyle: LineStyle.Dashed });
    x.barS = c.addBarSeries({ upColor: C.up, downColor: C.down, priceLineVisible: false, lastValueVisible: false, visible: false });
    x.lineS = c.addLineSeries({ color: '#2962ff', lineWidth: 2, priceLineVisible: false, lastValueVisible: false, visible: false });
    x.areaS = c.addAreaSeries({ lineColor: '#2962ff', topColor: 'rgba(41,98,255,0.35)', bottomColor: 'rgba(41,98,255,0.02)', lineWidth: 2, priceLineVisible: false, lastValueVisible: false, visible: false });
    x.emaF = ln('#00BCD4', { lineWidth: 2 }); x.emaS = ln('#FF9800', { lineWidth: 2 });
    // Khung dưới: 1 histogram + 3 đường dùng chung cho mọi chỉ báo dao động
    x.oscH = c2.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false });
    x.oscL = [0, 1, 2].map(() => c2.addLineSeries({ lineWidth: 1, priceLineVisible: false }));
    x.oscLevels = [];
    x.indSeries = new Map();
    x.fpD = c2.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false, priceScaleId: 'fpd' });
    c2.priceScale('fpd').applyOptions({ scaleMargins: { top: 0.55, bottom: 0 } });
    x.cvd = c2.addLineSeries({ color: '#f0b90b', lineWidth: 2, priceLineVisible: false });
    let syncing = false;
    const sync = (from: IChartApi, to: IChartApi) => from.timeScale().subscribeVisibleLogicalRangeChange((r) => {
      if (syncing || !r) return; syncing = true; to.timeScale().setVisibleLogicalRange(r); syncing = false;
    });
    sync(c, c2); sync(c2, c);
    x.chart = c; x.chart2 = c2;
    // Chú thích O/H/L/C theo con trỏ
    let rafL = 0;
    c.subscribeCrosshairMove((param) => {
      cancelAnimationFrame(rafL);
      rafL = requestAnimationFrame(() => {
        if (!param.time || param.logical === undefined) { setOhlc(null); return; }
        const i = Math.round(param.logical as number);
        setOhlc(bars.current[i] || null);
      });
    });
    c.subscribeClick((param) => {
      // Replay: chọn nến bắt đầu
      if (replayRef.current.mode === 'select' && param.logical !== undefined) {
        const idx = Math.max(1, Math.min(bars.current.length - 1, Math.round(param.logical as number)));
        setReplay((r) => ({ ...r, mode: 'on', idx, playing: false }));
        return;
      }
      if (drawRef.current.tool !== 'cursor' || !param.point) return;
      const w = c.timeScale().width(), h = el.current!.clientHeight - c.timeScale().height();
      const hit = hitTest({ chart: c, series: x.candle, tm: new TimeMap(bars.current.map((b) => b.time)), w, h }, drawRef.current.drawings, param.point.x, param.point.y);
      setSelId(hit ? hit.id : null);
    });
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
    const rp = replayRef.current;
    const b = rp.mode === 'on' ? bars.current.slice(0, rp.idx + 1) : bars.current, x = s.current;
    if (!x.candle) return;
    const { ov, osc, smcS, ema, bt, fpS, res: curRes, st: curSt } = opts.current;
    const closes = b.map((v) => v.close);
    // Smart Money Concepts (LuxAlgo)
    const smc = smcS.enabled && b.length > 10 ? computeSMC(b, { swingsLength: smcS.swingLength, internalConfluence: smcS.confluence }) : null;
    // EMA cross + backtest
    const btr = ema.enabled && b.length > 3 ? backtestEmaCross(b, bt) : null;
    const maVals = Object.fromEntries(MAS.map((m) => [m.k, sma(closes, m.n)])) as Record<MaKey, (number | null)[]>;
    const m20 = maVals.ma20, bb = bollinger(closes, 20, 2);
    const tc = smc && smcS.colorCandles ? (i: number) => (smc.internalTrendByBar[i] === 1 ? '#089981' : '#F23645') : null;
    const { chartType } = opts.current;
    const cb = chartType === 'ha' ? heikinAshi(b) : b;
    x.candle.setData(cb.map((v, i) => (tc ? { ...v, time: T(v.time), color: tc(i), wickColor: tc(i), borderColor: tc(i) } : { ...v, time: T(v.time) })));
    x.barS.applyOptions({ visible: chartType === 'bars' }); x.lineS.applyOptions({ visible: chartType === 'line' }); x.areaS.applyOptions({ visible: chartType === 'area' });
    x.barS.setData(chartType === 'bars' ? b.map((v) => ({ ...v, time: T(v.time) })) : []);
    x.lineS.setData(chartType === 'line' ? b.map((v) => ({ time: T(v.time), value: v.close })) : []);
    x.areaS.setData(chartType === 'area' ? b.map((v) => ({ time: T(v.time), value: v.close })) : []);
    x.emaF.setData(btr ? line(b, btr.emaFast) : []);
    x.emaS.setData(btr ? line(b, btr.emaSlow) : []);
    x.vol.setData(b.map((v) => ({ time: T(v.time), value: v.volume, color: v.close >= v.open ? C.up + '55' : C.down + '55' })));
    for (const m of MAS) x[m.k].setData(ov[m.k] ? line(b, maVals[m.k]) : []);
    x.bbU.setData(ov.bb ? line(b, bb.upper) : []); x.bbL.setData(ov.bb ? line(b, bb.lower) : []);
    // ---- Chỉ báo trên giá (danh mục ƒx): tạo/xoá series theo lựa chọn
    const { inds } = opts.current;
    const indLegend: Record<string, number | null> = {};
    for (const def of INDICATORS.filter((d) => d.group === 'overlay')) {
      const on = inds.includes(def.id) && b.length > 1;
      let list: any[] | undefined = x.indSeries.get(def.id);
      if (!on) { if (list) { list.forEach((se) => x.chart.removeSeries(se)); x.indSeries.delete(def.id); } continue; }
      const r: IndResult = def.compute(b);
      if (!list) {
        list = r.lines.map((l) => x.chart.addLineSeries({
          color: l.color, lineWidth: l.width || 1, lineStyle: l.dashed ? LineStyle.Dashed : LineStyle.Solid, priceLineVisible: false, lastValueVisible: false,
          crosshairMarkerVisible: false, ...(l.dots ? { lineVisible: false, pointMarkersVisible: true, pointMarkersRadius: 1.5 } : {}),
        }));
        x.indSeries.set(def.id, list);
      }
      r.lines.forEach((l, k) => list![k].setData(line(b, l.values)));
      const lastV = r.lines[0].values[b.length - 1];
      indLegend[def.id] = lastV ?? r.lines[1]?.values[b.length - 1] ?? null;
    }
    // ---- Khung dưới (dao động)
    const oscDef = IND_BY_ID[osc];
    const oscR: IndResult | null = oscDef && oscDef.group === 'osc' && b.length > 1 ? oscDef.compute(b) : null;
    x.oscL.forEach((se: any, k: number) => {
      const l = oscR?.lines[k];
      se.applyOptions({ color: l?.color || '#888', lineWidth: l?.width || 1, visible: !!l });
      se.setData(l ? line(b, l.values) : []);
    });
    x.oscH.setData(oscR?.hist ? b.map((v, i) => (oscR.hist!.values[i] === null ? { time: T(v.time) } : { time: T(v.time), value: oscR.hist!.values[i]!, color: oscR.hist!.colors?.[i] })) : []);
    const lvKey = osc;
    if (x.oscLevelKey !== lvKey) {
      x.oscLevels.forEach((pl: any) => x.oscL[0].removePriceLine(pl));
      x.oscLevels = (oscR?.levels || []).map((lv) => x.oscL[0].createPriceLine({ price: lv.v, color: lv.color, lineStyle: LineStyle.Dotted, lineWidth: 1, axisLabelVisible: true }));
      x.oscLevelKey = lvKey;
    }
    // ---- Footprint
    let fpd: FpDraw | null = null;
    const raw = fpRaw.current;
    if (fpS.enabled && raw && raw.symbol === sym && raw.tf === FP_TF[curRes] && raw.bars?.length) {
      const tick = tickOf(curSt?.ex || 'HOSE', raw.bars[raw.bars.length - 1].c);
      const row = fpS.rowTicks ? +(fpS.rowTicks * tick).toFixed(6) : autoRowSize(raw.bars, tick);
      const bars = analyzeFootprint(raw.bars, row, { ratio: fpS.ratio, stack: fpS.stack, minVol: fpS.minVol });
      fpd = { bars, row, tick, label: `${sym} ${RES_LABEL[curRes]}`, estimatedPct: raw.estimatedPct, s: fpS };
    }
    const fpIdx = new Map(b.map((v, i) => [v.time, i]));
    const cvdMap = new Map((fpd?.bars || []).map((fb) => [fb.t, fb]));
    x.cvd.setData(osc === 'cvd' ? b.map((v) => (cvdMap.has(v.time) ? { time: T(v.time), value: cvdMap.get(v.time)!.cvd } : { time: T(v.time) })) : []);
    x.fpD.setData(osc === 'cvd' ? b.map((v) => { const fb = cvdMap.get(v.time); return fb ? { time: T(v.time), value: fb.delta, color: fb.delta >= 0 ? C.up + '88' : C.down + '88' } : { time: T(v.time) }; }) : []);
    // Khi bật footprint: thang giá chỉ theo nến (bỏ qua MA/EMA/BB) để các ô giá đủ cao hiển thị số
    const autoscale = fpd ? { autoscaleInfoProvider: () => null } : { autoscaleInfoProvider: undefined };
    for (const k of [...MAS.map((m) => m.k), 'bbU', 'bbL', 'emaF', 'emaS']) x[k].applyOptions(autoscale);
    for (const list of x.indSeries.values()) for (const se of list) se.applyOptions(autoscale);
    const dimA = fpd && fpS.dim ? '40' : '';
    if (['bars', 'line', 'area'].includes(chartType)) x.candle.applyOptions({ upColor: 'rgba(0,0,0,0)', downColor: 'rgba(0,0,0,0)', wickUpColor: 'rgba(0,0,0,0)', wickDownColor: 'rgba(0,0,0,0)' });
    else x.candle.applyOptions({ upColor: C.up + dimA, downColor: C.down + dimA, wickUpColor: C.up + (dimA ? '99' : ''), wickDownColor: C.down + (dimA ? '99' : '') });
    if (fpd && !fpZoomed.current && b.length) {
      // phóng to để mỗi nến đủ rộng hiển thị số
      fpZoomed.current = true;
      const width = x.chart.timeScale().width() || 800;
      const nBars = Math.max(6, Math.floor(width / 96));
      const r = { from: b.length - nBars, to: b.length + 1 };
      // đặt cho cả 2 biểu đồ (giá & dao động) — tránh biểu đồ phụ đồng bộ ngược làm mất mức phóng to
      const apply = () => { x.chart.timeScale().setVisibleLogicalRange(r); x.chart2.timeScale().setVisibleLogicalRange(r); };
      requestAnimationFrame(apply); setTimeout(apply, 150);
    }
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
    drawState.current = { smc, idx: fpIdx, fill: btr ? { fast: btr.emaFast, slow: btr.emaSlow } : null, fp: fpd };
    setBtRes(btr);
    requestAnimationFrame(() => redrawRef.current());
    const n = b.length - 1;
    setLegend({ ...Object.fromEntries(MAS.map((m) => [m.k, maVals[m.k][n]])), ...indLegend, osc: oscR ? oscR.lines[0].values[n] : null });
    if (fit) { x.chart.timeScale().fitContent(); }
  }, []);

  redrawRef.current = redraw;
  useEffect(() => { render(); }, [ov, osc, smcS, ema, bt, fpS, inds, chartType, render]);
  // Replay: render lại khi đổi vị trí; tự phát theo tốc độ
  useEffect(() => { render(); if (replay.mode === 'on') s.current.chart?.timeScale().scrollToRealTime(); }, [replay.mode, replay.idx, render]);
  useEffect(() => {
    if (replay.mode !== 'on' || !replay.playing) return;
    const t = setInterval(() => setReplay((r) => {
      if (r.idx >= bars.current.length - 1) return { ...r, playing: false };
      return { ...r, idx: r.idx + 1 };
    }), 1000 / replay.speed);
    return () => clearInterval(t);
  }, [replay.mode, replay.playing, replay.speed]);
  // LOG / AUTO
  useEffect(() => {
    const x = s.current; if (!x.chart) return;
    x.chart.priceScale('right').applyOptions({ mode: logScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal, autoScale });
  }, [logScale, autoScale]);
  /** Chọn khoảng thời gian: đổi khung phù hợp rồi phóng tới khoảng đó sau khi dữ liệu tải xong */
  const applyRange = useCallback((k: string) => {
    const x = s.current, b = bars.current;
    const r = RANGES.find((q) => q.k === k)!;
    if (!x.chart || !b.length) return;
    const now = Date.now() / 1000;
    let from: number;
    if (r.days === 'all') from = 0;
    else if (r.days === 'ytd') from = Date.UTC(new Date().getUTCFullYear(), 0, 1) / 1000;
    else if (r.days === 1) { const lastDay = Math.floor((b[b.length - 1].time + 7 * 3600) / 86400); from = lastDay * 86400 - 7 * 3600; } // phiên gần nhất
    else from = now - r.days * 86400;
    let i = b.findIndex((v) => v.time >= from); if (i < 0) i = 0;
    const range = { from: i - 0.5, to: b.length + 2 };
    x.chart.timeScale().setVisibleLogicalRange(range); x.chart2.timeScale().setVisibleLogicalRange(range);
  }, []);
  const chooseRange = (k: string) => {
    const r = RANGES.find((q) => q.k === k)!;
    setRangeKey(k);
    if (r.res !== res) { pendingRange.current = k; setRes(r.res); } else applyRange(k);
  };
  /** Chụp ảnh biểu đồ (kèm lớp SMC/footprint/hình vẽ) và tải về PNG */
  const screenshot = () => {
    const x = s.current; if (!x.chart) return;
    const base: HTMLCanvasElement = x.chart.takeScreenshot();
    const out = document.createElement('canvas'); out.width = base.width; out.height = base.height;
    const ctx = out.getContext('2d')!;
    ctx.fillStyle = getComputedStyle(document.body).backgroundColor || '#000'; ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(base, 0, 0);
    for (const cv of [overlay.current, drawCv.current]) if (cv && cv.width) ctx.drawImage(cv, 0, 0); // cùng tỷ lệ devicePixelRatio với ảnh chụp
    ctx.font = '600 14px system-ui, sans-serif'; ctx.fillStyle = '#888'; ctx.fillText(`${sym} · ${RES_LABEL[res]} · ${new Date().toLocaleString('vi-VN')}`, 10, 20);
    const a = document.createElement('a'); a.download = `${sym}_${res}_${Date.now()}.png`; a.href = out.toDataURL('image/png'); a.click();
  };
  useEffect(() => { redrawRef.current(); }, [drawings, hideDraw, selId, drawColor]);
  // khung dưới đang là CVD nhưng tắt footprint => về RSI
  useEffect(() => { if (osc === 'cvd' && !fpS.enabled) setOsc('rsi'); }, [osc, fpS.enabled]);

  /** Đặt lại biểu đồ: thang giá tự động + khung nhìn mặc định (≈120 nến gần nhất) */
  const resetView = useCallback(() => {
    const x = s.current, n = bars.current.length;
    if (!x.chart) return;
    x.chart.priceScale('right').applyOptions({ autoScale: true });
    x.chart2.priceScale('right').applyOptions({ autoScale: true });
    if (opts.current.fpS.enabled && FP_TF[opts.current.res] !== undefined) { fpZoomed.current = false; render(); return; }
    const r = { from: Math.max(0, n - 120), to: n + 5 };
    x.chart.timeScale().setVisibleLogicalRange(r); x.chart2.timeScale().setVisibleLogicalRange(r);
  }, [render]);

  // ---- Phím tắt: Alt+R đặt lại, Esc huỷ vẽ, Delete xoá hình đang chọn, Ctrl+Z hoàn tác
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
      if (e.altKey && e.key.toLowerCase() === 'r') { e.preventDefault(); resetView(); }
      else if (e.key === 'Escape' && replayRef.current.mode !== 'off') { e.preventDefault(); setReplay((r) => ({ ...r, mode: 'off', playing: false })); }
      else if (e.key === 'Escape' && (pendingDraw.current || drawRef.current.tool !== 'cursor' || drawRef.current.selId)) {
        e.preventDefault(); pendingDraw.current = null; setTool('cursor'); setSelId(null); redrawRef.current();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && drawRef.current.selId) {
        e.preventDefault(); const id = drawRef.current.selId; setDrawings((d) => d.filter((x) => x.id !== id)); setSelId(null);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undoDraw(); }
    };
    addEventListener('keydown', k, true);
    return () => removeEventListener('keydown', k, true);
  }, [resetView, undoDraw, setDrawings]);

  // ---- Vẽ bằng chuột trên lớp canvas (chỉ nhận chuột khi đang chọn công cụ vẽ)
  const toPt = useCallback((e: React.PointerEvent): Pt | null => {
    const x = s.current, cv = drawCv.current; if (!x.chart || !cv) return null;
    const r = cv.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
    const li = x.chart.timeScale().coordinateToLogical(px), pr = x.candle.coordinateToPrice(py);
    if (li === null || pr === null) return null;
    const tm = new TimeMap(bars.current.map((b) => b.time));
    const idx = Math.round(li as number);
    let price = pr as number;
    const bar = bars.current[idx];
    if (magnet && bar) price = [bar.open, bar.high, bar.low, bar.close].reduce((a, v) => (Math.abs(v - price) < Math.abs(a - price) ? v : a));
    return { t: tm.toTime(idx), p: +price.toFixed(4) };
  }, [magnet]);
  const finish = (d: Drawing) => { setDrawings((list) => [...list, d]); setSelId(d.id); pendingDraw.current = null; if (!keepTool) setTool('cursor'); };
  const onDrawDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const pt = toPt(e); if (!pt) return;
    if (tool === 'eraser') {
      const x = s.current, cv = drawCv.current!; const r = cv.getBoundingClientRect();
      const hit = hitTest({ chart: x.chart, series: x.candle, tm: new TimeMap(bars.current.map((b) => b.time)), w: cv.clientWidth, h: cv.clientHeight }, drawings, e.clientX - r.left, e.clientY - r.top);
      if (hit) setDrawings((d) => d.filter((q) => q.id !== hit.id));
      return;
    }
    const def = TOOLS.find((t) => t.id === tool)!;
    const id = Math.random().toString(36).slice(2);
    const type = tool as Drawing['type'];
    if (def.pts === 1) {
      if (type === 'text') { const txt = prompt('Nội dung ghi chú:'); if (txt) finish({ id, type, pts: [pt], color: drawColor, text: txt }); else setTool('cursor'); return; }
      finish({ id, type, pts: [pt], color: drawColor }); return;
    }
    const pd = pendingDraw.current;
    if (!pd) { pendingDraw.current = { type, p1: pt, p2: pt }; (e.target as HTMLElement).setPointerCapture(e.pointerId); }
    else finish({ id, type: pd.type, pts: [pd.p1, pt], color: drawColor });
  };
  const onDrawMove = (e: React.PointerEvent) => {
    const pd = pendingDraw.current; if (!pd) return;
    const pt = toPt(e); if (pt) { pd.p2 = pt; redrawRef.current(); }
  };
  const onDrawUp = (e: React.PointerEvent) => {
    const pd = pendingDraw.current; if (!pd) return;
    // kéo-thả: nhả chuột xa điểm đầu => hoàn tất; bấm-nhả tại chỗ => chờ cú bấm thứ 2
    const x = s.current;
    const a = x.chart.timeScale().logicalToCoordinate(new TimeMap(bars.current.map((b) => b.time)).toIndex(pd.p1.t) as any) ?? 0;
    const r = drawCv.current!.getBoundingClientRect();
    if (Math.abs(e.clientX - r.left - a) > 6 || Math.abs((x.candle.priceToCoordinate(pd.p1.p) ?? 0) - (e.clientY - r.top)) > 6) {
      finish({ id: Math.random().toString(36).slice(2), type: pd.type, pts: [pd.p1, pd.p2], color: drawColor });
    }
  };

  /** Khôi phục bộ chỉ báo mặc định */
  const resetIndicators = () => {
    setOv({ ma6: false, ma10: false, ma20: true, ma50: true, ma200: false, bb: false, signals: true });
    setInds([]); setOsc('rsi'); setSmcS({ ...smcS, enabled: false }); setFpS({ ...fpS, enabled: false }); setEma({ ...ema, enabled: false, showBt: false });
  };
  const builtins: BuiltIn[] = [
    ...MAS.map((m) => ({ id: m.k, name: `MA ${m.n}`, desc: `Trung bình động đơn giản ${m.n} kỳ`, on: !!ov[m.k], toggle: () => setOv((o: any) => ({ ...o, [m.k]: !o[m.k] })), group: 'overlay' as const })),
    { id: 'bb', name: 'Bollinger Bands (20, 2)', desc: 'Dải biến động quanh MA20', on: !!ov.bb, toggle: () => setOv((o: any) => ({ ...o, bb: !o.bb })), group: 'overlay' },
    { id: 'sig', name: 'Tín hiệu MUA/BÁN cắt MA20', desc: 'Mũi tên khi giá đóng cửa cắt MA20', on: !!ov.signals, toggle: () => setOv((o: any) => ({ ...o, signals: !o.signals })), group: 'overlay' },
    { id: 'smc', name: 'Smart Money Concepts [LuxAlgo]', desc: 'BOS/CHoCH, Order Block, FVG, EQH/EQL, Premium/Discount', on: smcS.enabled, toggle: () => setSmcS((v) => ({ ...v, enabled: !v.enabled })), group: 'special' },
    { id: 'fp', name: 'Footprint (Bid x Ask)', desc: 'KL mua/bán chủ động theo từng mức giá', on: fpS.enabled, toggle: () => setFpS((v) => ({ ...v, enabled: !v.enabled })), group: 'special' },
    { id: 'emax', name: `EMA cross ${bt.fast}/${bt.slow} BUY/SELL + Backtest`, desc: 'Chiến lược giao cắt EMA (che_trader)', on: ema.enabled, toggle: () => setEma((v: any) => ({ ...v, enabled: !v.enabled })), group: 'special' },
  ];

  // Tải dữ liệu footprint & cập nhật định kỳ (3s khung phút, 5s khung ngày)
  const fpAllowed = FP_TF[res] !== undefined;
  useEffect(() => {
    fpZoomed.current = false;
    if (!fpS.enabled || !fpAllowed) { fpRaw.current = null; setFpInfo(null); render(); return; }
    let dead = false;
    const tf = FP_TF[res];
    const load = () => fetch(`/api/footprint?symbol=${sym}&tf=${tf}`).then((r) => r.json()).then((j) => {
      if (dead) return;
      if (j.error) { setFpInfo({ n: 0, est: 0, err: j.error }); return; }
      fpRaw.current = j;
      setFpInfo({ n: j.bars.length, est: j.estimatedPct, days: j.days });
      render();
    }).catch((e) => !dead && setFpInfo({ n: 0, est: 0, err: String(e) }));
    load();
    const t = setInterval(load, tf === 86400 ? 5000 : 3000);
    return () => { dead = true; clearInterval(t); };
  }, [sym, res, fpS.enabled, fpAllowed, render]);

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
        if (pendingRange.current) { const k = pendingRange.current; pendingRange.current = null; requestAnimationFrame(() => applyRange(k)); }
        else if (opts.current.fpS.enabled && FP_TF[res] !== undefined) { fpZoomed.current = false; render(); } // footprint tự phóng to
        else if (rows.length > 120) {
          const r = { from: rows.length - 120, to: rows.length + 5 };
          s.current.chart.timeScale().setVisibleLogicalRange(r);
          requestAnimationFrame(() => s.current.chart.timeScale().setVisibleLogicalRange(r)); // sau khi biểu đồ phụ đồng bộ
        }
      })
      .catch((e) => !dead && setErr(String(e)));
    return () => { dead = true; };
  }, [sym, res, render, applyRange]);

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
          <select className="expand" value={chartType} onChange={(e) => setChartType(e.target.value as ChartType)} title="Kiểu biểu đồ">
            {CHART_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <button className="expand" onClick={() => setIndOpen(true)} title="Thêm/bớt chỉ báo kỹ thuật">ƒx Chỉ báo</button>
          <button className={`expand${replay.mode !== 'off' ? ' on' : ''}`} title="Replay: tua lại thị trường từ một nến bất kỳ để luyện tập"
            onClick={() => setReplay((r) => (r.mode === 'off' ? { ...r, mode: 'select', playing: false } : { ...r, mode: 'off', playing: false }))}>⏪ Replay</button>
          {full && <button className={`expand${sideOpen ? ' on' : ''}`} onClick={() => setSideOpen((v) => !v)} title="Bảng phụ: Danh mục · Khớp lệnh · Thông tin">☰ Bảng phụ</button>}
          <button className="expand" onClick={resetView} title="Đặt lại biểu đồ (Alt+R): khung nhìn & thang giá mặc định">⟲ Đặt lại</button>
          <button className="expand" title={full ? 'Thoát toàn màn hình (Esc)' : 'Mở rộng biểu đồ toàn màn hình'} onClick={onFull}>{full ? '🗗 Thu nhỏ' : '⛶ Toàn màn hình'}</button>
          {!full && <button className="close" title={wide ? 'Thu hẹp khung' : 'Nới rộng khung'} onClick={onWide}>{wide ? '⇥' : '⇤'}</button>}
          <button className="close" onClick={onClose}>✕</button>
        </div>
      </div>
      <div className="res-tabs">
        {RES.map(([k, label]) => <button key={k} className={res === k ? 'on' : ''} onClick={() => setRes(k)}>{label}</button>)}
      </div>
      <div className="res-tabs ind">
        {MAS.map((m) => (
          <button key={m.k} className={ov[m.k] ? 'on' : ''} onClick={() => setOv({ ...ov, [m.k]: !ov[m.k] })}
            title={legend[m.k] === null ? `Chưa đủ ${m.n} nến ở khung này` : `Trung bình ${m.n} phiên`}>
            <i style={{ background: m.color }} />MA{m.n} {ov[m.k] ? f2(legend[m.k]) : ''}
          </button>
        ))}
        <button className={ov.bb ? 'on' : ''} onClick={() => setOv({ ...ov, bb: !ov.bb })}><i style={{ background: C.bb }} />Bollinger</button>
        {inds.map((id) => IND_BY_ID[id] && (
          <button key={id} className="on chip" title={`${IND_BY_ID[id].desc} — bấm để tắt`} onClick={() => setInds((l) => l.filter((x) => x !== id))}>
            <i style={{ background: IND_BY_ID[id].color || '#888' }} />{IND_BY_ID[id].short} {f2(legend[id])} ✕
          </button>
        ))}
        <button className={ov.signals ? 'on' : ''} onClick={() => setOv({ ...ov, signals: !ov.signals })}>▲ Tín hiệu MA20</button>
        <button className={smcS.enabled ? 'on' : ''} onClick={() => setSmcS({ ...smcS, enabled: !smcS.enabled })}>◆ SMC</button>
        <button className="gear" onClick={() => setSmcOpen((v) => !v)} title="Cài đặt SMC">⚙</button>
        <button className={fpS.enabled ? 'on' : ''} disabled={!fpAllowed} title={fpAllowed ? 'Footprint: KL mua/bán chủ động theo từng mức giá' : 'Footprint không hỗ trợ khung Tuần'}
          onClick={() => setFpS({ ...fpS, enabled: !fpS.enabled })}>👣 Footprint</button>
        <button className="gear" onClick={() => setFpOpen((v) => !v)} title="Cài đặt Footprint">⚙</button>
        <button className={ema.enabled ? 'on' : ''} onClick={() => setEma({ ...ema, enabled: !ema.enabled })}><i style={{ background: '#00BCD4' }} />EMA {bt.fast}/{bt.slow} BUY/SELL</button>
        {ema.enabled && !full && <button className={ema.showBt ? 'on' : ''} onClick={() => setEma({ ...ema, showBt: !ema.showBt })}>📈 Backtest</button>}
      </div>
      {fpOpen && (
        <div className="smc-panel">
          <div className="smc-grid">
            <label>Hiển thị <select value={fpS.mode} onChange={(e) => setFpS({ ...fpS, mode: e.target.value as FpSettings['mode'], enabled: true })}>
              <option value="bidask">Bid x Ask</option><option value="delta">Delta</option><option value="volume">Volume profile</option></select></label>
            <label>Bước giá/dòng <select value={fpS.rowTicks} onChange={(e) => setFpS({ ...fpS, rowTicks: +e.target.value })}>
              {[0, 1, 2, 5, 10, 20, 50].map((n) => <option key={n} value={n}>{n ? `${n} tick` : 'Tự động'}</option>)}</select></label>
            <label>Tỷ lệ imbalance <select value={fpS.ratio} onChange={(e) => setFpS({ ...fpS, ratio: +e.target.value })}>
              {[1.5, 2, 2.5, 3, 4, 5].map((n) => <option key={n} value={n}>{n * 100}%</option>)}</select></label>
            <label>Stacked ≥ <input type="number" min={2} max={6} value={fpS.stack} onChange={(e) => setFpS({ ...fpS, stack: Math.max(2, +e.target.value) })} /> dòng</label>
            <label>KL tối thiểu <input type="number" min={0} step={100} value={fpS.minVol} onChange={(e) => setFpS({ ...fpS, minVol: Math.max(0, +e.target.value) })} /></label>
            {([['poc', 'POC (giá KL lớn nhất)'], ['stacks', 'Vùng stacked imbalance'], ['markers', 'Nhãn UA / EX / AB / Δ phân kỳ'], ['summary', 'Delta & KL dưới mỗi nến'], ['dim', 'Làm mờ nến']] as [keyof FpSettings, string][]).map(([k, l]) => (
              <label key={k}><input type="checkbox" checked={!!fpS[k]} onChange={(e) => setFpS({ ...fpS, [k]: e.target.checked })} /> {l}</label>
            ))}
          </div>
          <div className="muted note">
            {fpInfo?.err ? <span className="c-down">Lỗi: {fpInfo.err}</span> : fpInfo ? <>
              {fpInfo.n} nến có dữ liệu{res === '1D' ? ' (lịch sử khung ngày được lưu dần mỗi phiên từ khi chạy hệ thống)' : ''}.
              {fpInfo.est ? ` Dữ liệu ƯỚC LƯỢNG ${fpInfo.est}% (VN30F: suy chiều mua/bán từ giá chào).` : ' Dữ liệu từng lệnh khớp thật từ sàn (VPS).'}
            </> : 'Bật 👣 Footprint để tải dữ liệu.'}
            {' '}Bid = bán chủ động, Ask = mua chủ động. UA = phiên đấu giá chưa hoàn tất, EX = cạn kiệt, AB = hấp thụ, ▲Δ/▼Δ = phân kỳ delta. Phóng to biểu đồ để xem số.
          </div>
        </div>
      )}
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
      <div className="chart-area">
      <DrawToolbar tool={tool} setTool={(t) => { pendingDraw.current = null; setTool(t); }} color={drawColor} setColor={setDrawColor}
        magnet={magnet} setMagnet={setMagnet} keep={keepTool} setKeep={setKeepTool} hidden={hideDraw} setHidden={setHideDraw}
        count={drawings.length} canUndo={drawHist.current.length > 0} onUndo={undoDraw}
        onClear={() => { if (confirm(`Xoá ${drawings.length} hình vẽ của ${sym}?`)) setDrawings(() => []); }} onReset={resetView} />
      <div className="charts">
      <div className="chart" ref={el}>
        <canvas ref={overlay} className="overlay" />
        <canvas ref={drawCv} className={`draw-layer${tool !== 'cursor' ? ' active' : ''}${tool === 'eraser' ? ' eraser' : ''}`}
          onPointerDown={onDrawDown} onPointerMove={onDrawMove} onPointerUp={onDrawUp} />
        {st?.ex === 'PS' && <PsPanel st={st} vn30={g.indices.get('11')?.value} />}
        <OhlcLegend bar={ohlc || bars.current[replay.mode === 'on' ? replay.idx : bars.current.length - 1]} res={res} />
        {replay.mode === 'select' && <div className="draw-hint">⏪ Bấm vào nến để bắt đầu replay từ đó — các nến sau sẽ bị ẩn · Esc/⏪ để huỷ</div>}
        {tool !== 'cursor' && <div className="draw-hint">{TOOLS.find((t) => t.id === tool)?.name} — {tool === 'eraser' ? 'bấm vào hình cần xoá' : TOOLS.find((t) => t.id === tool)!.pts === 2 ? 'bấm 2 điểm (hoặc kéo-thả)' : 'bấm 1 điểm'} · Esc để huỷ</div>}
        {err && <div className="err">Không tải được biểu đồ: {err}</div>}
      </div>
      <div className="res-tabs ind osc-bar">
        <select value={osc} onChange={(e) => setOsc(e.target.value)} title="Chỉ báo khung dưới">
          {INDICATORS.filter((d) => d.group === 'osc').map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          {fpS.enabled && fpAllowed && <option value="cvd">Delta & CVD (Footprint)</option>}
        </select>
        {osc !== 'cvd' && <span className="muted">{f2(legend.osc)}</span>}
        {['rsi', 'macd', 'stoch', 'adx'].map((id) => <button key={id} className={osc === id ? 'on' : ''} onClick={() => setOsc(id)}>{IND_BY_ID[id].short}</button>)}
      </div>
      <div className="chart osc" ref={el2} />
      <div className="chart-foot">
        {replay.mode === 'on' ? (
          <div className="replay-ctl">
            <b>⏪ Replay</b>
            <button onClick={() => setReplay((r) => ({ ...r, idx: Math.max(1, r.idx - 1), playing: false }))} title="Lùi 1 nến">⏮</button>
            <button onClick={() => setReplay((r) => ({ ...r, playing: !r.playing }))} title="Phát / Dừng">{replay.playing ? '⏸' : '▶'}</button>
            <button onClick={() => setReplay((r) => ({ ...r, idx: Math.min(bars.current.length - 1, r.idx + 1), playing: false }))} title="Tiến 1 nến">⏭</button>
            <select value={replay.speed} onChange={(e) => setReplay((r) => ({ ...r, speed: +e.target.value }))}>{[1, 2, 3, 5, 10].map((v) => <option key={v} value={v}>{v}x</option>)}</select>
            <span className="muted">{bars.current[replay.idx] ? new Date((bars.current[replay.idx].time + VN) * 1000).toISOString().slice(0, 16).replace('T', ' ') : ''} · {replay.idx + 1}/{bars.current.length}</span>
            <button onClick={() => setReplay((r) => ({ ...r, mode: 'select', playing: false }))}>Chọn lại</button>
            <button onClick={() => setReplay((r) => ({ ...r, mode: 'off', playing: false }))} title="Thoát replay">✕</button>
          </div>
        ) : (
          <div className="ranges">{RANGES.map((r) => <button key={r.k} className={rangeKey === r.k ? 'on' : ''} onClick={() => chooseRange(r.k)}>{r.k}</button>)}</div>
        )}
        <div className="foot-right">
          <span className="muted">{bars.current.length} nến · giờ VN (UTC+7)</span>
          <button onClick={screenshot} title="Chụp ảnh biểu đồ (PNG)">📷</button>
          <button className={autoScale ? 'on' : ''} onClick={() => setAutoScale((v) => !v)} title="Tự co giãn thang giá">AUTO</button>
          <button className={logScale ? 'on' : ''} onClick={() => setLogScale((v) => !v)} title="Thang giá logarit">LOG</button>
        </div>
      </div>
      </div>
      {full && sideOpen && <SidePanel sym={sym} watch={watch} onPick={onPick} />}
      </div>
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
      {indOpen && <IndicatorDialog active={inds} osc={osc} builtins={builtins} cvdAvailable={fpS.enabled && fpAllowed}
        onToggle={(id) => setInds((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]))} onOsc={setOsc}
        onReset={resetIndicators} onClose={() => setIndOpen(false)} />}
      {search !== null && <SymbolSearch initial={search} onClose={() => setSearch(null)} onSelect={(x) => { setSearch(null); if (x !== sym) onPick(x); }} />}
    </div>
  );
}

/** Khung số liệu phái sinh (góc phải trên biểu đồ): tổng dư mua/bán realtime, chênh lệch, KL khớp, OI, basis */
function PsPanel({ st, vn30 }: { st: any; vn30?: number }) {
  const [hide, setHide] = useState(() => { try { return localStorage.getItem('psPanel') === '0'; } catch { return false; } });
  const toggle = () => { setHide(!hide); try { localStorage.setItem('psPanel', hide ? '1' : '0'); } catch { /* */ } };
  const flash = useRef<HTMLDivElement>(null);
  const prev = useRef<string>('');
  const key = `${st.totBid}|${st.totAsk}`;
  useEffect(() => {
    if (prev.current && prev.current !== key && flash.current) { flash.current.classList.remove('flash'); void flash.current.offsetWidth; flash.current.classList.add('flash'); }
    prev.current = key;
  }, [key]);
  if (hide) return <button className="ps-panel-min" onClick={toggle} title="Hiện bảng dư mua/bán">Dư M/B ▸</button>;
  const tb = st.totBid || 0, ta = st.totAsk || 0, sum = tb + ta;
  const pb = sum ? (tb / sum) * 100 : 50;
  const diff = tb - ta;
  const px = st.last || st.ref;
  const basis = vn30 ? px - vn30 : null;
  const n = (v?: number) => (v === undefined || v === null ? '—' : Math.round(v).toLocaleString('vi-VN'));
  return (
    <div className="ps-panel" onPointerDown={(e) => e.stopPropagation()}>
      <div className="ps-head"><b>{st.s}</b><span className="muted">{st.code}</span><button onClick={toggle} title="Thu gọn">–</button></div>
      <div className="ps-tot" ref={flash}>
        <div><span>Tổng dư mua</span><b className="c-up">{n(tb)}</b></div>
        <div><span>Tổng dư bán</span><b className="c-down">{n(ta)}</b></div>
      </div>
      <div className="ps-bar" title={`Mua ${pb.toFixed(0)}% · Bán ${(100 - pb).toFixed(0)}%`}><i style={{ width: `${pb}%` }} /></div>
      <div className="ps-row"><span>Chênh lệch</span><b className={diff >= 0 ? 'c-up' : 'c-down'}>{diff > 0 ? '+' : ''}{n(diff)}</b><small>{pb.toFixed(0)}% / {(100 - pb).toFixed(0)}%</small></div>
      <div className="ps-row"><span>KL khớp</span><b>{n(st.totVol)}</b>{st.lastVol ? <small>+{n(st.lastVol)}</small> : null}</div>
      <div className="ps-row"><span>OI</span><b>{n(st.oi)}</b>{basis !== null && <small className={basis >= 0 ? 'c-up' : 'c-down'}>Basis {basis > 0 ? '+' : ''}{basis.toFixed(1)}</small>}</div>
      <div className="ps-row"><span>NN mua/bán</span><b>{n(st.fB)} / {n(st.fS)}</b></div>
    </div>
  );
}

/** Chú thích O/H/L/C của nến dưới con trỏ (hoặc nến cuối) */
function OhlcLegend({ bar, res }: { bar?: Bar | null; res: string }) {
  if (!bar) return null;
  const up = bar.close >= bar.open, cls = up ? 'c-up' : 'c-down';
  const f = (v: number) => (v >= 1000 ? v.toFixed(1) : v.toFixed(2));
  const chg = bar.close - bar.open, pc = bar.open ? (chg / bar.open) * 100 : 0;
  const d = new Date((bar.time + 7 * 3600) * 1000).toISOString();
  const when = res === '1D' || res === '1W' ? d.slice(0, 10).split('-').reverse().join('/') : `${d.slice(8, 10)}/${d.slice(5, 7)} ${d.slice(11, 16)}`;
  const vol = bar.volume >= 1e6 ? (bar.volume / 1e6).toFixed(2) + 'tr' : bar.volume >= 1e3 ? (bar.volume / 1e3).toFixed(1) + 'k' : String(bar.volume);
  return (
    <div className="ohlc-legend">
      <span className="muted">{when}</span>
      <span>O <b className={cls}>{f(bar.open)}</b></span><span>H <b className={cls}>{f(bar.high)}</b></span>
      <span>L <b className={cls}>{f(bar.low)}</b></span><span>C <b className={cls}>{f(bar.close)}</b></span>
      <b className={cls}>{chg >= 0 ? '+' : ''}{f(chg)} ({pc >= 0 ? '+' : ''}{pc.toFixed(2)}%)</b>
      <span>KL <b>{vol}</b></span>
    </div>
  );
}
