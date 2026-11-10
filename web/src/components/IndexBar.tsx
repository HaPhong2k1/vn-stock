import { useGlobal } from '../lib/hooks';

const ORDER = ['10', '11', '02', '12', '03'];

export function IndexBar() {
  const f = useGlobal();
  return (
    <div className="index-bar">
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
