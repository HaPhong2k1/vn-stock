import { useMemo, useState } from 'react';
import { INDICATORS } from '../lib/indicatorDefs';

export interface BuiltIn { id: string; name: string; desc: string; on: boolean; toggle: () => void; group: 'overlay' | 'special' }
interface Props {
  active: string[]; osc: string; builtins: BuiltIn[]; cvdAvailable: boolean;
  onToggle: (id: string) => void; onOsc: (id: string) => void; onReset: () => void; onClose: () => void;
}
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase();

/** Hộp "Chỉ báo" kiểu TradingView/Fiant: tìm kiếm, bật/tắt chỉ báo trên giá, chọn chỉ báo khung dưới */
export function IndicatorDialog({ active, osc, builtins, cvdAvailable, onToggle, onOsc, onReset, onClose }: Props) {
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<'all' | 'overlay' | 'osc' | 'special'>('all');
  const fq = fold(q.trim());
  const match = (name: string, desc: string) => !fq || fold(name).includes(fq) || fold(desc).includes(fq);
  const oscList = useMemo(() => [
    ...INDICATORS.filter((d) => d.group === 'osc').map((d) => ({ id: d.id, name: d.name, desc: d.desc })),
    ...(cvdAvailable ? [{ id: 'cvd', name: 'Delta & CVD (Footprint)', desc: 'Delta từng nến và delta cộng dồn từ dữ liệu footprint' }] : []),
  ], [cvdAvailable]);
  return (
    <div className="ss-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } }}>
      <div className="ss ind-dlg" role="dialog" aria-label="Chỉ báo">
        <div className="ss-head"><b>ƒx Chỉ báo kỹ thuật</b><button className="close" onClick={onClose}>✕</button></div>
        <div className="ss-input"><span>🔍</span><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm chỉ báo (VD: RSI, ichimoku, vwap…)" /></div>
        <div className="ss-cats">
          {([['all', 'Tất cả'], ['overlay', 'Trên biểu đồ giá'], ['osc', 'Khung dưới (dao động)'], ['special', 'Nâng cao']] as const).map(([k, l]) => (
            <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
          ))}
          <button className="reset-btn" onClick={onReset} title="Tắt hết, về bộ chỉ báo mặc định (MA20, MA50, RSI)">⟲ Khôi phục mặc định</button>
        </div>
        <div className="ss-list">
          {(tab === 'all' || tab === 'overlay') && <>
            <div className="ind-group">Trên biểu đồ giá <small className="muted">— bật nhiều cùng lúc</small></div>
            {builtins.filter((b) => b.group === 'overlay' && match(b.name, b.desc)).map((b) => (
              <label key={b.id} className="ind-row"><input type="checkbox" checked={b.on} onChange={b.toggle} /><b>{b.name}</b><span className="muted">{b.desc}</span></label>
            ))}
            {INDICATORS.filter((d) => d.group === 'overlay' && match(d.name, d.desc)).map((d) => (
              <label key={d.id} className="ind-row"><input type="checkbox" checked={active.includes(d.id)} onChange={() => onToggle(d.id)} /><b>{d.name}</b><span className="muted">{d.desc}</span></label>
            ))}
          </>}
          {(tab === 'all' || tab === 'osc') && <>
            <div className="ind-group">Khung dưới <small className="muted">— chọn 1</small></div>
            {oscList.filter((d) => match(d.name, d.desc)).map((d) => (
              <label key={d.id} className="ind-row"><input type="radio" name="osc" checked={osc === d.id} onChange={() => onOsc(d.id)} /><b>{d.name}</b><span className="muted">{d.desc}</span></label>
            ))}
          </>}
          {(tab === 'all' || tab === 'special') && <>
            <div className="ind-group">Nâng cao</div>
            {builtins.filter((b) => b.group === 'special' && match(b.name, b.desc)).map((b) => (
              <label key={b.id} className="ind-row"><input type="checkbox" checked={b.on} onChange={b.toggle} /><b>{b.name}</b><span className="muted">{b.desc}</span></label>
            ))}
          </>}
        </div>
        <div className="ss-foot muted">Lựa chọn được ghi nhớ trên trình duyệt này và áp dụng cho mọi mã.</div>
      </div>
    </div>
  );
}
