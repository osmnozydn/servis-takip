import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  acceptConsent, changePassword, consentCheckboxLabel, consentSections, formatPhone, loadProfile, MIN_PASSWORD_LENGTH,
  nextStep, ROLE_LABELS, signIn, validateNewPassword, type SessionProfile,
} from '@servis/shared';
import { isConfigured, supabase } from './lib/supabase';

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

  if (!isConfigured) return <Shell><p className="err">VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY tanımlı değil (apps/web/.env).</p></Shell>;
  if (loading) return <Shell><p className="muted">Yükleniyor…</p></Shell>;

  switch (nextStep(profile)) {
    case 'login': return <Login onDone={refresh} />;
    case 'change_password': return <ChangePassword profile={profile!} onDone={refresh} onSignOut={signOut} />;
    case 'consent': return <Consent profile={profile!} onDone={refresh} onSignOut={signOut} />;
    default: return <Home profile={profile!} onSignOut={signOut} />;
  }
}

function Shell({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <main className={wide ? 'card wide' : 'card'}>
      <div className="brand"><span className="logo">S</span><span>Servis Takip</span></div>
      {children}
    </main>
  );
}

function Login({ onDone }: { onDone: () => Promise<void> }) {
  const [code, setCode] = useState(storage.get(LAST_CODE_KEY) ?? '');
  const [ident, setIdent] = useState('');
  const [pw, setPw] = useState('');
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
    <Shell>
      <h1>Giriş yap</h1>
      <p className="muted">Yönetim paneli</p>
      <form onSubmit={submit}>
        {error && <p className="err box">{error}</p>}
        <label>Şirket kodu<input value={code} onChange={(e) => setCode(e.target.value)} placeholder="örn. demo" autoCapitalize="none" /></label>
        <label>Kullanıcı adı veya telefon<input value={ident} onChange={(e) => setIdent(e.target.value)} placeholder="örn. yonetici" autoCapitalize="none" /></label>
        <label>Şifre<input type="password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
        <button disabled={busy}>{busy ? 'Giriş yapılıyor…' : 'Giriş yap'}</button>
      </form>
    </Shell>
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
    <Shell>
      <h1>Şifrenizi belirleyin</h1>
      <p className="muted">Güvenliğiniz için geçici şifrenizi değiştirin.</p>
      <form onSubmit={submit}>
        {error && <p className="err box">{error}</p>}
        <label>Yeni şifre<input type="password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
        <small className="muted">En az {MIN_PASSWORD_LENGTH} karakter, bir harf ve bir rakam</small>
        <label>Yeni şifre (tekrar)<input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></label>
        <button disabled={busy}>Şifreyi kaydet</button>
        <button type="button" className="ghost" onClick={onSignOut}>Çıkış yap</button>
      </form>
    </Shell>
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
    <Shell wide>
      <h1>Kişisel Verilerin Korunması</h1>
      <p className="muted">KVKK Aydınlatma Metni ve Açık Rıza</p>
      <div className="consent">
        {consentSections(profile.role).map((s) => <section key={s.title}><h3>{s.title}</h3><p>{s.body}</p></section>)}
      </div>
      {error && <p className="err box">{error}</p>}
      <label className="check"><input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />{consentCheckboxLabel(profile.role)}</label>
      <div className="actions">
        <button disabled={!checked || busy} onClick={accept}>Onayla ve devam et</button>
        <button className="ghost" onClick={onSignOut}>Onaylamıyorum, çıkış yap</button>
      </div>
    </Shell>
  );
}

type Row = { id: string; full_name: string; username: string; role: keyof typeof ROLE_LABELS; phone: string | null; vehicle: { plate: string } | null };

function Home({ profile, onSignOut }: { profile: SessionProfile; onSignOut: () => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => {
    if (profile.role !== 'admin') return;
    supabase.from('profiles').select('id, full_name, username, role, phone, vehicle:vehicles(plate)')
      .order('role').order('username')
      .then(({ data }) => setRows((data ?? []) as unknown as Row[]));
  }, [profile.role]);

  if (profile.role !== 'admin') {
    return (
      <Shell>
        <h1>Merhaba, {profile.full_name.split(' ')[0]}</h1>
        <p>Bu panel şirket yöneticileri içindir. {ROLE_LABELS[profile.role]} olarak lütfen <b>mobil uygulamayı</b> kullanın.</p>
        <button className="ghost" onClick={onSignOut}>Çıkış yap</button>
      </Shell>
    );
  }
  return (
    <Shell wide>
      <div className="head">
        <div><h1>{profile.company?.name}</h1><p className="muted">Şirket kodu: <b>{profile.company?.code}</b> · {profile.full_name}</p></div>
        <button className="ghost small" onClick={onSignOut}>Çıkış</button>
      </div>
      <h2>Kullanıcılar {rows ? `(${rows.length})` : ''}</h2>
      {!rows ? <p className="muted">Yükleniyor…</p> : (
        <div className="tablewrap">
          <table>
            <thead><tr><th>Ad soyad</th><th>Kullanıcı adı</th><th>Rol</th><th>Telefon</th><th>Araç</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id}><td>{r.full_name}</td><td>{r.username}</td><td><span className={`tag ${r.role}`}>{ROLE_LABELS[r.role]}</span></td><td>{formatPhone(r.phone)}</td><td>{r.vehicle?.plate ?? '—'}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <p className="muted small">Kullanıcı ekleme/düzenleme ekranları yönetim paneli aşamasında (Faz 7) eklenecek.</p>
    </Shell>
  );
}
