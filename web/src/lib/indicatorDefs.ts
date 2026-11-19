// Danh mục chỉ báo kiểu TradingView/Fiant: "trên giá" (overlay) và "dao động" (khung dưới)
import * as I from '../../../shared/indicators.js';

export interface IBar { time: number; open: number; high: number; low: number; close: number; volume: number }
type Vals = (number | null)[];
export interface IndLine { values: Vals; color: string; width?: number; dashed?: boolean; dots?: boolean; title?: string }
export interface IndResult { lines: IndLine[]; hist?: { values: Vals; colors?: string[] }; levels?: { v: number; color: string }[] }
export interface IndDef { color?: string; id: string; name: string; short: string; group: 'overlay' | 'osc'; desc: string; compute: (b: IBar[]) => IndResult }

const cols = (b: IBar[]) => ({ H: b.map((x) => x.high), L: b.map((x) => x.low), C: b.map((x) => x.close), V: b.map((x) => x.volume) });
const vnDay = (t: number) => Math.floor((t + 7 * 3600) / 86400);
const G = '#0ecb81', R = '#f6465d';

const emaDef = (n: number, color: string): IndDef => ({
  id: `ema${n}`, name: `EMA ${n}`, short: `EMA${n}`, group: 'overlay', desc: `Trung bình động hàm mũ ${n} kỳ`,
  compute: (b) => ({ lines: [{ values: I.ema(cols(b).C, n), color, width: n >= 50 ? 2 : 1 }] }),
});

