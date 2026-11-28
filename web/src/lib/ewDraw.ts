// Vẽ Elliott Wave Analyzer Pro ("Ahmad PRO") lên canvas phủ biểu đồ.
// Logic: shared/ewave.js — port từ Pine Script, giấy phép Mozilla Public License 2.0.
import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import type { EwResult } from '../../../shared/ewave.js';

const rgba = (hex: string, transp = 0) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, 1 - transp / 100)})`;
};
const FONT = { tiny: 9, small: 11, normal: 12 } as const;

/** Vẽ nhãn sóng, đường nối, khung điều chỉnh, vùng mua/bán, mục tiêu & dừng lỗ. Gọi SAU drawOverlay (hàm đó xoá canvas). */
export function drawEW(canvas: HTMLCanvasElement, chart: IChartApi, series: ISeriesApi<'Candlestick'>, r: EwResult, dark: boolean) {
  const ctx = canvas.getContext('2d')!;
  const ts = chart.timeScale();
  const W = ts.width();
  const X = (i: number) => ts.logicalToCoordinate(i as any) ?? NaN;
  const Y = (p: number) => series.priceToCoordinate(p) ?? NaN;
  const ok = (...v: number[]) => v.every(Number.isFinite);
  const fg = dark ? '#FFFFFF' : '#131722';
  const col = (c: string) => (c === '#FFFFFF' ? fg : c); // đường/nhãn "Entry" màu trắng => đổi theo nền sáng/tối
  const dash = (s: string) => (s === 'dashed' ? [6, 4] : s === 'dotted' ? [2, 3] : []);

  ctx.save();
  // ── Hộp vùng mua/bán
  for (const b of r.boxes) {
    const x1 = X(b.x1), x2 = X(b.x2), y1 = Y(b.top), y2 = Y(b.bot);
    if (!ok(x1, x2, y1, y2)) continue;
    ctx.fillStyle = rgba(b.color, b.bgT); ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
    ctx.strokeStyle = rgba(b.color, b.borderT); ctx.lineWidth = 1; ctx.setLineDash(b.dash ? [6, 4] : []);
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1); ctx.setLineDash([]);
    ctx.font = `600 ${FONT.small}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = rgba(b.color, b.textT); ctx.fillText(b.text, (x1 + x2) / 2, (y1 + y2) / 2);
  }
  // ── Đường
  for (const l of r.lines) {
    let x1 = X(l.x1), y1 = Y(l.y1), x2 = X(l.x2), y2 = Y(l.y2);
    if (!ok(x1, y1, x2, y2)) continue;
    if (l.extend && x2 !== x1) { const k = (y2 - y1) / (x2 - x1); y2 = y2 + k * (W - x2); x2 = W; }
    const c = rgba(col(l.color), l.t);
    ctx.strokeStyle = c; ctx.lineWidth = l.width; ctx.setLineDash(dash(l.style));
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.setLineDash([]);
    if (l.style === 'arrow') {
      const a = Math.atan2(y2 - y1, x2 - x1), s = 8;
      ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - s * Math.cos(a - 0.45), y2 - s * Math.sin(a - 0.45)); ctx.lineTo(x2 - s * Math.cos(a + 0.45), y2 - s * Math.sin(a + 0.45));
      ctx.closePath(); ctx.fill();
    }
  }
  // ── Nhãn
  for (const lb of r.labels) {
    const x = X(lb.x), y = Y(lb.y);
    if (!ok(x, y)) continue;
    const fs = FONT[lb.size] || 11;
    ctx.font = `${lb.size === 'normal' ? 700 : 600} ${fs}px system-ui, sans-serif`;
    const lines = lb.text.split('\n');
    const tw = Math.max(...lines.map((t) => ctx.measureText(t).width));
    if (lb.style === 'none') {
      ctx.fillStyle = rgba(col(lb.color), lb.t || 0); ctx.textBaseline = 'middle';
      ctx.textAlign = lb.align === 'left' ? 'left' : 'center';
      ctx.fillText(lb.text, x, y);
      continue;
    }
    // nhãn có khung + mũi nhọn chỉ vào điểm (down: nằm trên điểm, up: nằm dưới điểm)
    const padX = 5, padY = 3, bw = tw + padX * 2, bh = fs * lines.length + padY * 2, tip = 5;
    const top = lb.style === 'down' ? y - tip - bh : y + tip;
    ctx.fillStyle = rgba(lb.bg || lb.color, lb.bgT ?? 85);
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x - bw / 2, top, bw, bh, 3); else ctx.rect(x - bw / 2, top, bw, bh);
    ctx.fill();
    ctx.beginPath();
    if (lb.style === 'down') { ctx.moveTo(x - 4, top + bh); ctx.lineTo(x + 4, top + bh); ctx.lineTo(x, y); }
    else { ctx.moveTo(x - 4, top); ctx.lineTo(x + 4, top); ctx.lineTo(x, y); }
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = col(lb.color); ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    lines.forEach((t, k) => ctx.fillText(t, x, top + padY + k * fs));
  }
  ctx.restore();
}
