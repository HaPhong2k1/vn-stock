export interface EwOptions {
  useLeverage: boolean; leverageX: number; riskPct: number; pivotLen: number; minWavePct: number;
  showZones: boolean; showTargets: boolean; zoneWidth: number; showFib: boolean;
  showImp: boolean; showZig: boolean; showFlt: boolean; showTri: boolean; showDia: boolean; showCpx: boolean;
  showCorr: boolean; showSig: boolean; showLns: boolean; showPnl: boolean; showTADetail: boolean;
}
export const EW_DEFAULTS: EwOptions;
export const EW_COLORS: Record<string, string>;
export interface EwLine { x1: number; y1: number; x2: number; y2: number; color: string; width: number; style: 'solid' | 'dashed' | 'dotted' | 'arrow'; t: number; extend?: boolean; entry?: boolean }
export interface EwLabel { x: number; y: number; text: string; color: string; style: 'up' | 'down' | 'none'; bg?: string; bgT?: number; t?: number; size: 'tiny' | 'small' | 'normal'; align?: 'left'; entry?: boolean }
export interface EwBox { x1: number; x2: number; top: number; bot: number; color: string; bgT: number; borderT: number; dash: boolean; text: string; textT: number }
type Bar = { time: number; open: number; high: number; low: number; close: number; volume: number };
export interface EwResult {
  pat: string; dir: string; conf: number; sub: string; phase: number; type: number; sig: string; rec: string; score: number;
  ent: number | null; stp: number | null; tgt1: number | null; tgt2: number | null; tgt3: number | null;
  buyBot: number | null; buyTop: number | null; sellBot: number | null; sellTop: number | null;
  labels: EwLabel[]; lines: EwLine[]; boxes: EwBox[]; pivots: { p: number; b: number; d: number }[];
  ta: { ema50: number; ema200: number; rsi: number; macdLine: number; macdSignal: number; stochK: number; stochD: number; adx: number } | null;
  tf: { align: number; wBias: number; dBias: number; cBias: number; wRsi: number; dRsi: number } | null;
  depth: { volRatio: number; bbPos: string; squeeze: boolean; aboveMid: boolean; higherHighs: boolean; higherLows: boolean } | null;
  opts: EwOptions; n: number;
}
export function computeEW(bars: Bar[], opts?: Partial<EwOptions>, htf?: { d?: Bar[]; w?: Bar[] }): EwResult;
