export interface BtOptions { fast: number; slow: number; mode: 'long' | 'longshort'; capital: number; feeBuy: number; feeSell: number; taxSell: number; lot: number; tPlus: number; start: number; end: number }
export interface BtTrade { side: 'LONG' | 'SHORT'; qty: number; entryTime: number; entryPrice: number; exitTime: number; exitPrice: number; pnl: number; pnlPct: number; bars: number; reason: string }
export interface BtResult {
  emaFast: number[]; emaSlow: number[];
  signals: { i: number; side: 'BUY' | 'SELL'; time: number; price: number }[];
  trades: BtTrade[]; equity: { time: number; value: number }[];
  openTrade: null | { side: string; qty: number; entryPrice: number; entryTime: number; lastPrice: number };
  stats: { trades: number; winRate: number; netProfit: number; netProfitPct: number; profitFactor: number; maxDrawdownPct: number; buyHoldPct: number; avgTradePct: number };
}
export const BT_DEFAULTS: BtOptions;
export function emaTV(values: number[], length: number): number[];
export function backtestEmaCross(bars: { time: number; open: number; high: number; low: number; close: number }[], opts?: Partial<BtOptions>): BtResult;
