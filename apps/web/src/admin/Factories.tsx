// Fabrikalar: servislerin gittiği işyerleri. Araç fabrikanın varış yarıçapına girince sabah seferi
// kendiliğinden tamamlanır ve yönetime "Servis tamamlandı" bildirimi gider.
import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { AddressInput } from './AddressInput';
import { FACTORY_COLUMNS, pgError, type FactoryRow } from './common';
import { StopMap, type PickedPoint } from './StopMap';
import { Field, Notice, Plate } from './ui';

type VehicleLite = { id: string; plate: string; name: string | null; factory_id: string | null };

export function Factories() {
  const [rows, setRows] = useState<FactoryRow[] | null>(null);
  const [vehicles, setVehicles] = useState<VehicleLite[]>([]);
  const [edit, setEdit] = useState<FactoryRow | 'new' | null>(null);

  async function load() {
    const [{ data: f }, { data: v }] = await Promise.all([
      supabase.from('factories').select(FACTORY_COLUMNS).order('name'),
      supabase.from('vehicles').select('id, plate, name, factory_id').order('plate'),
    ]);
    setRows((f ?? []) as FactoryRow[]);
    setVehicles((v ?? []) as VehicleLite[]);
  }
  useEffect(() => { void load(); }, []);

  if (edit) return <FactoryForm factory={edit === 'new' ? null : edit} vehicles={vehicles} onClose={async () => { setEdit(null); await load(); }} />;

  const unassigned = vehicles.filter((v) => !v.factory_id);
  return (
    <section>
      <div className="toolbar">
        <div>
          <h2>Fabrikalar {rows ? `(${rows.length})` : ''}</h2>
          <p className="muted small" style={{ margin: 0 }}>Sabah servisi araç fabrikaya varınca, akşam servisi son yolcuya ulaşınca kendiliğinden tamamlanır.</p>
        </div>
        <button onClick={() => setEdit('new')}>+ Yeni fabrika</button>
      </div>
      {!rows ? <p className="muted">Yükleniyor…</p> : rows.length === 0 ? (
        <div className="empty">Henüz fabrika yok. Fabrikayı ekleyip araçları bağlayın; sabah seferleri fabrikaya varınca otomatik tamamlansın.</div>
      ) : (
        <div className="factories">
          {rows.map((f) => {
            const vs = vehicles.filter((v) => v.factory_id === f.id);
            return (
              <button key={f.id} className="factory" onClick={() => setEdit(f)}>
                <span className="factory-ic"><svg viewBox="0 0 24 24"><path d="M3 21V10l6 3V10l6 3V6l6-3v18z" /><path d="M7 17h2M12 17h2M17 17h2" /></svg></span>
                <span className="factory-main">
                  <b>{f.name}</b>
                  <small>{f.address ?? `${f.lat.toFixed(5)}, ${f.lng.toFixed(5)}`}</small>
                  <span className="factory-meta">Varış yarıçapı {f.radius_m} m · {vs.length} araç</span>
                  {vs.length > 0 && <span className="factory-plates">{vs.map((v) => <Plate key={v.id} plate={v.plate} />)}</span>}
                </span>
                <span className="go">Düzenle</span>
              </button>
            );
          })}
        </div>
      )}
      {rows && rows.length > 0 && unassigned.length > 0 && (
        <Notice kind="info">Fabrikası seçilmemiş araç: {unassigned.map((v) => v.plate).join(', ')}. Bu araçların sabah seferi fabrikada otomatik tamamlanmaz; fabrikayı düzenleyip araçları bağlayabilirsiniz.</Notice>
      )}
    </section>
  );
}

