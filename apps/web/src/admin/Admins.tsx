// Yönetim ekibi: şirket yöneticileri ve operasyon sorumluları (yalnızca şirket yöneticisi ekler/siler)
import { useEffect, useState, type FormEvent } from 'react';
import { formatPhone } from '@servis/shared';
import { supabase } from '../lib/supabase';
import { callFn, genPassword, normalizePhone, PERSON_COLUMNS, slugUsername, type PersonRow } from './common';
import { CredentialsBox, Field, Notice, PasswordField } from './ui';

export function Admins({ companyCode, myId, canManage }: { companyCode: string; myId: string; canManage: boolean }) {
  const [rows, setRows] = useState<PersonRow[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [cred, setCred] = useState<{ title: string; username: string; password: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const { data } = await supabase.from('profiles').select(PERSON_COLUMNS).in('role', ['admin', 'operator']).order('role').order('full_name');
    setRows((data ?? []) as PersonRow[]);
  }
  useEffect(() => { void load(); }, []);

  async function reset(r: PersonRow) {
    if (!confirm(`${r.full_name} için yeni geçici şifre oluşturulsun mu?`)) return;
    const pw = genPassword();
    const res = await callFn('admin-users', { action: 'reset_password', user_id: r.id, password: pw });
    if (res.ok) setCred({ title: `${r.full_name} — yeni giriş bilgileri`, username: r.username, password: pw }); else setError(res.message);
  }
  async function remove(r: PersonRow) {
    if (!confirm(`${r.full_name} hesabı silinsin mi?`)) return;
    const res = await callFn('admin-users', { action: 'delete', user_id: r.id });
    if (res.ok) await load(); else setError(res.message);
  }

  return (
    <section>
      <div className="toolbar">
        <h2>Yönetim ekibi {rows ? `(${rows.length})` : ''}</h2>
        {canManage && !adding && <button onClick={() => { setAdding(true); setCred(null); }}>+ Yeni kişi</button>}
      </div>
      <div className="roles-info">
        <div><span className="tag admin">Yönetici</span> Her şeyi yönetir; yönetici ve operasyon sorumlusu ekleyip çıkarabilir.</div>
        <div><span className="tag operator">Operasyon sorumlusu</span> Araçların giriş-çıkışını takip eder; araç, sürücü, yolcu, fabrika ve servis saatlerini yönetir. Yönetim ekibine kişi ekleyemez.</div>
        <div className="muted small">İkisi de servis başladı / tamamlandı bildirimlerini alır.</div>
      </div>
      {!canManage && <Notice kind="info">Yönetim ekibine kişi eklemek veya çıkarmak için şirket yöneticisine başvurun.</Notice>}
      {adding && <AddAdmin onDone={async (c) => { setAdding(false); if (c) setCred(c); await load(); }} />}
      {cred && <CredentialsBox title={cred.title} companyCode={companyCode} username={cred.username} password={cred.password} />}
      {error && <Notice kind="err">{error}</Notice>}
      {!rows ? <p className="muted">Yükleniyor…</p> : (
        <div className="tablewrap">
          <table>
            <thead><tr><th>Ad soyad</th><th>Görev</th><th>Kullanıcı adı</th><th>Telefon</th><th /></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id}>
                <td><b>{r.full_name}</b>{r.id === myId && <span className="tag admin">siz</span>}{r.must_change_password && <span className="tag pending">ilk giriş bekleniyor</span>}</td>
                <td><span className={`tag ${r.role}`}>{r.role === 'operator' ? 'Operasyon sorumlusu' : 'Yönetici'}</span></td>
                <td className="mono">{r.username}</td><td>{formatPhone(r.phone)}</td>
                <td className="right">{canManage && r.id !== myId && <><button className="link" onClick={() => reset(r)}>Şifre sıfırla</button> · <button className="link danger" onClick={() => remove(r)}>Sil</button></>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function AddAdmin({ onDone }: { onDone: (c: { title: string; username: string; password: string } | null) => Promise<void> }) {
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [touched, setTouched] = useState(false);
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<'admin' | 'operator'>('operator');
  const [password, setPassword] = useState(genPassword());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const ph = phone.trim() ? normalizePhone(phone) : null;
    if (phone.trim() && !ph) { setError('Telefon numarası geçersiz.'); return; }
    setBusy(true); setError(null);
    const r = await callFn<{ username: string }>('admin-users', { action: 'create', role, username, full_name: fullName, password, phone: ph });
    setBusy(false);
    if (!r.ok) { setError(r.message); return; }
    await onDone({ title: `${fullName} — giriş bilgileri`, username: r.data.username, password });
  }
  return (
    <form onSubmit={submit} className="formgrid panel">
      <div className="span2 radios">
        <label className="radio"><input type="radio" checked={role === 'operator'} onChange={() => setRole('operator')} />
          <span><b>Operasyon sorumlusu</b><br /><small className="muted">Araç giriş-çıkışları, yolcular, sürücüler, fabrikalar</small></span></label>
        <label className="radio"><input type="radio" checked={role === 'admin'} onChange={() => setRole('admin')} />
          <span><b>Yönetici</b><br /><small className="muted">Tam yetki, yönetim ekibini de yönetir</small></span></label>
      </div>
      <Field label="Ad soyad *"><input value={fullName} required onChange={(e) => { setFullName(e.target.value); if (!touched) setUsername(slugUsername(e.target.value)); }} /></Field>
      <Field label="Telefon"><input value={phone} inputMode="tel" onChange={(e) => setPhone(e.target.value)} /></Field>
      <Field label="Kullanıcı adı *"><input value={username} required className="mono" onChange={(e) => { setUsername(e.target.value.toLowerCase()); setTouched(true); }} /></Field>
      <Field label="Geçici şifre *"><PasswordField value={password} onChange={setPassword} /></Field>
      {error && <div className="span2"><Notice kind="err">{error}</Notice></div>}
      <div className="span2 row-actions">
        <button disabled={busy}>{busy ? 'Kaydediliyor…' : role === 'operator' ? 'Operasyon sorumlusunu ekle' : 'Yöneticiyi ekle'}</button>
        <button type="button" className="ghost" onClick={() => onDone(null)}>Vazgeç</button>
      </div>
    </form>
  );
}
