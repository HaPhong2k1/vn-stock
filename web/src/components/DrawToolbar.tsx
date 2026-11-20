import { useEffect, useRef, useState } from 'react';
import { TOOL_DEFS, GROUPS, EMOJIS, defOf, type Drawing } from '../lib/drawings';

export const COLORS = ['#2962ff', '#f23645', '#089981', '#ff9800', '#e040fb', '#00bcd4', '#ffeb3b', '#787b86', '#ffffff', '#000000'];

const Svg = ({ d, size = 18 }: { d: string; size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
);
const CURSOR = 'M5 3l14 8l-6 2l-2 6z';
const ERASER = 'M7 20h10M4 15l9-9l6 6l-7 7H8z';
const ZOOM = 'M10 10m-6 0a6 6 0 1 0 12 0a6 6 0 1 0-12 0M15 15l6 6M7 10h6M10 7v6';
export function ToolIcon({ tool, size = 18 }: { tool: string; size?: number }) {
  if (tool === 'cursor') return <Svg d={CURSOR} size={size} />;
  if (tool === 'eraser') return <Svg d={ERASER} size={size} />;
  if (tool === 'zoom') return <Svg d={ZOOM} size={size} />;
  if (tool.startsWith('emoji:')) return <span style={{ fontSize: size - 2, lineHeight: 1 }}>{tool.slice(6)}</span>;
  const def = defOf(tool);
  return def ? <Svg d={def.icon} size={size} /> : <span>?</span>;
}

interface Props {
  tool: string; setTool: (t: string) => void;
  magnet: boolean; setMagnet: (v: boolean) => void; keep: boolean; setKeep: (v: boolean) => void;
  lockAll: boolean; setLockAll: (v: boolean) => void; hidden: boolean; setHidden: (v: boolean) => void;
  count: number; canUndo: boolean; onUndo: () => void; onClear: () => void; onReset: () => void;
}
const load = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const save = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* */ } };

