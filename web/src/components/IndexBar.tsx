import { useGlobal, useStock } from '../lib/hooks';

const ORDER = ['10', '11', '02', '12', '03'];

export function IndexBar({ onPick }: { onPick: (s: string) => void }) {
  const f = useGlobal();
  return (
    <div className="index-bar">
      <FuturesCard vn30={f.indices.get('11')?.value} onPick={onPick} />
      {ORDER.map((c) => f.indices.get(c)).filter(Boolean).map((ix) => {
        const cls = !ix!.chg ? 'c-ref' : ix!.chg > 0 ? 'c-up' : 'c-down';
        return (
          <div key={ix!.code} className="index-card">
            <div className="ix-name">{ix!.name}</div>
            <div className={`ix-val ${cls}`}>
              {ix!.value?.toFixed(2)} <span>{ix!.chg > 0 ? '▲' : ix!.chg < 0 ? '▼' : '■'} {ix!.chg?.toFixed(2)} ({ix!.chgPc?.toFixed(2)}%)</span>
            </div>
            <div className="ix-sub">
              {ix!.vol ? `${(ix!.vol / 1e6).toFixed(1)}tr CP` : ''} {ix!.val ? `· ${(ix!.val / 1e3).toLocaleString('vi-VN', { maximumFractionDigits: 0 })} tỷ` : ''}
              {ix!.up !== undefined && (
                <span className="breadth"> <b className="c-up">↑{ix!.up}</b> <b className="c-ref">■{ix!.nochg}</b> <b className="c-down">↓{ix!.down}</b></span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Thẻ VN30F1M: giá, thay đổi, basis so với VN30, OI */
function FuturesCard({ vn30, onPick }: { vn30?: number; onPick: (s: string) => void }) {
  const st = useStock('VN30F1M');
  if (!st || !st.ref) return null;
  const px = st.last || st.ref;
  const cls = !st.last || st.last === st.ref ? 'c-ref' : st.last > st.ref ? 'c-up' : 'c-down';
  const basis = vn30 ? px - vn30 : null;
  return (
    <div className="index-card fut" onClick={() => onPick('VN30F1M')} title={`Hợp đồng ${st.code || ''} · đáo hạn ${st.mat || ''}`}>
      <div className="ix-name">VN30F1M</div>
      <div className={`ix-val ${cls}`}>{px.toFixed(1)} <span>{st.chg > 0 ? '▲' : st.chg < 0 ? '▼' : '■'} {st.chg?.toFixed(1)} ({st.chgPc?.toFixed(2)}%)</span></div>
      <div className="ix-sub">
        KL {st.totVol?.toLocaleString('vi-VN')} · OI {st.oi?.toLocaleString('vi-VN') ?? '—'}
        {basis !== null && <> · Basis <b className={basis >= 0 ? 'c-up' : 'c-down'}>{basis.toFixed(1)}</b></>}
      </div>
    </div>
  );
}
