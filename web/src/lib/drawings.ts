// Công cụ vẽ kiểu TradingView/Fiant — toạ độ lưu theo (thời gian nến, giá) nên giữ nguyên khi zoom/đổi khung.
// Mỗi công cụ khai báo: số điểm cần bấm, hàm dựng hình học (đường, vùng tô, nhãn) và cách kéo điểm neo.
import type { IChartApi, ISeriesApi } from 'lightweight-charts';

export interface Pt { t: number; p: number }
export type LineStyle = 'solid' | 'dashed' | 'dotted';
export interface Drawing {
  id: string; type: string; pts: Pt[]; color: string; text?: string;
  width?: number; style?: LineStyle; fill?: boolean; locked?: boolean; extL?: boolean; extR?: boolean; hidden?: boolean;
}
export type Tool = string; // 'cursor' | 'cross' | 'eraser' | 'zoom' | id công cụ vẽ | 'emoji:🚀'

/** Chỉ số nến <-> thời gian (cho phép vẽ vào vùng tương lai bên phải) */
export class TimeMap {
  constructor(public times: number[]) {}
  step() { const t = this.times; const n = t.length; return n > 1 ? Math.max(1, t[n - 1] - t[n - 2]) : 86400; }
  toIndex(time: number): number {
    const t = this.times, n = t.length;
    if (!n) return 0;
    if (time >= t[n - 1]) return n - 1 + (time - t[n - 1]) / this.step();
    if (time <= t[0]) return (time - t[0]) / this.step();
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (t[m] <= time) lo = m; else hi = m; }
    return lo + (time - t[lo]) / Math.max(1, t[hi] - t[lo]);
  }
  toTime(idx: number): number {
    const t = this.times, n = t.length;
    if (!n) return 0;
    const i = Math.round(idx);
    if (i >= 0 && i < n) return t[i];
    if (i >= n) return t[n - 1] + (i - (n - 1)) * this.step();
    return t[0] + i * this.step();
  }
}

export interface DCtx { chart: IChartApi; series: ISeriesApi<'Candlestick'>; tm: TimeMap; w: number; h: number; closes: number[]; dark: boolean }
interface XY { x: number; y: number }
interface Geo {
  strokes: { p: Path2D; color?: string; width?: number; dash?: number[] }[];
  fills: { p: Path2D; color?: string; alpha?: number }[];
  texts: { x: number; y: number; s: string; color?: string; align?: CanvasTextAlign; base?: CanvasTextBaseline; bg?: string; size?: number; bold?: boolean }[];
}
interface ToolDef {
  id: string; name: string; group: string; icon: string;
  pts: number | 'multi' | 'free';           // số điểm cần bấm; multi = bấm nhiều điểm (Enter/nhấp đúp kết thúc); free = kéo tự do
  build: (d: Drawing, P: XY[], c: DCtx) => Geo;
  handles?: (d: Drawing, P: XY[], c: DCtx) => XY[];
  drag?: (d: Drawing, k: number, pt: Pt, c: DCtx) => void;
  create?: (pt: Pt, c: DCtx, color: string) => Drawing; // công cụ 1 cú bấm tạo sẵn nhiều điểm
  defaults?: Partial<Drawing>;
  hint?: string;
}

// ---------- Tiện ích hình học ----------
const geo = (): Geo => ({ strokes: [], fills: [], texts: [] });
const seg = (a: XY, b: XY) => { const p = new Path2D(); p.moveTo(a.x, a.y); p.lineTo(b.x, b.y); return p; };
const poly = (pts: XY[], close = false) => { const p = new Path2D(); pts.forEach((q, i) => (i ? p.lineTo(q.x, q.y) : p.moveTo(q.x, q.y))); if (close) p.closePath(); return p; };
const far = (a: XY, b: XY, k = 2000): XY => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
const lerp = (a: XY, b: XY, t: number): XY => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const dist = (a: XY, b: XY) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a: XY, b: XY) => lerp(a, b, 0.5);
/** Đường thẳng qua a,b, kéo dài trái/phải tuỳ chọn */
function line(a: XY, b: XY, extL?: boolean, extR?: boolean) {
  if (a.x === b.x && a.y === b.y) return seg(a, b);
  const s = extL ? far(b, a) : a, e = extR ? far(a, b) : b;
  return seg(s, e);
}
const fmtP = (p: number) => (Math.abs(p) >= 1000 ? p.toFixed(1) : Math.abs(p) >= 10 ? p.toFixed(2) : p.toFixed(3));
const priceAt = (c: DCtx, y: number) => (c.series.coordinateToPrice(y) as number | null) ?? NaN;
const yOf = (c: DCtx, p: number) => c.series.priceToCoordinate(p) ?? NaN;
const xOfIdx = (c: DCtx, i: number) => c.chart.timeScale().logicalToCoordinate(i as any) ?? NaN;
const idxOf = (c: DCtx, pt: Pt) => c.tm.toIndex(pt.t);
const pct = (a: number, b: number) => (a ? ((b - a) / a) * 100 : 0);
const sgn = (v: number) => (v > 0 ? '+' : '');
function arrowHead(g: Geo, a: XY, b: XY, color?: string, size = 10) {
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  const p = poly([{ x: b.x - size * Math.cos(ang - 0.45), y: b.y - size * Math.sin(ang - 0.45) }, b, { x: b.x - size * Math.cos(ang + 0.45), y: b.y - size * Math.sin(ang + 0.45) }]);
  g.strokes.push({ p, color });
}
const FIB_COLORS: Record<string, string> = { '0': '#787b86', '0.236': '#f23645', '0.382': '#ff9800', '0.5': '#4caf50', '0.618': '#089981', '0.786': '#00bcd4', '1': '#787b86', '1.272': '#9c27b0', '1.414': '#e91e63', '1.618': '#2962ff', '2': '#f23645', '2.618': '#9c27b0', '3.618': '#e91e63', '4.236': '#673ab7' };
const fc = (v: number) => FIB_COLORS[String(v)] || '#787b86';
const RETR = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618];
const EXT = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.272, 1.618, 2, 2.618];
const FAN = [0.25, 0.382, 0.5, 0.618, 0.75];
const ARC = [0.236, 0.382, 0.5, 0.618, 0.786, 1];

