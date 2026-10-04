// Genel bakış: araçlar şu an nerede/ne durumda, bugünkü seferler, süresi yaklaşan belgeler
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Page } from '../layout/AdminLayout';
import { daysUntil, DOC_LABEL, fmtDay, VEHICLE_COLUMNS, type DocType, type VehicleRow } from './common';
import { fmtDate, fmtTime, todayTR } from './time';
import { Plate } from './ui';

type LastPos = { vehicle_id: string; recorded_at: string; speed: number | null };
type Person = { id: string; full_name: string; role: string; vehicle_id: string | null; license_expires_on: string | null };
type TripRow = { id: string; vehicle_id: string; vehicle_plate: string; driver_name: string | null; started_at: string; ended_at: string | null };
type Due = { key: string; who: string; what: string; date: string; days: number; page: Page };

function lastSeen(iso: string | undefined, now: number) {
  if (!iso) return { cls: 'idle', text: 'Henüz konum yok' };
  const min = Math.round((now - Date.parse(iso)) / 60000);
  if (min <= 5) return { cls: 'on', text: min <= 1 ? 'Yolda, şimdi' : `Yolda, ${min} dk önce` };
  if (min < 60) return { cls: 'idle', text: `${min} dk önce görüldü` };
  const sameDay = new Date(iso).toDateString() === new Date(now).toDateString();
  return { cls: 'idle', text: sameDay ? `Bugün ${fmtTime(iso)}'de görüldü` : `Son görülme ${new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', timeZone: 'Europe/Istanbul' }).format(new Date(iso))}` };
}