function FactoryForm({ factory, vehicles, onClose }: { factory: FactoryRow | null; vehicles: VehicleLite[]; onClose: () => Promise<void> }) {
  const isNew = !factory;
  const [name, setName] = useState(factory?.name ?? '');
  const [address, setAddress] = useState(factory?.address ?? '');
  const [point, setPoint] = useState<PickedPoint | null>(factory ? { lat: factory.lat, lng: factory.lng, address: factory.address ?? '' } : null);
  const [radius, setRadius] = useState(factory?.radius_m ?? 150);
  const [linked, setLinked] = useState<string[]>(factory ? vehicles.filter((v) => v.factory_id === factory.id).map((v) => v.id) : vehicles.filter((v) => !v.factory_id).map((v) => v.id));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!point) { setError('Fabrikanın yerini adres yazarak ya da haritada tıklayarak seçin.'); return; }
    setBusy(true); setError(null); setSaved(false);
    const row = { name: name.trim(), address: address.trim() || point.address || null, lat: point.lat, lng: point.lng, radius_m: radius };
    const res = isNew
      ? await supabase.from('factories').insert(row).select('id').single()
      : await supabase.from('factories').update(row).eq('id', factory!.id).select('id').single();
    if (res.error || !res.data) { setBusy(false); setError(pgError(res.error, 'Fabrika kaydedilemedi.')); return; }
    const id = res.data.id as string;
    const before = vehicles.filter((v) => v.factory_id === id).map((v) => v.id);
    const add = linked.filter((v) => !before.includes(v));
    const drop = before.filter((v) => !linked.includes(v));
    const r1 = add.length ? await supabase.from('vehicles').update({ factory_id: id }).in('id', add) : { error: null };
    const r2 = drop.length ? await supabase.from('vehicles').update({ factory_id: null }).in('id', drop) : { error: null };
    setBusy(false);
    if (r1.error || r2.error) { setError('Fabrika kaydedildi ama araç bağlantıları güncellenemedi.'); return; }
    if (isNew) await onClose(); else setSaved(true);
  }
  async function remove() {
    if (!factory || !confirm(`${factory.name} silinsin mi? Bağlı araçların fabrika bağlantısı kaldırılır; sefer geçmişi korunur.`)) return;
    setBusy(true);
    const { error: de } = await supabase.from('factories').delete().eq('id', factory.id);
    setBusy(false);
    if (de) { setError(pgError(de, 'Fabrika silinemedi.')); return; }
    await onClose();
  }

  return (
    <section>
      <button className="ghost small back" onClick={onClose}>← Fabrikalar</button>
      <h2>{isNew ? 'Yeni fabrika' : factory!.name}</h2>
      <form onSubmit={submit}>
        <div className="split">
          <div className="formgrid one">
            <Field label="Fabrika adı *"><input value={name} required maxLength={80} placeholder="örn. Gebze OSB – Ana Tesis" onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="Adres / giriş kapısı" hint="Yazdıkça adres önerileri çıkar. Araçların girdiği kapıyı seçmeniz en doğrusu.">
              <AddressInput value={address} placeholder="Fabrika adresini yazın"
                onChange={setAddress} onSelect={(p) => { setPoint(p); setAddress(p.address); }} />
            </Field>
            <Field label={`Varış yarıçapı: ${radius} m`} hint="Araç bu mesafeye girince fabrikaya varmış sayılır ve sabah seferi tamamlanır. Büyük tesislerde artırın.">
              <input type="range" min={50} max={1000} step={25} value={radius} onChange={(e) => setRadius(Number(e.target.value))} />
            </Field>
            <div className="field-block">
              <div className="field-label">Bu fabrikaya giden araçlar</div>
              {vehicles.length === 0 ? <p className="muted small">Henüz araç yok.</p> : (
                <div className="checklist">
                  {vehicles.map((v) => {
                    const other = v.factory_id && v.factory_id !== factory?.id;
                    return (
                      <label key={v.id} className="check">
                        <input type="checkbox" checked={linked.includes(v.id)}
                          onChange={(e) => setLinked(e.target.checked ? [...linked, v.id] : linked.filter((x) => x !== v.id))} />
                        <Plate plate={v.plate} /> <span>{v.name ?? ''}{other ? <small className="muted"> · şu an başka fabrikada</small> : null}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
          <StopMap picked={point} onPick={(p) => { setPoint(p); if (p.address) setAddress(p.address); }} search={false} radius={radius} height={420} />
        </div>
        {error && <Notice kind="err">{error}</Notice>}
        {saved && <Notice kind="ok">Kaydedildi.</Notice>}
        <div className="row-actions">
          <button disabled={busy}>{busy ? 'Kaydediliyor…' : isNew ? 'Fabrikayı kaydet' : 'Kaydet'}</button>
          <button type="button" className="ghost" onClick={onClose}>{isNew ? 'Vazgeç' : 'Kapat'}</button>
          {!isNew && <button type="button" className="ghost danger right" disabled={busy} onClick={remove}>Fabrikayı sil</button>}
        </div>
      </form>
    </section>
  );
}
