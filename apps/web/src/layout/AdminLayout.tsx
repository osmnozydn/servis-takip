// Yönetim paneli düzeni: sol menü (telefonda çekmece), üst bar, içerik
import { useEffect, useState, type ReactNode } from 'react';
import type { SessionProfile } from '@servis/shared';
import { Avatar } from '../admin/ui';
import { NotificationBell } from './NotificationBell';

export type Page = 'overview' | 'passengers' | 'drivers' | 'vehicles' | 'factories' | 'trips' | 'admins' | 'platform';

const I = {
  overview: <path d="M3 13h8V3H3zM13 21h8v-8h-8zM13 3v6h8V3zM3 21h8v-4H3z" />,
  passengers: <><circle cx="9" cy="7" r="3.2" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" /><path d="M17 4.5a3 3 0 0 1 0 5.6M21 20c0-2.6-1.6-4.8-4-5.6" /></>,
  drivers: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="2.2" /><path d="M12 14.2V20.5M9.9 11.3 4 9.5M14.1 11.3 20 9.5" /></>,
  vehicles: <><rect x="3" y="5" width="18" height="11" rx="2.5" /><path d="M3 11h18M7 16v2.5M17 16v2.5" /><circle cx="7.5" cy="13.5" r=".6" /><circle cx="16.5" cy="13.5" r=".6" /></>,
  factories: <><path d="M3 21V10l6 3V10l6 3V6l6-3v18z" /><path d="M7 17h2M12 17h2M17 17h2" /></>,
  trips: <><path d="M4 19c4 0 3-7 8-7s4-7 8-7" /><circle cx="4" cy="19" r="1.8" /><circle cx="20" cy="5" r="1.8" /></>,
  admins: <><path d="M12 3 4 6v5c0 5 3.4 8.6 8 10 4.6-1.4 8-5 8-10V6z" /><path d="m9 12 2 2 4-4" /></>,
  platform: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><path d="M17.5 14v7M14 17.5h7" /></>,
};
const Icon = ({ name }: { name: keyof typeof I }) => <svg viewBox="0 0 24 24" aria-hidden="true">{I[name]}</svg>;

const COMPANY_PAGES: { id: Page; label: string; group?: string }[] = [
  { id: 'overview', label: 'Genel bakış' },
  { id: 'passengers', label: 'Yolcular ve duraklar', group: 'Operasyon' },
  { id: 'vehicles', label: 'Araçlar' },
  { id: 'drivers', label: 'Sürücüler' },
  { id: 'factories', label: 'Fabrikalar' },
  { id: 'trips', label: 'Sefer geçmişi', group: 'Kayıtlar' },
  { id: 'admins', label: 'Yönetim ekibi', group: 'Hesap' },
];
const todayLabel = () => new Intl.DateTimeFormat('tr-TR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Istanbul' }).format(new Date());

export function AdminLayout({ profile, page, onNavigate, onSignOut, title, subtitle, children }: {
  profile: SessionProfile; page: Page; onNavigate: (p: Page) => void; onSignOut: () => void;
  title: string; subtitle?: string; children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const company = profile.company;
  useEffect(() => { setOpen(false); window.scrollTo?.(0, 0); }, [page]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="app">
      <aside className={`side ${open ? 'open' : ''}`} aria-label="Ana menü">
        <div className="brand"><span className="logo">R</span><span>READY LIVE<small>Filo yönetimi</small></span></div>
        {company ? (
          <div className="side-company">
            <div className="name">{company.name}</div>
            <div className="code">Şirket kodu: {company.code}</div>
            {profile.is_platform_admin && <button className="link" onClick={() => onNavigate('platform')}>Şirket değiştir</button>}
          </div>
        ) : profile.is_platform_admin ? (
          <div className="side-company"><div className="name">Şirket seçilmedi</div><div className="code">Yönetmek için bir şirkete girin.</div></div>
        ) : null}
        <nav>
          {company && COMPANY_PAGES.map((p) => [
            p.group && <div key={`g-${p.group}`} className="group">{p.group}</div>,
            <button key={p.id} className={`navbtn ${page === p.id ? 'on' : ''}`} aria-current={page === p.id ? 'page' : undefined} onClick={() => onNavigate(p.id)}>
              <Icon name={p.id as keyof typeof I} />{p.label}
            </button>,
          ])}
          {profile.is_platform_admin && (<>
            <div className="group">Platform</div>
            <button className={`navbtn ${page === 'platform' ? 'on' : ''}`} aria-current={page === 'platform' ? 'page' : undefined} onClick={() => onNavigate('platform')}>
              <Icon name="platform" />Şirketler
            </button>
          </>)}
        </nav>
        <div className="side-user">
          <Avatar name={profile.full_name} />
          <div className="who"><b>{profile.full_name}</b><span>{profile.is_platform_admin ? 'Platform yöneticisi' : profile.role === 'operator' ? 'Operasyon sorumlusu' : 'Şirket yöneticisi'}</span></div>
          <button onClick={onSignOut}>Çıkış</button>
        </div>
      </aside>
      <div className={`scrim ${open ? 'open' : ''}`} onClick={() => setOpen(false)} />
      <div className="main">
        <header className="topbar">
          <button className="menubtn" aria-label="Menüyü aç" aria-expanded={open} onClick={() => setOpen(true)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          </button>
          <div className="titles">
            {subtitle && <div className="sub">{subtitle}</div>}
            <h1>{title}</h1>
          </div>
          <div className="spacer" />
          <div className="top-right">
            <span className="top-date">{todayLabel()}</span>
            <NotificationBell userId={profile.id} />
            <Avatar name={profile.full_name} />
          </div>
        </header>
        <div className="content">{children}</div>
      </div>
    </div>
  );
}
