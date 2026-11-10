import { useEffect, useRef, useState } from 'react';
import { createChart, type IChartApi, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts';
import { useStock } from '../lib/hooks';
import { fmtPrice, fmtVol, priceClass } from '../lib/format';

const VN = 7 * 3600; // hiển thị giờ VN trên trục thời gian (thư viện dùng UTC)
const RES = [['1', '1 phút'], ['5', '5 phút'], ['15', '15 phút'], ['1H', '1 giờ'], ['1D', 'Ngày'], ['1W', 'Tuần']] as const;
const SPAN: Record<string, number> = { '1': 3, '5': 10, '15': 30, '1H': 90, '1D': 730, '1W': 2000 };
const STEP: Record<string, number> = { '1': 60, '5': 300, '15': 900, '1H': 3600 };

type Bar = { time: number; open: number; high: number; low: number; close: number; volume: number };

export function StockDetail({ sym, onClose }: { sym: string; onClose: () => void }) {
  const st = useStock(sym);
  const [res, setRes] = useState<string>('1D');
  const [err, setErr] = useState('');
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi>();
  const candle = useRef<ISeriesApi<'Candlestick'>>();
  const vol = useRef<ISeriesApi<'Histogram'>>();
  const last = useRef<Bar | null>(null);
  const lastTot = useRef(0);

  useEffect(() => {
    const dark = matchMedia('(prefers-color-scheme: dark)').matches;
    const c = createChart(el.current!, {
      autoSize: true,
      layout: { background: { color: 'transparent' }, textColor: dark ? '#c9d1d9' : '#333' },
      grid: { vertLines: { color: dark ? '#222a35' : '#eee' }, horzLines: { color: dark ? '#222a35' : '#eee' } },
      timeScale: { timeVisible: true, secondsVisible: false },
      rightPriceScale: { scaleMargins: { top: 0.1, bottom: 0.25 } },
    });
    candle.current = c.addCandlestickSeries({ upColor: '#0ecb81', downColor: '#f6465d', borderVisible: false, wickUpColor: '#0ecb81', wickDownColor: '#f6465d' });
    vol.current = c.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'v' });
    c.priceScale('v').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    chart.current = c;
    return () => c.remove();
  }, []);

  useEffect(() => {
    let dead = false;
    setErr('');
    const to = Math.floor(Date.now() / 1000);
    fetch(`/api/history?symbol=${sym}&resolution=${res}&from=${to - SPAN[res] * 86400}&to=${to}`)
      .then((r) => r.json())
      .then((rows: Bar[] | { error: string }) => {
        if (dead) return;
        if (!Array.isArray(rows)) { setErr(rows.error); return; }
        candle.current!.setData(rows.map((b) => ({ ...b, time: (b.time + VN) as UTCTimestamp })));
        vol.current!.setData(rows.map((b) => ({ time: (b.time + VN) as UTCTimestamp, value: b.volume, color: b.close >= b.open ? '#0ecb8155' : '#f6465d55' })));
        last.current = rows[rows.length - 1] || null;
        lastTot.current = 0;
        chart.current!.timeScale().fitContent();
      })
      .catch((e) => !dead && setErr(String(e)));
    return () => { dead = true; };
  }, [sym, res]);

  // Cập nhật nến cuối theo từng lệnh khớp realtime
  useEffect(() => {
    if (!st || !st.last || !candle.current || !last.current) return;
    const now = Math.floor(Date.now() / 1000);
    let bar = last.current;
    if (res === '1D' || res === '1W') {
      const today = new Date((now + VN) * 1000).toISOString().slice(0, 10);
      const barDay = new Date((bar.time + VN) * 1000).toISOString().slice(0, 10);
      if (res === '1D' && today !== barDay) {
        bar = { time: Date.parse(today + 'T02:00:00Z') / 1000, open: st.open || st.last, high: st.last, low: st.last, close: st.last, volume: 0 };
      }
      bar = { ...bar, close: st.last, high: Math.max(bar.high, st.high || st.last), low: Math.min(bar.low, st.low || st.last), volume: res === '1D' ? st.totVol : bar.volume };
    } else {
      const step = STEP[res];
      const bucket = Math.floor(now / step) * step;
      const delta = lastTot.current ? Math.max(0, st.totVol - lastTot.current) : 0;
      bar = bucket > bar.time
        ? { time: bucket, open: st.last, high: st.last, low: st.last, close: st.last, volume: delta }
        : { ...bar, close: st.last, high: Math.max(bar.high, st.last), low: Math.min(bar.low, st.last), volume: bar.volume + delta };
    }
    lastTot.current = st.totVol;
    last.current = bar;
    candle.current.update({ ...bar, time: (bar.time + VN) as UTCTimestamp });
    vol.current!.update({ time: (bar.time + VN) as UTCTimestamp, value: bar.volume, color: bar.close >= bar.open ? '#0ecb8155' : '#f6465d55' });
  }, [st, res]);

  const pc = (p: any) => (st ? priceClass(p, st) : '');
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
      <div className="chart" ref={el}>{err && <div className="err">Không tải được biểu đồ: {err}</div>}</div>
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
