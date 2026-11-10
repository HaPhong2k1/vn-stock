/**
 * Giữ server không "ngủ" trên gói miễn phí của Render (ngủ sau 15 phút không có request từ ngoài).
 * Render tự cấp RENDER_EXTERNAL_URL; server tự gọi vào URL công khai của mình mỗi 10 phút.
 * Có thể tắt bằng KEEPALIVE=0. Nên dùng thêm dịch vụ ping ngoài (UptimeRobot/cron-job.org) làm dự phòng.
 */
export function startKeepAlive(log = console) {
  const base = process.env.KEEPALIVE_URL || process.env.RENDER_EXTERNAL_URL;
  if (!base || process.env.KEEPALIVE === '0') return;
  const url = `${base.replace(/\/$/, '')}/api/health`;
  const ping = () => fetch(url, { signal: AbortSignal.timeout(20_000) })
    .then((r) => { if (!r.ok) log.warn('[keepalive]', r.status); })
    .catch((e) => log.warn('[keepalive]', e.message));
  setInterval(ping, 10 * 60_000);
  log.info(`[keepalive] tự ping ${url} mỗi 10 phút`);
}
