const IST: Intl.DateTimeFormatOptions = { timeZone: 'Asia/Kolkata' };

export function fmtDate(iso?: string | null) {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00+05:30' : iso);
  return d.toLocaleDateString('en-IN', { ...IST, day: '2-digit', month: 'short', year: 'numeric' });
}
export function fmtDateTime(iso?: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', { ...IST, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
export function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-IN', { ...IST, hour: '2-digit', minute: '2-digit' });
}
export function relTime(iso?: string | null) {
  if (!iso) return '—';
  const diff = (Date.now() - new Date(iso.length === 10 ? iso + 'T00:00:00+05:30' : iso).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  const days = Math.floor(diff / 86400);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  return fmtDate(iso);
}
export const num = (n?: number | null) => (n === null || n === undefined ? '—' : n.toLocaleString('en-IN'));
export const pct = (n?: number | null) => (n === null || n === undefined ? '—' : `${n.toFixed(n % 1 ? 1 : 0)}%`);
export const monthLabel = (m: string) => {
  const [y, mo] = m.split('-');
  return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
};
export const isoToday = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
export const isoDaysAgo = (n: number) => new Date(Date.now() + 5.5 * 3600 * 1000 - n * 86400000).toISOString().slice(0, 10);
export const bytes = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** ₹ with Indian digit grouping: ₹35,00,000 */
export const inr = (n?: number | null) => (n === null || n === undefined ? '—' : `₹${Math.round(n).toLocaleString('en-IN')}`);
/** Compact Indian units: ₹35 L, ₹4.1 Cr */
export function inrShort(n?: number | null) {
  if (n === null || n === undefined) return '—';
  if (Math.abs(n) >= 1e7) return `₹${(n / 1e7).toFixed(n >= 1e8 ? 0 : 2).replace(/\.?0+$/, '')} Cr`;
  if (Math.abs(n) >= 1e5) return `₹${(n / 1e5).toFixed(n >= 1e6 ? 1 : 2).replace(/\.?0+$/, '')} L`;
  return inr(n);
}
export const daysWord = (n: number) => `${n} day${Math.abs(n) === 1 ? '' : 's'}`;
