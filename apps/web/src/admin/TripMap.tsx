import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { StopEvent, TrackPoint } from './types';
import { fmtTime } from './time';

const STATUS_COLOR: Record<StopEvent['status'], string> = {
  arrived: '#2E7D32', missed: '#C62828', absent: '#8A94A3', pending: '#E59400',
};

export function TripMap({ track, stops, focus }: { track: TrackPoint[]; stops: StopEvent[]; focus?: string | null }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const markers = useRef<Record<string, L.Marker>>({});

  useEffect(() => {
    if (!el.current) return;
    const m = L.map(el.current, { zoomControl: true });
    map.current = m;
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(m);

    const bounds: L.LatLngExpression[] = [];
    if (track.length) {
      const line = track.map((p) => [p.lat, p.lng] as L.LatLngTuple);
      L.polyline(line, { color: '#1F4E79', weight: 4, opacity: 0.85 }).addTo(m);
      const dot = (p: TrackPoint, color: string, label: string) =>
        L.circleMarker([p.lat, p.lng], { radius: 7, color: '#fff', weight: 2, fillColor: color, fillOpacity: 1 })
          .bindTooltip(`${label} · ${fmtTime(p.recorded_at)}`).addTo(m);
      dot(track[0], '#1F4E79', 'Başlangıç');
      dot(track[track.length - 1], '#111', 'Bitiş');
      bounds.push(...line);
    }
    stops.forEach((s, i) => {
      const color = STATUS_COLOR[s.status];
      const label = i + 1; // tablodaki sırayla aynı
      const icon = L.divIcon({
        className: '',
        html: `<div style="width:26px;height:26px;border-radius:13px;background:${color};color:#fff;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;font:700 12px system-ui">${label}</div>`,
        iconSize: [26, 26], iconAnchor: [13, 13],
      });
      const detail = s.status === 'arrived' ? `Varış ${fmtTime(s.arrived_at)}`
        : s.status === 'missed' ? `Uğranmadı · en yakın ${Math.round(s.closest_m ?? 0)} m`
        : s.status === 'absent' ? 'Gelmeyeceğini bildirdi' : 'Bekleniyor';
      markers.current[s.id] = L.marker([s.lat, s.lng], { icon })
        .bindTooltip(`<b>${s.passenger_name ?? ''}</b><br>${s.address ?? ''}<br>${detail}`).addTo(m);
      bounds.push([s.lat, s.lng]);
    });
    if (bounds.length) m.fitBounds(L.latLngBounds(bounds), { padding: [30, 30] });
    else m.setView([41.01, 28.98], 11);
    return () => { m.remove(); map.current = null; markers.current = {}; };
  }, [track, stops]);

  useEffect(() => {
    if (!focus || !map.current) return;
    const mk = markers.current[focus];
    if (mk) { map.current.setView(mk.getLatLng(), 15, { animate: true }); mk.openTooltip(); }
  }, [focus]);

  return <div ref={el} className="tripmap" />;
}