// ---------- Định nghĩa công cụ ----------
const I = (d: string) => d; // đường dẫn SVG (viewBox 0 0 24 24)
export const TOOL_DEFS: ToolDef[] = [
  // ===== Đường kẻ =====
  { id: 'trend', name: 'Đường xu hướng', group: 'lines', icon: I('M4 20L20 4M4 20m-1.5 0a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0M20 4m-1.5 0a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0'), pts: 2,
    build: (d, [a, b]) => { const g = geo(); g.strokes.push({ p: line(a, b, d.extL, d.extR) }); return g; } },
  { id: 'ray', name: 'Tia', group: 'lines', icon: I('M4 20L22 2M4 20m-1.5 0a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0'), pts: 2,
    build: (d, [a, b]) => { const g = geo(); g.strokes.push({ p: line(a, b, false, true) }); return g; } },
  { id: 'extended', name: 'Đường kéo dài', group: 'lines', icon: I('M1 23L23 1M8 16m-1.5 0a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0M16 8m-1.5 0a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0'), pts: 2,
    build: (d, [a, b]) => { const g = geo(); g.strokes.push({ p: line(a, b, true, true) }); return g; } },
  { id: 'infoline', name: 'Đường thông tin (Δ giá, %, số nến)', group: 'lines', icon: I('M4 20L20 4M13 20h8M13 17h6'), pts: 2,
    build: (d, [a, b], c) => {
      const g = geo(); g.strokes.push({ p: seg(a, b) });
      const dp = d.pts[1].p - d.pts[0].p, n = Math.round(idxOf(c, d.pts[1]) - idxOf(c, d.pts[0]));
      const ang = (Math.atan2(-(b.y - a.y), b.x - a.x) * 180) / Math.PI;
      g.texts.push({ x: b.x + 6, y: b.y, s: `${sgn(dp)}${fmtP(dp)} (${sgn(dp)}${pct(d.pts[0].p, d.pts[1].p).toFixed(2)}%) · ${n} nến · ${ang.toFixed(0)}°`, align: 'left', base: 'middle', bg: 'auto' });
      return g;
    } },
  { id: 'angle', name: 'Góc xu hướng', group: 'lines', icon: I('M3 20h18M3 20L18 6M10 20a7 7 0 0 0-2-5'), pts: 2,
    build: (d, [a, b]) => {
      const g = geo(); g.strokes.push({ p: seg(a, b) }); g.strokes.push({ p: seg(a, { x: a.x + 60, y: a.y }), dash: [3, 3] });
      const ang = Math.atan2(-(b.y - a.y), b.x - a.x); const arc = new Path2D(); arc.arc(a.x, a.y, 30, -ang, 0, ang < 0); g.strokes.push({ p: arc });
      g.texts.push({ x: a.x + 36, y: a.y - 6, s: `${((ang * 180) / Math.PI).toFixed(1)}°`, align: 'left', base: 'bottom' });
      return g;
    } },
  { id: 'hline', name: 'Đường ngang', group: 'lines', icon: I('M2 12h20M12 12m-1.5 0a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0'), pts: 1,
    build: (d, [a], c) => { const g = geo(); g.strokes.push({ p: seg({ x: -10, y: a.y }, { x: c.w + 10, y: a.y }) }); g.texts.push({ x: c.w - 4, y: a.y - 2, s: fmtP(d.pts[0].p), align: 'right', base: 'bottom', bold: true }); return g; } },
  { id: 'hray', name: 'Tia ngang', group: 'lines', icon: I('M6 12h16M6 12m-1.5 0a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0'), pts: 1,
    build: (d, [a], c) => { const g = geo(); g.strokes.push({ p: seg(a, { x: c.w + 10, y: a.y }) }); g.texts.push({ x: c.w - 4, y: a.y - 2, s: fmtP(d.pts[0].p), align: 'right', base: 'bottom', bold: true }); return g; } },
  { id: 'vline', name: 'Đường dọc', group: 'lines', icon: I('M12 2v20M12 12m-1.5 0a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0'), pts: 1,
    build: (d, [a], c) => { const g = geo(); g.strokes.push({ p: seg({ x: a.x, y: -10 }, { x: a.x, y: c.h + 10 }) }); return g; } },
  { id: 'crossline', name: 'Đường chữ thập', group: 'lines', icon: I('M2 12h20M12 2v20'), pts: 1,
    build: (d, [a], c) => { const g = geo(); g.strokes.push({ p: seg({ x: -10, y: a.y }, { x: c.w + 10, y: a.y }) }, { p: seg({ x: a.x, y: -10 }, { x: a.x, y: c.h + 10 }) }); g.texts.push({ x: c.w - 4, y: a.y - 2, s: fmtP(d.pts[0].p), align: 'right', base: 'bottom' }); return g; } },
  { id: 'arrow', name: 'Mũi tên', group: 'lines', icon: I('M4 20L20 4M20 4h-7M20 4v7'), pts: 2,
    build: (d, [a, b]) => { const g = geo(); g.strokes.push({ p: seg(a, b) }); arrowHead(g, a, b, undefined, 12); return g; } },
  { id: 'channel', name: 'Kênh song song', group: 'channels', icon: I('M2 16L16 4M8 22L22 10M5 19L19 7'), pts: 3,
    build: (d, P) => {
      const [a, b] = P; const c3 = P[2] || b; const g = geo();
      const slope = b.x === a.x ? 0 : (b.y - a.y) / (b.x - a.x); const dy = c3.y - (a.y + slope * (c3.x - a.x));
      const a2 = { x: a.x, y: a.y + dy }, b2 = { x: b.x, y: b.y + dy };
      g.fills.push({ p: poly([a, b, b2, a2], true), alpha: 0.12 });
      g.strokes.push({ p: line(a, b, d.extL, d.extR) }, { p: line(a2, b2, d.extL, d.extR) }, { p: line(mid(a, a2), mid(b, b2), d.extL, d.extR), dash: [4, 4] });
      return g;
    },
    handles: (d, P) => { if (P.length < 3) return P; const [a, b, c3] = P; const slope = b.x === a.x ? 0 : (b.y - a.y) / (b.x - a.x); return [a, b, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + (c3.y - (a.y + slope * (c3.x - a.x))) }]; },
    drag: (d, k, pt, c) => { if (k === 2) { d.pts[2] = { t: c.tm.toTime((idxOf(c, d.pts[0]) + idxOf(c, d.pts[1])) / 2), p: pt.p }; } else d.pts[k] = pt; } },
  { id: 'regression', name: 'Kênh hồi quy tuyến tính', group: 'channels', icon: I('M2 18L22 6M2 22L22 10M2 14L22 2'), pts: 2,
    build: (d, P, c) => {
      const g = geo(); const [a, b] = P;
      let i0 = Math.round(idxOf(c, d.pts[0])), i1 = Math.round(idxOf(c, d.pts[1])); if (i0 > i1) [i0, i1] = [i1, i0];
      i0 = Math.max(0, i0); i1 = Math.min(c.closes.length - 1, i1);
      const n = i1 - i0 + 1;
      if (n < 3) { g.strokes.push({ p: seg(a, b), dash: [4, 4] }); return g; }
      let sx = 0, sy = 0, sxy = 0, sxx = 0;
      for (let i = i0; i <= i1; i++) { const x = i - i0, y = c.closes[i]; sx += x; sy += y; sxy += x * y; sxx += x * x; }
      const k = (n * sxy - sx * sy) / (n * sxx - sx * sx || 1), m = (sy - k * sx) / n;
      let sd = 0; for (let i = i0; i <= i1; i++) sd += (c.closes[i] - (m + k * (i - i0))) ** 2; sd = Math.sqrt(sd / n);
      const L = (off: number) => [{ x: xOfIdx(c, i0), y: yOf(c, m + off) }, { x: xOfIdx(c, i1), y: yOf(c, m + k * (n - 1) + off) }] as [XY, XY];
      const [u0, u1] = L(2 * sd), [l0, l1] = L(-2 * sd), [m0, m1] = L(0);
      g.fills.push({ p: poly([u0, u1, l1, l0], true), alpha: 0.1 });
      g.strokes.push({ p: line(u0, u1, false, d.extR) }, { p: line(l0, l1, false, d.extR) }, { p: line(m0, m1, false, d.extR), dash: [5, 4] });
      return g;
    } },
  { id: 'pitchfork', name: 'Pitchfork (Andrews)', group: 'channels', icon: I('M3 12L21 12M3 12L21 4M3 12L21 20'), pts: 3,
    build: (d, P) => pitch(P, false) },
  { id: 'schiff', name: 'Pitchfork Schiff', group: 'channels', icon: I('M3 16L21 12M3 16L21 4M3 16L21 20'), pts: 3,
    build: (d, P) => pitch(P, true) },
  // ===== Fibonacci =====
  { id: 'fib', name: 'Fibonacci thoái lui', group: 'fib', icon: I('M3 4h18M3 9h18M3 14h18M3 20h18M4 20L20 4'), pts: 2,
    build: (d, P, c) => {
      const g = geo(); const [a, b] = P; const x1 = Math.min(a.x, b.x), x2 = d.extR ? c.w : Math.max(a.x, b.x);
      const p0 = d.pts[0].p, p1 = d.pts[1].p;
      let prevY: number | null = null;
      RETR.forEach((lv) => {
        const price = p1 + (p0 - p1) * lv, y = yOf(c, price);
        if (prevY !== null && d.fill !== false) { const r = new Path2D(); r.rect(x1, Math.min(prevY, y), x2 - x1, Math.abs(y - prevY)); g.fills.push({ p: r, color: fc(lv), alpha: 0.08 }); }
        g.strokes.push({ p: seg({ x: x1, y }, { x: x2, y }), color: fc(lv), width: 1 });
        g.texts.push({ x: x1 - 4, y, s: `${lv} (${fmtP(price)})`, align: 'right', base: 'middle', color: fc(lv), size: 10 });
        prevY = y;
      });
      g.strokes.push({ p: seg(a, b), dash: [4, 4] });
      return g;
    } },
  { id: 'fibext', name: 'Fibonacci mở rộng dựa trên xu hướng', group: 'fib', icon: I('M3 20L9 6L15 14M3 4h18M3 9h18'), pts: 3,
    build: (d, P, c) => {
      const g = geo(); const [a, b] = P; const c3 = P[2] || b;
      g.strokes.push({ p: poly([a, b, c3]), dash: [4, 4] });
      if (P.length < 3) return g;
      const pA = d.pts[0].p, pB = d.pts[1].p, pC = d.pts[2].p;
      const x1 = Math.min(b.x, c3.x), x2 = d.extR ? c.w : Math.max(c3.x + (c3.x - a.x) * 0.5, c3.x + 60);
      EXT.forEach((lv) => {
        const price = pC + (pB - pA) * lv, y = yOf(c, price);
        g.strokes.push({ p: seg({ x: x1, y }, { x: x2, y }), color: fc(lv), width: 1 });
        g.texts.push({ x: x2 + 4, y, s: `${lv} (${fmtP(price)})`, align: 'left', base: 'middle', color: fc(lv), size: 10 });
      });
      return g;
    } },
  { id: 'fibchannel', name: 'Kênh Fibonacci', group: 'fib', icon: I('M2 18L14 6M6 22L18 10M10 24L22 12'), pts: 3,
    build: (d, P) => {
      const g = geo(); const [a, b] = P; const c3 = P[2] || b;
      const slope = b.x === a.x ? 0 : (b.y - a.y) / (b.x - a.x); const dy = c3.y - (a.y + slope * (c3.x - a.x));
      [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618, 2.618].forEach((lv) => g.strokes.push({ p: line({ x: a.x, y: a.y + dy * lv }, { x: b.x, y: b.y + dy * lv }, false, true), color: fc(lv), width: 1 }));
      return g;
    } },
  { id: 'fibtime', name: 'Fibonacci vùng thời gian', group: 'fib', icon: I('M4 3v18M7 3v18M10 3v18M15 3v18M22 3v18'), pts: 2,
    build: (d, P, c) => {
      const g = geo(); const [a, b] = P; const dx = b.x - a.x;
      [0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89].forEach((n, i) => { const x = a.x + dx * n; g.strokes.push({ p: seg({ x, y: 0 }, { x, y: c.h }), color: Object.values(FIB_COLORS)[i % 10], width: 1 }); g.texts.push({ x: x + 3, y: c.h - 4, s: String(n), align: 'left', base: 'bottom', size: 10 }); });
      return g;
    } },
  { id: 'fibfan', name: 'Fibonacci kháng cự dạng quạt', group: 'fib', icon: I('M3 21L21 3M3 21L21 9M3 21L21 15M3 21L15 3'), pts: 2,
    build: (d, [a, b]) => {
      const g = geo();
      FAN.forEach((lv) => {
        g.strokes.push({ p: line(a, { x: b.x, y: a.y + (b.y - a.y) * lv }, false, true), color: fc(lv), width: 1 });
        g.strokes.push({ p: line(a, { x: a.x + (b.x - a.x) * lv, y: b.y }, false, true), color: fc(lv), width: 1 });
      });
      g.strokes.push({ p: line(a, b, false, true) });
      const r = new Path2D(); r.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y)); g.strokes.push({ p: r, dash: [3, 3], width: 1 });
      return g;
    } },
  { id: 'fibtrendtime', name: 'Fibonacci vùng thời gian dựa trên xu hướng', group: 'fib', icon: I('M3 20L9 6L13 14M15 3v18M18 3v18M22 3v18'), pts: 3,
    build: (d, P, c) => {
      const g = geo(); const [a, b] = P; const c3 = P[2] || b;
      g.strokes.push({ p: poly([a, b, c3]), dash: [4, 4] });
      if (P.length < 3) return g;
      const dx = b.x - a.x;
      [0, 0.382, 0.5, 0.618, 1, 1.382, 1.618, 2, 2.382, 2.618, 3, 3.618, 4.236].forEach((lv) => { const x = c3.x + dx * lv; g.strokes.push({ p: seg({ x, y: 0 }, { x, y: c.h }), color: fc(lv), width: 1 }); g.texts.push({ x: x + 3, y: 14, s: String(lv), align: 'left', base: 'top', size: 10, color: fc(lv) }); });
      return g;
    } },
  { id: 'fibcircle', name: 'Các vòng Fibonacci', group: 'fib', icon: I('M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0M12 12m-5 0a5 5 0 1 0 10 0a5 5 0 1 0-10 0'), pts: 2,
    build: (d, [a, b]) => {
      const g = geo(); const r0 = dist(a, b); const cx = mid(a, b);
      [0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618, 2.618].forEach((lv) => { const p = new Path2D(); p.arc(cx.x, cx.y, (r0 / 2) * lv * 2, 0, Math.PI * 2); g.strokes.push({ p, color: fc(lv), width: 1 }); });
      g.strokes.push({ p: seg(a, b), dash: [4, 4] });
      return g;
    } },
  { id: 'fibspiral', name: 'Fibonacci hình xoắn ốc', group: 'fib', icon: I('M12 12a2 2 0 1 1 2-2a4 4 0 1 1-4-4a7 7 0 1 1 7 7'), pts: 2,
    build: (d, [a, b]) => {
      const g = geo(); const r1 = dist(a, b); if (r1 < 1) return g;
      const th0 = Math.atan2(b.y - a.y, b.x - a.x), k = Math.log(1.618034) / (Math.PI / 2);
      const pts: XY[] = [];
      for (let th = -6 * Math.PI; th <= 2.5 * Math.PI; th += 0.05) { const r = r1 * Math.exp(k * th); pts.push({ x: a.x + r * Math.cos(th0 + th), y: a.y + r * Math.sin(th0 + th) }); }
      g.strokes.push({ p: poly(pts) }, { p: seg(a, b), dash: [4, 4] });
      return g;
    } },
  { id: 'fibarc', name: 'Fibonacci kháng cự dạng cung', group: 'fib', icon: I('M3 20a9 9 0 0 1 18 0M7 20a5 5 0 0 1 10 0'), pts: 2,
    build: (d, [a, b]) => {
      const g = geo(); const r0 = dist(a, b); const ang = Math.atan2(a.y - b.y, a.x - b.x);
      ARC.forEach((lv) => { const p = new Path2D(); p.arc(b.x, b.y, r0 * lv, ang - Math.PI / 2, ang + Math.PI / 2); g.strokes.push({ p, color: fc(lv), width: 1 }); });
      g.strokes.push({ p: seg(a, b), dash: [4, 4] });
      return g;
    } },
  { id: 'fibwedge', name: 'Fibonacci hình cái nêm', group: 'fib', icon: I('M3 20L21 4M3 20L21 16M14 9.5a12 12 0 0 1 1.5 8'), pts: 3,
    build: (d, P) => {
      const g = geo(); const [a, b] = P; const c3 = P[2] || b; const r0 = dist(a, b);
      g.strokes.push({ p: seg(a, b) }, { p: line(a, c3, false, false) });
      if (P.length < 3) return g;
      const a1 = Math.atan2(b.y - a.y, b.x - a.x), a2 = Math.atan2(c3.y - a.y, c3.x - a.x);
      ARC.forEach((lv) => { const p = new Path2D(); p.arc(a.x, a.y, r0 * lv, a1, a2, ((a2 - a1 + Math.PI * 3) % (Math.PI * 2)) - Math.PI > 0); g.strokes.push({ p, color: fc(lv), width: 1 }); });
      return g;
    } },
  { id: 'pitchfan', name: 'Mô hình Pitchfork dạng quạt', group: 'fib', icon: I('M3 12L21 4M3 12L21 9M3 12L21 15M3 12L21 20'), pts: 3,
    build: (d, P) => {
      const g = geo(); const [a, b] = P; const c3 = P[2] || b;
      g.strokes.push({ p: seg(b, c3), dash: [4, 4] });
      [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1].forEach((lv) => g.strokes.push({ p: line(a, lerp(b, c3, lv), false, true), color: fc(lv), width: 1 }));
      return g;
    } },
  // ===== Gann =====
  { id: 'gannbox', name: 'Mô hình Hộp Gann', group: 'fib', icon: I('M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18'), pts: 2,
    build: (d, [a, b]) => {
      const g = geo(); const x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x), y1 = Math.min(a.y, b.y), y2 = Math.max(a.y, b.y);
      const lv = [0, 0.25, 0.382, 0.5, 0.618, 0.75, 1];
      lv.forEach((v) => {
        const x = x1 + (x2 - x1) * v, y = y1 + (y2 - y1) * v;
        g.strokes.push({ p: seg({ x, y: y1 }, { x, y: y2 }), color: fc(v), width: 1 }, { p: seg({ x: x1, y }, { x: x2, y }), color: fc(v), width: 1 });
        g.texts.push({ x, y: y2 + 2, s: String(v), base: 'top', size: 9, color: fc(v) }); g.texts.push({ x: x1 - 3, y, s: String(v), align: 'right', base: 'middle', size: 9, color: fc(v) });
      });
      const r = new Path2D(); r.rect(x1, y1, x2 - x1, y2 - y1); g.fills.push({ p: r, alpha: 0.05 });
      return g;
    } },
  { id: 'gannfixed', name: 'Khu vực Gann cố định (hình vuông)', group: 'fib', icon: I('M3 3h18v18H3zM3 3l18 18M21 3L3 21M3 12h18M12 3v18'), pts: 2,
    build: (d, [a, b]) => { const s = Math.max(Math.abs(b.x - a.x), 4); return gannSquare(a, { x: a.x + s * Math.sign(b.x - a.x || 1), y: a.y + s * Math.sign(b.y - a.y || 1) }); } },
  { id: 'gannsquare', name: 'Mô hình Gann vuông', group: 'fib', icon: I('M3 3h18v18H3zM3 3l18 18M21 3L3 21M3 3l18 9M3 3l9 18'), pts: 2,
    build: (d, [a, b]) => gannSquare(a, b) },
  { id: 'gannfan', name: 'Quạt Gann', group: 'fib', icon: I('M3 21L21 3M3 21L21 12M3 21L12 3M3 21L21 17M3 21L17 3'), pts: 2,
    build: (d, [a, b]) => {
      const g = geo(); const dx = b.x - a.x, dy = b.y - a.y;
      const R: [number, number, string][] = [[1, 8, '1/8'], [1, 4, '1/4'], [1, 3, '1/3'], [1, 2, '1/2'], [1, 1, '1/1'], [2, 1, '2/1'], [3, 1, '3/1'], [4, 1, '4/1'], [8, 1, '8/1']];
      R.forEach(([px, tx, lb], i) => {
        const e = { x: a.x + dx * (px <= tx ? 1 : tx / px), y: a.y + dy * (px <= tx ? px / tx : 1) };
        g.strokes.push({ p: line(a, e, false, true), color: Object.values(FIB_COLORS)[i % 12], width: 1 });
        g.texts.push({ x: e.x + 3, y: e.y, s: lb, align: 'left', base: 'middle', size: 9 });
      });
      return g;
    } },
  // ===== Mô hình =====
  { id: 'xabcd', name: 'Mô hình XABCD (Harmonic)', group: 'patterns', icon: I('M2 18L7 6L12 14L17 4L22 16'), pts: 5, build: (d, P, c) => harmonic(d, P, c, ['X', 'A', 'B', 'C', 'D']) },
  { id: 'abcd', name: 'Mô hình ABCD', group: 'patterns', icon: I('M3 18L9 6L15 14L21 4'), pts: 4, build: (d, P, c) => harmonic(d, P, c, ['A', 'B', 'C', 'D']) },
  { id: 'trianglep', name: 'Mô hình tam giác', group: 'patterns', icon: I('M2 6L6 18L10 9L14 16L18 11L22 14M2 6L22 13M6 18L22 14'), pts: 4,
    build: (d, P) => { const g = geo(); g.strokes.push({ p: poly(P) }); if (P.length >= 4) { g.strokes.push({ p: line(P[0], P[2], false, true), dash: [4, 4] }, { p: line(P[1], P[3], false, true), dash: [4, 4] }); g.fills.push({ p: poly(P, true), alpha: 0.08 }); } return g; } },
  { id: 'hs', name: 'Vai – Đầu – Vai', group: 'patterns', icon: I('M2 18L5 11L8 15L12 4L16 15L19 11L22 18M3 15h19'), pts: 7,
    build: (d, P) => {
      const g = geo(); g.strokes.push({ p: poly(P) });
      if (P.length >= 5) g.strokes.push({ p: line(P[2], P[4], true, true), dash: [5, 4] });
      const lb = ['', 'Vai trái', '', 'Đầu', '', 'Vai phải', ''];
      P.forEach((q, i) => lb[i] && g.texts.push({ x: q.x, y: q.y - 8, s: lb[i], base: 'bottom', bold: true }));
      if (P.length >= 7) g.fills.push({ p: poly(P, true), alpha: 0.07 });
      return g;
    } },
  { id: 'elliott5', name: 'Sóng đẩy Elliott (1-2-3-4-5)', group: 'patterns', icon: I('M2 20L6 12L8 15L14 4L16 9L22 2'), pts: 6, build: (d, P) => wave(P, ['0', '1', '2', '3', '4', '5']) },
  { id: 'elliottabc', name: 'Sóng điều chỉnh Elliott (A-B-C)', group: 'patterns', icon: I('M3 4L9 16L14 9L21 20'), pts: 4, build: (d, P) => wave(P, ['0', 'A', 'B', 'C']) },
  { id: 'elliotttri', name: 'Tam giác Elliott (A-B-C-D-E)', group: 'patterns', icon: I('M2 4L6 18L10 7L14 15L18 9L22 13'), pts: 6, build: (d, P) => wave(P, ['0', 'A', 'B', 'C', 'D', 'E']) },
  // ===== Dự báo & đo lường =====
  { id: 'long', name: 'Vị thế Mua (Long)', group: 'measure', icon: I('M3 4h18v8H3zM3 12h18v8H3z'), pts: 1, hint: 'bấm vào giá vào lệnh · kéo các điểm neo để chỉnh mục tiêu/dừng lỗ',
    create: (pt, c, color) => position(pt, c, color, 'long'), build: (d, P, c) => positionGeo(d, c, 'long'), handles: (d, P, c) => positionHandles(d, c), drag: (d, k, pt) => positionDrag(d, k, pt) },
  { id: 'short', name: 'Vị thế Bán (Short)', group: 'measure', icon: I('M3 4h18v8H3zM3 12h18v8H3z'), pts: 1, hint: 'bấm vào giá vào lệnh · kéo các điểm neo để chỉnh mục tiêu/dừng lỗ',
    create: (pt, c, color) => position(pt, c, color, 'short'), build: (d, P, c) => positionGeo(d, c, 'short'), handles: (d, P, c) => positionHandles(d, c), drag: (d, k, pt) => positionDrag(d, k, pt) },
  { id: 'pricerange', name: 'Đo khoảng giá', group: 'measure', icon: I('M12 3v18M8 7l4-4l4 4M8 17l4 4l4-4'), pts: 2,
    build: (d, [a, b]) => {
      const g = geo(); const dp = d.pts[1].p - d.pts[0].p; const col = dp >= 0 ? '#2962ff' : '#f23645';
      const r = new Path2D(); r.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y)); g.fills.push({ p: r, color: col, alpha: 0.15 });
      const mx = (a.x + b.x) / 2; g.strokes.push({ p: seg({ x: mx, y: a.y }, { x: mx, y: b.y }), color: col }); arrowHead(g, { x: mx, y: a.y }, { x: mx, y: b.y }, col, 8);
      g.texts.push({ x: mx, y: dp >= 0 ? Math.min(a.y, b.y) - 4 : Math.max(a.y, b.y) + 4, s: `${sgn(dp)}${fmtP(dp)} (${sgn(dp)}${pct(d.pts[0].p, d.pts[1].p).toFixed(2)}%)`, base: dp >= 0 ? 'bottom' : 'top', bg: col, color: '#fff' });
      return g;
    } },
  { id: 'daterange', name: 'Đo khoảng thời gian', group: 'measure', icon: I('M3 12h18M7 8l-4 4l4 4M17 8l4 4l-4 4'), pts: 2,
    build: (d, [a, b], c) => {
      const g = geo(); const n = Math.round(idxOf(c, d.pts[1]) - idxOf(c, d.pts[0]));
      const r = new Path2D(); r.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y)); g.fills.push({ p: r, color: '#2962ff', alpha: 0.15 });
      const my = (a.y + b.y) / 2; g.strokes.push({ p: seg({ x: a.x, y: my }, { x: b.x, y: my }), color: '#2962ff' }); arrowHead(g, { x: a.x, y: my }, { x: b.x, y: my }, '#2962ff', 8);
      const days = Math.abs(d.pts[1].t - d.pts[0].t) / 86400;
      g.texts.push({ x: (a.x + b.x) / 2, y: Math.max(a.y, b.y) + 4, s: `${n} nến · ${days >= 1 ? days.toFixed(0) + ' ngày' : (days * 24 * 60).toFixed(0) + ' phút'}`, base: 'top', bg: '#2962ff', color: '#fff' });
      return g;
    } },
  { id: 'measure', name: 'Đo giá & thời gian', group: 'measure', icon: I('M4 4h16v16H4zM4 4l16 16'), pts: 2,
    build: (d, [a, b], c) => {
      const g = geo(); const dp = d.pts[1].p - d.pts[0].p; const col = dp >= 0 ? '#2962ff' : '#f23645';
      const n = Math.round(idxOf(c, d.pts[1]) - idxOf(c, d.pts[0]));
      const r = new Path2D(); r.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y)); g.fills.push({ p: r, color: col, alpha: 0.15 });
      g.strokes.push({ p: seg({ x: (a.x + b.x) / 2, y: a.y }, { x: (a.x + b.x) / 2, y: b.y }), color: col }, { p: seg({ x: a.x, y: (a.y + b.y) / 2 }, { x: b.x, y: (a.y + b.y) / 2 }), color: col });
      g.texts.push({ x: (a.x + b.x) / 2, y: dp >= 0 ? Math.min(a.y, b.y) - 4 : Math.max(a.y, b.y) + 4, s: `${sgn(dp)}${fmtP(dp)} (${sgn(dp)}${pct(d.pts[0].p, d.pts[1].p).toFixed(2)}%) · ${n} nến`, base: dp >= 0 ? 'bottom' : 'top', bg: col, color: '#fff' });
      return g;
    } },
  // ===== Hình học =====
  { id: 'rect', name: 'Hình chữ nhật', group: 'shapes', icon: I('M3 6h18v12H3z'), pts: 2, defaults: { fill: true },
    build: (d, [a, b], c) => { const g = geo(); const x2 = d.extR ? c.w : b.x; const r = new Path2D(); r.rect(a.x, a.y, x2 - a.x, b.y - a.y); if (d.fill !== false) g.fills.push({ p: r, alpha: 0.15 }); g.strokes.push({ p: r }); return g; },
    handles: (d, [a, b]) => [a, b, { x: a.x, y: b.y }, { x: b.x, y: a.y }],
    drag: (d, k, pt) => { if (k < 2) d.pts[k] = pt; else if (k === 2) { d.pts[0] = { t: pt.t, p: d.pts[0].p }; d.pts[1] = { t: d.pts[1].t, p: pt.p }; } else { d.pts[1] = { t: pt.t, p: d.pts[1].p }; d.pts[0] = { t: d.pts[0].t, p: pt.p }; } } },
  { id: 'circle', name: 'Hình tròn', group: 'shapes', icon: I('M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0'), pts: 2, defaults: { fill: true },
    build: (d, [a, b]) => { const g = geo(); const p = new Path2D(); p.arc(a.x, a.y, dist(a, b), 0, Math.PI * 2); if (d.fill !== false) g.fills.push({ p, alpha: 0.12 }); g.strokes.push({ p }); return g; } },
  { id: 'ellipse', name: 'Hình elip', group: 'shapes', icon: I('M12 12m-10 0a10 6 0 1 0 20 0a10 6 0 1 0-20 0'), pts: 2, defaults: { fill: true },
    build: (d, [a, b]) => { const g = geo(); const p = new Path2D(); p.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2 || 1, Math.abs(b.y - a.y) / 2 || 1, 0, 0, Math.PI * 2); if (d.fill !== false) g.fills.push({ p, alpha: 0.12 }); g.strokes.push({ p }); return g; } },
  { id: 'triangle', name: 'Tam giác', group: 'shapes', icon: I('M12 3L22 21H2z'), pts: 3, defaults: { fill: true },
    build: (d, P) => { const g = geo(); const p = poly(P, P.length >= 3); if (d.fill !== false && P.length >= 3) g.fills.push({ p, alpha: 0.12 }); g.strokes.push({ p }); return g; } },
  { id: 'path', name: 'Đường gấp khúc (nhấp đúp / Enter để kết thúc)', group: 'shapes', icon: I('M2 18L7 8L12 14L17 6L22 10'), pts: 'multi',
    build: (d, P) => { const g = geo(); g.strokes.push({ p: poly(P) }); if (P.length > 1) arrowHead(g, P[P.length - 2], P[P.length - 1]); return g; } },
  { id: 'brush', name: 'Bút vẽ tự do', group: 'shapes', icon: I('M3 21c3 0 4-2 5-4s3-3 5-1M14 14l7-7l-3-3l-7 7'), pts: 'free',
    build: (d, P) => { const g = geo(); g.strokes.push({ p: poly(P) }); return g; }, handles: () => [] },
  { id: 'highlighter', name: 'Bút dạ quang', group: 'shapes', icon: I('M4 20h6M6 17l9-12l4 3l-9 12z'), pts: 'free', defaults: { width: 10 },
    build: (d, P) => { const g = geo(); g.strokes.push({ p: poly(P), width: d.width || 10 }); return g; }, handles: () => [] },
  // ===== Chú thích =====
  { id: 'text', name: 'Văn bản', group: 'text', icon: I('M5 5h14M12 5v14'), pts: 1,
    build: (d, [a]) => { const g = geo(); g.texts.push({ x: a.x, y: a.y, s: d.text || 'Văn bản', align: 'left', base: 'middle', size: 13, bold: true, color: d.color }); return g; } },
  { id: 'callout', name: 'Chú thích có mũi tên', group: 'text', icon: I('M3 4h18v10H9l-4 5v-5H3z'), pts: 2,
    build: (d, [a, b]) => { const g = geo(); g.strokes.push({ p: seg(a, b) }); g.texts.push({ x: b.x, y: b.y, s: d.text || 'Ghi chú', bg: d.color, color: '#fff', base: 'middle', size: 12, bold: true }); return g; } },
  { id: 'pricelabel', name: 'Nhãn giá', group: 'text', icon: I('M3 8h13l5 4l-5 4H3z'), pts: 1,
    build: (d, [a]) => { const g = geo(); const s = fmtP(d.pts[0].p); g.strokes.push({ p: seg(a, { x: a.x + 10, y: a.y - 10 }) }); g.texts.push({ x: a.x + 10, y: a.y - 10, s, bg: d.color, color: '#fff', align: 'left', base: 'bottom', bold: true }); return g; } },
  { id: 'arrowup', name: 'Mũi tên tăng', group: 'text', icon: I('M12 3l7 9h-4v9H9v-9H5z'), pts: 1, defaults: { color: '#089981' },
    build: (d, [a]) => { const g = geo(); const p = poly([{ x: a.x, y: a.y }, { x: a.x + 8, y: a.y + 10 }, { x: a.x + 3, y: a.y + 10 }, { x: a.x + 3, y: a.y + 20 }, { x: a.x - 3, y: a.y + 20 }, { x: a.x - 3, y: a.y + 10 }, { x: a.x - 8, y: a.y + 10 }], true); g.fills.push({ p, alpha: 1 }); if (d.text) g.texts.push({ x: a.x, y: a.y + 24, s: d.text, base: 'top', bold: true, color: d.color }); return g; } },
  { id: 'arrowdown', name: 'Mũi tên giảm', group: 'text', icon: I('M12 21l7-9h-4V3H9v9H5z'), pts: 1, defaults: { color: '#f23645' },
    build: (d, [a]) => { const g = geo(); const p = poly([{ x: a.x, y: a.y }, { x: a.x + 8, y: a.y - 10 }, { x: a.x + 3, y: a.y - 10 }, { x: a.x + 3, y: a.y - 20 }, { x: a.x - 3, y: a.y - 20 }, { x: a.x - 3, y: a.y - 10 }, { x: a.x - 8, y: a.y - 10 }], true); g.fills.push({ p, alpha: 1 }); if (d.text) g.texts.push({ x: a.x, y: a.y - 24, s: d.text, base: 'bottom', bold: true, color: d.color }); return g; } },
  { id: 'flag', name: 'Cờ đánh dấu', group: 'text', icon: I('M5 21V4M5 4h12l-3 4l3 4H5'), pts: 1,
    build: (d, [a]) => { const g = geo(); g.strokes.push({ p: seg(a, { x: a.x, y: a.y - 26 }) }); g.fills.push({ p: poly([{ x: a.x, y: a.y - 26 }, { x: a.x + 16, y: a.y - 21 }, { x: a.x, y: a.y - 16 }], true), alpha: 1 }); return g; } },
];
export const EMOJIS = ['👍', '👎', '🚀', '🔥', '⚠️', '✅', '❌', '⭐', '💰', '🎯', '📈', '📉', '🐂', '🐻', '❓', '💡'];
const emojiDef: ToolDef = { id: 'emoji', name: 'Biểu tượng', group: 'emoji', icon: '', pts: 1,
  build: (d, [a]) => { const g = geo(); g.texts.push({ x: a.x, y: a.y, s: d.text || '⭐', size: (d.width || 2) * 10 + 8, base: 'middle' }); return g; } };

