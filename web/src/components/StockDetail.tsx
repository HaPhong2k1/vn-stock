import { useCallback, useEffect, useRef, useState } from 'react';
import { createChart, type IChartApi, type ISeriesApi, type SeriesMarker, type UTCTimestamp, LineStyle } from 'lightweight-charts';
import { sma, rsi, macd, bollinger, crossUp, crossDown } from '../../../shared/indicators.js';
import { useStock } from '../lib/hooks';
import { fmtPrice, fmtVol, priceClass } from '../lib/format';
import { api } from '../lib/api';

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

export function StockDetail({ sym, onClose }: { sym: string; onClose: () => void }) {
  const st = useStock(sym);
  const [res, setRes] = useState<string>('1D');
  const [ov, setOv] = useState({ ma20: true, ma50: true, bb: false, signals: true });
  const [osc, setOsc] = useState<'RSI' | 'MACD'>('RSI');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [legend, setLegend] = useState<{ ma20?: number | null; ma50?: number | null; rsi?: number | null; macd?: number | null }>({});
  const el = useRef<HTMLDivElement>(null);
  const el2 = useRef<HTMLDivElement>(null);
  const s = useRef<Record<string, any>>({});
  const bars = useRef<Bar[]>([]);
  const lastTot = useRef(0);
  const opts = useRef({ ov, osc });
  opts.current = { ov, osc };

  // Tạo 2 biểu đồ: giá (+MA/BB/khối lượng) và dao động (RSI/MACD), đồng bộ trục thời gian
  useEffect(() => {
    const dark = matchMedia('(prefers-color-scheme: dark)').matches;
    const base = {
      autoSize: true,
      layout: { background: { color: 'transparent' }, textColor: dark ? '#c9d1d9' : '#333' },
      grid: { vertLines: { color: dark ? '#222a35' : '#eee' }, horzLines: { color: dark ? '#222a35' : '#eee' } },
      timeScale: { timeVisible: true, secondsVisible: false },
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
    return () => { c.remove(); c2.remove(); };
  }, []);

  /** Tính lại toàn bộ chỉ báo từ mảng nến và vẽ lại */
  const render = useCallback((fit = false) => {
    const b = bars.current, x = s.current;
    if (!x.candle) return;
    const { ov, osc } = opts.current;
    const closes = b.map((v) => v.close);
    const m20 = sma(closes, 20), m50 = sma(closes, 50), bb = bollinger(closes, 20, 2), r = rsi(closes, 14), md = macd(closes);
    x.candle.setData(b.map((v) => ({ ...v, time: T(v.time) })));
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
    x.candle.setMarkers(marks);
    const n = b.length - 1;
    setLegend({ ma20: m20[n], ma50: m50[n], rsi: r[n], macd: md.hist[n] });
    if (fit) { x.chart.timeScale().fitContent(); }
  }, []);

  useEffect(() => { render(); }, [ov, osc, render]);

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
        if (rows.length > 120) s.current.chart.timeScale().setVisibleLogicalRange({ from: rows.length - 120, to: rows.length + 3 });
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
      bar = { ...bar, close: st.last, high: Math.max(bar.high, st.high || st.last), low: Math.min(bar.low, st.low || st.last), volume: res === '1D' ? st.totVol : bar.volume };
    } else {
      const step = STEP[res];
      const bucket = Math.floor(now / step) * step;
      const delta = lastTot.current ? Math.max(0, st.totVol - lastTot.current) : 0;
      if (bucket > bar.time) { bar = { time: bucket, open: st.last, high: st.last, low: st.last, close: st.last, volume: delta }; append = true; }
      else bar = { ...bar, close: st.last, high: Math.max(bar.high, st.last), low: Math.min(bar.low, st.last), volume: bar.volume + delta };
    }
    lastTot.current = st.totVol;
    if (append) b.push(bar); else b[b.length - 1] = bar;
    if (!pending.current) { pending.current = true; setTimeout(() => { pending.current = false; render(); }, 300); }
  }, [st, res, render]);

  const quickAlert = async (type: string, value?: number) => {
    try {
      await api('/alerts', { method: 'POST', body: { sym, type, value: value ?? null, repeat: type.includes('CROSS') } });
      setMsg('✓ Đã tạo cảnh báo'); setTimeout(() => setMsg(''), 3000);
    } catch (e: any) { setMsg(e.message); }
  };

  const pc = (p: any) => (st ? priceClass(p, st) : '');
  const f2 = (v?: number | null) => (v === null || v === undefined ? '—' : v.toFixed(2));
  return (
    <div className="detail">
      <div className="detail-head">
        <div>
          <b className="d-sym">{sym}</b> <span className="muted">{st?.ex}</span>
          {st && <span className={`d-price ${pc(st.last)}`}>{fmtPrice(st.last || st.ref)} <small>{st.chg > 0 ? '+' : ''}{st.chg?.toFixed(2)} ({st.chgPc?.toFixed(2)}%)</small></span>}
        </div>
        <button className="close" onClick={onClose}>✕</button>
      </div>
      <div className="res-tabs">
        {RES.map(([k, label]) => <button key={k} className={res === k ? 'on' : ''} onClick={() => setRes(k)}>{label}</button>)}
      </div>
      <div className="res-tabs ind">
        <button className={ov.ma20 ? 'on' : ''} onClick={() => setOv({ ...ov, ma20: !ov.ma20 })}><i style={{ background: C.ma20 }} />MA20 {f2(legend.ma20)}</button>
        <button className={ov.ma50 ? 'on' : ''} onClick={() => setOv({ ...ov, ma50: !ov.ma50 })}><i style={{ background: C.ma50 }} />MA50 {f2(legend.ma50)}</button>
        <button className={ov.bb ? 'on' : ''} onClick={() => setOv({ ...ov, bb: !ov.bb })}><i style={{ background: C.bb }} />Bollinger</button>
        <button className={ov.signals ? 'on' : ''} onClick={() => setOv({ ...ov, signals: !ov.signals })}>▲ Tín hiệu MA20</button>
      </div>
      <div className="chart" ref={el}>{err && <div className="err">Không tải được biểu đồ: {err}</div>}</div>
      <div className="res-tabs ind">
        <button className={osc === 'RSI' ? 'on' : ''} onClick={() => setOsc('RSI')}>RSI(14) {f2(legend.rsi)}</button>
        <button className={osc === 'MACD' ? 'on' : ''} onClick={() => setOsc('MACD')}>MACD(12,26,9) {f2(legend.macd)}</button>
      </div>
      <div className="chart osc" ref={el2} />
      <div className="quick">
        <button onClick={() => quickAlert('MA20_CROSS_UP')}>🔔 Báo khi cắt lên MA20</button>
        {st?.last ? <button onClick={() => quickAlert('PRICE_GTE', +(st.last * 1.03).toFixed(2))}>🔔 Giá ≥ {(st.last * 1.03).toFixed(2)} (+3%)</button> : null}
        {st?.last ? <button onClick={() => quickAlert('PRICE_LTE', +(st.last * 0.97).toFixed(2))}>🔔 Giá ≤ {(st.last * 0.97).toFixed(2)} (−3%)</button> : null}
        <span className="muted">{msg}</span>
      </div>
      {st && (
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
            <dt>Giá trị ước tính</dt><dd>{st.avg && st.totVol ? ((st.avg * st.totVol) / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + ' tỷ' : ''}</dd>
            <dt>NN mua / bán</dt><dd>{fmtVol(st.fB)} / {fmtVol(st.fS)}</dd>
            <dt>NN ròng</dt><dd className={st.fB - st.fS >= 0 ? 'c-up' : 'c-down'}>{fmtVol(st.fB - st.fS)}</dd>
          </dl>
        </div>
      )}
    </div>
  );
}
