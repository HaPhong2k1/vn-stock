import { useEffect, useMemo, useRef, useState } from 'react';
import { feed } from '../lib/feed';

export interface SymbolInfo { s: string; name: string; ex: string; type: 'stock' | 'etf' | 'futures' | 'index' }

let cache: Promise<SymbolInfo[]> | null = null;
const loadSymbols = () => {
  if (!cache) cache = fetch('/api/symbols').then((r) => r.json()).catch(() => { cache = null; return []; });
  return cache;
};

const CATS = [['all', 'Tất cả'], ['stock', 'Cổ phiếu'], ['etf', 'ETF'], ['futures', 'Hợp đồng tương lai'], ['index', 'Chỉ số']] as const;
// HĐ tương lai theo kỳ hạn gần -> xa
const FUT_ORDER = ['VN30F1M', 'VN30F2M', 'VN30F1Q', 'VN30F2Q'];
const order = (x: { s: string }) => { const i = FUT_ORDER.indexOf(x.s); return i < 0 ? 99 : i; };
const TYPE_LABEL: Record<string, string> = { stock: 'cổ phiếu', etf: 'ETF', futures: 'phái sinh', index: 'chỉ số' };
// bỏ dấu tiếng Việt để tìm "son ha" ra "Sơn Hà"
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toUpperCase();

function Hl({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const i = fold(text).indexOf(q);
  if (i < 0) return <>{text}</>;
  return <>{text.slice(0, i)}<mark>{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>;
}

interface Props { initial?: string; onSelect: (s: string) => void; onClose: () => void }

/** Hộp "Tìm kiếm mã giao dịch" kiểu TradingView/Fiant: gõ mã hoặc tên công ty (có/không dấu) */
export function SymbolSearch({ initial = '', onSelect, onClose }: Props) {
  const [all, setAll] = useState<SymbolInfo[]>([]);
  const [q, setQ] = useState(initial);
  const [cat, setCat] = useState<string>('all');
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => { loadSymbols().then(setAll); }, []);
  useEffect(() => { const el = input.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, []);

  const fq = fold(q.trim());
  const results = useMemo(() => {
    const pool = cat === 'all' ? all : all.filter((x) => x.type === cat);
    if (!fq) {
      // chưa gõ: ưu tiên phái sinh, chỉ số, VN30
      const pri = new Set(['VN30F1M', 'VNINDEX', 'VN30', ...(feed.groups.VN30 || [])]);
      return [...pool].sort((a, b) => Number(pri.has(b.s)) - Number(pri.has(a.s)) || order(a) - order(b) || a.s.localeCompare(b.s)).slice(0, 60);
    }
    const scored: [number, SymbolInfo][] = [];
    for (const x of pool) {
      const code = x.s.toUpperCase(), name = fold(x.name);
      let sc = -1;
      if (code === fq) sc = 0;
      else if (code.startsWith(fq)) sc = 1;
      else if (code.includes(fq)) sc = 2;
      else {
        // tên: khớp trọn từ (VD "SON HA" ≠ "SON HAI") ưu tiên hơn khớp một phần
        const at = name.indexOf(fq);
        if (at >= 0) {
          const before = at === 0 || name[at - 1] === ' ', after = name[at + fq.length];
          sc = before && (after === undefined || after === ' ') ? 3 : before ? 4 : 5;
        }
      }
      if (sc >= 0) scored.push([sc * 100 + Math.min(code.length, 99), x]);
    }
    return scored.sort((a, b) => a[0] - b[0] || order(a[1]) - order(b[1]) || a[1].s.localeCompare(b[1].s)).slice(0, 60).map((x) => x[1]);
  }, [all, fq, cat]);

  useEffect(() => { setSel(0); }, [fq, cat]);
  useEffect(() => { list.current?.querySelector('.on')?.scrollIntoView({ block: 'nearest' }); }, [sel]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: all.length };
    for (const x of all) c[x.type] = (c[x.type] || 0) + 1;
    return c;
  }, [all]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((i) => Math.min(results.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter' && results[sel]) { e.preventDefault(); onSelect(results[sel].s); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
  };

  return (
    <div className="ss-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ss" role="dialog" aria-label="Tìm kiếm mã giao dịch" onKeyDown={onKey}>
        <div className="ss-head">
          <b>Tìm kiếm Mã giao dịch</b>
          <button className="close" onClick={onClose} aria-label="Đóng">✕</button>
        </div>
        <div className="ss-input">
          <span>🔍</span>
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nhập mã hoặc tên công ty (VD: SHI, VN30F1M, son ha)" spellCheck={false} />
          {q && <button className="icon" onClick={() => { setQ(''); input.current?.focus(); }}>✕</button>}
        </div>
        <div className="ss-cats">
          {CATS.filter(([k]) => k === 'all' || counts[k]).map(([k, l]) => (
            <button key={k} className={cat === k ? 'on' : ''} onClick={() => { setCat(k); input.current?.focus(); }}>
              {l}{counts[k] ? <small> {counts[k]}</small> : null}
            </button>
          ))}
        </div>
        <div className="ss-list" ref={list}>
          <div className="ss-row ss-th"><span>MÃ</span><span>MÔ TẢ</span><span /></div>
          {results.map((x, i) => {
            const st = feed.stocks.get(x.s);
            const pc = st?.last ? st.chgPc : null;
            return (
              <div key={x.s} className={`ss-row${i === sel ? ' on' : ''}`} onMouseEnter={() => setSel(i)} onClick={() => onSelect(x.s)}>
                <span className="ss-code"><Hl text={x.s} q={fq} /></span>
                <span className="ss-name"><Hl text={x.name || '—'} q={fq} /></span>
                <span className="ss-meta">
                  {pc !== null && <b className={pc > 0 ? 'c-up' : pc < 0 ? 'c-down' : 'c-ref'}>{pc > 0 ? '+' : ''}{pc.toFixed(2)}%</b>}
                  <small>{TYPE_LABEL[x.type]}</small> {x.ex === 'PS' ? 'HNX' : x.ex}
                </span>
              </div>
            );
          })}
          {!results.length && <div className="empty muted">{all.length ? `Không tìm thấy mã “${q}”` : 'Đang tải danh sách mã…'}</div>}
        </div>
        <div className="ss-foot muted">↑↓ chọn · Enter mở biểu đồ · Esc đóng · Mẹo: đang xem biểu đồ, chỉ cần gõ chữ là mở hộp tìm kiếm</div>
      </div>
    </div>
  );
}
