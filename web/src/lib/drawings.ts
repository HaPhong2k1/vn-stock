// Công cụ vẽ trên biểu đồ (kiểu TradingView/Fiant). Toạ độ lưu theo (thời gian nến, giá) để giữ nguyên khi đổi zoom/khung.
import type { IChartApi, ISeriesApi } from 'lightweight-charts';

export type Tool = 'cursor' | 'trend' | 'ray' | 'hline' | 'vline' | 'rect' | 'fib' | 'text' | 'measure' | 'eraser';
export interface Pt { t: number; p: number }
export interface Drawing { id: string; type: Exclude<Tool, 'cursor' | 'eraser'>; pts: Pt[]; color: string; text?: string }

export const TOOLS: { id: Tool; icon: string; name: string; pts: number }[] = [
  { id: 'cursor', icon: '↖', name: 'Con trỏ (kéo/zoom biểu đồ)', pts: 0 },
  { id: 'trend', icon: '╱', name: 'Đường xu hướng', pts: 2 },
  { id: 'ray', icon: '⟋→', name: 'Tia (kéo dài sang phải)', pts: 2 },
  { id: 'hline', icon: '─', name: 'Đường ngang (hỗ trợ/kháng cự)', pts: 1 },
  { id: 'vline', icon: '│', name: 'Đường dọc', pts: 1 },
  { id: 'rect', icon: '▭', name: 'Hình chữ nhật (vùng giá)', pts: 2 },
  { id: 'fib', icon: 'ƒ', name: 'Fibonacci thoái lui', pts: 2 },
  { id: 'measure', icon: '↕', name: 'Đo giá & thời gian', pts: 2 },
  { id: 'text', icon: 'T', name: 'Văn bản', pts: 1 },
  { id: 'eraser', icon: '⌫', name: 'Tẩy (bấm vào hình để xoá)', pts: 0 },
];
export const FIB = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
const FIB_COL = ['#787b86', '#f23645', '#ff9800', '#4caf50', '#089981', '#00bcd4', '#787b86'];

/** Chuyển đổi chỉ số nến <-> thời gian (cho phép vẽ vào vùng tương lai bên phải) */
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

export interface Ctx { chart: IChartApi; series: ISeriesApi<'Candlestick'>; tm: TimeMap; w: number; h: number }
const xy = (c: Ctx, pt: Pt) => ({ x: c.chart.timeScale().logicalToCoordinate(c.tm.toIndex(pt.t) as any) ?? NaN, y: c.series.priceToCoordinate(pt.p) ?? NaN });
const fmt = (p: number) => (Math.abs(p) >= 1000 ? p.toFixed(1) : p.toFixed(2));

