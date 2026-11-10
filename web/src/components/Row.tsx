import { memo, useEffect, useRef } from 'react';
import { useStock } from '../lib/hooks';
import { fmtPrice, fmtVol, priceClass } from '../lib/format';

interface Props { sym: string; top: number; watched: boolean; onPick: (s: string) => void; onToggleWatch: (s: string) => void }

/** Một dòng bảng giá. Chỉ render lại khi chính mã này thay đổi; nháy màu khi giá/khối lượng đổi. */
export const Row = memo(function Row({ sym, top, watched, onPick, onToggleWatch }: Props) {
  const st = useStock(sym);
  const prev = useRef<typeof st>();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const p = prev.current;
    if (p && st && ref.current) {
      const cells = ref.current.querySelectorAll<HTMLElement>('[data-k]');
      cells.forEach((el) => {
        const k = el.dataset.k!;
        const [field, i, j] = k.split('.');
        const get = (o: any) => (i !== undefined ? o[field]?.[+i]?.[+j] : o[field]);
        if (get(p) !== get(st)) {
          el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
        }
      });
    }
    prev.current = st;
  }, [st]);

  if (!st) return <div className="row" style={{ top }}><div className="cell sym">{sym}</div></div>;
  const pc = (p: any) => priceClass(p, st);
  const lastCls = pc(st.last);
  const L = (side: 'b' | 'a', i: number) => {
    const lv = st[side][i] || [0, 0];
    return [
      <div key={`${side}p${i}`} className={`cell num ${pc(lv[0])}`} data-k={`${side}.${i}.0`}>{fmtPrice(lv[0])}</div>,
      <div key={`${side}v${i}`} className={`cell num ${pc(lv[0])}`} data-k={`${side}.${i}.1`}>{fmtVol(lv[1])}</div>,
    ];
  };
  return (
    <div className="row" ref={ref} style={{ top }}>
      <div className={`cell sym ${lastCls}`} onClick={() => onPick(sym)} title="Xem chi tiết">
        <button className={`star ${watched ? 'on' : ''}`} onClick={(e) => { e.stopPropagation(); onToggleWatch(sym); }}>★</button>
        {sym}
      </div>
      <div className="cell num c-ceil">{fmtPrice(st.ceil)}</div>
      <div className="cell num c-floor">{fmtPrice(st.floor)}</div>
      <div className="cell num c-ref">{fmtPrice(st.ref)}</div>
      {L('b', 2)}{L('b', 1)}{L('b', 0)}
      <div className={`cell num match ${lastCls}`} data-k="last">{fmtPrice(st.last)}</div>
      <div className={`cell num match ${lastCls}`} data-k="lastVol">{fmtVol(st.lastVol)}</div>
      <div className={`cell num match ${lastCls}`}>{st.last ? (st.chg > 0 ? '+' : '') + st.chg.toFixed(2) : ''}</div>
      <div className={`cell num match ${lastCls}`}>{st.last ? (st.chgPc > 0 ? '+' : '') + st.chgPc.toFixed(2) + '%' : ''}</div>
      {L('a', 0)}{L('a', 1)}{L('a', 2)}
      <div className="cell num" data-k="totVol">{fmtVol(st.totVol)}</div>
      <div className={`cell num ${pc(st.high)}`}>{fmtPrice(st.high)}</div>
      <div className={`cell num ${pc(st.low)}`}>{fmtPrice(st.low)}</div>
      <div className={`cell num ${pc(st.avg)}`}>{fmtPrice(st.avg)}</div>
      <div className="cell num" data-k="fB">{fmtVol(st.fB)}</div>
      <div className="cell num" data-k="fS">{fmtVol(st.fS)}</div>
      <div className="cell num">{fmtVol(st.room)}</div>
    </div>
  );
});
