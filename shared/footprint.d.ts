export interface FpRow { p: number; bid: number; ask: number; vol: number; delta: number; buyImb: boolean; sellImb: boolean }
export interface FpBar {
  t: number; o: number; h: number; l: number; c: number; auction: number; rows: FpRow[]; vol: number; delta: number; cvd: number;
  poc: number | null; maxVol: number; stacks: { dir: 1 | -1; from: number; to: number; n: number }[];
  unfinishedHigh: boolean; unfinishedLow: boolean; exhaustHigh: boolean; exhaustLow: boolean;
  absorbLow: boolean; absorbHigh: boolean; divBear: boolean; divBull: boolean;
}
export const FP_DEFAULTS: { ratio: number; minVol: number; stack: number; exhaustPct: number; absorbMult: number };
export function tickOf(ex: string, price: number): number;
export function autoRowSize(bars: { h: number; l: number }[], tick: number): number;
export function analyzeFootprint(bars: { t: number; o: number; h: number; l: number; c: number; rows: [number, number, number][]; auction?: number }[], row: number, opts?: Partial<typeof FP_DEFAULTS>): FpBar[];
