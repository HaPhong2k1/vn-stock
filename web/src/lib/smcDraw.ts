// Vẽ Smart Money Concepts lên canvas phủ trên biểu đồ lightweight-charts.
// Logic SMC: shared/smc.js — © LuxAlgo, CC BY-NC-SA 4.0 (phi thương mại).
import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import type { SmcResult } from '../../../shared/smc.js';
import type { FpBar } from '../../../shared/footprint.js';

export interface SmcSettings {
  enabled: boolean; mode: 'Historical' | 'Present';
  internal: boolean; swing: boolean; swingPoints: boolean; strongWeak: boolean;
  internalOB: boolean; internalOBCount: number; swingOB: boolean; swingOBCount: number;
  eq: boolean; fvg: boolean; zones: boolean; colorCandles: boolean; swingLength: number; confluence: boolean;
}
export const SMC_UI_DEFAULTS: SmcSettings = {
  enabled: false, mode: 'Historical', internal: true, swing: true, swingPoints: false, strongWeak: true,
  internalOB: true, internalOBCount: 5, swingOB: false, swingOBCount: 5, eq: true, fvg: false, zones: false,
  colorCandles: false, swingLength: 50, confluence: false,
};

const GREEN = '#089981', RED = '#F23645', GRAY = '#878b94';
const rgba = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

export interface EmaFill { fast: number[]; slow: number[] }

