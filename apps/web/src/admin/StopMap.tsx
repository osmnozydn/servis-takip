// Harita: numaralı duraklar + (isteğe bağlı) tıklayarak/aramayla yeni nokta seçme
import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export type MapStop = { id: string; lat: number; lng: number; label: string; title: string; muted?: boolean };
import { AddressInput, type PickedPoint } from './AddressInput';
export type { PickedPoint };

const pin = (label: string, color: string, size = 26) => L.divIcon({
  className: '',
  html: `<div style="width:${size}px;height:${size}px;border-radius:${size / 2}px;background:${color};color:#fff;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;font:700 12px system-ui">${label}</div>`,
  iconSize: [size, size], iconAnchor: [size / 2, size / 2],
});

async function reverse(lat: number, lng: number): Promise<string> {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&zoom=17&accept-language=tr&lat=${lat}&lon=${lng}`);
    const j = await r.json() as { display_name?: string };
    return j.display_name ? shortAddress(j.display_name) : '';
  } catch { return ''; }
}
const shortAddress = (s: string) => s.split(', ').filter((p) => !/^(Türkiye|\d{5})$/.test(p)).slice(0, 4).join(', ');

export function StopMap({ stops = [], picked, onPick, end, height = 380, focus, path, search = true, radius }: {
  stops?: MapStop[];
  picked?: PickedPoint | null;
  onPick?: (p: PickedPoint) => void;
  end?: { lat: number; lng: number; label: string } | null;
  height?: number;
  focus?: string | null;
  /** Yollardan geçen güzergâh (enlem, boylam). Yoksa duraklar arası kesikli tahmini çizgi. */
  path?: [number, number][] | null;
  /** Haritanın üstünde adres arama kutusu (form kendi adres alanını kullanıyorsa kapatılır) */
  search?: boolean;
  /** Seçilen noktanın çevresine varış yarıçapı çiz (m) */
  radius?: number;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const pickMarker = useRef<L.Marker | null>(null);
  const pickCircle = useRef<L.Circle | null>(null);
  const markers = useRef<Record<string, L.Marker>>({});
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const fitted = useRef('');  // hangi durak kümesine sığdırıldı

  useEffect(() => {
    if (!el.current) return;
    const m = L.map(el.current).setView([41.01, 28.98], 11);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    m.on('click', async (e: L.LeafletMouseEvent) => {
      if (!onPickRef.current) return;
      const { lat, lng } = e.latlng;
      onPickRef.current({ lat, lng, address: '' });
      const address = await reverse(lat, lng);
      onPickRef.current?.({ lat, lng, address });
    });
    map.current = m;
    return () => { m.off(); m.stop(); m.remove(); map.current = null; pickMarker.current = null; pickCircle.current = null; markers.current = {}; };
  }, []);

  // Duraklar
  useEffect(() => {
    const m = map.current, g = layer.current;
    if (!m || !g) return;
    g.clearLayers(); markers.current = {};
    const pts: L.LatLngTuple[] = [];
    for (const s of stops) {
      const mk = L.marker([s.lat, s.lng], { icon: pin(s.label, s.muted ? '#8A94A3' : '#1F4E79') }).bindTooltip(s.title).addTo(g);
      markers.current[s.id] = mk;
      pts.push([s.lat, s.lng]);
    }
    if (end) {
      L.marker([end.lat, end.lng], { icon: pin('★', '#F2A900', 28) }).bindTooltip(`Varış: ${end.label}`).addTo(g);
      pts.push([end.lat, end.lng]);
    }
    if (path && path.length > 1) {
      L.polyline(path, { color: '#ffffff', weight: 8, opacity: .9, interactive: false }).addTo(g);
      L.polyline(path, { color: '#1F4E79', weight: 5, opacity: .95, interactive: false }).addTo(g);
    } else if (stops.length > 1) {
      L.polyline(stops.map((s) => [s.lat, s.lng] as L.LatLngTuple), { color: '#1F4E79', weight: 2, dashArray: '4 8', opacity: .35, interactive: false }).addTo(g);
    }
    if (picked) pts.push([picked.lat, picked.lng]);
    // Durak kümesi değiştiğinde (ilk yükleme, durak eklendi/çıkarıldı) yeniden sığdır; yalnızca sıra değişince haritayı oynatma
    const setKey = stops.map((s) => s.id).sort().join(',') + (end ? '|end' : '');
    if (pts.length && fitted.current !== setKey) { m.fitBounds(L.latLngBounds(pts), { padding: [30, 30], maxZoom: 15, animate: false }); fitted.current = setKey; }
  }, [stops, end, path]); // eslint-disable-line react-hooks/exhaustive-deps

  // Seçilen nokta
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (!picked) { pickMarker.current?.remove(); pickMarker.current = null; pickCircle.current?.remove(); pickCircle.current = null; return; }
    if (radius) {
      if (!pickCircle.current) pickCircle.current = L.circle([picked.lat, picked.lng], { radius, color: '#F2A900', weight: 2, fillColor: '#F2A900', fillOpacity: .12, interactive: false }).addTo(m);
      else { pickCircle.current.setLatLng([picked.lat, picked.lng]); pickCircle.current.setRadius(radius); }
    }
    if (!pickMarker.current) {
      pickMarker.current = L.marker([picked.lat, picked.lng], { draggable: true, icon: pin('+', '#2E7D32', 30), zIndexOffset: 1000 }).addTo(m);
      pickMarker.current.on('dragend', async () => {
        const p = pickMarker.current!.getLatLng();
        onPickRef.current?.({ lat: p.lat, lng: p.lng, address: '' });
        const address = await reverse(p.lat, p.lng);
        onPickRef.current?.({ lat: p.lat, lng: p.lng, address });
      });
    } else pickMarker.current.setLatLng([picked.lat, picked.lng]);
    if (!m.getBounds().contains([picked.lat, picked.lng]) || m.getZoom() < 14) m.setView([picked.lat, picked.lng], 16, { animate: false });
  }, [picked?.lat, picked?.lng, radius]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!focus || !map.current) return;
    const mk = markers.current[focus];
    if (mk) { if (!map.current.getBounds().contains(mk.getLatLng())) map.current.panTo(mk.getLatLng(), { animate: false }); mk.openTooltip(); }
  }, [focus]);

  return (
    <div className="stopmap">
      {onPick && search && <MapSearch onSelect={(p) => { onPick(p); map.current?.setView([p.lat, p.lng], 16, { animate: false }); }} />}
      <div ref={el} className="tripmap" style={{ height }} />
      {onPick && <small className="muted">Adresi yazıp önerilerden seçin veya haritada noktanın olduğu yere tıklayın. İşareti sürükleyerek düzeltebilirsiniz.</small>}
    </div>
  );
}

function MapSearch({ onSelect }: { onSelect: (p: PickedPoint) => void }) {
  const [q, setQ] = useState('');
  return <AddressInput value={q} onChange={setQ} onSelect={(p) => { setQ(p.address); onSelect(p); }} />;
}
