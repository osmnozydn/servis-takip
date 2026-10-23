// Bildirim zili: servis başladı / tamamlandı bildirimleri. Yenileri canlı gelir, köşede kısa bir
// uyarı gösterir; tarayıcı izin verirse masaüstü bildirimi de çıkar (panel açıkken).
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

type Note = { id: number; kind: string; title: string; body: string; created_at: string; read_at: string | null };

const KIND_CLS: Record<string, string> = { trip_started: 'start', trip_completed: 'done', trip_closed: 'warn', bus_departed: 'start' };

function when(iso: string, now: number) {
  const m = Math.round((now - Date.parse(iso)) / 60000);
  if (m < 1) return 'şimdi';
  if (m < 60) return `${m} dk önce`;
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date(now).toDateString();
  return new Intl.DateTimeFormat('tr-TR', sameDay ? { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' }
    : { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' }).format(d);
}

export function NotificationBell({ userId }: { userId: string }) {
  const [items, setItems] = useState<Note[]>([]);
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<Note | null>(null);
  const [perm, setPerm] = useState<NotificationPermission | 'unsupported'>(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
  const [now, setNow] = useState(Date.now());
  const box = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from('notifications').select('id, kind, title, body, created_at, read_at')
      .order('created_at', { ascending: false }).limit(40);
    setItems((data ?? []) as Note[]);
  }, []);

  useEffect(() => {
    void load();
    const ch = supabase.channel(`notes-${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${userId}` }, (p) => {
        const n = p.new as Note;
        setItems((xs) => [n, ...xs.filter((x) => x.id !== n.id)].slice(0, 40));
        setToast(n);
        try {
          if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.visibilityState !== 'visible')
            new Notification(n.title, { body: n.body, tag: `n-${n.id}`, icon: '/favicon.svg' });
        } catch { /* yoksay */ }
      }).subscribe();
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => { supabase.removeChannel(ch); clearInterval(t); };
  }, [userId, load]);

  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 7000); return () => clearTimeout(t); }, [toast]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  const unread = items.filter((n) => !n.read_at).length;
  async function markAll() {
    setItems((xs) => xs.map((x) => ({ ...x, read_at: x.read_at ?? new Date().toISOString() })));
    await supabase.rpc('mark_notifications_read', { p_ids: null });
  }
  async function askPerm() {
    if (typeof Notification === 'undefined') return;
    setPerm(await Notification.requestPermission());
  }

  return (
    <div className="bell" ref={box}>
      <button type="button" className="bell-btn" aria-label={`Bildirimler${unread ? `, ${unread} okunmamış` : ''}`} aria-expanded={open}
        onClick={() => { setOpen(!open); setNow(Date.now()); }}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z" /><path d="M10 20a2 2 0 0 0 4 0" /></svg>
        {unread > 0 && <span className="bell-badge">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="bell-pop" role="dialog" aria-label="Bildirimler">
          <div className="bell-head">
            <b>Bildirimler</b>
            {unread > 0 && <button type="button" className="link small" onClick={markAll}>Tümünü okundu say</button>}
          </div>
          {perm === 'default' && (
            <button type="button" className="bell-perm" onClick={askPerm}>Panel arka plandayken de masaüstü bildirimi al</button>
          )}
          <ul>
            {items.length === 0 && <li className="bell-empty">Henüz bildirim yok. Servis başlayınca ve tamamlanınca burada görünür.</li>}
            {items.map((n) => (
              <li key={n.id} className={`${KIND_CLS[n.kind] ?? ''} ${n.read_at ? '' : 'unread'}`}>
                <i />
                <div>
                  <div className="bn-top"><b>{n.title}</b><span>{when(n.created_at, now)}</span></div>
                  <p>{n.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {toast && !open && (
        <div className={`toast ${KIND_CLS[toast.kind] ?? ''}`} role="status" onClick={() => { setToast(null); setOpen(true); }}>
          <i />
          <div><b>{toast.title}</b><p>{toast.body}</p></div>
        </div>
      )}
    </div>
  );
}
