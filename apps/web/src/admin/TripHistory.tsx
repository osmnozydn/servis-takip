// Yönetici: Sefer geçmişi
// "Durağıma gelmedi" itirazında: tarih + araç seç → sefer → gidilen yol haritada,
// her durak için varış/ayrılış saati, uğranmadıysa aracın en fazla ne kadar yaklaştığı.
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { TripMap } from './TripMap';
import { fmtDate, fmtDistance, fmtTime, fmtTimeSec, minutesBetween, todayTR } from './time';
import type { StopEvent, TrackPoint, Trip } from './types';

const STATUS_LABEL: Record<StopEvent['status'], string> = {
  arrived: 'Varıldı', missed: 'Uğranmadı', absent: 'Gelmeyecekti', pending: 'Bekleniyor',
};

type Vehicle = { id: string; plate: string };

export function TripHistory() {
  const [date, setDate] = useState(todayTR());
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehicleId, setVehicleId] = useState('');
  const [trips, setTrips] = useState<Trip[] | null>(null);
  const [summary, setSummary] = useState<Record<string, { arrived: number; missed: number; total: number }>>({});
  const [selected, setSelected] = useState<Trip | null>(null);

  useEffect(() => {
    supabase.from('vehicles').select('id, plate').order('plate').then(({ data }) => setVehicles((data ?? []) as Vehicle[]));
  }, []);

  useEffect(() => {
    setTrips(null); setSelected(null);
    let q = supabase.from('trips')
      .select('id, vehicle_id, vehicle_plate, driver_name, service_date, started_at, ended_at, end_reason, direction, distance_m, position_count')
      .eq('service_date', date).order('started_at');
    if (vehicleId) q = q.eq('vehicle_id', vehicleId);
    q.then(async ({ data }) => {
      const list = (data ?? []) as Trip[];
      setTrips(list);
      if (!list.length) { setSummary({}); return; }
      const { data: ev } = await supabase.from('trip_stop_events').select('trip_id, status').in('trip_id', list.map((t) => t.id));
      const s: typeof summary = {};
      for (const e of ev ?? []) {
        const x = (s[e.trip_id] ??= { arrived: 0, missed: 0, total: 0 });
        if (e.status !== 'absent') x.total++;
        if (e.status === 'arrived') x.arrived++;
        if (e.status === 'missed') x.missed++;
      }
      setSummary(s);
    });
  }, [date, vehicleId]);

  if (selected) return <TripDetail trip={selected} onBack={() => setSelected(null)} />;

  return (
    <section>
      <div className="filters">
        <label>Tarih<input type="date" value={date} max={todayTR()} onChange={(e) => setDate(e.target.value)} /></label>
        <label>Araç
          <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
            <option value="">Tümü</option>
            {vehicles.map((v) => <option key={v.id} value={v.id}>{v.plate}</option>)}
          </select>
        </label>
      </div>
      <p className="muted small">{fmtDate(date)}</p>
      {!trips ? <p className="muted">Yükleniyor…</p> : trips.length === 0 ? (
        <p className="empty">Bu tarihte kayıtlı sefer yok.</p>
      ) : (
        <div className="tablewrap">
          <table className="clickable">
            <thead><tr><th>Araç</th><th>Servis</th><th>Sürücü</th><th>Başlangıç</th><th>Bitiş</th><th>Mesafe</th><th>Duraklar</th><th></th></tr></thead>
            <tbody>
              {trips.map((t) => {
                const s = summary[t.id];
                return (
                  <tr key={t.id} onClick={() => setSelected(t)}>
                    <td><b>{t.vehicle_plate}</b></td>
                    <td>{t.direction === 'to_factory' ? 'Sabah · fabrikaya' : t.direction === 'from_factory' ? 'Akşam · fabrikadan' : '—'}</td>
                    <td>{t.driver_name ?? '—'}</td>
                    <td>{fmtTime(t.started_at)}</td>
                    <td>{t.ended_at ? <>{fmtTime(t.ended_at)}{(t.end_reason === 'factory' || t.end_reason === 'last_stop') && <span className="tag arrived" title="Otomatik tamamlandı">oto</span>}</> : <span className="tag live">Devam ediyor</span>}</td>
                    <td>{fmtDistance(t.distance_m)}</td>
                    <td>
                      {s ? <>{s.arrived}/{s.total} varıldı{s.missed ? <span className="tag missed">{s.missed} uğranmadı</span> : null}</> : '—'}
                    </td>
                    <td className="go">İncele</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function TripDetail({ trip, onBack }: { trip: Trip; onBack: () => void }) {
  const [stops, setStops] = useState<StopEvent[] | null>(null);
  const [track, setTrack] = useState<TrackPoint[] | null>(null);
  const [focus, setFocus] = useState<string | null>(null);

  useEffect(() => {
    supabase.from('trip_stop_events')
      .select('id, trip_id, passenger_name, address, lat, lng, planned_order, status, arrived_at, departed_at, closest_m, closest_at')
      .eq('trip_id', trip.id)
      .then(({ data }) => setStops((data ?? []) as StopEvent[]));
    (async () => {
      // Uzun seferler 1000 noktayı aşabilir: sayfa sayfa çek
      const all: TrackPoint[] = [];
      for (let from = 0; ; from += 1000) {
        const { data } = await supabase.from('vehicle_positions').select('lat, lng, recorded_at, speed')
          .eq('trip_id', trip.id).order('recorded_at').range(from, from + 999);
        all.push(...((data ?? []) as TrackPoint[]));
        if (!data || data.length < 1000) break;
      }
      setTrack(all);
    })();
  }, [trip.id]);

  // Sıralama: varılanlar varış saatine göre, sonra diğerleri planlanan sıraya göre
  const ordered = useMemo(() => [...(stops ?? [])].sort((a, b) => {
    if (a.arrived_at && b.arrived_at) return a.arrived_at.localeCompare(b.arrived_at);
    if (a.arrived_at) return -1;
    if (b.arrived_at) return 1;
    return (a.planned_order ?? 99) - (b.planned_order ?? 99);
  }), [stops]);

  function exportCsv() {
    const rows = [['Yolcu', 'Adres', 'Durum', 'Varış', 'Ayrılış', 'Bekleme (dk)', 'En yakın geçiş (m)', 'En yakın geçiş saati']];
    for (const s of ordered) rows.push([
      s.passenger_name ?? '', s.address ?? '', STATUS_LABEL[s.status], fmtTimeSec(s.arrived_at), fmtTimeSec(s.departed_at),
      String(minutesBetween(s.arrived_at, s.departed_at) ?? ''), s.closest_m != null ? String(Math.round(s.closest_m)) : '', fmtTimeSec(s.closest_at),
    ]);
    const csv = '﻿' + rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(';')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `sefer_${trip.vehicle_plate?.replace(/\s/g, '')}_${trip.service_date}.csv`;
    a.click();
  }

  const missed = (stops ?? []).filter((s) => s.status === 'missed').length;

  return (
    <section>
      <button className="ghost small back" onClick={onBack}>← Seferler</button>
      <div className="trip-head">
        <div>
          <h2 style={{ margin: '8px 0 2px' }}>{trip.vehicle_plate} · {trip.driver_name}</h2>
          <p className="muted" style={{ margin: 0 }}>
            {fmtDate(trip.service_date)} · {fmtTime(trip.started_at)}–{trip.ended_at ? fmtTime(trip.ended_at) : 'devam ediyor'}
            {' · '}{fmtDistance(trip.distance_m)} · {trip.position_count} konum
            {trip.end_reason === 'inactivity' ? ' · sinyal kesildiği için otomatik kapandı'
              : trip.end_reason === 'factory' ? ' · fabrikaya varınca otomatik tamamlandı'
              : trip.end_reason === 'last_stop' ? ' · son yolcuya ulaşınca otomatik tamamlandı' : ''}
          </p>
        </div>
        <button className="ghost small" onClick={exportCsv} disabled={!stops}>CSV indir</button>
      </div>

      {missed > 0 ? <p className="alert">Bu seferde <b>{missed} durağa uğranmadı</b>. Ayrıntılar aşağıdaki tabloda.</p> : null}

      {track && stops ? <TripMap track={track} stops={ordered} focus={focus} /> : <div className="tripmap loading">Harita yükleniyor…</div>}
      <div className="legend">
        <span><i style={{ background: '#2E7D32' }} />Varıldı</span>
        <span><i style={{ background: '#C62828' }} />Uğranmadı</span>
        <span><i style={{ background: '#8A94A3' }} />Gelmeyeceğini bildirdi</span>
        <span><i className="line" />Gidilen yol</span>
      </div>

      <div className="tablewrap">
        <table className="clickable">
          <thead><tr><th>#</th><th>Yolcu</th><th>Durak</th><th>Durum</th><th>Varış</th><th>Ayrılış</th><th>Bekleme</th><th>En yakın geçiş</th></tr></thead>
          <tbody>
            {ordered.map((s, i) => (
              <tr key={s.id} onClick={() => setFocus(s.id)} className={s.status === 'missed' ? 'row-missed' : ''}>
                <td>{i + 1}</td>
                <td>{s.passenger_name}</td>
                <td>{s.address}</td>
                <td><span className={`tag ${s.status}`}>{STATUS_LABEL[s.status]}</span></td>
                <td>{fmtTime(s.arrived_at)}</td>
                <td>{fmtTime(s.departed_at)}</td>
                <td>{minutesBetween(s.arrived_at, s.departed_at) != null ? `${minutesBetween(s.arrived_at, s.departed_at)} dk` : '—'}</td>
                <td>{s.status === 'arrived' ? '—' : s.closest_m != null ? `${fmtDistance(s.closest_m)} (${fmtTime(s.closest_at)})` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        Varış: araç durağa 80 m yaklaştığı ilk an. Ayrılış: 150 m uzaklaştığı an. "En yakın geçiş": uğranmayan durağa aracın en fazla ne kadar yaklaştığı.
      </p>
    </section>
  );
}
