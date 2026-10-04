const TZ = 'Europe/Istanbul';

export const fmtTime = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat('tr-TR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : '—';

export const fmtTimeSec = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat('tr-TR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(iso)) : '—';

export const fmtDate = (d: string) =>
  new Intl.DateTimeFormat('tr-TR', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric', weekday: 'long' }).format(new Date(d + 'T00:00:00Z'));

export const todayTR = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);

export const minutesBetween = (a: string | null, b: string | null) =>
  a && b ? Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 60000)) : null;

export const fmtDistance = (m: number | null | undefined) =>
  m == null ? '—' : m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