export const GROUPS: { id: string; name: string }[] = [
  { id: 'lines', name: 'Đường xu hướng' }, { id: 'channels', name: 'Kênh & Pitchfork' }, { id: 'fib', name: 'Fibonacci & Gann' },
  { id: 'patterns', name: 'Mô hình' }, { id: 'measure', name: 'Dự báo & đo lường' }, { id: 'shapes', name: 'Hình học & bút vẽ' },
  { id: 'text', name: 'Chú thích' }, { id: 'emoji', name: 'Biểu tượng cảm xúc' },
];
export const defOf = (type: string): ToolDef | undefined => (type.startsWith('emoji') ? emojiDef : TOOL_DEFS.find((t) => t.id === type));
export const toolName = (tool: string) => (tool.startsWith('emoji:') ? `Biểu tượng ${tool.slice(6)}` : defOf(tool)?.name || tool);
export const toolPts = (tool: string) => (tool.startsWith('emoji:') ? 1 : defOf(tool)?.pts ?? 0);

// ---------- Các hàm dựng phức tạp ----------
function pitch(P: XY[], schiff: boolean): Geo {
  const g = geo(); const [a0, b] = P; const c3 = P[2] || b;
  const a = schiff ? mid(a0, b) : a0; const m = mid(b, c3);
  g.strokes.push({ p: seg(b, c3), dash: [4, 4] }, { p: line(a, m, false, true) });
  const dx = m.x - a.x, dy = m.y - a.y;
  g.strokes.push({ p: line(b, { x: b.x + dx, y: b.y + dy }, false, true) }, { p: line(c3, { x: c3.x + dx, y: c3.y + dy }, false, true) });
  g.fills.push({ p: poly([b, far(b, { x: b.x + dx, y: b.y + dy }, 50), far(c3, { x: c3.x + dx, y: c3.y + dy }, 50), c3], true), alpha: 0.06 });
  return g;
}
function gannSquare(a: XY, b: XY): Geo {
  const g = geo(); const x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x), y1 = Math.min(a.y, b.y), y2 = Math.max(a.y, b.y);
  const r = new Path2D(); r.rect(x1, y1, x2 - x1, y2 - y1); g.strokes.push({ p: r }); g.fills.push({ p: r, alpha: 0.05 });
  for (const v of [0.25, 0.5, 0.75]) { g.strokes.push({ p: seg({ x: x1 + (x2 - x1) * v, y: y1 }, { x: x1 + (x2 - x1) * v, y: y2 }), width: 1, dash: [2, 3] }, { p: seg({ x: x1, y: y1 + (y2 - y1) * v }, { x: x2, y: y1 + (y2 - y1) * v }), width: 1, dash: [2, 3] }); }
  const C = [{ x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }];
  g.strokes.push({ p: seg(C[0], C[2]), color: '#ff9800', width: 1 }, { p: seg(C[1], C[3]), color: '#ff9800', width: 1 });
  for (const v of [0.5]) { g.strokes.push({ p: seg(C[3], { x: x2, y: y1 + (y2 - y1) * v }), color: '#089981', width: 1 }, { p: seg(C[3], { x: x1 + (x2 - x1) * v, y: y1 }), color: '#089981', width: 1 }); }
  const arc = new Path2D(); arc.ellipse(x1, y2, x2 - x1, y2 - y1, 0, -Math.PI / 2, 0); g.strokes.push({ p: arc, color: '#2962ff', width: 1 });
  return g;
}
function harmonic(d: Drawing, P: XY[], c: DCtx, names: string[]): Geo {
  const g = geo(); g.strokes.push({ p: poly(P) });
  const pr = d.pts.map((p) => p.p);
  const ratio = (i: number, j: number, k: number) => { const den = Math.abs(pr[j] - pr[i]); return den ? Math.abs(pr[k] - pr[j]) / den : 0; };
  if (names[0] === 'X') {
    if (P.length >= 3) g.fills.push({ p: poly([P[0], P[1], P[2]], true), alpha: 0.12 });
    if (P.length >= 5) { g.fills.push({ p: poly([P[2], P[3], P[4]], true), alpha: 0.12 }); g.strokes.push({ p: seg(P[0], P[2]), dash: [3, 3], width: 1 }, { p: seg(P[2], P[4]), dash: [3, 3], width: 1 }, { p: seg(P[0], P[4]), dash: [3, 3], width: 1 }); }
    if (P.length >= 3) g.texts.push({ x: mid(P[0], P[2]).x, y: mid(P[0], P[2]).y, s: ratio(0, 1, 2).toFixed(3), size: 10, bg: 'auto' });
    if (P.length >= 4) g.texts.push({ x: mid(P[1], P[3]).x, y: mid(P[1], P[3]).y, s: ratio(1, 2, 3).toFixed(3), size: 10, bg: 'auto' });
    if (P.length >= 5) { g.texts.push({ x: mid(P[2], P[4]).x, y: mid(P[2], P[4]).y, s: ratio(2, 3, 4).toFixed(3), size: 10, bg: 'auto' }); const xa = Math.abs(pr[1] - pr[0]); g.texts.push({ x: mid(P[0], P[4]).x, y: mid(P[0], P[4]).y, s: (xa ? Math.abs(pr[4] - pr[1]) / xa : 0).toFixed(3), size: 10, bg: 'auto' }); }
  } else {
    if (P.length >= 3) g.texts.push({ x: mid(P[0], P[2]).x, y: mid(P[0], P[2]).y, s: ratio(0, 1, 2).toFixed(3), size: 10, bg: 'auto' });
    if (P.length >= 4) { g.texts.push({ x: mid(P[1], P[3]).x, y: mid(P[1], P[3]).y, s: ratio(1, 2, 3).toFixed(3), size: 10, bg: 'auto' }); g.strokes.push({ p: seg(P[0], P[2]), dash: [3, 3], width: 1 }, { p: seg(P[1], P[3]), dash: [3, 3], width: 1 }); }
  }
  P.forEach((q, i) => { const up = i > 0 ? q.y <= P[i - 1].y : P[1] ? q.y <= P[1].y : true; g.texts.push({ x: q.x, y: q.y + (up ? -8 : 8), s: names[i], base: up ? 'bottom' : 'top', bold: true }); });
  void c;
  return g;
}
function wave(P: XY[], names: string[]): Geo {
  const g = geo(); g.strokes.push({ p: poly(P) });
  P.forEach((q, i) => { const up = i > 0 ? q.y <= P[i - 1].y : P[1] ? q.y <= P[1].y : true; g.texts.push({ x: q.x, y: q.y + (up ? -8 : 8), s: `(${names[i]})`, base: up ? 'bottom' : 'top', bold: true }); });
  return g;
}
function position(pt: Pt, c: DCtx, color: string, kind: 'long' | 'short'): Drawing {
  const i = c.tm.toIndex(pt.t); const right = c.tm.toTime(i + 20);
  const tgt = kind === 'long' ? pt.p * 1.03 : pt.p * 0.97, stp = kind === 'long' ? pt.p * 0.985 : pt.p * 1.015;
  return { id: Math.random().toString(36).slice(2), type: kind, color, pts: [pt, { t: right, p: +tgt.toFixed(4) }, { t: right, p: +stp.toFixed(4) }] };
}
function positionGeo(d: Drawing, c: DCtx, kind: 'long' | 'short'): Geo {
  const g = geo(); const [E, T, S] = d.pts; if (!T || !S) return g;
  const x1 = xOfIdx(c, idxOf(c, E)), x2 = xOfIdx(c, idxOf(c, T)); const yE = yOf(c, E.p), yT = yOf(c, T.p), yS = yOf(c, S.p);
  const rt = new Path2D(); rt.rect(x1, Math.min(yE, yT), x2 - x1, Math.abs(yT - yE)); g.fills.push({ p: rt, color: '#089981', alpha: 0.22 });
  const rs = new Path2D(); rs.rect(x1, Math.min(yE, yS), x2 - x1, Math.abs(yS - yE)); g.fills.push({ p: rs, color: '#f23645', alpha: 0.22 });
  g.strokes.push({ p: seg({ x: x1, y: yE }, { x: x2, y: yE }), color: '#787b86', width: 1.5 });
  const rr = Math.abs(T.p - E.p) / (Math.abs(E.p - S.p) || 1);
  const tP = pct(E.p, T.p), sP = pct(E.p, S.p);
  const up = (kind === 'long') === (yT < yE);
  g.texts.push({ x: (x1 + x2) / 2, y: up ? Math.min(yT, yE) - 3 : Math.max(yT, yE) + 3, s: `Mục tiêu ${fmtP(T.p)} (${sgn(tP)}${tP.toFixed(2)}%)`, base: up ? 'bottom' : 'top', bg: '#089981', color: '#fff', size: 11 });
  g.texts.push({ x: (x1 + x2) / 2, y: up ? Math.max(yS, yE) + 3 : Math.min(yS, yE) - 3, s: `Dừng lỗ ${fmtP(S.p)} (${sgn(sP)}${sP.toFixed(2)}%)`, base: up ? 'top' : 'bottom', bg: '#f23645', color: '#fff', size: 11 });
  g.texts.push({ x: x2 + 4, y: yE, s: `${kind === 'long' ? 'MUA' : 'BÁN'} ${fmtP(E.p)} · R:R ${rr.toFixed(2)}`, align: 'left', base: 'middle', bg: '#787b86', color: '#fff', size: 11, bold: true });
  return g;
}
function positionHandles(d: Drawing, c: DCtx): XY[] {
  const [E, T, S] = d.pts; if (!T || !S) return [];
  const x1 = xOfIdx(c, idxOf(c, E)), x2 = xOfIdx(c, idxOf(c, T));
  return [{ x: x1, y: yOf(c, E.p) }, { x: x1, y: yOf(c, T.p) }, { x: x1, y: yOf(c, S.p) }, { x: x2, y: yOf(c, E.p) }];
}
function positionDrag(d: Drawing, k: number, pt: Pt) {
  const [E, T, S] = d.pts;
  if (k === 0) { const dp = pt.p - E.p; d.pts = [pt, { t: T.t, p: T.p + dp }, { t: S.t, p: S.p + dp }]; }
  else if (k === 1) d.pts[1] = { t: T.t, p: pt.p };
  else if (k === 2) d.pts[2] = { t: S.t, p: pt.p };
  else if (k === 3 && pt.t > E.t) { d.pts[1] = { t: pt.t, p: T.p }; d.pts[2] = { t: pt.t, p: S.p }; }
}

