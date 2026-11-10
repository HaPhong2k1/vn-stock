import type { Stock } from './types';

export const fmtPrice = (v: number | string | undefined) => {
  if (v === undefined || v === null || v === 0 || v === '0') return '';
  if (typeof v === 'string') return v;           // ATO / ATC
  return v >= 1000 ? v.toFixed(1) : v.toFixed(2); // phái sinh (điểm) hiển thị 1 số lẻ
};
export const fmtVol = (v: number | undefined) => (!v ? '' : v.toLocaleString('vi-VN'));
export const fmtBig = (v: number | undefined) => {
  if (!v) return '';
  if (v >= 1e9) return (v / 1e9).toFixed(2) + ' tỷ';
  if (v >= 1e6) return (v / 1e6).toFixed(2) + ' tr';
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'k';
  return String(v);
};

/** Màu chuẩn bảng giá VN: tím=trần, xanh lam=sàn, vàng=tham chiếu, xanh lá=tăng, đỏ=giảm */
export function priceClass(p: number | string | undefined, st: Pick<Stock, 'ref' | 'ceil' | 'floor'>) {
  if (typeof p !== 'number' || !p || !st.ref) return '';
  if (p >= st.ceil) return 'c-ceil';
  if (p <= st.floor) return 'c-floor';
  if (Math.abs(p - st.ref) < 1e-9) return 'c-ref';
  return p > st.ref ? 'c-up' : 'c-down';
}
