// Yazdıkça adres önerileri (Google Maps'teki gibi). Kaynak: Photon (OpenStreetMap, anahtarsız,
// yazarken arama için tasarlanmış). Ulaşılamazsa Nominatim'e düşer. Canlıda Google Places ile değiştirilebilir.
import { useEffect, useId, useRef, useState } from 'react';

export type PickedPoint = { lat: number; lng: number; address: string };
type Suggestion = PickedPoint & { main: string; sub: string };

const TR_BBOX = '25.6,35.8,44.9,42.2';           // Türkiye
const DEFAULT_BIAS = { lat: 41.01, lng: 29.0 };   // İstanbul

type PhotonProps = {
  name?: string; street?: string; housenumber?: string; district?: string; locality?: string;
  city?: string; county?: string; state?: string; countrycode?: string;
};

const uniq = (xs: (string | undefined)[]) => xs.filter((x, i, a): x is string => !!x && a.indexOf(x) === i);

function fromPhoton(p: PhotonProps, lng: number, lat: number): Suggestion {
  const streetLine = uniq([p.street, p.housenumber]).join(' ');
  const main = p.name ?? (streetLine || p.district || p.city || '');
  const area = uniq([p.district ?? p.locality, p.city ?? p.county, p.state !== (p.city ?? p.county) ? p.state : undefined]);
  const sub = uniq([p.name && streetLine !== main ? streetLine : undefined, ...area]).filter((x) => x !== main).join(', ');
  const address = uniq([main, p.name && streetLine ? p.street : undefined, p.district ?? p.locality, p.city ?? p.county]).slice(0, 4).join(', ');
  return { lat, lng, main, sub, address };
}

export async function suggest(q: string, bias = DEFAULT_BIAS, signal?: AbortSignal): Promise<Suggestion[]> {
  try {
    const u = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=8&lat=${bias.lat}&lon=${bias.lng}&bbox=${TR_BBOX}`;
    const r = await fetch(u, { signal });
    if (!r.ok) throw new Error(String(r.status));
    const j = await r.json() as { features: { properties: PhotonProps; geometry: { coordinates: [number, number] } }[] };
    const out = j.features
      .filter((f) => !f.properties.countrycode || f.properties.countrycode === 'TR')
      .map((f) => fromPhoton(f.properties, f.geometry.coordinates[0], f.geometry.coordinates[1]))
      .filter((s) => s.main);
    // aynı satırı iki kez gösterme
    return out.filter((s, i) => out.findIndex((x) => x.main === s.main && x.sub === s.sub) === i).slice(0, 6);
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&countrycodes=tr&limit=6&accept-language=tr&q=${encodeURIComponent(q)}`, { signal });
    if (!r.ok) return [];
    const j = await r.json() as { lat: string; lon: string; display_name: string }[];
    return j.map((x) => {
      const parts = x.display_name.split(', ').filter((p) => !/^(Türkiye|\d{5})$/.test(p));
      return { lat: +x.lat, lng: +x.lon, main: parts[0], sub: parts.slice(1, 4).join(', '), address: parts.slice(0, 4).join(', ') };
    });
  }
}

export function AddressInput({ value, onChange, onSelect, placeholder, bias }: {
  value: string;
  onChange: (text: string) => void;
  onSelect: (p: PickedPoint) => void;
  placeholder?: string;
  bias?: { lat: number; lng: number } | null;
}) {
  const [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');   // yalnızca kullanıcının yazdığı metinle arama yapılır
  const ctrl = useRef<AbortController | null>(null);
  const listId = useId();

  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) { setItems([]); setBusy(false); return; }
    const t = setTimeout(async () => {
      ctrl.current?.abort();
      const c = new AbortController(); ctrl.current = c;
      setBusy(true);
      try { const r = await suggest(q, bias ?? undefined, c.signal); setItems(r); setActive(r.length ? 0 : -1); setOpen(true); }
      catch { /* iptal edildi */ }
      finally { if (ctrl.current === c) setBusy(false); }
    }, 280);
    return () => clearTimeout(t);
  }, [query]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => ctrl.current?.abort(), []);

  function choose(s: Suggestion) {
    onSelect({ lat: s.lat, lng: s.lng, address: s.address });
    setOpen(false); setItems([]); setQuery('');
  }

  const show = open && query.trim().length >= 3 && !busy;
  return (
    <div className="addrsearch">
      <div className="addrinput">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
        <input
          value={value} placeholder={placeholder ?? 'Adres, cadde veya yer yazın'}
          role="combobox" aria-expanded={show && items.length > 0} aria-controls={listId} aria-autocomplete="list"
          aria-activedescendant={show && active >= 0 ? `${listId}-${active}` : undefined} autoComplete="off"
          onChange={(e) => { onChange(e.target.value); setQuery(e.target.value); setOpen(true); }}
          onFocus={() => { if (items.length) setOpen(true); }}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (!show || !items.length) return;
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % items.length); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a - 1 + items.length) % items.length); }
            else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); choose(items[active]); }
            else if (e.key === 'Escape') { setOpen(false); }
          }}
        />
        {busy && <span className="addrspin" aria-label="Aranıyor" />}
      </div>
      {show && (
        <ul className="addrres" id={listId} role="listbox">
          {items.length === 0 && <li className="muted nores">Sonuç yok. Haritada tıklayarak da seçebilirsiniz.</li>}
          {items.map((s, i) => (
            <li key={`${s.lat},${s.lng},${i}`} id={`${listId}-${i}`} role="option" aria-selected={i === active}
              className={i === active ? 'on' : ''} onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => { e.preventDefault(); choose(s); }}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6.5-5.8-6.5-11A6.5 6.5 0 0 1 18.5 10c0 5.2-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.3" /></svg>
              <span><b>{s.main}</b>{s.sub && <small>{s.sub}</small>}</span>
            </li>
          ))}
          <li className="addrsrc" aria-hidden="true">© OpenStreetMap katkıcıları</li>
        </ul>
      )}
    </div>
  );
}
