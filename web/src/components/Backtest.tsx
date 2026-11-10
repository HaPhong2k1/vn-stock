import type { BtOptions, BtResult } from '../../../shared/strategy.js';

const vnd = (v: number) => Math.round(v).toLocaleString('vi-VN');
const d = (t: number) => new Date((t + 7 * 3600) * 1000).toISOString().slice(0, 10).split('-').reverse().join('/');
const cls = (v: number) => (v > 0 ? 'c-up' : v < 0 ? 'c-down' : '');

interface Props { res: BtResult | null; opts: BtOptions; onChange: (o: BtOptions) => void; intraday: boolean }

/** Bảng kết quả backtest chiến lược EMA cross */
export function Backtest({ res, opts, onChange, intraday }: Props) {
  const set = (k: keyof BtOptions, v: unknown) => onChange({ ...opts, [k]: v });
  const startStr = opts.start ? new Date(opts.start * 1000).toISOString().slice(0, 10) : '';
  const eq = res?.equity || [];
  const path = (() => {
    if (eq.length < 2) return '';
    const vals = eq.map((e) => e.value), mn = Math.min(...vals), mx = Math.max(...vals), span = mx - mn || 1;
    return vals.map((v, i) => `${i ? 'L' : 'M'}${((i / (vals.length - 1)) * 300).toFixed(1)},${(60 - ((v - mn) / span) * 56 - 2).toFixed(1)}`).join(' ');
  })();
  const s = res?.stats;
  return (
    <div className="bt">
      <div className="bt-form">
        <label>EMA nhanh <input type="number" min={2} max={200} value={opts.fast} onChange={(e) => set('fast', Math.max(2, +e.target.value))} /></label>
        <label>EMA chậm <input type="number" min={3} max={400} value={opts.slow} onChange={(e) => set('slow', Math.max(3, +e.target.value))} /></label>
        <label>Kiểu
          <select value={opts.mode} onChange={(e) => set('mode', e.target.value)}>
            <option value="long">Chỉ mua (phù hợp TTCK VN)</option>
            <option value="longshort">Mua & bán khống (như bản gốc)</option>
          </select>
        </label>
        <label>Vốn <input type="number" step={10_000_000} value={opts.capital} onChange={(e) => set('capital', +e.target.value)} /> đ</label>
        <label>Phí mua/bán % <input type="number" step={0.01} value={opts.feeBuy} onChange={(e) => onChange({ ...opts, feeBuy: +e.target.value, feeSell: +e.target.value })} /></label>
        <label>Thuế bán % <input type="number" step={0.01} value={opts.taxSell} onChange={(e) => set('taxSell', +e.target.value)} /></label>
        <label><input type="checkbox" checked={opts.tPlus > 0} onChange={(e) => set('tPlus', e.target.checked ? 2 : 0)} /> Áp dụng T+2</label>
        <label>Từ ngày <input type="date" value={startStr} onChange={(e) => set('start', e.target.value ? Date.parse(e.target.value) / 1000 : 0)} /></label>
      </div>
      {s && (
        <>
          <div className="bt-stats">
            <div><span>Lãi/lỗ ròng</span><b className={cls(s.netProfit)}>{s.netProfitPct.toFixed(2)}%</b><small>{vnd(s.netProfit)} đ</small></div>
            <div><span>Mua & giữ</span><b className={cls(s.buyHoldPct)}>{s.buyHoldPct.toFixed(2)}%</b></div>
            <div><span>Số lệnh</span><b>{s.trades}</b></div>
            <div><span>Tỷ lệ thắng</span><b>{s.winRate.toFixed(1)}%</b></div>
            <div><span>Profit factor</span><b>{Number.isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : '∞'}</b></div>
            <div><span>Sụt giảm tối đa</span><b className="c-down">{s.maxDrawdownPct.toFixed(2)}%</b></div>
          </div>
          {path && <svg className="bt-eq" viewBox="0 0 300 60" preserveAspectRatio="none"><path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" /></svg>}
          {res.openTrade && <div className="muted note">Đang mở vị thế {res.openTrade.side === 'LONG' ? 'MUA' : 'BÁN KHỐNG'} {vnd(res.openTrade.qty)} CP từ {d(res.openTrade.entryTime)} giá {res.openTrade.entryPrice} (giá hiện tại {res.openTrade.lastPrice}).</div>}
          <div className="bt-trades">
            <table className="grid">
              <thead><tr><th>#</th><th>Loại</th><th>Vào</th><th>Giá vào</th><th>Ra</th><th>Giá ra</th><th>KL</th><th>Lãi/lỗ</th></tr></thead>
              <tbody>
                {[...res.trades].reverse().map((t, i) => (
                  <tr key={i}>
                    <td>{res.trades.length - i}</td><td>{t.side === 'LONG' ? 'Mua' : 'Bán khống'}</td>
                    <td>{d(t.entryTime)}</td><td>{t.entryPrice.toFixed(2)}</td><td title={t.reason}>{d(t.exitTime)}</td><td>{t.exitPrice.toFixed(2)}</td>
                    <td>{vnd(t.qty)}</td><td className={cls(t.pnl)}>{t.pnlPct.toFixed(2)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!res.trades.length && <div className="muted empty">Chưa có lệnh nào đóng trong giai đoạn này.</div>}
          </div>
        </>
      )}
      <div className="muted note">
        Tín hiệu tính trên giá đóng cửa, khớp ở giá mở cửa nến kế tiếp (như TradingView). Dữ liệu biểu đồ hiện tại{intraday ? ' (khung phút — lịch sử ngắn)' : ''}.
        Kết quả quá khứ không đảm bảo lợi nhuận tương lai. Ý tưởng: “BUY and SELL – Backtest single EMA cross” của che_trader.
      </div>
    </div>
  );
}