/** Vẽ lại toàn bộ overlay. Toạ độ x theo chỉ số nến (logical index) nên vẽ được cả vùng kéo dài sang phải. */
export function drawOverlay(canvas: HTMLCanvasElement, chart: IChartApi, series: ISeriesApi<'Candlestick'>,
  smc: SmcResult | null, s: SmcSettings, timeToIndex: Map<number, number>, ema: EmaFill | null, dark: boolean) {
  const ts = chart.timeScale();
  const w = ts.width();
  const h = canvas.parentElement!.clientHeight - ts.height();
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
  }
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const X = (i: number) => ts.logicalToCoordinate(i as any) ?? NaN;
  const Y = (p: number) => series.priceToCoordinate(p) ?? NaN;
  const ok = (...v: number[]) => v.every(Number.isFinite);

  // --- Vùng tô giữa 2 đường EMA (giống fill() của script EMA cross)
  if (ema) {
    const r = ts.getVisibleLogicalRange();
    if (r) {
      const a = Math.max(0, Math.floor(r.from)), b = Math.min(ema.fast.length - 1, Math.ceil(r.to));
      if (b > a) {
        ctx.beginPath();
        for (let i = a; i <= b; i++) { const x = X(i), y = Y(ema.fast[i]); i === a ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
        for (let i = b; i >= a; i--) ctx.lineTo(X(i), Y(ema.slow[i]));
        ctx.closePath();
        ctx.fillStyle = dark ? 'rgba(255,255,255,0.10)' : 'rgba(120,120,140,0.14)';
        ctx.fill();
      }
    }
  }
  if (!smc || !s.enabled) return;
  const last = smc.n - 1;
  const rightEdge = w;

  const label = (text: string, x: number, y: number, color: string, above: boolean, size = 10) => {
    if (!ok(x, y)) return;
    ctx.font = `600 ${size}px system-ui, sans-serif`;
    ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = above ? 'bottom' : 'top';
    ctx.fillText(text, x, y + (above ? -2 : 2));
  };
  const hline = (x1: number, x2: number, y: number, color: string, dash: number[] = []) => {
    if (!ok(x1, x2, y)) return;
    ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.setLineDash(dash);
    ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke(); ctx.setLineDash([]);
  };
  const box = (x1: number, x2: number, top: number, bottom: number, fill: string, border?: string) => {
    const y1 = Y(top), y2 = Y(bottom);
    if (!ok(x1, x2, y1, y2)) return;
    ctx.fillStyle = fill; ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
    if (border) { ctx.strokeStyle = border; ctx.lineWidth = 1; ctx.strokeRect(x1, y1, x2 - x1, y2 - y1); }
  };

  // --- Premium / Discount
  if (s.zones && ok(smc.trailing.top, smc.trailing.bottom)) {
    const t = smc.trailing.top, b = smc.trailing.bottom, x1 = X(smc.trailing.barIndex), x2 = X(last);
    const mid = Math.round((smc.trailing.barIndex + last) / 2);
    box(x1, x2, t, 0.95 * t + 0.05 * b, rgba(RED, 0.2)); label('Premium', X(mid), Y(t), RED, true);
    box(x1, x2, 0.525 * t + 0.475 * b, 0.525 * b + 0.475 * t, rgba(GRAY, 0.2)); label('Equilibrium', X(last) + 30, Y((t + b) / 2) - 6, GRAY, false);
    box(x1, x2, 0.95 * b + 0.05 * t, b, rgba(GREEN, 0.2)); label('Discount', X(mid), Y(b), GREEN, false);
  }

  // --- Order blocks (kéo dài sang phải)
  const drawOBs = (list: SmcResult['internalOBs'], count: number, internal: boolean) => {
    for (const ob of list.slice(0, count)) {
      const bull = ob.bias === 1;
      const c = internal ? (bull ? '#3179f5' : '#f77c80') : (bull ? '#1848cc' : '#b22833');
      box(X(ob.index), rightEdge, ob.high, ob.low, rgba(c, 0.2), internal ? undefined : rgba(c, 0.6));
    }
  };
  if (s.internalOB) drawOBs(smc.internalOBs, s.internalOBCount, true);
  if (s.swingOB) drawOBs(smc.swingOBs, s.swingOBCount, false);

  // --- Fair value gaps (2 nửa)
  if (s.fvg) {
    for (const g of smc.fvgs) {
      const c = g.bias === 1 ? '#00ff68' : '#ff0008', mid = (g.top + g.bottom) / 2;
      const x1 = X(g.leftIndex), x2 = X(g.rightIndex);
      box(x1, x2, g.top, mid, rgba(c, 0.3)); box(x1, x2, mid, g.bottom, rgba(c, 0.3));
    }
  }

  // --- Cấu trúc BOS / CHoCH
  let structs = smc.structures.filter((x) => (x.internal ? s.internal : s.swing));
  if (s.mode === 'Present') {
    const keep = new Map<string, typeof structs[0]>();
    for (const x of structs) keep.set(`${x.internal}${x.bias}`, x);
    structs = [...keep.values()];
  }
  for (const x of structs) {
    const c = x.bias === 1 ? GREEN : RED;
    const y = Y(x.level);
    hline(X(x.fromIndex), X(x.toIndex), y, c, x.internal ? [4, 3] : []);
    label(x.tag, X(Math.round((x.fromIndex + x.toIndex) / 2)), y, c, x.bias === 1, x.internal ? 9 : 11);
  }

  // --- Equal highs / lows
  if (s.eq) {
    let eqs = smc.equals;
    if (s.mode === 'Present') eqs = ['EQH', 'EQL'].map((t) => [...eqs].reverse().find((e) => e.type === t)!).filter(Boolean);
    for (const e of eqs) {
      const c = e.type === 'EQH' ? RED : GREEN;
      const x1 = X(e.fromIndex), x2 = X(e.toIndex), y1 = Y(e.fromPrice), y2 = Y(e.toPrice);
      if (ok(x1, x2, y1, y2)) {
        ctx.strokeStyle = c; ctx.setLineDash([1, 2]); ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.setLineDash([]);
      }
      label(e.type, X(Math.round((e.fromIndex + e.toIndex) / 2)), Y(e.toPrice), c, e.type === 'EQH', 9);
    }
  }

  // --- Điểm swing HH/LH/HL/LL
  if (s.swingPoints) {
    let sw = smc.swings;
    if (s.mode === 'Present') sw = [[...sw].reverse().find((x) => x.type === 'HH' || x.type === 'LH'), [...sw].reverse().find((x) => x.type === 'HL' || x.type === 'LL')].filter(Boolean) as typeof sw;
    for (const p of sw) {
      const high = p.type === 'HH' || p.type === 'LH';
      label(p.type, X(p.index), Y(p.price), high ? RED : GREEN, high, 10);
    }
  }

  // --- Strong / Weak High & Low
  if (s.strongWeak && ok(smc.trailing.top, smc.trailing.bottom)) {
    const xr = X(last + 20);
    const ti = timeToIndex.get(smc.trailing.lastTopTime), bi = timeToIndex.get(smc.trailing.lastBottomTime);
    if (ti !== undefined) {
      hline(X(ti), xr, Y(smc.trailing.top), RED);
      label(smc.swingTrend === -1 ? 'Strong High' : 'Weak High', Math.min(xr, rightEdge - 34), Y(smc.trailing.top), RED, true, 9);
    }
    if (bi !== undefined) {
      hline(X(bi), xr, Y(smc.trailing.bottom), GREEN);
      label(smc.swingTrend === 1 ? 'Strong Low' : 'Weak Low', Math.min(xr, rightEdge - 34), Y(smc.trailing.bottom), GREEN, false, 9);
    }
  }
}

// ======================= FOOTPRINT =======================

