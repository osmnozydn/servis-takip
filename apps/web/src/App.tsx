import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  acceptConsent, changePassword, consentCheckboxLabel, consentSections, loadProfile, MIN_PASSWORD_LENGTH,
  nextStep, ROLE_LABELS, signIn, validateNewPassword, type SessionProfile,
} from '@servis/shared';
import { isConfigured, supabase } from './lib/supabase';
import { AdminLayout, type Page } from './layout/AdminLayout';
import { RouteArt } from './layout/RouteArt';
import { Dashboard } from './admin/Dashboard';
import { TripHistory } from './admin/TripHistory';
import { Platform } from './admin/Platform';
import { Vehicles } from './admin/Vehicles';
import { Drivers } from './admin/Drivers';
import { Passengers } from './admin/Passengers';
import { Admins } from './admin/Admins';

const LAST_CODE_KEY = 'last_company_code';
const storage = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* yoksay */ } },
};

// Akış: giriş → (ilk girişse) şifre değiştir → (rıza yoksa) KVKK → yönetim paneli
export default function App() {
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<SessionProfile | null>(null);
  const refresh = useCallback(async () => setProfile(await loadProfile(supabase)), []);

  useEffect(() => {
    if (!isConfigured) { setLoading(false); return; }
    refresh().finally(() => setLoading(false));
    const { data } = supabase.auth.onAuthStateChange((e) => {
      if (e === 'SIGNED_IN' || e === 'SIGNED_OUT' || e === 'USER_UPDATED') setTimeout(refresh, 0);
    });
    return () => data.subscription.unsubscribe();
  }, [refresh]);

  const signOut = async () => { await supabase.auth.signOut(); setProfile(null); };

  if (!isConfigured) return <AuthShell><p className="err box">VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY tanımlı değil (apps/web/.env).</p></AuthShell>;
  if (loading) return <div className="auth-form" style={{ minHeight: '100vh' }}><p className="muted">Yükleniyor…</p></div>;

  switch (nextStep(profile)) {
    case 'login': return <Login onDone={refresh} />;
    case 'change_password': return <ChangePassword profile={profile!} onDone={refresh} onSignOut={signOut} />;
    case 'consent': return <Consent profile={profile!} onDone={refresh} onSignOut={signOut} />;
    default: return <Home profile={profile!} onSignOut={signOut} onRefresh={refresh} />;
  }
}

/** Giriş ve hesap adımlarının ortak çerçevesi: solda rota çizimi, sağda form */
function AuthShell({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className={`auth ${wide ? 'auth-wide' : ''}`}>
      <aside className="auth-art">
        <div className="brand"><span className="logo">S</span><span>Servis Takip<small>Filo yönetimi</small></span></div>
        <h1>Servisleriniz, durak durak.</h1>
        <p>Araçlarınızı canlı izleyin, yolcuları alış sırasıyla yönetin, her seferin hangi durağa kaçta uğradığını görün.</p>
        <div className="art-stage">
          <RouteArt />
          <div className="glass livecard" aria-hidden="true">
            <div className="lc-top"><span className="lc-dot" />Yolda · canlı</div>
            <div className="lc-plate"><span className="plate"><span className="tr">TR</span><span className="no">34 SRV 07</span></span></div>
            <div className="lc-row"><span>Sıradaki durak</span><b>Moda, Kadıköy</b></div>
            <div className="lc-row"><span>Tahmini varış</span><b>3 dk</b></div>
          </div>
        </div>
        <ul className="auth-facts">
          <li>Canlı konum</li>
          <li>Durak durak rota</li>
          <li>Sefer geçmişi</li>
        </ul>
      </aside>
      <main className="auth-form">
        <div className="auth-box">{children}</div>
        <div className="auth-legal">© {new Date().getFullYear()} Servis Takip · Her şirketin verisi ayrı tutulur</div>
      </main>
    </div>
  );
}

function Login({ onDone }: { onDone: () => Promise<void> }) {
  const [code, setCode] = useState(storage.get(LAST_CODE_KEY) ?? '');
  const [ident, setIdent] = useState('');
  const [pw, setPw] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const r = await signIn(supabase, code, ident, pw);
    if (r.ok) { storage.set(LAST_CODE_KEY, code.trim().toLowerCase()); await onDone(); }
    else { setError(r.message); setPw(''); }
    setBusy(false);
  }

  return (
    <AuthShell>
      <h2>Yönetim paneline giriş</h2>
      <p className="muted">Şirketinizin kodu ve size verilen bilgilerle giriş yapın.</p>
      <form onSubmit={submit}>
        {error && <p className="err box" role="alert">{error}</p>}
        <label>Şirket kodu
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="örn. demo" autoCapitalize="none" autoComplete="organization" />
        </label>
        <label>Kullanıcı adı veya telefon
          <input value={ident} onChange={(e) => setIdent(e.target.value)} placeholder="örn. yonetici" autoCapitalize="none" autoComplete="username" />
        </label>
        <label>Şifre
          <div className="inline">
            <input type={show ? 'text' : 'password'} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" />
            <button type="button" className="ghost small" onClick={() => setShow(!show)} aria-pressed={show}>{show ? 'Gizle' : 'Göster'}</button>
          </div>
        </label>
        <button type="submit" disabled={busy}>{busy ? 'Giriş yapılıyor…' : 'Giriş yap'}</button>
      </form>
      <div className="auth-foot">
        Sürücü ve yolcular giriş için mobil uygulamayı kullanır. Platform yöneticisi şirket kodu olarak <b>platform</b> yazar.
      </div>
    </AuthShell>
  );
}

