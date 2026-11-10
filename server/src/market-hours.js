// Lịch giao dịch HOSE/HNX/UPCOM theo giờ Việt Nam (UTC+7)
function vnNow(d = new Date()) {
  const t = new Date(d.getTime() + 7 * 3600_000);
  return { day: t.getUTCDay(), min: t.getUTCHours() * 60 + t.getUTCMinutes() };
}

export function sessionOf(d = new Date()) {
  const { day, min } = vnNow(d);
  if (day === 0 || day === 6) return 'CLOSED';
  if (min >= 9 * 60 && min < 9 * 60 + 15) return 'ATO';
  if (min >= 9 * 60 + 15 && min < 11 * 60 + 30) return 'CONTINUOUS';
  if (min >= 11 * 60 + 30 && min < 13 * 60) return 'BREAK';
  if (min >= 13 * 60 && min < 14 * 60 + 30) return 'CONTINUOUS';
  if (min >= 14 * 60 + 30 && min < 14 * 60 + 45) return 'ATC';
  if (min >= 14 * 60 + 45 && min < 15 * 60) return 'PUT_THROUGH';
  if (min >= 8 * 60 + 30 && min < 9 * 60) return 'PRE_OPEN';
  return 'CLOSED';
}

export function isTradingActive(d = new Date()) {
  return ['ATO', 'CONTINUOUS', 'ATC', 'PUT_THROUGH'].includes(sessionOf(d));
}
