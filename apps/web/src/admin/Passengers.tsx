// Yolcular: araç bazında durak durak alış sırası, yolcu ekleme (durağı haritadan), düzenleme
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { formatPhone } from '@servis/shared';
import { supabase } from '../lib/supabase';
import { callFn, genPassword, normalizePhone, PERSON_COLUMNS, pgError, slugUsername, VEHICLE_COLUMNS, type PersonRow, type VehicleRow } from './common';
import { StopMap, type MapStop, type PickedPoint } from './StopMap';
import { CredentialsBox, Field, Notice, PasswordField, Plate } from './ui';

type Ctx = { companyId: string; companyCode: string };
type StopRow = { id: string; passenger_id: string; vehicle_id: string; lat: number; lng: number; address: string | null; pickup_order: number | null };
type Item = PersonRow & { stop: StopRow | null };

export function Passengers({ companyCode }: Ctx) {
  const [vehicles, setVehicles] = useState<VehicleRow[] | null>(null);
  const [people, setPeople] = useState<PersonRow[]>([]);
  const [stops, setStops] = useState<StopRow[]>([]);
  const [vehicleId, setVehicleId] = useState<string>('');
  const [order, setOrder] = useState<string[]>([]);       // yolcu id'leri, alış sırasıyla
  const [dirty, setDirty] = useState(false);
  const [view, setView] = useState<Item | 'new' | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function load(keepVehicle = vehicleId) {
    const [{ data: v }, { data: p }, { data: s }] = await Promise.all([
      supabase.from('vehicles').select(VEHICLE_COLUMNS).order('plate'),
      supabase.from('profiles').select(PERSON_COLUMNS).eq('role', 'passenger').order('full_name'),
      supabase.from('stops').select('id, passenger_id, vehicle_id, lat, lng, address, pickup_order'),
    ]);
    const vs = (v ?? []) as VehicleRow[];
    setVehicles(vs); setPeople((p ?? []) as PersonRow[]); setStops((s ?? []) as StopRow[]);
    setVehicleId(keepVehicle && (keepVehicle === '__none' || vs.some((x) => x.id === keepVehicle)) ? keepVehicle : vs[0]?.id ?? '__none');
  }
  useEffect(() => { void load(''); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const stopOf = useMemo(() => Object.fromEntries(stops.map((s) => [s.passenger_id, s])), [stops]);
  const items: Item[] = useMemo(() => people.map((p) => ({ ...p, stop: stopOf[p.id] ?? null })), [people, stopOf]);
  const vehicle = vehicles?.find((v) => v.id === vehicleId) ?? null;
  const unassigned = items.filter((i) => !i.vehicle_id);

  // Seçili aracın yolcuları: duraklı olanlar alış sırasıyla, durağı olmayanlar sonda
  useEffect(() => {
    const list = items.filter((i) => i.vehicle_id === vehicleId);
    list.sort((a, b) => (a.stop?.pickup_order ?? 1e9) - (b.stop?.pickup_order ?? 1e9) || a.full_name.localeCompare(b.full_name, 'tr'));
    setOrder(list.map((i) => i.id)); setDirty(false);
  }, [vehicleId, items]);
  useEffect(() => setMsg(null), [vehicleId]);

  const byId = useMemo(() => Object.fromEntries(items.map((i) => [i.id, i])), [items]);
  const ordered = order.map((id) => byId[id]).filter(Boolean);
  const withStop = ordered.filter((i) => i.stop);

  function move(idx: number, delta: number) {
    const j = idx + delta;
    if (j < 0 || j >= order.length) return;
    const next = [...order]; [next[idx], next[j]] = [next[j], next[idx]];
    setOrder(next); setDirty(true); setMsg(null);
  }
  async function saveOrder() {
    if (!vehicle) return;
    setBusy(true);
    const { error } = await supabase.rpc('set_pickup_order', { p_vehicle: vehicle.id, p_passengers: withStop.map((i) => i.id) });
    if (!error && vehicle.route_mode !== 'manual') await supabase.from('vehicles').update({ route_mode: 'manual' }).eq('id', vehicle.id);
    setBusy(false);
    if (error) { setMsg({ kind: 'err', text: 'Sıra kaydedilemedi.' }); return; }
    setMsg({ kind: 'ok', text: 'Alış sırası kaydedildi. Rota bu sırayla oluşturulacak.' });
    await load(vehicle.id);
  }
  async function setMode(mode: 'auto' | 'manual') {
    if (!vehicle) return;
    await supabase.from('vehicles').update({ route_mode: mode }).eq('id', vehicle.id);
    await load(vehicle.id);
  }

  const mapStops: MapStop[] = withStop.map((i, k) => ({ id: i.id, lat: i.stop!.lat, lng: i.stop!.lng, label: String(k + 1), title: `<b>${k + 1}. ${i.full_name}</b><br>${i.stop!.address ?? ''}` }));

  if (!vehicles) return <p className="muted">Yükleniyor…</p>;
  if (view === 'new') return <PassengerForm companyCode={companyCode} vehicles={vehicles} defaultVehicle={vehicle?.id ?? ''} others={mapStops} onClose={async (vid) => { setView(null); await load(vid ?? vehicleId); }} />;
  if (view) return <PassengerForm companyCode={companyCode} vehicles={vehicles} passenger={view} others={mapStops.filter((s) => s.id !== view.id)} onClose={async (vid) => { setView(null); await load(vid ?? vehicleId); }} />;

  return (
    <section>
      <div className="toolbar">
        <h2>Yolcular ({people.length})</h2>
        <button onClick={() => setView('new')}>+ Yeni yolcu</button>
      </div>
      {vehicles.length === 0 && <Notice kind="info">Önce “Araçlar” sekmesinden bir araç ekleyin; yolcular bir servis aracına atanır.</Notice>}
      <div className="vtabs">
        {vehicles.map((v) => {
          const n = items.filter((i) => i.vehicle_id === v.id).length;
          return <button key={v.id} className={v.id === vehicleId ? 'on' : ''} onClick={() => setVehicleId(v.id)}><Plate plate={v.plate} />{v.name ?? ''} <span className="count">{n}</span></button>;
        })}
        {unassigned.length > 0 && <button className={vehicleId === '__none' ? 'on' : ''} onClick={() => setVehicleId('__none')}>Araçsız <span className="count">{unassigned.length}</span></button>}
      </div>

      {vehicleId === '__none' ? (
        <PeopleTable list={unassigned} onOpen={setView} />
      ) : vehicle && (
        <div className="split">
          <div>
            <div className="modebar">
              <span>Rota:</span>
              <button className={vehicle.route_mode === 'auto' ? 'on' : ''} onClick={() => setMode('auto')}>Otomatik (en kısa)</button>
              <button className={vehicle.route_mode === 'manual' ? 'on' : ''} onClick={() => setMode('manual')}>Alış sırasına göre</button>
            </div>
            <p className="muted small">
              {vehicle.route_mode === 'manual'
                ? 'Sürücü yolcuları aşağıdaki sırayla alır. Okları kullanarak sırayı değiştirin ve kaydedin.'
                : 'Şu an rota otomatik (en kısa yol) hesaplanıyor. Sırayı değiştirip kaydederseniz “Alış sırasına göre” moduna geçilir.'}
              {vehicle.capacity ? ` · Kapasite ${ordered.length}/${vehicle.capacity}` : ''}
            </p>
            {dirty && (
              <div className="savebar">
                <span>Sıra değişti — kaydedilmedi</span>
                <button disabled={busy} onClick={saveOrder}>{busy ? 'Kaydediliyor…' : 'Alış sırasını kaydet'}</button>
                <button className="ghost" onClick={() => void load(vehicleId)}>Vazgeç</button>
              </div>
            )}
            {ordered.length === 0 ? <div className="empty">Bu araçta yolcu yok.</div> : (
              <ol className="pickup">
                {ordered.map((i, idx) => (
                  <li key={i.id} className={!i.stop ? 'nostop' : focus === i.id ? 'focus' : ''} onMouseEnter={() => i.stop && setFocus(i.id)}>
                    <span className="num">{i.stop ? withStop.indexOf(i) + 1 : '–'}</span>
                    <div className="who" onClick={() => setView(i)}>
                      <b>{i.full_name}</b>
                      <small className="muted">{i.stop ? i.stop.address || `${i.stop.lat.toFixed(5)}, ${i.stop.lng.toFixed(5)}` : 'Durak tanımlı değil — tıklayıp ekleyin'}</small>
                    </div>
                    <div className="arrows">
                      <button type="button" className="ghost small" disabled={idx === 0 || !i.stop} title="Yukarı" onClick={() => move(idx, -1)}>▲</button>
                      <button type="button" className="ghost small" disabled={idx === ordered.length - 1 || !i.stop || !ordered[idx + 1]?.stop} title="Aşağı" onClick={() => move(idx, 1)}>▼</button>
                    </div>
                  </li>
                ))}
                {vehicle.end_lat != null && <li className="endpt"><span className="num">★</span><div className="who"><b>{vehicle.end_label ?? 'Varış noktası'}</b><small className="muted">Rota burada biter</small></div></li>}
              </ol>
            )}
            {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
          </div>
          <StopMap key={vehicle.id} stops={mapStops} focus={focus}
            end={vehicle.end_lat != null ? { lat: vehicle.end_lat, lng: vehicle.end_lng!, label: vehicle.end_label ?? 'Varış' } : null} height={460} />
        </div>
      )}
    </section>
  );
}

function PeopleTable({ list, onOpen }: { list: Item[]; onOpen: (i: Item) => void }) {
  return (
    <div className="tablewrap">
      <table className="clickable">
        <thead><tr><th>Ad soyad</th><th>Kullanıcı adı</th><th>Telefon</th><th>Durak</th><th /></tr></thead>
        <tbody>{list.map((i) => (
          <tr key={i.id} onClick={() => onOpen(i)}><td><b>{i.full_name}</b></td><td className="mono">{i.username}</td><td>{formatPhone(i.phone)}</td><td>{i.stop?.address ?? '—'}</td><td className="go">Aç</td></tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function PassengerForm({ companyCode, vehicles, passenger, defaultVehicle = '', others, onClose }: {
  companyCode: string; vehicles: VehicleRow[]; passenger?: Item; defaultVehicle?: string; others: MapStop[];
  onClose: (vehicleId?: string) => Promise<void>;
}) {
  const isNew = !passenger;
  const [fullName, setFullName] = useState(passenger?.full_name ?? '');
  const [phone, setPhone] = useState(passenger?.phone ?? '');
  const [username, setUsername] = useState(passenger?.username ?? '');
  const [userTouched, setUserTouched] = useState(false);
  const [password, setPassword] = useState(genPassword());
  const [vehicleId, setVehicleId] = useState(passenger?.vehicle_id ?? defaultVehicle);
  const [point, setPoint] = useState<PickedPoint | null>(passenger?.stop ? { lat: passenger.stop.lat, lng: passenger.stop.lng, address: passenger.stop.address ?? '' } : null);
  const [address, setAddress] = useState(passenger?.stop?.address ?? '');
  const [addrTouched, setAddrTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ username: string; password: string; kind: 'new' | 'reset' } | null>(null);
  const [saved, setSaved] = useState(false);

  function pick(p: PickedPoint) { setPoint(p); if (!addrTouched && p.address) setAddress(p.address); }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const ph = phone.trim() ? normalizePhone(phone) : null;
    if (phone.trim() && !ph) { setError('Telefon numarası geçersiz.'); return; }
    if (point && !vehicleId) { setError('Durak kaydetmek için servis aracı seçin.'); return; }
    setBusy(true); setError(null); setSaved(false);
    if (isNew) {
      const r = await callFn<{ id: string; username: string }>('admin-users', {
        action: 'create', role: 'passenger', username, full_name: fullName, password, phone: ph, vehicle_id: vehicleId || null,
        stop: point ? { lat: point.lat, lng: point.lng, address: address.trim() || point.address || null } : undefined,
      });
      setBusy(false);
      if (!r.ok) { setError(r.message); return; }
      setDone({ username: r.data.username, password, kind: 'new' });
      return;
    }
    // Düzenleme: profil → durak (araç değişince durak tetikleyiciyle yeni aracın sonuna taşınır)
    const { error: pe } = await supabase.from('profiles').update({ full_name: fullName.trim(), phone: ph, vehicle_id: vehicleId || null }).eq('id', passenger!.id);
    if (pe) { setBusy(false); setError(pgError(pe)); return; }
    if (point && vehicleId) {
      const row = { lat: point.lat, lng: point.lng, address: address.trim() || point.address || null };
      const { data: existing } = await supabase.from('stops').select('id').eq('passenger_id', passenger!.id).maybeSingle();
      const se = existing
        ? (await supabase.from('stops').update(row).eq('id', existing.id)).error
        : (await supabase.from('stops').insert({ ...row, passenger_id: passenger!.id })).error;
      if (se) { setBusy(false); setError(pgError(se, 'Durak kaydedilemedi.')); return; }
    }
    setBusy(false); setSaved(true);
  }
  async function resetPassword() {
    if (!passenger || !confirm(`${passenger.full_name} için yeni geçici şifre oluşturulsun mu?`)) return;
    const pw = genPassword();
    setBusy(true);
    const r = await callFn('admin-users', { action: 'reset_password', user_id: passenger.id, password: pw });
    setBusy(false);
    if (r.ok) setDone({ username: passenger.username, password: pw, kind: 'reset' }); else setError(r.message);
  }
  async function remove() {
    if (!passenger || !confirm(`${passenger.full_name} silinsin mi? Hesabı ve durağı kalıcı olarak silinir.`)) return;
    setBusy(true);
    const r = await callFn('admin-users', { action: 'delete', user_id: passenger.id });
    setBusy(false);
    if (r.ok) await onClose(); else setError(r.message);
  }

  if (done?.kind === 'new') {
    return (
      <section className="narrow">
        <Notice kind="ok"><b>{fullName}</b> yolcu olarak eklendi{point ? ' ve durağı kaydedildi (araçtaki sıranın sonuna eklendi)' : ''}.</Notice>
        <CredentialsBox title="Yolcunun giriş bilgileri (mobil uygulama)" companyCode={companyCode} username={done.username} password={done.password} />
        <div className="row-actions">
          <button onClick={() => onClose(vehicleId || undefined)}>Alış sırasına dön</button>
        </div>
      </section>
    );
  }

  return (
    <section>
      <button className="ghost small back" onClick={() => onClose()}>← Yolcular</button>
      <h2>{isNew ? 'Yeni yolcu' : <>{passenger!.full_name} <span className="muted small mono">@{passenger!.username}</span></>}</h2>
      <form onSubmit={submit}>
        <div className="split">
          <div className="formgrid one">
            <Field label="Ad soyad *"><input value={fullName} required onChange={(e) => { setFullName(e.target.value); if (isNew && !userTouched) setUsername(slugUsername(e.target.value)); }} /></Field>
            <Field label="Cep telefonu" hint="Yolcu telefon numarasıyla da giriş yapabilir."><input value={phone} inputMode="tel" placeholder="0555 123 45 67" onChange={(e) => setPhone(e.target.value)} /></Field>
            {isNew && <>
              <Field label="Kullanıcı adı *"><input value={username} required className="mono" onChange={(e) => { setUsername(e.target.value.toLowerCase()); setUserTouched(true); }} /></Field>
              <Field label="Geçici şifre *"><PasswordField value={password} onChange={setPassword} /></Field>
            </>}
            <Field label="Servis aracı" hint={!isNew && vehicleId !== (passenger!.vehicle_id ?? '') ? 'Araç değişirse durak yeni aracın alış sırasının sonuna eklenir.' : undefined}>
              <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
                <option value="">— Araç atanmadı —</option>
                {vehicles.map((v) => <option key={v.id} value={v.id}>{v.plate}{v.name ? ` · ${v.name}` : ''}</option>)}
              </select>
            </Field>
            <Field label="Durak adresi / tarifi" hint="Sürücünün göreceği kısa tarif (örn. Moda Cd. eczane önü).">
              <input value={address} onChange={(e) => { setAddress(e.target.value); setAddrTouched(true); }} placeholder="Haritadan seçince otomatik dolar" />
            </Field>
            {point ? <small className="muted">Durak konumu: {point.lat.toFixed(5)}, {point.lng.toFixed(5)}</small> : <small className="muted">Durak henüz seçilmedi.</small>}
          </div>
          <StopMap picked={point} onPick={pick} stops={others.map((s) => ({ ...s, muted: true }))} height={400} />
        </div>
        {error && <Notice kind="err">{error}</Notice>}
        {saved && <Notice kind="ok">Kaydedildi.</Notice>}
        {done?.kind === 'reset' && <CredentialsBox title="Yeni giriş bilgileri" companyCode={companyCode} username={done.username} password={done.password} />}
        <div className="row-actions">
          <button disabled={busy}>{busy ? 'Kaydediliyor…' : isNew ? 'Yolcuyu kaydet' : 'Kaydet'}</button>
          <button type="button" className="ghost" onClick={() => onClose(vehicleId || undefined)}>{isNew ? 'Vazgeç' : 'Kapat'}</button>
          {!isNew && <>
            <button type="button" className="ghost" disabled={busy} onClick={resetPassword}>Şifre sıfırla</button>
            <button type="button" className="ghost danger right" disabled={busy} onClick={remove}>Yolcuyu sil</button>
          </>}
        </div>
      </form>
    </section>
  );
}