/** Thanh công cụ vẽ dọc kiểu TradingView/Fiant: mỗi nhóm nhớ công cụ dùng gần nhất, bấm ▸ để mở danh sách */
export function DrawToolbar(p: Props) {
  const [last, setLast] = useState<Record<string, string>>(() => load('drawLast', {}));
  const [fav, setFav] = useState<string[]>(() => load('drawFav', ['trend', 'hline', 'fib', 'rect']));
  const [open, setOpen] = useState<{ g: string; top: number } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => save('drawLast', last), [last]);
  useEffect(() => save('drawFav', fav), [fav]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(null); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const groupTools = (g: string) => (g === 'emoji' ? EMOJIS.map((e) => `emoji:${e}`) : g === 'cursors' ? ['cursor', 'eraser'] : TOOL_DEFS.filter((t) => t.group === g).map((t) => t.id));
  const pick = (g: string, t: string) => { setLast((l) => ({ ...l, [g]: t })); p.setTool(t); setOpen(null); };
  const groupOf = (t: string) => (t === 'cursor' || t === 'eraser' ? 'cursors' : t.startsWith('emoji:') ? 'emoji' : defOf(t)?.group);
  const all = [{ id: 'cursors', name: 'Con trỏ' }, ...GROUPS];
  const toggleFav = (t: string) => setFav((f) => (f.includes(t) ? f.filter((x) => x !== t) : [...f, t]));
  const nameOf = (t: string) => (t === 'cursor' ? 'Con trỏ (kéo / chọn / di chuyển hình)' : t === 'eraser' ? 'Tẩy' : t.startsWith('emoji:') ? `Biểu tượng ${t.slice(6)}` : defOf(t)?.name || t);

  return (
    <div className="draw-bar" ref={root} onKeyDown={(e) => e.stopPropagation()}>
      {all.map((g) => {
        const tools = groupTools(g.id);
        const cur = last[g.id] && tools.includes(last[g.id]) ? last[g.id] : tools[0];
        const active = groupOf(p.tool) === g.id;
        return (
          <div key={g.id} className="db-group">
            <button className={active ? 'on' : ''} title={`${nameOf(active ? p.tool : cur)}`} onClick={() => pick(g.id, active ? p.tool : cur)}>
              <ToolIcon tool={active ? p.tool : cur} />
            </button>
            <button className="db-more" title={`Mở nhóm: ${g.name}`} onClick={(e) => {
              const r = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect(), base = root.current!.getBoundingClientRect();
              setOpen(open?.g === g.id ? null : { g: g.id, top: Math.max(0, Math.min(r.top - base.top, base.height - 440)) }); // không tràn khỏi đáy
            }}>›</button>
          </div>
        );
      })}
      <button className={p.tool === 'zoom' ? 'on' : ''} title="Phóng to vùng (kéo chọn khoảng thời gian)" onClick={() => p.setTool(p.tool === 'zoom' ? 'cursor' : 'zoom')}><ToolIcon tool="zoom" /></button>
      {fav.length > 0 && <span className="sep" />}
      {fav.map((t) => (
        <button key={t} className={`db-fav${p.tool === t ? ' on' : ''}`} title={`★ ${nameOf(t)}`} onClick={() => p.setTool(p.tool === t ? 'cursor' : t)}><ToolIcon tool={t} size={16} /></button>
      ))}
      <span className="sep" />
      <button className={p.magnet ? 'on' : ''} title="Nam châm: bắt dính vào Mở/Cao/Thấp/Đóng của nến" onClick={() => p.setMagnet(!p.magnet)}><Svg d="M6 3v8a6 6 0 0 0 12 0V3h-4v8a2 2 0 0 1-4 0V3zM6 7h4M14 7h4" /></button>
      <button className={p.keep ? 'on' : ''} title="Giữ chế độ vẽ (vẽ liên tục nhiều hình)" onClick={() => p.setKeep(!p.keep)}><Svg d="M5 19l4-1l10-10l-3-3L6 15zM14 6l3 3M4 22h16" /></button>
      <button className={p.lockAll ? 'on' : ''} title={p.lockAll ? 'Mở khoá tất cả hình vẽ' : 'Khoá tất cả hình vẽ (không kéo nhầm)'} onClick={() => p.setLockAll(!p.lockAll)}>
        <Svg d={p.lockAll ? 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4' : 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 7.5-2'} /></button>
      <button className={p.hidden ? 'on' : ''} title={p.hidden ? 'Hiện hình vẽ' : 'Ẩn tất cả hình vẽ'} onClick={() => p.setHidden(!p.hidden)}>
        <Svg d={p.hidden ? 'M3 3l18 18M10.6 6.1A9 9 0 0 1 21 12a14 14 0 0 1-3 3.6M6.6 6.6A14 14 0 0 0 3 12s3 6 9 6a8.8 8.8 0 0 0 4-1' : 'M2 12s4-7 10-7s10 7 10 7s-4 7-10 7S2 12 2 12zM12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0'} /></button>
      <button title="Hoàn tác (Ctrl+Z)" disabled={!p.canUndo} onClick={p.onUndo}><Svg d="M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3" /></button>
      <button title={`Xoá tất cả hình vẽ (${p.count})`} disabled={!p.count} onClick={p.onClear}><Svg d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" /></button>
      <span className="sep" />
      <button title="Đặt lại biểu đồ (Alt+R)" onClick={p.onReset}><Svg d="M4 12a8 8 0 1 0 2.3-5.7M4 4v5h5" /></button>

      {open && (
        <div className="db-fly" style={{ top: Math.max(0, open.top - 4) }}>
          <div className="db-fly-h">{all.find((g) => g.id === open.g)?.name}</div>
          {open.g === 'emoji' ? (
            <div className="db-emoji">{EMOJIS.map((e) => <button key={e} onClick={() => pick('emoji', `emoji:${e}`)}>{e}</button>)}</div>
          ) : groupTools(open.g).map((t) => (
            <div key={t} className={`db-item${p.tool === t ? ' on' : ''}`} onClick={() => pick(open.g, t)}>
              <ToolIcon tool={t} /><span>{nameOf(t)}</span>
              {t !== 'cursor' && t !== 'eraser' && (
                <button className={`db-star${fav.includes(t) ? ' on' : ''}`} title="Ghim vào thanh công cụ" onClick={(e) => { e.stopPropagation(); toggleFav(t); }}>★</button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Thanh chỉnh sửa nổi cho hình đang chọn: màu, độ dày, kiểu nét, tô nền, kéo dài, chữ, khoá, nhân bản, xoá */
export function DrawEditBar({ d, onChange, onDelete, onClone, canFill, canExtend, hasText }: {
  d: Drawing; onChange: (patch: Partial<Drawing>) => void; onDelete: () => void; onClone: () => void; canFill: boolean; canExtend: boolean; hasText: boolean;
}) {
  const [pal, setPal] = useState(false);
  return (
    <div className="draw-edit" onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
      <span className="de-name">{defOf(d.type)?.name || d.type}</span>
      <div className="de-color">
        <button title="Màu" onClick={() => setPal((v) => !v)}><i style={{ background: d.color }} /></button>
        {pal && <div className="de-pal">{COLORS.map((c) => <button key={c} style={{ background: c }} onClick={() => { onChange({ color: c }); setPal(false); }} />)}</div>}
      </div>
      <select value={d.width || 1.5} onChange={(e) => onChange({ width: +e.target.value })} title="Độ dày nét">
        {[1, 1.5, 2, 3, 4, 6].map((w) => <option key={w} value={w}>{w}px</option>)}
      </select>
      <select value={d.style || 'solid'} onChange={(e) => onChange({ style: e.target.value as Drawing['style'] })} title="Kiểu nét">
        <option value="solid">━ Liền</option><option value="dashed">╍ Đứt</option><option value="dotted">┅ Chấm</option>
      </select>
      {canFill && <button className={d.fill !== false ? 'on' : ''} onClick={() => onChange({ fill: d.fill === false })} title="Tô nền">▨</button>}
      {canExtend && <>
        <button className={d.extL ? 'on' : ''} onClick={() => onChange({ extL: !d.extL })} title="Kéo dài sang trái">⇤</button>
        <button className={d.extR ? 'on' : ''} onClick={() => onChange({ extR: !d.extR })} title="Kéo dài sang phải">⇥</button>
      </>}
      {hasText && <input value={d.text || ''} placeholder="Nội dung" onChange={(e) => onChange({ text: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />}
      <button className={d.locked ? 'on' : ''} onClick={() => onChange({ locked: !d.locked })} title={d.locked ? 'Mở khoá' : 'Khoá (không kéo được)'}>{d.locked ? '🔒' : '🔓'}</button>
      <button onClick={onClone} title="Nhân bản">⧉</button>
      <button onClick={onDelete} title="Xoá (Delete)">🗑</button>
    </div>
  );
}