// ---------- Vẽ & chọn ----------
const toXY = (c: DCtx, pt: Pt): XY => ({ x: xOfIdx(c, c.tm.toIndex(pt.t)), y: yOf(c, pt.p) });
const DASH: Record<string, number[]> = { solid: [], dashed: [6, 4], dotted: [1.5, 3] };

function geoOf(d: Drawing, c: DCtx): { g: Geo; P: XY[] } | null {
  const def = defOf(d.type); if (!def) return null;
  const P = d.pts.map((pt) => toXY(c, pt));
  if (P.some((q) => !Number.isFinite(q.x) || !Number.isFinite(q.y))) return null;
  return { g: def.build(d, P, c), P };
}

function textBox(ctx: CanvasRenderingContext2D, t: Geo['texts'][0]) {
  ctx.font = `${t.bold ? '600 ' : ''}${t.size || 11}px system-ui, sans-serif`;
  const w = ctx.measureText(t.s).width, h = (t.size || 11) + 6;
  const al = t.align || 'center', bs = t.base || 'middle';
  const x = al === 'left' ? t.x : al === 'right' ? t.x - w : t.x - w / 2;
  const y = bs === 'top' ? t.y : bs === 'bottom' ? t.y - h : t.y - h / 2;
  return { x: x - 4, y, w: w + 8, h };
}

