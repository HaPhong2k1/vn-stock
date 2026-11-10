import { useGlobal } from '../lib/hooks';

const SESSION: Record<string, string> = {
  PRE_OPEN: 'Chờ mở cửa', ATO: 'Phiên ATO', CONTINUOUS: 'Khớp lệnh liên tục', BREAK: 'Nghỉ trưa',
  ATC: 'Phiên ATC', PUT_THROUGH: 'Thỏa thuận', CLOSED: 'Đóng cửa',
};

export function StatusBar() {
  const f = useGlobal();
  const st = f.status;
  const feedAge = st?.feed.lastMsgAt ? Math.round((Date.now() - f.clockSkew - st.feed.lastMsgAt) / 1000) : null;
  const ok = f.conn === 'open' && st?.feed.connected;
  return (
    <div className="status-bar">
      <span className={`dot ${ok ? 'ok' : f.conn === 'connecting' ? 'warn' : 'bad'}`} />
      <span>{ok ? 'Realtime' : f.conn === 'open' ? 'Mất kết nối nguồn' : 'Đang kết nối…'}</span>
      <span>· {SESSION[st?.session || ''] || '—'}</span>
      <span>· Trễ mạng {f.latency} ms</span>
      {feedAge !== null && <span>· Tin cuối {feedAge}s trước</span>}
      {st?.provider === 'sim' && <span className="sim">GIẢ LẬP</span>}
      <span className="clock">{new Date().toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}</span>
    </div>
  );
}
