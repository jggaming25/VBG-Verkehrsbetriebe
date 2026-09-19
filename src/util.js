export const uid = () =>
  Math.random().toString(36).slice(2, 9) + Date.now().toString(36);

export function sanitizeChannelName(name, fallback = 'ticket') {
  return (name || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80) || fallback;
}

export function parseHexColor(hex) {
  const v = String(hex || '').replace('#', '');
  if (/^[0-9a-fA-F]{6}$/.test(v)) return parseInt(v, 16);
  return 0x5865f2;
}

export function timeAgo(ts) {
  if (!ts) return '–';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function fmtDate(ts) {
  if (!ts) return '–';
  return new Date(ts).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
}

export function extractionId(input) {
  // akzeptiert "123456789", "<@123456789>", "<@!123456789>"
  const m = String(input).match(/(\d{15,20})/);
  return m ? m[1] : null;
}