export interface FpSettings {
  enabled: boolean; mode: 'bidask' | 'delta' | 'volume'; rowTicks: number; // 0 = tự động
  ratio: number; stack: number; minVol: number; markers: boolean; poc: boolean; stacks: boolean; summary: boolean; dim: boolean;
}
export const FP_UI_DEFAULTS: FpSettings = {
  enabled: false, mode: 'bidask', rowTicks: 0, ratio: 3, stack: 3, minVol: 0, markers: true, poc: true, stacks: true, summary: true, dim: true,
};
export interface FpDraw { bars: FpBar[]; row: number; tick: number; label: string; estimatedPct: number; s: FpSettings }

const kfmt = (v: number) => {
  const a = Math.abs(v);
  if (a >= 1e6) return (v / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M';
  if (a >= 1e4) return Math.round(v / 1e3) + 'k';
  if (a >= 1e3) return (v / 1e3).toFixed(1) + 'k';
  return String(Math.round(v));
};

/** Vẽ footprint: mỗi nến là một cột các ô giá (bid x ask / delta / volume) */
export function drawFootprint(canvas: HTMLCanvasElement, chart: IChartApi, series: ISeriesApi<'Candlestick'>, fp: FpDraw,
  timeToIndex: Map<number, number>, dark: boolean) {
  const ctx = canvas.getContext('2d')!;
  const ts = chart.timeScale();
  const w = ts.width();
  const h = canvas.parentElement!.clientHeight - ts.height();
  const X = (i: number) => ts.logicalToCoordinate(i as any) ?? NaN;
  const Y = (p: number) => series.priceToCoordinate(p) ?? NaN;
  const s = fp.s;
  const bs = Math.abs(X(1) - X(0)) || 6;
  const cellW = Math.max(2, bs * 0.92);
  const GREEN = '#0ecb81', RED = '#f6465d', TXT = dark ? '#d9dee5' : '#1d232b', POC = '#f0b90b';
  const showText = cellW >= 46;

  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
  for (const b of fp.bars) {
    const i = timeToIndex.get(b.t);
    if (i === undefined) continue;
    const xc = X(i);
    if (!Number.isFinite(xc) || xc < -cellW || xc > w + cellW) continue;
    const left = xc - cellW / 2;
    let maxAbs = 1, maxVol = 1;
    for (const r of b.rows) { maxAbs = Math.max(maxAbs, Math.abs(r.delta)); maxVol = Math.max(maxVol, r.vol); }
    for (const r of b.rows) {
      if (!r.vol) continue; // dòng chỉ có KL khớp định kỳ (ATO/ATC) — không có bên chủ động
      const yTop = Y(r.p + fp.row - fp.tick / 2), yBot = Y(r.p - fp.tick / 2);
      if (!Number.isFinite(yTop) || !Number.isFinite(yBot)) continue;
      const ch = Math.max(1, yBot - yTop);
      if (s.mode === 'volume') {
        ctx.fillStyle = dark ? 'rgba(120,140,170,0.18)' : 'rgba(80,100,140,0.12)';
        ctx.fillRect(left, yTop, cellW, ch);
        ctx.fillStyle = dark ? 'rgba(90,150,255,0.55)' : 'rgba(40,100,220,0.45)';
        ctx.fillRect(left, yTop + 0.5, cellW * (r.vol / maxVol), ch - 1);
      } else {
        const a = 0.1 + 0.55 * (Math.abs(r.delta) / maxAbs);
        ctx.fillStyle = r.delta >= 0 ? `rgba(14,203,129,${a})` : `rgba(246,70,93,${a})`;
        ctx.fillRect(left, yTop, cellW, ch);
      }
      // imbalance: viền đậm phía có imbalance
      if (r.buyImb) { ctx.fillStyle = GREEN; ctx.fillRect(left + cellW - 3, yTop, 3, ch); }
      if (r.sellImb) { ctx.fillStyle = RED; ctx.fillRect(left, yTop, 3, ch); }
      if (s.poc && b.poc !== null && Math.abs(r.p - b.poc) < fp.row / 2) {
        ctx.strokeStyle = POC; ctx.lineWidth = 1.5; ctx.strokeRect(left + 0.75, yTop + 0.75, cellW - 1.5, ch - 1.5);
      }
      if (showText && ch >= 9) {
        const fs = Math.min(11, Math.floor(ch - 1));
        ctx.textBaseline = 'middle';
        const ym = yTop + ch / 2;
        if (s.mode === 'bidask') {
          ctx.font = `${r.sellImb ? '700 ' : ''}${fs}px ui-monospace, monospace`;
          ctx.textAlign = 'right'; ctx.fillStyle = r.sellImb ? RED : TXT; ctx.fillText(kfmt(r.bid), xc - 5, ym);
          ctx.font = `${fs}px ui-monospace, monospace`; ctx.textAlign = 'center'; ctx.fillStyle = dark ? '#7d8794' : '#8a939f'; ctx.fillText('x', xc, ym);
          ctx.font = `${r.buyImb ? '700 ' : ''}${fs}px ui-monospace, monospace`;
          ctx.textAlign = 'left'; ctx.fillStyle = r.buyImb ? GREEN : TXT; ctx.fillText(kfmt(r.ask), xc + 5, ym);
        } else {
          ctx.font = `${fs}px ui-monospace, monospace`; ctx.textAlign = 'center';
          ctx.fillStyle = s.mode === 'delta' ? (r.delta >= 0 ? GREEN : RED) : TXT;
          ctx.fillText(s.mode === 'delta' ? (r.delta > 0 ? '+' : '') + kfmt(r.delta) : kfmt(r.vol), xc, ym);
        }
      }
    }
    const yH = Y(b.h + fp.row - fp.tick / 2), yL = Y(b.l - fp.tick / 2);
    // stacked imbalance: vùng hỗ trợ/kháng cự kéo dài sang phải
    if (s.stacks) {
      for (const st of b.stacks) {
        const y1 = Y(st.to + fp.row - fp.tick / 2), y2 = Y(st.from - fp.tick / 2);
        ctx.fillStyle = st.dir === 1 ? 'rgba(14,203,129,0.10)' : 'rgba(246,70,93,0.10)';
        ctx.fillRect(xc + cellW / 2, y1, w - (xc + cellW / 2), y2 - y1);
        ctx.strokeStyle = st.dir === 1 ? GREEN : RED; ctx.setLineDash([4, 3]); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(xc - cellW / 2, (y1 + y2) / 2); ctx.lineTo(w, (y1 + y2) / 2); ctx.stroke(); ctx.setLineDash([]);
      }
    }
    if (s.markers) {
      ctx.font = '700 9px system-ui, sans-serif'; ctx.textAlign = 'center';
      const lbl = (t: string, y: number, color: string, above: boolean, dy = 0) => {
        ctx.fillStyle = color; ctx.textBaseline = above ? 'bottom' : 'top'; ctx.fillText(t, xc, y + (above ? -2 - dy : 2 + dy));
      };
      let up = 0, dn = 0;
      if (b.unfinishedHigh) { lbl('UA', yH, '#f0b90b', true, up); up += 10; }
      if (b.exhaustHigh) { lbl('EX', yH, RED, true, up); up += 10; }
      if (b.absorbHigh) { lbl('AB', yH, RED, true, up); up += 10; }
      if (b.divBear) { lbl('▼Δ', yH, RED, true, up); up += 10; }
      if (b.unfinishedLow) { lbl('UA', yL, '#f0b90b', false, dn); dn += 10; }
      if (b.exhaustLow) { lbl('EX', yL, GREEN, false, dn); dn += 10; }
      if (b.absorbLow) { lbl('AB', yL, GREEN, false, dn); dn += 10; }
      if (b.divBull) { lbl('▲Δ', yL, GREEN, false, dn); dn += 10; }
    }
    if (s.summary && cellW >= 30) {
      ctx.font = '600 10px ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillStyle = b.delta >= 0 ? GREEN : RED; ctx.fillText((b.delta > 0 ? '+' : '') + kfmt(b.delta), xc, h - 14);
      ctx.fillStyle = dark ? '#9aa3ae' : '#5d6670'; ctx.fillText(kfmt(b.vol) + (b.auction ? ` +${kfmt(b.auction)} ĐK` : ''), xc, h - 2);
    }
  }
  // Nhãn thông tin
  const info = `Footprint · ${fp.label} · dòng ${fp.row} · imbalance ${Math.round(s.ratio * 100)}%` + (fp.estimatedPct ? ` · ƯỚC LƯỢNG ${fp.estimatedPct}%` : ' · dữ liệu lệnh khớp thật');
  ctx.font = '600 11px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  const tw = ctx.measureText(info).width;
  ctx.fillStyle = dark ? 'rgba(17,21,28,0.85)' : 'rgba(255,255,255,0.85)'; ctx.fillRect(6, 26, tw + 12, 18);
  ctx.fillStyle = fp.estimatedPct ? '#f0b90b' : TXT; ctx.fillText(info, 12, 29); // dưới dòng chú thích OHLC
  ctx.restore();
}