export function drawShape(ctx: CanvasRenderingContext2D, c: Ctx, d: Drawing, dark: boolean, selected = false) {
  const P = d.pts.map((pt) => xy(c, pt));
  if (P.some((q) => !Number.isFinite(q.x) || !Number.isFinite(q.y))) return;
  ctx.save();
  ctx.strokeStyle = d.color; ctx.fillStyle = d.color; ctx.lineWidth = selected ? 2.5 : 1.5;
  ctx.font = '600 11px system-ui, sans-serif';
  const [a, b] = P;
  switch (d.type) {
    case 'trend':
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); break;
    case 'ray': {
      const dx = b.x - a.x, dy = b.y - a.y, k = dx === 0 ? 0 : (c.w - a.x) / dx;
      const ex = dx >= 0 ? c.w : 0, ey = dx === 0 ? b.y : a.y + dy * (dx >= 0 ? k : -a.x / dx);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(ex, ey); ctx.stroke(); break;
    }
    case 'hline':
      ctx.beginPath(); ctx.moveTo(0, a.y); ctx.lineTo(c.w, a.y); ctx.stroke();
      ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillText(fmt(d.pts[0].p), c.w - 4, a.y - 2); break;
    case 'vline':
      ctx.beginPath(); ctx.moveTo(a.x, 0); ctx.lineTo(a.x, c.h); ctx.stroke(); break;
    case 'rect':
      ctx.globalAlpha = 0.15; ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y); ctx.globalAlpha = 1;
      ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y); break;
    case 'fib': {
      const x1 = Math.min(a.x, b.x), x2 = c.w;
      FIB.forEach((lv, i) => {
        const price = d.pts[1].p + (d.pts[0].p - d.pts[1].p) * lv;
        const y = c.series.priceToCoordinate(price) ?? NaN;
        if (!Number.isFinite(y)) return;
        ctx.strokeStyle = FIB_COL[i]; ctx.fillStyle = FIB_COL[i];
        ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();
        ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText(`${lv} (${fmt(price)})`, x1 + 4, y - 1);
      });
      ctx.strokeStyle = d.color; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]);
      break;
    }
    case 'measure': {
      const dp = d.pts[1].p - d.pts[0].p, pct = (dp / d.pts[0].p) * 100;
      const bars = Math.round(c.tm.toIndex(d.pts[1].t) - c.tm.toIndex(d.pts[0].t));
      const col = dp >= 0 ? '#2962ff' : '#f23645';
      ctx.fillStyle = col; ctx.globalAlpha = 0.15; ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y); ctx.globalAlpha = 1;
      ctx.strokeStyle = col; ctx.beginPath(); ctx.moveTo((a.x + b.x) / 2, a.y); ctx.lineTo((a.x + b.x) / 2, b.y); ctx.stroke();
      const label = `${dp >= 0 ? '+' : ''}${fmt(dp)} (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%) · ${bars} nến`;
      const tw = ctx.measureText(label).width + 12, lx = (a.x + b.x) / 2 - tw / 2, ly = dp >= 0 ? Math.min(a.y, b.y) - 22 : Math.max(a.y, b.y) + 4;
      ctx.fillStyle = col; ctx.fillRect(lx, ly, tw, 18);
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, lx + tw / 2, ly + 9);
      break;
    }
    case 'text':
      ctx.font = '600 13px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillStyle = d.color; ctx.fillText(d.text || '', a.x + 2, a.y); break;
  }
  if (selected || d.type !== 'text') {
    // tay nắm
    ctx.fillStyle = dark ? '#11151c' : '#fff'; ctx.strokeStyle = d.color; ctx.lineWidth = 1.5;
    if (selected) for (const q of P) { ctx.beginPath(); ctx.arc(q.x, q.y, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
  }
  ctx.restore();
}

/** Khoảng cách điểm tới đoạn thẳng */
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
/** Tìm hình gần điểm (x, y) nhất trong bán kính 7px */
export function hitTest(c: Ctx, list: Drawing[], x: number, y: number): Drawing | null {
  let best: Drawing | null = null, bd = 7;
  for (const d of list) {
    const P = d.pts.map((pt) => xy(c, pt));
    if (P.some((q) => !Number.isFinite(q.x) || !Number.isFinite(q.y))) continue;
    const [a, b] = P;
    let dist = Infinity;
    if (d.type === 'hline') dist = Math.abs(y - a.y);
    else if (d.type === 'vline') dist = Math.abs(x - a.x);
    else if (d.type === 'text') dist = Math.hypot(x - a.x - 20, y - a.y) - 20;
    else if (d.type === 'trend') dist = segDist(x, y, a.x, a.y, b.x, b.y);
    else if (d.type === 'ray') dist = segDist(x, y, a.x, a.y, a.x + (b.x - a.x) * 50, a.y + (b.y - a.y) * 50);
    else if (d.type === 'rect' || d.type === 'measure') {
      const x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x), y1 = Math.min(a.y, b.y), y2 = Math.max(a.y, b.y);
      dist = x >= x1 - 4 && x <= x2 + 4 && y >= y1 - 4 && y <= y2 + 4 ? 0 : Infinity;
    } else if (d.type === 'fib') {
      for (const lv of FIB) {
        const yy = c.series.priceToCoordinate(d.pts[1].p + (d.pts[0].p - d.pts[1].p) * lv) ?? NaN;
        if (x >= Math.min(a.x, b.x) - 4) dist = Math.min(dist, Math.abs(y - yy));
      }
    }
    if (dist < bd) { bd = dist; best = d; }
  }
  return best;
}

const KEY = (sym: string) => `draw:${sym}`;
export const loadDrawings = (sym: string): Drawing[] => { try { return JSON.parse(localStorage.getItem(KEY(sym)) || '[]'); } catch { return []; } };
export const saveDrawings = (sym: string, list: Drawing[]) => { try { localStorage.setItem(KEY(sym), JSON.stringify(list)); } catch { /* bỏ qua */ } };