export function Dashboard({ name, onNavigate }: { name: string; onNavigate: (p: Page) => void }) {
  const [vehicles, setVehicles] = useState<VehicleRow[] | null>(null);
  const [pos, setPos] = useState<Record<string, LastPos>>({});
  const [people, setPeople] = useState<Person[]>([]);
  const [trips, setTrips] = useState<TripRow[]>([]);
  const [tripStats, setTripStats] = useState<Record<string, { arrived: number; missed: number; total: number }>>({});
  const [due, setDue] = useState<Due[]>([]);
  const [now, setNow] = useState(Date.now());
  const today = todayTR();

  useEffect(() => {
    (async () => {
      const limit = new Date(Date.now() + 33 * 86400000).toISOString().slice(0, 10);
      const [{ data: v }, { data: lp }, { data: p }, { data: t }, { data: docs }] = await Promise.all([
        supabase.from('vehicles').select(VEHICLE_COLUMNS).order('plate'),
        supabase.from('vehicle_last_positions').select('vehicle_id, recorded_at, speed'),
        supabase.from('profiles').select('id, full_name, role, vehicle_id, license_expires_on'),
        supabase.from('trips').select('id, vehicle_id, vehicle_plate, driver_name, started_at, ended_at').eq('service_date', today).order('started_at', { ascending: false }),
        supabase.from('documents').select('id, owner_type, owner_id, doc_type, expires_on').not('expires_on', 'is', null).lte('expires_on', limit),
      ]);
      const vs = (v ?? []) as VehicleRow[]; const ps = (p ?? []) as Person[];
      setVehicles(vs); setPeople(ps); setTrips((t ?? []) as TripRow[]);
      setPos(Object.fromEntries(((lp ?? []) as LastPos[]).map((x) => [x.vehicle_id, x])));

      if (t?.length) {
        const { data: ev } = await supabase.from('trip_stop_events').select('trip_id, status').in('trip_id', t.map((x) => x.id));
        const s: Record<string, { arrived: number; missed: number; total: number }> = {};
        for (const e of ev ?? []) {
          const x = (s[e.trip_id] ??= { arrived: 0, missed: 0, total: 0 });
          if (e.status !== 'absent') x.total++;
          if (e.status === 'arrived') x.arrived++;
          if (e.status === 'missed') x.missed++;
        }
        setTripStats(s);
      }

      const nameOf = (id: string) => ps.find((x) => x.id === id)?.full_name ?? vs.find((x) => x.id === id)?.plate ?? '—';
      const list: Due[] = [];
      for (const d of docs ?? []) {
        const n = daysUntil(d.expires_on); if (n === null) continue;
        list.push({ key: d.id, who: nameOf(d.owner_id), what: DOC_LABEL[d.doc_type as DocType], date: d.expires_on!, days: n, page: d.owner_type === 'vehicle' ? 'vehicles' : 'drivers' });
      }
      for (const x of ps) {
        const n = daysUntil(x.license_expires_on);
        if (x.role === 'driver' && n !== null && n <= 33 && !list.some((l) => l.who === x.full_name && l.what === 'Ehliyet'))
          list.push({ key: `lic-${x.id}`, who: x.full_name, what: 'Ehliyet', date: x.license_expires_on!, days: n, page: 'drivers' });
      }
      setDue(list.sort((a, b) => a.days - b.days));
    })();

    const ch = supabase.channel('dash-positions')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicle_last_positions' }, (pl) => {
        const n = pl.new as LastPos; if (n?.vehicle_id) setPos((m) => ({ ...m, [n.vehicle_id]: n }));
      }).subscribe();
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => { supabase.removeChannel(ch); clearInterval(tick); };
  }, [today]);

  const count = (r: string) => people.filter((x) => x.role === r).length;
  const driverOf = (vid: string) => people.find((x) => x.role === 'driver' && x.vehicle_id === vid)?.full_name;
  const paxOf = (vid: string) => people.filter((x) => x.role === 'passenger' && x.vehicle_id === vid).length;
  const onRoad = (vehicles ?? []).filter((v) => lastSeen(pos[v.id]?.recorded_at, now).cls === 'on').length;
  const hour = Number(new Intl.DateTimeFormat('tr-TR', { hour: 'numeric', hour12: false, timeZone: 'Europe/Istanbul' }).format(new Date(now)));
  const greet = hour < 11 ? 'Günaydın' : hour < 18 ? 'İyi günler' : 'İyi akşamlar';

  return (
    <section className="bare">
      <div className="hello">
        <div>
          <h2>{greet}, {name.split(' ')[0]}</h2>
          <div className="muted" style={{ margin: 0 }}>{fmtDate(today)}</div>
        </div>
        <div className="tally">
          <button onClick={() => onNavigate('vehicles')}><b>{vehicles?.length ?? '–'}</b> araç</button>
          <button onClick={() => onNavigate('drivers')}><b>{count('driver')}</b> sürücü</button>
          <button onClick={() => onNavigate('passengers')}><b>{count('passenger')}</b> yolcu</button>
        </div>
      </div>

      <div className="dash">
        <div className="surface">
          <h3>Araçlar şu an <small>{vehicles ? `${onRoad} araç yolda` : ''}</small></h3>
          {!vehicles ? <p className="muted">Yükleniyor…</p> : vehicles.length === 0 ? (
            <div className="empty">Henüz araç yok. <button className="link" onClick={() => onNavigate('vehicles')}>İlk aracı ekleyin</button>.</div>
          ) : (
            <ul className="fleet">
              {vehicles.map((v) => {
                const s = lastSeen(pos[v.id]?.recorded_at, now);
                const d = driverOf(v.id);
                return (
                  <li key={v.id}>
                    <Plate plate={v.plate} />
                    <div style={{ minWidth: 0 }}>
                      <div className="line1">{v.name ?? v.brand_model ?? 'Servis'}</div>
                      <div className="line2">{d ?? 'Sürücü atanmadı'}, {paxOf(v.id)} yolcu</div>
                    </div>
                    <span className={`state ${s.cls}`}><i />{s.text}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="surface">
          <h3>Bugünkü seferler <small><button className="link" onClick={() => onNavigate('trips')}>Sefer geçmişi</button></small></h3>
          {trips.length === 0 ? <p className="muted" style={{ margin: 0 }}>Bugün henüz sefer başlamadı. Sürücü uygulamayı açınca sefer otomatik başlar.</p> : (
            <ul className="triplist">
              {trips.map((t) => {
                const s = tripStats[t.id];
                return (
                  <li key={t.id}>
                    <Plate plate={t.vehicle_plate} />
                    <div className="t">
                      <div>{fmtTime(t.started_at)}–{t.ended_at ? fmtTime(t.ended_at) : 'devam ediyor'}</div>
                      <div>{t.driver_name ?? ''}</div>
                    </div>
                    {s ? (s.missed ? <span className="tag missed">{s.missed} durak atlandı</span> : <span className="tag arrived">{s.arrived}/{s.total} durak</span>)
                      : !t.ended_at ? <span className="tag live">Yolda</span> : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="surface full">
          <h3>Süresi yaklaşan belgeler <small>önümüzdeki 30 gün</small></h3>
          {due.length === 0 ? <p className="muted" style={{ margin: 0 }}>Süresi dolan ya da 30 gün içinde dolacak belge yok.</p> : (
            <ul className="duelist">
              {due.map((d) => (
                <li key={d.key}>
                  <span><b>{d.who}</b> — {d.what}</span>
                  <span>
                    <span className={`tag ${d.days < 0 ? 'missed' : 'pending'}`}>{d.days < 0 ? `${fmtDay(d.date)}, süresi doldu` : d.days === 0 ? 'bugün doluyor' : `${d.days} gün kaldı`}</span>{' '}
                    <button className="link" onClick={() => onNavigate(d.page)}>Güncelle</button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