export function renderDrawing(ctx: CanvasRenderingContext2D, d: Drawing, c: DCtx, selected: boolean, hover = false) {
  const r = geoOf(d, c); if (!r) return;
  const { g, P } = r;
  const color = d.color || '#2962ff', width = (d.width || 1.5) + (hover && !selected ? 0.8 : 0);
  ctx.save();
  for (const f of g.fills) { ctx.globalAlpha = f.alpha ?? 0.15; ctx.fillStyle = f.color || color; ctx.fill(f.p); }
  ctx.globalAlpha = 1; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const s of g.strokes) {
    ctx.strokeStyle = s.color || color; ctx.lineWidth = s.width ? Math.max(s.width, d.type === 'highlighter' ? s.width : 1) : width;
    if (d.type === 'highlighter') ctx.globalAlpha = 0.35;
    ctx.setLineDash(s.dash || DASH[d.style || 'solid'] || []); ctx.stroke(s.p); ctx.globalAlpha = 1;
  }
  ctx.setLineDash([]);
  for (const t of g.texts) {
    const b = textBox(ctx, t);
    b.x = Math.min(Math.max(b.x, 2), c.w - b.w - 2); // giữ nhãn trong khung biểu đồ
    if (t.bg) { ctx.fillStyle = t.bg === 'auto' ? (c.dark ? 'rgba(17,21,28,.85)' : 'rgba(255,255,255,.85)') : t.bg; ctx.beginPath(); ctx.roundRect?.(b.x, b.y, b.w, b.h, 3); ctx.fill(); }
    ctx.fillStyle = t.color || (t.bg && t.bg !== 'auto' ? '#fff' : color); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(t.s, b.x + 4, b.y + b.h / 2);
  }
  if (selected) {
    const def = defOf(d.type)!;
    const H = def.handles ? def.handles(d, P, c) : P;
    for (const q of H) { ctx.beginPath(); ctx.arc(q.x, q.y, 5, 0, Math.PI * 2); ctx.fillStyle = c.dark ? '#11151c' : '#fff'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = d.locked ? '#787b86' : '#2962ff'; ctx.stroke(); }
  }
  ctx.restore();
}

