// Sürücüler: liste, yeni sürücü kaydı (fotoğraf + belgeler kayıt sırasında), düzenleme
import { useEffect, useState, type FormEvent } from 'react';
import { formatPhone } from '@servis/shared';
import { supabase } from '../lib/supabase';
import {
  callFn, daysUntil, DRIVER_DOCS, genPassword, LICENSE_CLASSES, normalizePhone, PERSON_COLUMNS, pgError, slugUsername,
  VEHICLE_COLUMNS, VEHICLE_DOCS, type PersonRow, type VehicleRow,
} from './common';
import {
  Avatar, CredentialsBox, DocDraftPicker, DocumentsPanel, draftCount, ExpiryTag, Field, Notice, PasswordField, uploadDrafts,
  useThumbs, type DocDrafts,
} from './ui';

type Ctx = { companyId: string; companyCode: string };

export function Drivers(ctx: Ctx) {
  const [rows, setRows] = useState<PersonRow[] | null>(null);
  const [vehicles, setVehicles] = useState<VehicleRow[]>([]);
  const [expiring, setExpiring] = useState<Record<string, number>>({});
  const [view, setView] = useState<PersonRow | 'new' | null>(null);
  const thumbs = useThumbs('driver', 'driver_photo', (rows ?? []).map((r) => r.id));

  async function load() {
    const [{ data: p }, { data: v }, { data: d }] = await Promise.all([
      supabase.from('profiles').select(PERSON_COLUMNS).eq('role', 'driver').order('full_name'),
      supabase.from('vehicles').select(VEHICLE_COLUMNS).order('plate'),
      supabase.from('documents').select('owner_id, expires_on').eq('owner_type', 'driver').not('expires_on', 'is', null),
    ]);
    const ex: Record<string, number> = {};
    for (const x of d ?? []) { const n = daysUntil(x.expires_on); if (n !== null && n <= 30) ex[x.owner_id] = (ex[x.owner_id] ?? 0) + 1; }
    setExpiring(ex);
    setVehicles((v ?? []) as VehicleRow[]);
    setRows((p ?? []) as PersonRow[]);
  }
  useEffect(() => { void load(); }, []);

  const plate = (id: string | null) => vehicles.find((v) => v.id === id)?.plate;
  if (view === 'new') return <DriverCreate {...ctx} vehicles={vehicles} onClose={async () => { setView(null); await load(); }} />;
  if (view) return <DriverDetail {...ctx} driver={view} vehicles={vehicles} onClose={async () => { setView(null); await load(); }} />;

  return (
    <section>
      <div className="toolbar">
        <h2>Sürücüler {rows ? `(${rows.length})` : ''}</h2>
        <button onClick={() => setView('new')}>+ Yeni sürücü kaydı</button>
      </div>
      {!rows ? <p className="muted">Yükleniyor…</p> : rows.length === 0 ? (
        <div className="empty">Henüz sürücü yok. “Yeni sürücü kaydı” ile ekleyin; fotoğrafını ve belgelerini kayıt sırasında yükleyebilirsiniz.</div>
      ) : (
        <div className="tablewrap">
          <table className="clickable">
            <thead><tr><th /><th>Ad soyad</th><th>Kullanıcı adı</th><th>Telefon</th><th>Araç</th><th>Ehliyet</th><th>Ehliyet geçerlilik</th><th>Uyarı</th><th /></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id} onClick={() => setView(r)}>
                <td><Avatar url={thumbs[r.id]} name={r.full_name} /></td>
                <td><b>{r.full_name}</b>{r.must_change_password && <span className="tag pending" title="Henüz ilk girişini yapmadı">ilk giriş bekleniyor</span>}</td>
                <td className="mono">{r.username}</td><td>{formatPhone(r.phone)}</td>
                <td>{plate(r.vehicle_id) ?? <span className="muted">atanmadı</span>}</td>
                <td>{r.license_class ?? '—'}</td>
                <td><ExpiryTag date={r.license_expires_on} /></td>
                <td>{expiring[r.id] ? <span className="tag missed">{expiring[r.id]} belge</span> : ''}</td>
                <td className="go">Aç →</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function VehicleSelect({ vehicles, value, onChange, allowNew }: { vehicles: VehicleRow[]; value: string; onChange: (v: string) => void; allowNew?: boolean }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">— Araç atanmadı —</option>
      {vehicles.map((v) => <option key={v.id} value={v.id}>{v.plate}{v.name ? ` · ${v.name}` : ''}</option>)}
      {allowNew && <option value="__new">+ Yeni araç ekle…</option>}
    </select>
  );
}

function DriverCreate({ companyId, companyCode, vehicles, onClose }: Ctx & { vehicles: VehicleRow[]; onClose: () => Promise<void> }) {
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [username, setUsername] = useState('');
  const [userTouched, setUserTouched] = useState(false);
  const [password, setPassword] = useState(genPassword());
  const [vehicleId, setVehicleId] = useState('');
  const [newPlate, setNewPlate] = useState('');
  const [newBrand, setNewBrand] = useState('');
  const [newCapacity, setNewCapacity] = useState('');
  const [licenseNo, setLicenseNo] = useState('');
  const [licenseClass, setLicenseClass] = useState('D');
  const [licenseExp, setLicenseExp] = useState('');
  const [drafts, setDrafts] = useState<DocDrafts>({});
  const [vDrafts, setVDrafts] = useState<DocDrafts>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ username: string; password: string; warnings: string[] } | null>(null);

  const vehicleChosen = vehicleId !== '';

  async function submit(e: FormEvent) {
    e.preventDefault();
    const ph = phone.trim() ? normalizePhone(phone) : null;
    if (phone.trim() && !ph) { setError('Telefon numarası geçersiz.'); return; }
    setBusy(true); setError(null);

    // 1) Gerekirse yeni araç
    let vid = vehicleId;
    if (vehicleId === '__new') {
      const { data, error: ve } = await supabase.from('vehicles').insert({
        plate: newPlate.trim().toLocaleUpperCase('tr-TR').replace(/\s+/g, ' '), brand_model: newBrand.trim() || null,
        capacity: newCapacity ? parseInt(newCapacity, 10) : null,
      }).select('id').single();
      if (ve || !data) { setBusy(false); setError(pgError(ve, 'Araç oluşturulamadı.')); return; }
      vid = data.id;
      const wins = [1, 2, 3, 4, 5].flatMap((d) => [['06:30', '09:30'], ['16:30', '19:30']].map(([s, t]) => ({ vehicle_id: vid, weekday: d, start_time: s, end_time: t })));
      await supabase.from('visibility_windows').insert(wins);
    }

    // 2) Sürücü hesabı
    const r = await callFn<{ id: string; username: string }>('admin-users', {
      action: 'create', role: 'driver', username, full_name: fullName, password, phone: ph, vehicle_id: vid || null,
      license_no: licenseNo, license_class: licenseClass, license_expires_on: licenseExp || null,
    });
    if (!r.ok) {
      if (vehicleId === '__new' && vid) await supabase.from('vehicles').delete().eq('id', vid);
      setBusy(false); setError(r.message); return;
    }

    // 3) Belgeler
    const warnings = [
      ...await uploadDrafts(companyId, 'driver', r.data.id, drafts),
      ...(vid ? await uploadDrafts(companyId, 'vehicle', vid, vDrafts) : []),
    ];
    setBusy(false);
    setDone({ username: r.data.username, password, warnings });
  }

  if (done) {
    return (
      <section className="narrow">
        <Notice kind="ok"><b>{fullName}</b> sürücü olarak kaydedildi{draftCount(drafts) + draftCount(vDrafts) > done.warnings.length ? ', belgeler yüklendi' : ''}.</Notice>
        {done.warnings.length > 0 && <Notice kind="err">Bazı belgeler yüklenemedi: {done.warnings.join(' ')} Sürücünün sayfasından tekrar yükleyebilirsiniz.</Notice>}
        <CredentialsBox title="Sürücünün giriş bilgileri (mobil uygulama)" companyCode={companyCode} username={done.username} password={done.password} />
        <div className="row-actions"><button onClick={onClose}>Sürücülere dön</button></div>
      </section>
    );
  }

  return (
    <section>
      <button className="ghost small back" onClick={onClose}>← Sürücüler</button>
      <h2>Yeni sürücü kaydı</h2>
      <form onSubmit={submit} className="formgrid">
        <h3 className="span2">Kişisel bilgiler</h3>
        <Field label="Ad soyad *"><input value={fullName} required onChange={(e) => { setFullName(e.target.value); if (!userTouched) setUsername(slugUsername(e.target.value)); }} /></Field>
        <Field label="Cep telefonu" hint="Sürücü telefon numarasıyla da giriş yapabilir."><input value={phone} inputMode="tel" placeholder="0555 123 45 67" onChange={(e) => setPhone(e.target.value)} /></Field>

        <h3 className="span2">Giriş bilgileri</h3>
        <Field label="Kullanıcı adı *" hint="Ad soyaddan otomatik önerilir."><input value={username} required className="mono" onChange={(e) => { setUsername(e.target.value.toLowerCase()); setUserTouched(true); }} /></Field>
        <Field label="Geçici şifre *" hint="İlk girişte değiştirmesi istenir."><PasswordField value={password} onChange={setPassword} /></Field>

        <h3 className="span2">Araç</h3>
        <Field label="Kullanacağı araç"><VehicleSelect vehicles={vehicles} value={vehicleId} onChange={setVehicleId} allowNew /></Field>
        <div />
        {vehicleId === '__new' && (<>
          <Field label="Plaka *"><input value={newPlate} required placeholder="34 ABC 123" onChange={(e) => setNewPlate(e.target.value)} /></Field>
          <Field label="Marka / model"><input value={newBrand} onChange={(e) => setNewBrand(e.target.value)} /></Field>
          <Field label="Kapasite"><input type="number" min={1} max={100} value={newCapacity} onChange={(e) => setNewCapacity(e.target.value)} /></Field>
          <p className="muted small">Diğer araç bilgilerini (konum görme saatleri, rota) sonra “Araçlar” sekmesinden düzenleyebilirsiniz.</p>
        </>)}

        <h3 className="span2">Ehliyet</h3>
        <Field label="Ehliyet no"><input value={licenseNo} onChange={(e) => setLicenseNo(e.target.value)} /></Field>
        <div className="grid2in">
          <Field label="Sınıfı"><select value={licenseClass} onChange={(e) => setLicenseClass(e.target.value)}>{LICENSE_CLASSES.map((c) => <option key={c}>{c}</option>)}</select></Field>
          <Field label="Geçerlilik tarihi"><input type="date" value={licenseExp} onChange={(e) => setLicenseExp(e.target.value)} /></Field>
        </div>

        <h3 className="span2">Sürücü fotoğrafı ve belgeleri</h3>
        <div className="span2"><DocDraftPicker types={DRIVER_DOCS.filter((t) => t !== 'other')} value={drafts} onChange={setDrafts} /></div>

        {vehicleChosen && (<>
          <h3 className="span2">Araç fotoğrafı ve belgeleri <span className="muted small">(isteğe bağlı)</span></h3>
          <div className="span2"><DocDraftPicker types={VEHICLE_DOCS.filter((t) => t !== 'other')} value={vDrafts} onChange={setVDrafts} /></div>
        </>)}

        {error && <div className="span2"><Notice kind="err">{error}</Notice></div>}
        <div className="span2 row-actions">
          <button disabled={busy}>{busy ? 'Kaydediliyor…' : `Sürücüyü kaydet${draftCount(drafts) + draftCount(vDrafts) ? ` (${draftCount(drafts) + draftCount(vDrafts)} belge)` : ''}`}</button>
          <button type="button" className="ghost" onClick={onClose}>Vazgeç</button>
        </div>
      </form>
    </section>
  );
}

function DriverDetail({ companyId, companyCode, driver, vehicles, onClose }: Ctx & { driver: PersonRow; vehicles: VehicleRow[]; onClose: () => Promise<void> }) {
  const [fullName, setFullName] = useState(driver.full_name);
  const [phone, setPhone] = useState(driver.phone ?? '');
  const [vehicleId, setVehicleId] = useState(driver.vehicle_id ?? '');
  const [licenseNo, setLicenseNo] = useState(driver.license_no ?? '');
  const [licenseClass, setLicenseClass] = useState(driver.license_class ?? '');
  const [licenseExp, setLicenseExp] = useState(driver.license_expires_on ?? '');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [reset, setReset] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    const ph = phone.trim() ? normalizePhone(phone) : null;
    if (phone.trim() && !ph) { setMsg({ kind: 'err', text: 'Telefon numarası geçersiz.' }); return; }
    setBusy(true); setMsg(null);
    const { error } = await supabase.from('profiles').update({
      full_name: fullName.trim(), phone: ph, vehicle_id: vehicleId || null,
      license_no: licenseNo.trim() || null, license_class: licenseClass || null, license_expires_on: licenseExp || null,
    }).eq('id', driver.id);
    setBusy(false);
    setMsg(error ? { kind: 'err', text: pgError(error) } : { kind: 'ok', text: 'Kaydedildi.' });
  }
  async function resetPassword() {
    const pw = genPassword();
    if (!confirm(`${driver.full_name} için yeni geçici şifre oluşturulsun mu? Eski şifresi çalışmayacak.`)) return;
    setBusy(true);
    const r = await callFn('admin-users', { action: 'reset_password', user_id: driver.id, password: pw });
    setBusy(false);
    if (r.ok) setReset(pw); else setMsg({ kind: 'err', text: r.message });
  }
  async function remove() {
    if (!confirm(`${driver.full_name} silinsin mi?\n\nHesabı, fotoğrafı ve belgeleri kalıcı olarak silinir. Geçmiş seferlerde adı görünmeye devam eder.`)) return;
    setBusy(true);
    const r = await callFn('admin-users', { action: 'delete', user_id: driver.id });
    setBusy(false);
    if (r.ok) await onClose(); else setMsg({ kind: 'err', text: r.message });
  }

  return (
    <section>
      <button className="ghost small back" onClick={onClose}>← Sürücüler</button>
      <h2>{driver.full_name} <span className="muted small mono">@{driver.username}</span></h2>
      <div className="split">
        <form onSubmit={save} className="formgrid">
          <h3 className="span2">Bilgiler</h3>
          <Field label="Ad soyad"><input value={fullName} required onChange={(e) => setFullName(e.target.value)} /></Field>
          <Field label="Cep telefonu"><input value={phone} inputMode="tel" onChange={(e) => setPhone(e.target.value)} /></Field>
          <Field label="Araç"><VehicleSelect vehicles={vehicles} value={vehicleId} onChange={setVehicleId} /></Field>
          <Field label="Ehliyet no"><input value={licenseNo} onChange={(e) => setLicenseNo(e.target.value)} /></Field>
          <Field label="Ehliyet sınıfı"><select value={licenseClass} onChange={(e) => setLicenseClass(e.target.value)}><option value="">—</option>{LICENSE_CLASSES.map((c) => <option key={c}>{c}</option>)}</select></Field>
          <Field label="Ehliyet geçerlilik"><input type="date" value={licenseExp} onChange={(e) => setLicenseExp(e.target.value)} /></Field>
          {msg && <div className="span2"><Notice kind={msg.kind}>{msg.text}</Notice></div>}
          <div className="span2 row-actions"><button disabled={busy}>Kaydet</button></div>
        </form>
        <div>
          <h3>Fotoğraf ve belgeler</h3>
          <DocumentsPanel companyId={companyId} ownerType="driver" ownerId={driver.id} types={DRIVER_DOCS} />
        </div>
      </div>
      <h3>Hesap</h3>
      {reset && <CredentialsBox title="Yeni giriş bilgileri" companyCode={companyCode} username={driver.username} password={reset} />}
      <div className="row-actions">
        <button className="ghost" disabled={busy} onClick={resetPassword}>Şifre sıfırla</button>
        <button className="ghost danger" disabled={busy} onClick={remove}>Sürücüyü sil</button>
      </div>
    </section>
  );
}
