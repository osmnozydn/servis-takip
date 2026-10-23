// Araçlar: liste, ekle/düzenle, servis saatleri (sabah/akşam), fabrika, belgeler
import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import {
  deleteOwnerDocuments, DIRECTION_LABEL, FACTORY_COLUMNS, pgError, VEHICLE_COLUMNS, VEHICLE_DOCS, WEEKDAYS,
  type Direction, type FactoryRow, type VehicleRow,
} from './common';
import { Avatar, DocDraftPicker, Plate, DocumentsPanel, draftCount, Field, Notice, uploadDrafts, useThumbs, type DocDrafts } from './ui';

type Counts = Record<string, { driver?: string; passengers: number }>;

export function Vehicles({ companyId }: { companyId: string }) {
  const [rows, setRows] = useState<VehicleRow[] | null>(null);
  const [counts, setCounts] = useState<Counts>({});
  const [factories, setFactories] = useState<FactoryRow[]>([]);
  const [edit, setEdit] = useState<VehicleRow | 'new' | null>(null);
  const thumbs = useThumbs('vehicle', 'vehicle_photo', (rows ?? []).map((r) => r.id));

  async function load() {
    const [{ data: v }, { data: p }, { data: f }] = await Promise.all([
      supabase.from('vehicles').select(VEHICLE_COLUMNS).order('plate'),
      supabase.from('profiles').select('full_name, role, vehicle_id').in('role', ['driver', 'passenger']).not('vehicle_id', 'is', null),
      supabase.from('factories').select(FACTORY_COLUMNS).order('name'),
    ]);
    setFactories((f ?? []) as FactoryRow[]);
    const c: Counts = {};
    for (const x of p ?? []) {
      const e = (c[x.vehicle_id!] ??= { passengers: 0 });
      if (x.role === 'driver') e.driver = e.driver ? `${e.driver}, ${x.full_name}` : x.full_name;
      else e.passengers++;
    }
    setCounts(c);
    setRows((v ?? []) as VehicleRow[]);
  }
  useEffect(() => { void load(); }, []);

  if (edit) return <VehicleForm companyId={companyId} vehicle={edit === 'new' ? null : edit} factories={factories} onClose={async () => { setEdit(null); await load(); }} />;

  return (
    <section>
      <div className="toolbar">
        <h2>Araçlar {rows ? `(${rows.length})` : ''}</h2>
        <button onClick={() => setEdit('new')}>+ Yeni araç</button>
      </div>
      {!rows ? <p className="muted">Yükleniyor…</p> : rows.length === 0 ? (
        <div className="empty">Henüz araç yok. Önce araçları ekleyin; sonra sürücü ve yolcuları araçlara atayabilirsiniz.</div>
      ) : (
        <div className="tablewrap">
          <table className="clickable">
            <thead><tr><th /><th>Plaka</th><th>Hat adı</th><th>Marka / model</th><th>Kapasite</th><th>Sürücü</th><th>Yolcu</th><th>Fabrika</th><th>Rota</th><th /></tr></thead>
            <tbody>{rows.map((v) => (
              <tr key={v.id} onClick={() => setEdit(v)}>
                <td>{thumbs[v.id] ? <Avatar url={thumbs[v.id]} name={v.plate} /> : null}</td>
                <td><Plate plate={v.plate} /></td><td>{v.name ?? '—'}</td>
                <td>{[v.brand_model, v.color].filter(Boolean).join(' · ') || '—'}</td>
                <td>{v.capacity ?? '—'}</td>
                <td>{counts[v.id]?.driver ?? <span className="muted">atanmadı</span>}</td>
                <td>{counts[v.id]?.passengers ?? 0}{v.capacity ? ` / ${v.capacity}` : ''}</td>
                <td>{factories.find((f) => f.id === v.factory_id)?.name ?? <span className="muted">seçilmedi</span>}</td>
                <td>{v.route_mode === 'manual' ? 'Alış sırası' : 'Otomatik'}</td>
                <td className="go">Düzenle</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}

type WindowRule = { days: number[]; direction: Direction; service: string; lead: number; end: string };
const WEEK = [1, 2, 3, 4, 5];
const DEFAULT_WINDOWS: WindowRule[] = [
  { days: WEEK, direction: 'to_factory', service: '06:10', lead: 30, end: '09:30' },
  { days: WEEK, direction: 'from_factory', service: '17:30', lead: 30, end: '20:00' },
];
type WRow = { weekday: number; start_time: string; end_time: string; direction: Direction | null; service_time: string | null; lead_minutes: number };

const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const fromMin = (n: number) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;

function groupWindows(rows: WRow[]): WindowRule[] {
  const m = new Map<string, WindowRule>();
  for (const r of rows) {
    const service = (r.service_time ?? r.start_time).slice(0, 5);
    const direction: Direction = r.direction ?? (service < '12:00' ? 'to_factory' : 'from_factory');
    const k = `${direction}-${service}-${r.lead_minutes}-${r.end_time.slice(0, 5)}`;
    const g = m.get(k) ?? { days: [], direction, service, lead: r.lead_minutes, end: r.end_time.slice(0, 5) };
    g.days.push(r.weekday); m.set(k, g);
  }
  return [...m.values()].map((g) => ({ ...g, days: g.days.sort() })).sort((a, b) => a.service.localeCompare(b.service));
}

function VehicleForm({ companyId, vehicle, factories, onClose }: { companyId: string; vehicle: VehicleRow | null; factories: FactoryRow[]; onClose: () => Promise<void> }) {
  const isNew = !vehicle;
  const [plate, setPlate] = useState(vehicle?.plate ?? '');
  const [name, setName] = useState(vehicle?.name ?? '');
  const [brand, setBrand] = useState(vehicle?.brand_model ?? '');
  const [color, setColor] = useState(vehicle?.color ?? '');
  const [capacity, setCapacity] = useState(vehicle?.capacity?.toString() ?? '');
  const [mode, setMode] = useState<'auto' | 'manual'>(vehicle?.route_mode ?? 'auto');
  const [factoryId, setFactoryId] = useState(vehicle ? vehicle.factory_id ?? '' : factories.length === 1 ? factories[0].id : '');
  const [windows, setWindows] = useState<WindowRule[]>(isNew ? DEFAULT_WINDOWS : []);
  const [drafts, setDrafts] = useState<DocDrafts>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!vehicle) return;
    supabase.from('visibility_windows').select('weekday, start_time, end_time, direction, service_time, lead_minutes').eq('vehicle_id', vehicle.id)
      .then(({ data }) => setWindows(groupWindows((data ?? []) as WRow[])));
  }, [vehicle]);

  function windowsError(): string | null {
    for (const w of windows) {
      if (!w.days.length) return 'Her servis için en az bir gün seçin.';
      if (!w.service || !w.end || w.service >= w.end) return 'Servisin bitiş saati kalkış saatinden sonra olmalı.';
      if (toMin(w.service) < w.lead) return 'Görünme süresi gece yarısını geçemez (kalkış saatini ya da süreyi değiştirin).';
    }
    return null;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const we = windowsError(); if (we) { setError(we); return; }
    setBusy(true); setError(null); setSaved(null);
    const cap = capacity ? parseInt(capacity, 10) : null;
    const row = {
      plate: plate.trim().toLocaleUpperCase('tr-TR').replace(/\s+/g, ' '), name: name.trim() || null, brand_model: brand.trim() || null,
      color: color.trim() || null, capacity: cap, route_mode: mode, factory_id: factoryId || null,
    };
    const res = isNew
      ? await supabase.from('vehicles').insert(row).select('id').single()
      : await supabase.from('vehicles').update(row).eq('id', vehicle!.id).select('id').single();
    if (res.error || !res.data) { setBusy(false); setError(pgError(res.error, 'Araç kaydedilemedi.')); return; }
    const id = res.data.id as string;

    // Servis saatleri: hepsini yeniden yaz (yolcuya görünme başlangıcı = kalkış − görünme süresi)
    await supabase.from('visibility_windows').delete().eq('vehicle_id', id);
    const wrows = windows.flatMap((w) => w.days.map((d) => ({
      vehicle_id: id, weekday: d, direction: w.direction, service_time: w.service, lead_minutes: w.lead,
      start_time: fromMin(toMin(w.service) - w.lead), end_time: w.end,
    })));
    const wr = wrows.length ? await supabase.from('visibility_windows').insert(wrows) : { error: null };

    const docErrors = isNew ? await uploadDrafts(companyId, 'vehicle', id, drafts) : [];
    setBusy(false);
    if (wr.error) { setError('Araç kaydedildi ama servis saatleri kaydedilemedi.'); return; }
    if (docErrors.length) { setError(`Araç kaydedildi. Bazı belgeler yüklenemedi: ${docErrors.join(' ')}`); return; }
    if (isNew) await onClose(); else setSaved('Değişiklikler kaydedildi.');
  }

  async function remove() {
    if (!vehicle) return;
    if (!confirm(`${vehicle.plate} silinsin mi?\n\nAraca atanmış sürücü ve yolcuların araç bağlantısı kaldırılır, yolcuların durakları silinir. Sefer geçmişi korunur.`)) return;
    setBusy(true);
    await deleteOwnerDocuments('vehicle', vehicle.id);
    const { error } = await supabase.from('vehicles').delete().eq('id', vehicle.id);
    setBusy(false);
    if (error) { setError(pgError(error, 'Araç silinemedi.')); return; }
    await onClose();
  }

  const setW = (i: number, patch: Partial<WindowRule>) => setWindows(windows.map((w, j) => (j === i ? { ...w, ...patch } : w)));

  return (
    <section>
      <button className="ghost small back" onClick={onClose}>← Araçlar</button>
      <h2>{isNew ? 'Yeni araç' : <Plate plate={vehicle!.plate} size="lg" />}</h2>
      <form onSubmit={submit} className="formgrid">
        <h3 className="span2">Araç bilgileri</h3>
        <Field label="Plaka *"><input value={plate} required placeholder="34 ABC 123" onChange={(e) => setPlate(e.target.value)} /></Field>
        <Field label="Hat / servis adı" hint="Yolcular bu adı görür."><input value={name} placeholder="örn. Kadıköy – Fabrika" onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Marka / model"><input value={brand} placeholder="örn. Mercedes Sprinter" onChange={(e) => setBrand(e.target.value)} /></Field>
        <Field label="Renk"><input value={color} placeholder="örn. Beyaz" onChange={(e) => setColor(e.target.value)} /></Field>
        <Field label="Yolcu kapasitesi"><input type="number" min={1} max={100} value={capacity} onChange={(e) => setCapacity(e.target.value)} /></Field>

        <h3 className="span2">Rota</h3>
        <div className="span2 radios">
          <label className="radio"><input type="radio" checked={mode === 'auto'} onChange={() => setMode('auto')} />
            <span><b>Otomatik (en hızlı yol)</b><br /><small className="muted">Sürücü servisi başlatınca duraklar yollara göre en hızlı sırayla dizilir.</small></span></label>
          <label className="radio"><input type="radio" checked={mode === 'manual'} onChange={() => setMode('manual')} />
            <span><b>Benim belirlediğim alış sırası</b><br /><small className="muted">Yolcular “Yolcular” sekmesinde belirlediğiniz sırayla alınır.</small></span></label>
        </div>
        <Field label="Gittiği fabrika" hint="Sabah seferi araç bu fabrikaya varınca kendiliğinden tamamlanır; rota da orada biter.">
          <select value={factoryId} onChange={(e) => setFactoryId(e.target.value)}>
            <option value="">— Fabrika seçilmedi —</option>
            {factories.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </Field>
        {factories.length === 0 && <div className="span2"><Notice kind="info">Henüz fabrika tanımlı değil. Sol menüden <b>Fabrikalar</b> sayfasında ekleyebilirsiniz.</Notice></div>}

        <h3 className="span2">Servis saatleri</h3>
        <p className="muted small span2">Yolcular aracın canlı konumunu kalkıştan belirttiğiniz süre önce görmeye başlar (ör. 06:10 servisi için 30 dk önce = 05:40). Bu saatler dışında yolcu ekranında “servis şu an aktif değil” uyarısı çıkar. Yönetim ve sürücü her zaman görür.</p>
        <div className="span2 windows">
          {windows.map((w, i) => (
            <div className="svc" key={i}>
              <div className="svc-top">
                <div className="seg">
                  {(['to_factory', 'from_factory'] as Direction[]).map((d) => (
                    <button type="button" key={d} className={w.direction === d ? 'on' : ''} onClick={() => setW(i, { direction: d })}>{DIRECTION_LABEL[d]}</button>
                  ))}
                </div>
                <button type="button" className="link danger" onClick={() => setWindows(windows.filter((_, j) => j !== i))}>Kaldır</button>
              </div>
              <div className="days">
                {WEEKDAYS.map((d, k) => (
                  <button type="button" key={d} className={`day ${w.days.includes(k + 1) ? 'on' : ''}`}
                    onClick={() => setW(i, { days: w.days.includes(k + 1) ? w.days.filter((x) => x !== k + 1) : [...w.days, k + 1].sort() })}>{d}</button>
                ))}
              </div>
              <div className="svc-times">
                <label>Kalkış<input type="time" value={w.service} onChange={(e) => setW(i, { service: e.target.value })} /></label>
                <label>Yolcuya görünür
                  <select value={w.lead} onChange={(e) => setW(i, { lead: Number(e.target.value) })}>
                    {[0, 10, 15, 20, 30, 45, 60].map((n) => <option key={n} value={n}>{n === 0 ? 'kalkışta' : `${n} dk önce`}</option>)}
                  </select>
                </label>
                <label>En geç bitiş<input type="time" value={w.end} onChange={(e) => setW(i, { end: e.target.value })} /></label>
              </div>
              {w.service && toMin(w.service) >= w.lead && (
                <small className="muted">Yolcular {fromMin(toMin(w.service) - w.lead)}–{w.end} arası aracı görür · {w.direction === 'to_factory' ? 'fabrikaya varınca' : 'son yolcuya ulaşınca'} sefer kendiliğinden tamamlanır.</small>
              )}
            </div>
          ))}
          {windows.length === 0 && <p className="muted small">Servis saati tanımlı değil: yolcular konumu hiç göremez.</p>}
          <div className="row-actions" style={{ marginTop: 0 }}>
            <button type="button" className="ghost small" onClick={() => setWindows([...windows, { ...DEFAULT_WINDOWS[0] }])}>+ Sabah servisi</button>
            <button type="button" className="ghost small" onClick={() => setWindows([...windows, { ...DEFAULT_WINDOWS[1] }])}>+ Akşam servisi</button>
          </div>
        </div>

        <h3 className="span2">Araç fotoğrafı ve belgeleri</h3>
        <div className="span2">
          {isNew
            ? <DocDraftPicker types={VEHICLE_DOCS.filter((t) => t !== 'other')} value={drafts} onChange={setDrafts} />
            : <DocumentsPanel companyId={companyId} ownerType="vehicle" ownerId={vehicle!.id} types={VEHICLE_DOCS} />}
        </div>

        {error && <div className="span2"><Notice kind="err">{error}</Notice></div>}
        {saved && <div className="span2"><Notice kind="ok">{saved}</Notice></div>}
        <div className="span2 row-actions">
          <button disabled={busy}>{busy ? 'Kaydediliyor…' : isNew ? `Aracı kaydet${draftCount(drafts) ? ` (${draftCount(drafts)} belge)` : ''}` : 'Kaydet'}</button>
          <button type="button" className="ghost" onClick={onClose}>{isNew ? 'Vazgeç' : 'Kapat'}</button>
          {!isNew && <button type="button" className="ghost danger right" disabled={busy} onClick={remove}>Aracı sil</button>}
        </div>
      </form>
    </section>
  );
}
