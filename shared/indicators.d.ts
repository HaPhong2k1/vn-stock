type S = (number | null)[];
export function sma(values: number[], period: number): S;
export function ema(values: number[], period: number): S;
export function rsi(values: number[], period?: number): S;
export function macd(values: number[], fast?: number, slow?: number, signal?: number): { line: S; signal: S; hist: S };
export function bollinger(values: number[], period?: number, mult?: number): { mid: S; upper: S; lower: S };
export function crossUp(a: S, b: S, i: number): boolean;
export function crossDown(a: S, b: S, i: number): boolean;
