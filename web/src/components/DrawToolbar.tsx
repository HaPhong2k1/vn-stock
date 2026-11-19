import { TOOLS, type Tool } from '../lib/drawings';

const COLORS = ['#2962ff', '#f23645', '#089981', '#ff9800', '#e040fb', '#ffffff', '#000000'];
interface Props {
  tool: Tool; setTool: (t: Tool) => void; color: string; setColor: (c: string) => void;
  magnet: boolean; setMagnet: (v: boolean) => void; keep: boolean; setKeep: (v: boolean) => void;
  hidden: boolean; setHidden: (v: boolean) => void; count: number; canUndo: boolean; onUndo: () => void; onClear: () => void; onReset: () => void;
}

/** Thanh công cụ vẽ dọc bên trái biểu đồ */
export function DrawToolbar(p: Props) {
  return (
    <div className="draw-bar" onKeyDown={(e) => e.stopPropagation()}>
      {TOOLS.map((t) => (
        <button key={t.id} className={p.tool === t.id ? 'on' : ''} title={t.name} onClick={() => p.setTool(p.tool === t.id && t.id !== 'cursor' ? 'cursor' : t.id)}>{t.icon}</button>
      ))}
      <span className="sep" />
      <div className="draw-color" title="Màu hình vẽ">
        <i style={{ background: p.color }} />
        <div className="draw-pal">{COLORS.map((c) => <button key={c} style={{ background: c }} onClick={() => p.setColor(c)} aria-label={c} />)}</div>
      </div>
      <button className={p.magnet ? 'on' : ''} title="Nam châm: bắt dính vào giá Mở/Cao/Thấp/Đóng của nến" onClick={() => p.setMagnet(!p.magnet)}>🧲</button>
      <button className={p.keep ? 'on' : ''} title="Giữ công cụ sau khi vẽ (vẽ liên tục)" onClick={() => p.setKeep(!p.keep)}>🔒</button>
      <button className={p.hidden ? 'on' : ''} title={p.hidden ? 'Hiện hình vẽ' : 'Ẩn hình vẽ'} onClick={() => p.setHidden(!p.hidden)}>{p.hidden ? '🙈' : '👁'}</button>
      <button title="Hoàn tác (Ctrl+Z)" disabled={!p.canUndo} onClick={p.onUndo}>↶</button>
      <button title={`Xoá tất cả hình vẽ (${p.count})`} disabled={!p.count} onClick={p.onClear}>🗑</button>
      <span className="sep" />
      <button title="Đặt lại biểu đồ (Alt+R): về khung nhìn & thang giá mặc định" onClick={p.onReset}>⟲</button>
    </div>
  );
}
