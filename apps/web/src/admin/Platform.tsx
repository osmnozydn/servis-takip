// Platform yöneticisi: şirketler (projeler) — listele, yeni şirket aç, şirkete gir
import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { callFn, genPassword, slugCode, slugUsername } from './common';
import { CredentialsBox, Field, Notice, PasswordField } from './ui';

type CompanyRow = {
  id: string; code: string; name: string; contact_name: string | null; contact_phone: string | null; created_at: string;
  admins: number; drivers: number; passengers: number; vehicles: number;
};

export function Platform({ activeCompanyId, onEnter }: { activeCompanyId: string | null; onEnter: (id: string | null) => Promise<void> }) {
  const [rows, setRows] = useState<CompanyRow[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    const { data } = await supabase.rpc('platform_companies');
    setRows((data ?? []) as CompanyRow[]);
  }
  useEffect(() => { void load(); }, []);

  async function enter(id: string) { setBusyId(id); await onEnter(id); setBusyId(null); }

  if (creating) return <CreateCompany onClose={async () => { setCreating(false); await load(); }} onEnter={enter} />;

  return (
    <section>
      <div className="toolbar">
        <h2>{rows ? `${rows.length} şirket` : 'Şirketler'}</h2>
        <button onClick={() => setCreating(true)}>+ Yeni şirket aç</button>
      </div>
      {!rows ? <p className="muted">Yükleniyor…</p> : rows.length === 0 ? (
        <div className="empty">Henüz şirket yok. “Yeni şirket aç” ile ilk şirketi oluşturun.</div>
      ) : (
        <div className="companies">
          {rows.map((c) => (
            <div key={c.id} className={`company ${c.id === activeCompanyId ? 'active' : ''}`}>
              <div className="company-top">
                <div>
                  <h3>{c.name}</h3>
                  <div className="muted small">Şirket kodu: <b className="mono">{c.code}</b></div>
                </div>
                {c.id === activeCompanyId && <span className="tag arrived">Şu an yönetiliyor</span>}
              </div>
              <div className="stats">
                <span><b>{c.vehicles}</b> araç</span><span><b>{c.drivers}</b> sürücü</span>
                <span><b>{c.passengers}</b> yolcu</span><span><b>{c.admins}</b> yönetici</span>
              </div>
              {(c.contact_name || c.contact_phone) && <div className="muted small">İletişim: {[c.contact_name, c.contact_phone].filter(Boolean).join(' · ')}</div>}
              <button className="small" disabled={busyId === c.id} onClick={() => enter(c.id)}>
                {busyId === c.id ? 'Açılıyor…' : c.id === activeCompanyId ? 'Yönetime dön' : 'Şirketi yönet'}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function CreateCompany({ onClose, onEnter }: { onClose: () => Promise<void>; onEnter: (id: string) => Promise<void> }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [codeTouched, setCodeTouched] = useState(false);
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [adminName, setAdminName] = useState('');
  const [adminUser, setAdminUser] = useState('');
  const [userTouched, setUserTouched] = useState(false);
  const [adminPhone, setAdminPhone] = useState('');
  const [password, setPassword] = useState(genPassword());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ id: string; name: string; code: string; username: string; password: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const r = await callFn<{ company: { id: string; name: string; code: string }; admin: { username: string } }>('platform-admin', {
      action: 'create_company', name, code, contact_name: contactName, contact_phone: contactPhone,
      admin: { full_name: adminName, username: adminUser, phone: adminPhone, password },
    });
    setBusy(false);
    if (!r.ok) { setError(r.message); return; }
    setDone({ ...r.data.company, username: r.data.admin.username, password });
  }

  if (done) {
    return (
      <section className="narrow">
        <Notice kind="ok"><b>{done.name}</b> oluşturuldu.</Notice>
        <CredentialsBox title="Şirket yöneticisinin giriş bilgileri" companyCode={done.code} username={done.username} password={done.password} />
        <p className="muted small">Şimdi şirkete girip araçları, sürücüleri ve yolcuları ekleyebilirsiniz. Şirket yöneticisi de aynı işlemleri kendi hesabıyla yapabilir.</p>
        <div className="row-actions">
          <button onClick={() => onEnter(done.id)}>Şirkete gir ve kuruluma başla</button>
          <button className="ghost" onClick={onClose}>Şirket listesine dön</button>
        </div>
      </section>
    );
  }

  return (
    <section>
      <button className="ghost small back" onClick={onClose}>← Şirketler</button>
      <h2>Yeni şirket aç</h2>
      <form onSubmit={submit} className="formgrid">
        <h3 className="span2">Şirket bilgileri</h3>
        <Field label="Şirket adı *">
          <input value={name} required placeholder="örn. Yıldız Turizm Taşımacılık" onChange={(e) => { setName(e.target.value); if (!codeTouched) setCode(slugCode(e.target.value)); }} />
        </Field>
        <Field label="Şirket kodu *" hint="Kullanıcılar giriş ekranında bunu yazar. Küçük harf, rakam ve tire; sonradan değiştirilemez.">
          <input value={code} required className="mono" placeholder="örn. yildiz-turizm" onChange={(e) => { setCode(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')); setCodeTouched(true); }} />
        </Field>
        <Field label="Yetkili kişi"><input value={contactName} onChange={(e) => setContactName(e.target.value)} /></Field>
        <Field label="Yetkili telefonu"><input value={contactPhone} inputMode="tel" placeholder="0555 123 45 67" onChange={(e) => setContactPhone(e.target.value)} /></Field>

        <h3 className="span2">İlk şirket yöneticisi</h3>
        <Field label="Ad soyad *">
          <input value={adminName} required onChange={(e) => { setAdminName(e.target.value); if (!userTouched) setAdminUser(slugUsername(e.target.value)); }} />
        </Field>
        <Field label="Kullanıcı adı *">
          <input value={adminUser} required className="mono" onChange={(e) => { setAdminUser(e.target.value.toLowerCase()); setUserTouched(true); }} />
        </Field>
        <Field label="Telefon" hint="Telefonla da giriş yapabilir."><input value={adminPhone} inputMode="tel" onChange={(e) => setAdminPhone(e.target.value)} /></Field>
        <Field label="Geçici şifre *" hint="İlk girişte değiştirmesi istenir."><PasswordField value={password} onChange={setPassword} /></Field>

        {error && <div className="span2"><Notice kind="err">{error}</Notice></div>}
        <div className="span2 row-actions">
          <button disabled={busy}>{busy ? 'Oluşturuluyor…' : 'Şirketi oluştur'}</button>
          <button type="button" className="ghost" onClick={onClose}>Vazgeç</button>
        </div>
      </form>
    </section>
  );
}