let hitCtx: CanvasRenderingContext2D | null = null;
/** Tìm hình (và điểm neo) dưới con trỏ. Hình vẽ sau nằm trên => kiểm tra từ cuối danh sách */
export function hitDrawing(list: Drawing[], x: number, y: number, c: DCtx, selId?: string | null): { d: Drawing; handle: number } | null {
  if (!hitCtx) hitCtx = document.createElement('canvas').getContext('2d');
  const ctx = hitCtx!;
  const order = [...list].reverse();
  if (selId) { const s = list.find((d) => d.id === selId); if (s) order.unshift(s); }
  for (const d of order) {
    if (d.hidden) continue;
    const r = geoOf(d, c); if (!r) continue;
    const def = defOf(d.type)!;
    const H = def.handles ? def.handles(d, r.P, c) : r.P;
    if (d.id === selId) { const k = H.findIndex((q) => dist(q, { x, y }) <= 7); if (k >= 0) return { d, handle: k }; }
    ctx.lineWidth = Math.max(10, (d.width || 1.5) + 8);
    if (r.g.strokes.some((s) => ctx.isPointInStroke(s.p, x, y))) return { d, handle: -1 };
    if (r.g.fills.some((f) => (f.alpha ?? 0.15) >= 0.05 && ctx.isPointInPath(f.p, x, y))) return { d, handle: -1 };
    for (const t of r.g.texts) { const b = textBox(ctx, t); if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return { d, handle: -1 }; }
    const k = H.findIndex((q) => dist(q, { x, y }) <= 6); if (k >= 0) return { d, handle: k };
  }
  return null;
}

