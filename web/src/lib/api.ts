/** ID ẩn danh của trình duyệt — dùng làm chủ sở hữu cảnh báo (chưa có đăng nhập) */
export const clientId = (() => {
  try {
    let id = localStorage.getItem('clientId');
    if (!id) { id = crypto.randomUUID(); localStorage.setItem('clientId', id); }
    return id;
  } catch { return 'anon-' + Math.random().toString(36).slice(2, 12); }
})();

export function setClientId(id: string) {
  try { localStorage.setItem('clientId', id); } catch { /* bỏ qua */ }
  location.reload();
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const r = await fetch(`/api${path}`, {
    method: opts.method || 'GET',
    headers: { 'x-client-id': clientId, ...(opts.body ? { 'content-type': 'application/json' } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

export interface Metrics {
  s: string; ex: string; price: number; chgPc: number; totVol: number; value: number;
  ma20: number | null; ma50: number | null; ma200: number | null; ema9: number | null; ema21: number | null;
  rsi14: number | null; macd: number | null; macdSig: number | null; macdHist: number | null;
  bbUp: number | null; bbLow: number | null; avgVol20: number; volRatio: number | null;
  hi52: number | null; lo52: number | null; distMa20: number | null; live: boolean;
  aboveMa20: boolean; ema10: number | null; ema20: number | null; emaCrossUp: boolean; emaCrossDown: boolean;
  smcBullChoch: boolean; smcBearChoch: boolean; smcBullBos: boolean; smcBearBos: boolean; smcSwingTrend: number; smcInternalTrend: number; ma20CrossUp: boolean; ma20CrossDown: boolean; macdCrossUp: boolean; ema9CrossUp: boolean; goldenCross: boolean;
}
export interface Alert {
  id: string; sym: string; type: string; value: number | null; repeat: boolean; note: string; telegramChatId: string;
  active: boolean; createdAt: number; firedCount: number; lastFiredAt: number;
}
export interface AlertEvent { id: string; alertId: string; sym: string; type: string; msg: string; price: number; at: number }
export interface Signal { id: string; type: string; s: string; price: number; ma20: number | null; rsi14: number | null; volRatio: number | null; at: number }

export const ALERT_LABELS: Record<string, { label: string; kind: 'level' | 'event'; unit?: string }> = {
  MA20_CROSS_UP: { label: 'Giá cắt lên MA20 (tín hiệu MUA)', kind: 'event' },
  MA20_CROSS_DOWN: { label: 'Giá cắt xuống MA20', kind: 'event' },
  MACD_CROSS_UP: { label: 'MACD cắt lên Signal', kind: 'event' },
  EMA_CROSS_UP: { label: 'EMA10 cắt lên EMA20 (BUY)', kind: 'event' },
  EMA_CROSS_DOWN: { label: 'EMA10 cắt xuống EMA20 (SELL)', kind: 'event' },
  SMC_BULL_CHOCH: { label: 'SMC: CHoCH tăng', kind: 'event' },
  SMC_BEAR_CHOCH: { label: 'SMC: CHoCH giảm', kind: 'event' },
  SMC_BULL_BOS: { label: 'SMC: BOS tăng', kind: 'event' },
  PRICE_GTE: { label: 'Giá ≥', kind: 'level', unit: 'nghìn đ' },
  PRICE_LTE: { label: 'Giá ≤', kind: 'level', unit: 'nghìn đ' },
  PCT_GTE: { label: '% thay đổi ≥', kind: 'level', unit: '%' },
  PCT_LTE: { label: '% thay đổi ≤', kind: 'level', unit: '%' },
  VOL_GTE: { label: 'Tổng KL ≥', kind: 'level', unit: 'CP' },
  VOLRATIO_GTE: { label: 'KL / TB 20 phiên ≥', kind: 'level', unit: 'lần' },
  RSI_LTE: { label: 'RSI(14) ≤', kind: 'level' },
  RSI_GTE: { label: 'RSI(14) ≥', kind: 'level' },
};
export const SIGNAL_LABELS: Record<string, string> = {
  MA20_CROSS_UP: 'Cắt lên MA20 — MUA', MA20_CROSS_DOWN: 'Cắt xuống MA20', MACD_CROSS_UP: 'MACD cắt lên',
  EMA_CROSS_UP: 'EMA10↑EMA20 — BUY', EMA_CROSS_DOWN: 'EMA10↓EMA20 — SELL',
  SMC_BULL_CHOCH: 'SMC CHoCH tăng', SMC_BEAR_CHOCH: 'SMC CHoCH giảm', SMC_BULL_BOS: 'SMC BOS tăng',
};
