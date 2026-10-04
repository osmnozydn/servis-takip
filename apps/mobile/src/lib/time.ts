// Tarih/saat yardımcıları (Türkiye saati, UTC+3, yaz saati yok)
const TR_OFFSET_MS = 3 * 3600_000;

export function todayTR(): string {
  return new Date(Date.now() + TR_OFFSET_MS).toISOString().slice(0, 10);
}

/** "2026-10-05T06:30" → "Yarın 06:30" / "Pazartesi 06:30" / "Bugün 16:30" */
export function friendlyNextOpen(iso: string | null | undefined): string {
  if (!iso) return 'tanımlı bir saat yok';
  const [date, time] = iso.split('T');
  const today = todayTR();
  const tomorrow = new Date(Date.parse(today) + 86400_000).toISOString().slice(0, 10);
  if (date === today) return `bugün ${time}`;
  if (date === tomorrow) return `yarın ${time}`;
  const days = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
  return `${days[new Date(date + 'T12:00:00Z').getUTCDay()]} ${time}`;
}

/** Bir zamandan bu yana geçen süre: "az önce", "3 dk önce", "2 sa önce" */
export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—';
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 30) return 'az önce';
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} dk önce`;
  if (s < 86400) return `${Math.round(s / 3600)} sa önce`;
  return `${Math.round(s / 86400)} gün önce`;
}

/** Saniye → "12 dk" / "1 sa 5 dk" */
export function duration(s: number | null | undefined): string {
  if (s == null) return '—';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} dk`;
  return `${Math.floor(m / 60)} sa ${m % 60} dk`;
}
