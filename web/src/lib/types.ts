export type Level = [number | string, number];
export interface Stock {
  s: string; ex: string; ref: number; ceil: number; floor: number; open: number;
  last: number; lastVol: number; chg: number; chgPc: number; high: number; low: number; avg: number;
  totVol: number; b: Level[]; a: Level[]; fB: number; fS: number; room: number; t: string; seq: number; u: number;
}
export interface Index {
  code: string; name: string; value: number; chg: number; chgPc: number; vol: number; val: number;
  up: number; down: number; nochg: number; status?: string; t?: string; u?: number;
}
export interface FeedStatus {
  session: string; provider: string; clients: number; now: number;
  feed: { connected: boolean; lastMsgAt: number; lastResyncAt: number; reconnects: number };
}
