// Canlı filo haritası: her aracın son konumu, plaka etiketiyle. Konum geldikçe işaret kayar.
import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export type FleetPoint = { id: string; plate: string; lat: number; lng: number; live: boolean; title: string /** HTML: kullanıcı verisi esc() ile kaçışlanmalı */ };

export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const icon = (p: FleetPoint) => L.divIcon({
  className: '',
  html: `<div class="fm-pin ${p.live ? 'live' : ''}"><i></i><span>${esc(p.plate)}</span></div>`,
  iconSize: [0, 0], iconAnchor: [0, 0],
});

export function FleetMap({ points, onPick }: { points: FleetPoint[]; onPick?: (id: string) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const marks = useRef<Record<string, L.Marker>>({});
  const fitted = useRef('');
  const pickRef = useRef(onPick); pickRef.current = onPick;

  useEffect(() => {
    if (!el.current) return;
    const m = L.map(el.current, { zoomControl: false, attributionControl: true, scrollWheelZoom: false }).setView([41.01, 29.0], 10);
    L.control.zoom({ position: 'bottomright' }).addTo(m);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(m);
    map.current = m;
    return () => { m.off(); m.stop(); m.remove(); map.current = null; marks.current = {}; fitted.current = ''; };
  }, []);

  useEffect(() => {
    const m = map.current; if (!m) return;
    const seen = new Set<string>();
    for (const p of points) {
      seen.add(p.id);
      const mk = marks.current[p.id];
      if (mk) { mk.setLatLng([p.lat, p.lng]); mk.setIcon(icon(p)); mk.setTooltipContent(p.title); }
      else {
        marks.current[p.id] = L.marker([p.lat, p.lng], { icon: icon(p), keyboard: true, title: p.plate })
          .bindTooltip(p.title, { direction: 'top', offset: [0, -18] })
          .on('click', () => pickRef.current?.(p.id)).addTo(m);
      }
    }
    for (const id of Object.keys(marks.current)) if (!seen.has(id)) { marks.current[id].remove(); delete marks.current[id]; }
    const key = points.map((p) => p.id).sort().join(',');
    if (points.length && fitted.current !== key) {
      fitted.current = key;
      if (points.length === 1) m.setView([points[0].lat, points[0].lng], 13, { animate: false });
      else m.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng] as L.LatLngTuple)), { padding: [60, 60], maxZoom: 13, animate: false });
    }
  }, [points]);

  return (
    <div className="fleetmap">
      <div ref={el} className="fleetmap-canvas" />
      {points.length === 0 && <div className="fleetmap-empty">Henüz konum gelmedi. Sürücü uygulamada servisi başlatınca araçlar burada görünür.</div>}
    </div>
  );
}
