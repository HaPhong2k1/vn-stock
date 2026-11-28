import type { EwResult } from '../../../shared/ewave.js';

const REC_CLR: Record<string, string> = { 'STRONG BUY': '#00E676', BUY: '#00C853', ACCUMULATE: '#00BCD4', HOLD: '#FFD600', SELL: '#FF5252', 'STRONG SELL': '#D50000' };
const f = (v: number | null | undefined) => (v === null || v === undefined || Number.isNaN(v) ? '—' : Math.abs(v) >= 1000 ? v.toFixed(1) : v.toFixed(2));
const bias = (b: number) => (b >= 1 ? ['Bullish', '#00E676'] : b <= -1 ? ['Bearish', '#FF5252'] : ['Neutral', '#888']);

/** Bảng thông tin của Ahmad PRO (như table.new trong Pine): khuyến nghị, mẫu sóng, tín hiệu, vùng mua/bán */
export function EwPanel({ r, offsetTop = 0 }: { r: EwResult; offsetTop?: number }) {
  const o = r.opts;
  const rc = REC_CLR[r.rec] || '#FFD600';
  const ta = r.score >= 3 ? 'BUY' : r.score >= -1 ? 'HOLD' : 'SELL';
  const taC = ta === 'BUY' ? '#00E676' : ta === 'HOLD' ? '#FFD600' : '#FF5252';
  const confC = r.conf >= 70 ? '#00E676' : r.conf >= 50 ? '#FFD600' : '#FF5252';
  const sigC = r.sig.includes('BUY') ? '#00E676' : r.sig.includes('Short') ? '#FF1744' : r.sig.includes('ACCUM') ? '#00BCD4' : r.sig.includes('TAKE') ? '#00B0FF' : '#888';
  const row = (k: string, v: React.ReactNode, c?: string) => <div className="ew-row"><span>{k}</span><b style={c ? { color: c } : undefined}>{v}</b></div>;
  const t = r.ta, tf = r.tf, d = r.depth;
  return (
    <div className="ew-panel" style={{ top: 6 + offsetTop }} onPointerDown={(e) => e.stopPropagation()}>
      <div className="ew-head"><span>Ahmad PRO</span><b style={{ color: o.useLeverage ? '#FF9800' : '#00E676' }}>{o.useLeverage ? `LONG/SHORT ${o.leverageX}x` : 'SPOT'}</b></div>
      <div className="ew-row ew-rec" style={{ background: rc + '33', color: rc }}><span>Khuyến nghị</span><b>{r.rec === 'STRONG BUY' || r.rec === 'STRONG SELL' ? `★ ${r.rec} ★` : r.rec}</b></div>
      {row('Mẫu sóng', r.pat)}
      {row('Pha', r.phase || '—', r.phase ? '#00E676' : undefined)}
      {row('Độ tin cậy', `${r.conf.toFixed(1)}%`, confC)}
      {o.showTADetail && t && tf && d ? <>
        <div className="ew-sec"><span>─ Kỹ thuật ─</span><b style={{ color: taC }}>{ta}</b></div>
        {row('EMA 50/200', bias(Math.sign(t.ema50 - t.ema200) || 0)[0], bias(Math.sign(t.ema50 - t.ema200) || 0)[1])}
        {row('RSI (14)', `${f(t.rsi)}${t.rsi < 30 ? ' (quá bán)' : t.rsi > 70 ? ' (quá mua)' : ''}`, t.rsi < 30 ? '#00E676' : t.rsi > 70 ? '#FF5252' : undefined)}
        {row('MACD', (t.macdLine || 0) > (t.macdSignal || 0) ? 'Bullish' : 'Bearish', (t.macdLine || 0) > (t.macdSignal || 0) ? '#00E676' : '#FF5252')}
        {row('Stochastic', `${f(t.stochK)} / ${f(t.stochD)}`, t.stochK < 20 ? '#00E676' : t.stochK > 80 ? '#FF5252' : undefined)}
        {row('ADX', `${f(t.adx)} ${(t.adx || 0) > 25 ? '(có xu hướng)' : '(đi ngang)'}`)}
        <div className="ew-sec"><span>─ Đa khung ─</span><b style={{ color: tf.align >= 2 ? '#00E676' : tf.align <= -2 ? '#FF5252' : '#FFD600' }}>
          {tf.align >= 4 ? 'Strong ↑' : tf.align >= 2 ? 'Bullish' : tf.align <= -4 ? 'Strong ↓' : tf.align <= -2 ? 'Bearish' : 'Mixed'}</b></div>
        {row('Tuần', `${bias(tf.wBias)[0]}${Number.isFinite(tf.wRsi) ? ` (${tf.wRsi.toFixed(0)})` : ''}`, bias(tf.wBias)[1])}
        {row('Ngày', `${bias(tf.dBias)[0]}${Number.isFinite(tf.dRsi) ? ` (${tf.dRsi.toFixed(0)})` : ''}`, bias(tf.dBias)[1])}
        {row('Khung hiện tại', bias(tf.cBias)[0], bias(tf.cBias)[1])}
        <div className="ew-sec"><span>─ Độ sâu ─</span><b /></div>
        {row('Khối lượng', `${d.volRatio >= 1.5 ? 'Cao' : d.volRatio >= 1 ? 'Trên TB' : d.volRatio >= 0.5 ? 'Dưới TB' : 'Thấp'} (${d.volRatio.toFixed(1)}x)`, d.volRatio >= 1 ? '#00E676' : '#FF8A80')}
        {row('Bollinger', `${d.bbPos}${d.squeeze ? ' (Squeeze)' : ''}`, d.aboveMid ? '#00E676' : '#FF8A80')}
        {row('Cấu trúc', d.higherHighs && d.higherLows ? 'HH + HL ↑' : !d.higherHighs && !d.higherLows ? 'LH + LL ↓' : d.higherHighs ? 'HH + LL' : 'LH + HL',
          d.higherHighs && d.higherLows ? '#00E676' : !d.higherHighs && !d.higherLows ? '#FF5252' : '#FFD600')}
      </> : row('Kỹ thuật', ta, taC)}
      {r.sig !== 'HOLD' && r.sig !== '—' && <div className="ew-row ew-sig" style={{ background: sigC + '33' }}><span>Tín hiệu EW</span><b>{r.sig}</b></div>}
      {o.useLeverage ? <>
        {row('Entry', f(r.ent))}{row('Stop Loss', f(r.stp), '#FF5252')}
        {row('Target 1', f(r.tgt1), '#00B0FF')}{row('Target 2', f(r.tgt2), '#00B0FF')}{row('Target 3', f(r.tgt3), '#00B0FF')}
      </> : r.tgt1 !== null && row('Mục tiêu sóng', f(r.tgt1), '#00B0FF')}
      {r.buyBot !== null && r.buyTop !== null && row('Vùng mua', `${f(r.buyBot)} – ${f(r.buyTop)}`, '#00E676')}
      {r.sellBot !== null && r.sellTop !== null && row('Vùng bán', `${f(r.sellBot)} – ${f(r.sellTop)}`, '#00B0FF')}
      {o.useLeverage && row('Rủi ro thực', `${(o.riskPct * o.leverageX).toFixed(1)}%`, o.riskPct * o.leverageX > 10 ? '#FF5252' : '#FF9800')}
    </div>
  );
}