export const INDICATORS: IndDef[] = [
  // ---------- Trên giá ----------
  emaDef(9, '#ff6d00'), emaDef(21, '#2962ff'), emaDef(50, '#00897b'), emaDef(200, '#d50000'),
  { id: 'vwap', name: 'VWAP', short: 'VWAP', group: 'overlay', desc: 'Giá trung bình theo khối lượng, tính lại mỗi phiên (dùng cho khung phút)',
    compute: (b) => { const { H, L, C, V } = cols(b); return { lines: [{ values: I.vwap(H, L, C, V, (i) => vnDay(b[i].time)), color: '#e040fb', width: 2 }] }; } },
  { id: 'supertrend', name: 'SuperTrend (10, 3)', short: 'SuperTrend', group: 'overlay', desc: 'Đường dừng lỗ động theo ATR: xanh = xu hướng tăng, đỏ = giảm',
    compute: (b) => {
      const { H, L, C } = cols(b); const st = I.supertrend(H, L, C, 10, 3);
      return { lines: [
        { values: st.line.map((v, i) => (st.dir[i] === 1 ? v : null)), color: G, width: 2, title: 'Tăng' },
        { values: st.line.map((v, i) => (st.dir[i] === -1 ? v : null)), color: R, width: 2, title: 'Giảm' },
      ] };
    } },
  { id: 'psar', name: 'Parabolic SAR', short: 'SAR', group: 'overlay', desc: 'Điểm dừng và đảo chiều (0.02, 0.02, 0.2)',
    compute: (b) => { const { H, L } = cols(b); return { lines: [{ values: I.psar(H, L), color: '#2196f3', dots: true }] }; } },
  { id: 'ichimoku', name: 'Ichimoku (9, 26, 52)', short: 'Ichimoku', group: 'overlay', desc: 'Tenkan, Kijun, mây Senkou A/B',
    compute: (b) => {
      const { H, L, C } = cols(b); const k = I.ichimoku(H, L, C);
      return { lines: [
        { values: k.tenkan, color: '#2962ff', title: 'Tenkan' }, { values: k.kijun, color: '#b71c1c', title: 'Kijun' },
        { values: k.spanA, color: '#43a047', dashed: true, title: 'Senkou A' }, { values: k.spanB, color: '#e53935', dashed: true, title: 'Senkou B' },
      ] };
    } },
  { id: 'donchian', name: 'Donchian Channels (20)', short: 'Donchian', group: 'overlay', desc: 'Kênh đỉnh/đáy cao nhất – thấp nhất 20 kỳ',
    compute: (b) => { const { H, L } = cols(b); const d = I.donchian(H, L, 20); return { lines: [{ values: d.upper, color: '#26a69a' }, { values: d.mid, color: '#ff9800', dashed: true }, { values: d.lower, color: '#26a69a' }] }; } },
  { id: 'keltner', name: 'Keltner Channels (20, 2)', short: 'Keltner', group: 'overlay', desc: 'EMA20 ± 2 × ATR20',
    compute: (b) => { const { H, L, C } = cols(b); const k = I.keltner(H, L, C); return { lines: [{ values: k.upper, color: '#7e57c2' }, { values: k.mid, color: '#7e57c2', dashed: true }, { values: k.lower, color: '#7e57c2' }] }; } },
  // ---------- Dao động (khung dưới) ----------
  { id: 'rsi', name: 'RSI (14)', short: 'RSI', group: 'osc', desc: 'Chỉ số sức mạnh tương đối; >70 quá mua, <30 quá bán',
    compute: (b) => ({ lines: [{ values: I.rsi(cols(b).C, 14), color: '#a855f7' }], levels: [{ v: 70, color: R }, { v: 30, color: G }] }) },
  { id: 'macd', name: 'MACD (12, 26, 9)', short: 'MACD', group: 'osc', desc: 'Đường MACD, Signal và Histogram',
    compute: (b) => { const m = I.macd(cols(b).C); return { lines: [{ values: m.line, color: '#2962ff' }, { values: m.signal, color: '#ff6d00' }], hist: { values: m.hist, colors: m.hist.map((v) => ((v ?? 0) >= 0 ? G + '99' : R + '99')) } }; } },
  { id: 'stoch', name: 'Stochastic (14, 3, 3)', short: 'Stoch', group: 'osc', desc: '%K và %D; >80 quá mua, <20 quá bán',
    compute: (b) => { const { H, L, C } = cols(b); const s = I.stochastic(H, L, C); return { lines: [{ values: s.k, color: '#2962ff' }, { values: s.d, color: '#ff6d00' }], levels: [{ v: 80, color: R }, { v: 20, color: G }] }; } },
  { id: 'stochrsi', name: 'Stoch RSI (3, 3, 14, 14)', short: 'StochRSI', group: 'osc', desc: 'Stochastic áp dụng trên RSI — nhạy hơn RSI',
    compute: (b) => { const s = I.stochRsi(cols(b).C); return { lines: [{ values: s.k, color: '#2962ff' }, { values: s.d, color: '#ff6d00' }], levels: [{ v: 80, color: R }, { v: 20, color: G }] }; } },
  { id: 'adx', name: 'ADX / DMI (14)', short: 'ADX', group: 'osc', desc: 'Sức mạnh xu hướng (ADX > 25 = có xu hướng) và +DI / −DI',
    compute: (b) => { const { H, L, C } = cols(b); const d = I.adx(H, L, C); return { lines: [{ values: d.adx, color: '#ff9800', width: 2, title: 'ADX' }, { values: d.pdi, color: G, title: '+DI' }, { values: d.mdi, color: R, title: '−DI' }], levels: [{ v: 25, color: '#8b95a5' }] }; } },
  { id: 'cci', name: 'CCI (20)', short: 'CCI', group: 'osc', desc: 'Commodity Channel Index; ±100',
    compute: (b) => { const { H, L, C } = cols(b); return { lines: [{ values: I.cci(H, L, C), color: '#00bcd4' }], levels: [{ v: 100, color: R }, { v: -100, color: G }] }; } },
  { id: 'atr', name: 'ATR (14)', short: 'ATR', group: 'osc', desc: 'Biên độ dao động trung bình — dùng đặt cắt lỗ',
    compute: (b) => { const { H, L, C } = cols(b); return { lines: [{ values: I.atr(H, L, C), color: '#ef5350' }] }; } },
  { id: 'willr', name: 'Williams %R (14)', short: '%R', group: 'osc', desc: '−20 quá mua, −80 quá bán',
    compute: (b) => { const { H, L, C } = cols(b); return { lines: [{ values: I.williamsR(H, L, C), color: '#7e57c2' }], levels: [{ v: -20, color: R }, { v: -80, color: G }] }; } },
  { id: 'obv', name: 'OBV', short: 'OBV', group: 'osc', desc: 'On-Balance Volume — dòng tiền tích luỹ theo khối lượng',
    compute: (b) => { const { C, V } = cols(b); return { lines: [{ values: I.obv(C, V), color: '#2962ff' }] }; } },
  { id: 'mfi', name: 'MFI (14)', short: 'MFI', group: 'osc', desc: 'Money Flow Index — RSI có trọng số khối lượng; >80 / <20',
    compute: (b) => { const { H, L, C, V } = cols(b); return { lines: [{ values: I.mfi(H, L, C, V), color: '#26a69a' }], levels: [{ v: 80, color: R }, { v: 20, color: G }] }; } },
];
// màu đại diện (chip chú thích)
for (const d of INDICATORS) if (!d.color) d.color = d.compute([{ time: 0, open: 1, high: 1, low: 1, close: 1, volume: 1 }, { time: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 }]).lines[0]?.color;
export const IND_BY_ID: Record<string, IndDef> = Object.fromEntries(INDICATORS.map((d) => [d.id, d]));