function ChangePassword({ profile, onDone, onSignOut }: { profile: SessionProfile; onDone: () => Promise<void>; onSignOut: () => void }) {
  const [pw, setPw] = useState(''); const [pw2, setPw2] = useState('');
  const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const v = validateNewPassword(pw, pw2); if (v) { setError(v); return; }
    setBusy(true); setError(null);
    const r = await changePassword(supabase, profile.id, pw);
    if (!r.ok) setError(r.message); else await onDone();
    setBusy(false);
  }
  return (
    <AuthShell>
      <h2>Şifrenizi belirleyin</h2>
      <p className="muted">Hoş geldiniz, {profile.full_name.split(' ')[0]}. Güvenliğiniz için size verilen geçici şifreyi değiştirin.</p>
      <form onSubmit={submit}>
        {error && <p className="err box" role="alert">{error}</p>}
        <label>Yeni şifre<input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></label>
        <small className="muted hint" style={{ marginTop: -8, marginBottom: 14 }}>En az {MIN_PASSWORD_LENGTH} karakter, bir harf ve bir rakam</small>
        <label>Yeni şifre (tekrar)<input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" /></label>
        <button type="submit" disabled={busy}>Şifreyi kaydet</button>
        <button type="button" className="ghost" onClick={onSignOut}>Çıkış yap</button>
      </form>
    </AuthShell>
  );
}

function Consent({ profile, onDone, onSignOut }: { profile: SessionProfile; onDone: () => Promise<void>; onSignOut: () => void }) {
  const [checked, setChecked] = useState(false); const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function accept() {
    setBusy(true); setError(null);
    if (await acceptConsent(supabase, profile.id)) await onDone(); else setError('Kaydedilemedi. Tekrar deneyin.');
    setBusy(false);
  }
  return (
    <AuthShell wide>
      <h2>Kişisel verilerin korunması</h2>
      <p className="muted">KVKK aydınlatma metni ve açık rıza</p>
      <div className="consent">
        {consentSections(profile.role).map((s) => <section key={s.title}><h3>{s.title}</h3><p>{s.body}</p></section>)}
      </div>
      {error && <p className="err box">{error}</p>}
      <label className="check"><input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />{consentCheckboxLabel(profile.role)}</label>
      <div className="actions">
        <button disabled={!checked || busy} onClick={accept}>Onayla ve devam et</button>
        <button className="ghost" onClick={onSignOut}>Onaylamıyorum, çıkış yap</button>
      </div>
    </AuthShell>
  );
}

const PAGE_TITLES: Record<Page, string> = {
  overview: 'Genel bakış', passengers: 'Yolcular ve duraklar', drivers: 'Sürücüler', vehicles: 'Araçlar',
  trips: 'Sefer geçmişi', admins: 'Yöneticiler', platform: 'Şirketler',
};

function Home({ profile, onSignOut, onRefresh }: { profile: SessionProfile; onSignOut: () => void; onRefresh: () => Promise<void> }) {
  const company = profile.company;
  const [page, setPage] = useState<Page>(profile.is_platform_admin && !company ? 'platform' : 'overview');

  async function enterCompany(id: string | null) {
    await supabase.rpc('platform_enter_company', { p_company: id });
    await onRefresh();
    setPage(id ? 'overview' : 'platform');
  }

  if (profile.role !== 'admin') {
    return (
      <AuthShell>
        <h2>Merhaba, {profile.full_name.split(' ')[0]}</h2>
        <p className="muted">Bu panel şirket yöneticileri içindir. {ROLE_LABELS[profile.role]} olarak lütfen mobil uygulamayı kullanın.</p>
        <button className="ghost" onClick={onSignOut}>Çıkış yap</button>
      </AuthShell>
    );
  }

  const current: Page = profile.is_platform_admin && !company ? 'platform' : page;
  const sub = current === 'platform' ? 'Her şirket ayrı bir projedir; birbirlerinin verisini göremezler.' : company ? company.name : '';

  return (
    <AdminLayout profile={profile} page={current} onNavigate={setPage} onSignOut={onSignOut}
      title={PAGE_TITLES[current]} subtitle={sub}>
      <div key={`${company?.id ?? 'none'}-${current}`}>
        {current === 'platform' && <Platform activeCompanyId={company?.id ?? null} onEnter={enterCompany} />}
        {company && current === 'overview' && <Dashboard name={profile.full_name} onNavigate={setPage} />}
        {company && current === 'trips' && <section><TripHistory /></section>}
        {company && current === 'vehicles' && <Vehicles companyId={company.id} />}
        {company && current === 'drivers' && <Drivers companyId={company.id} companyCode={company.code} />}
        {company && current === 'passengers' && <Passengers companyId={company.id} companyCode={company.code} />}
        {company && current === 'admins' && <Admins companyCode={company.code} myId={profile.id} />}
      </div>
    </AdminLayout>
  );
}
