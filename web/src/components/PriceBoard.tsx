import { useEffect, useRef, useState } from 'react';
import { Row } from './Row';

const ROW_H = 26;

interface Props { syms: string[]; watch: Set<string>; onPick: (s: string) => void; onToggleWatch: (s: string) => void }

/** Bảng giá có ảo hoá (chỉ render các dòng đang hiển thị) để mượt cả với 800+ mã UPCOM */
export function PriceBoard({ syms, watch, onPick, onToggleWatch }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState(0);
  const [height, setHeight] = useState(600);
  useEffect(() => {
    const el = box.current!;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => { box.current?.scrollTo(0, 0); }, [syms]);

  const start = Math.max(0, Math.floor(scroll / ROW_H) - 10);
  const end = Math.min(syms.length, Math.ceil((scroll + height) / ROW_H) + 10);

  return (
    <div className="board">
      <div className="head">
        <div className="hrow">
          <div className="cell r2">Mã</div>
          <div className="cell r2">Trần</div><div className="cell r2">Sàn</div><div className="cell r2">TC</div>
          <div className="cell c6">Dư mua</div>
          <div className="cell c4 match">Khớp lệnh</div>
          <div className="cell c6">Dư bán</div>
          <div className="cell r2">Tổng KL</div>
          <div className="cell c3">Giá</div>
          <div className="cell c3">Nước ngoài</div>
          <div className="cell">Giá 3</div><div className="cell">KL 3</div><div className="cell">Giá 2</div><div className="cell">KL 2</div><div className="cell">Giá 1</div><div className="cell">KL 1</div>
          <div className="cell match">Giá</div><div className="cell match">KL</div><div className="cell match">+/-</div><div className="cell match">%</div>
          <div className="cell">Giá 1</div><div className="cell">KL 1</div><div className="cell">Giá 2</div><div className="cell">KL 2</div><div className="cell">Giá 3</div><div className="cell">KL 3</div>
          <div className="cell">Cao</div><div className="cell">Thấp</div><div className="cell">TB</div>
          <div className="cell">Mua</div><div className="cell">Bán</div><div className="cell">Room</div>
        </div>
      </div>
      <div className="body" ref={box} onScroll={(e) => setScroll(e.currentTarget.scrollTop)}>
        <div style={{ height: syms.length * ROW_H, position: 'relative' }}>
          {syms.slice(start, end).map((s, i) => (
            <Row key={s} sym={s} top={(start + i) * ROW_H} watched={watch.has(s)} onPick={onPick} onToggleWatch={onToggleWatch} />
          ))}
        </div>
        {!syms.length && <div className="empty">Chưa có mã nào. Nhấn ★ ở bảng giá hoặc gõ mã vào ô tìm kiếm để thêm.</div>}
      </div>
    </div>
  );
}