/** Kéo điểm neo k của hình */
export function dragHandle(d: Drawing, k: number, pt: Pt, c: DCtx): Drawing {
  const nd = { ...d, pts: d.pts.map((p) => ({ ...p })) };
  const def = defOf(d.type)!;
  if (def.drag) def.drag(nd, k, pt, c); else nd.pts[k] = pt;
  return nd;
}
/** Dời cả hình theo (Δ chỉ số nến, Δ giá) */
export function moveDrawing(orig: Drawing, dIdx: number, dP: number, c: DCtx): Drawing {
  return { ...orig, pts: orig.pts.map((p) => ({ t: c.tm.toTime(c.tm.toIndex(p.t) + dIdx), p: +(p.p + dP).toFixed(6) })) };
}
/** Tạo hình mới từ các điểm đã bấm */
export function makeDrawing(tool: string, pts: Pt[], color: string, c: DCtx): Drawing {
  const def = defOf(tool)!;
  if (def.create && pts.length === 1) return def.create(pts[0], c, color);
  const d: Drawing = { id: Math.random().toString(36).slice(2), type: tool.startsWith('emoji:') ? 'emoji' : tool, pts, color, ...(def.defaults || {}) };
  if (tool.startsWith('emoji:')) d.text = tool.slice(6);
  if (def.defaults?.color) d.color = def.defaults.color;
  return d;
}
export const hasText = (type: string) => ['text', 'callout', 'arrowup', 'arrowdown', 'emoji'].includes(type);
export const canFill = (type: string) => ['rect', 'circle', 'ellipse', 'triangle', 'fib'].includes(type);
export const canExtend = (type: string) => ['trend', 'channel', 'regression', 'fib', 'fibext', 'rect'].includes(type);

const KEY = (sym: string) => `draw:${sym}`;
export const loadDrawings = (sym: string): Drawing[] => { try { return JSON.parse(localStorage.getItem(KEY(sym)) || '[]'); } catch { return []; } };
export const saveDrawings = (sym: string, list: Drawing[]) => { try { localStorage.setItem(KEY(sym), JSON.stringify(list)); } catch { /* bỏ qua */ } };
