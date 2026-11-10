export const BULLISH: 1;
export const BEARISH: -1;
export interface SmcStructure { tag: 'BOS' | 'CHoCH'; bias: 1 | -1; internal: boolean; level: number; fromTime: number; fromIndex: number; toTime: number; toIndex: number }
export interface SmcOB { high: number; low: number; time: number; index: number; bias: 1 | -1; createdAt: number }
export interface SmcFVG { top: number; bottom: number; bias: 1 | -1; leftTime: number; leftIndex: number; rightIndex: number; at: number }
export interface SmcResult {
  structures: SmcStructure[];
  swings: { type: 'HH' | 'LH' | 'HL' | 'LL'; time: number; index: number; price: number }[];
  equals: { type: 'EQH' | 'EQL'; fromTime: number; fromIndex: number; fromPrice: number; toTime: number; toIndex: number; toPrice: number; at: number }[];
  internalOBs: SmcOB[]; swingOBs: SmcOB[]; fvgs: SmcFVG[];
  trailing: { top: number; bottom: number; barTime: number; barIndex: number; lastTopTime: number; lastBottomTime: number };
  swingTrend: number; internalTrend: number; internalTrendByBar: number[]; n: number;
}
export const SMC_DEFAULTS: Record<string, unknown>;
export function computeSMC(bars: { time: number; open: number; high: number; low: number; close: number }[], opts?: Record<string, unknown>): SmcResult;
export function smcLastBarSignals(smc: SmcResult): Record<string, boolean | number>;
