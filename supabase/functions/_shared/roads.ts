// Yol ağı üzerinden rota: sıralama (en hızlı) + çizim + süre/mesafe
//
// Sağlayıcı: GOOGLE_MAPS_API_KEY tanımlıysa Google Routes API, değilse OSRM
// (OpenStreetMap yol verisi; varsayılan genel sunucu router.project-osrm.org — canlıda
// Google anahtarı veya kendi OSRM sunucunuz OSRM_URL ile kullanılmalı).
// İkisi de başarısız olursa kuş uçuşu tahmine düşülür (source = "fallback").

export type LL = { lat: number; lng: number };
export type Leg = { distance_m: number; duration_s: number };
export type RoadRoute = {
  source: "google" | "osrm" | "fallback";
  order: number[];          // girdi noktalarının gezilme sırası (indeks)
  polyline: string | null;  // Google/OSRM ortak "encoded polyline" (hassasiyet 5)
  legs: Leg[];              // sıradaki ardışık noktalar arası
  distance_m: number;
  duration_s: number;
};

const OSRM = (Deno.env.get("OSRM_URL") ?? "https://router.project-osrm.org").replace(/\/$/, "");
const GKEY = () => Deno.env.get("GOOGLE_MAPS_API_KEY") ?? "";

// ---------------- yardımcılar ----------------
const R = 6371000;
export function haversine(a: LL, b: LL) {
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const ROAD_FACTOR = 1.35, CITY_SPEED_MS = 25 / 3.6;
const crowLeg = (a: LL, b: LL): Leg => {
  const d = haversine(a, b) * ROAD_FACTOR;
  return { distance_m: Math.round(d), duration_s: Math.round(d / CITY_SPEED_MS) };
};
const coords = (pts: LL[]) => pts.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(";");

async function fetchJson(url: string, init?: RequestInit, ms = 12000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { ...init, signal: ctl.signal, headers: { "User-Agent": "servis-takip/1.0", ...(init?.headers ?? {}) } });
    if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

/** Kuş uçuşu en yakın komşu + 2-opt (son çare) */
function crowOrder(pts: LL[], startIdx?: number, endIdx?: number): number[] {
  const idx = pts.map((_, i) => i).filter((i) => i !== startIdx && i !== endIdx);
  const seq: number[] = [];
  let cur = startIdx ?? idx.shift()!;
  if (startIdx === undefined) seq.push(cur);
  while (idx.length) {
    let bi = 0, bd = Infinity;
    idx.forEach((i, k) => { const d = haversine(pts[cur], pts[i]); if (d < bd) { bd = d; bi = k; } });
    cur = idx.splice(bi, 1)[0]; seq.push(cur);
  }
  const full = () => [...(startIdx !== undefined ? [startIdx] : []), ...seq, ...(endIdx !== undefined ? [endIdx] : [])];
  const len = (o: number[]) => o.slice(1).reduce((s, v, k) => s + haversine(pts[o[k]], pts[v]), 0);
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < seq.length - 1; i++) for (let k = i + 1; k < seq.length; k++) {
      const before = len(full());
      const cand = [...seq.slice(0, i), ...seq.slice(i, k + 1).reverse(), ...seq.slice(k + 1)];
      const old = seq.splice(0, seq.length, ...cand);
      if (len(full()) + 1 < before) improved = true; else seq.splice(0, seq.length, ...old);
    }
  }
  return full();
}

// ---------------- sıralama ----------------
/**
 * En hızlı gezilme sırası. startIdx/endIdx verilirse o noktalar başta/sonda sabit kalır.
 * Döndürülen dizi tüm noktaların indekslerini içerir.
 */
export async function optimizeOrder(pts: LL[], startIdx?: number, endIdx?: number): Promise<{ order: number[]; source: RoadRoute["source"] }> {
  if (pts.length <= 2) {
    const o = pts.map((_, i) => i);
    if (startIdx !== undefined) { o.splice(o.indexOf(startIdx), 1); o.unshift(startIdx); }
    if (endIdx !== undefined && endIdx !== startIdx) { o.splice(o.indexOf(endIdx), 1); o.push(endIdx); }
    return { order: o, source: "osrm" };
  }
  // Google: uç noktalar sabit olmalı; eksikse uzaklık sezgisiyle seç
  if (GKEY()) {
    try {
      let s = startIdx, e = endIdx;
      const all = pts.map((_, i) => i);
      if (s === undefined) {
        const ref = e !== undefined ? pts[e] : centroid(pts);
        s = all.filter((i) => i !== e).reduce((a, b) => (haversine(ref, pts[b]) > haversine(ref, pts[a]) ? b : a));
      }
      if (e === undefined) e = all.filter((i) => i !== s).reduce((a, b) => (haversine(pts[s!], pts[b]) > haversine(pts[s!], pts[a]) ? b : a));
      const mid = all.filter((i) => i !== s && i !== e);
      const g = await googleRoutes([pts[s], ...mid.map((i) => pts[i]), pts[e]], true);
      const midOrder = g.optimized.length ? g.optimized.map((k) => mid[k]) : mid;
      return { order: [s, ...midOrder, e], source: "google" };
    } catch (err) { console.error("google optimize", err); }
  }
  // OSRM trip
  try {
    if (startIdx !== undefined && endIdx !== undefined) {
      const mid = pts.map((_, i) => i).filter((i) => i !== startIdx && i !== endIdx);
      const seq = [startIdx, ...mid, endIdx];
      const j = await fetchJson(`${OSRM}/trip/v1/driving/${coords(seq.map((i) => pts[i]))}?roundtrip=false&source=first&destination=last&overview=false`);
      return { order: tripOrder(j, seq), source: "osrm" };
    }
    // Döngüsel tur → uç noktaya göre aç (en uzun bağlantı atılır)
    const j = await fetchJson(`${OSRM}/trip/v1/driving/${coords(pts)}?roundtrip=true&overview=false`);
    const cyc = tripOrder(j, pts.map((_, i) => i));
    const legDur: number[] = (j.trips?.[0]?.legs ?? []).map((l: { duration: number }) => l.duration); // cyc[k] → cyc[k+1], son: kapanış
    const n = cyc.length;
    const rotate = (startPos: number, dir: 1 | -1) => Array.from({ length: n }, (_, k) => cyc[((startPos + dir * k) % n + n) % n]);
    if (endIdx !== undefined) {
      const p = cyc.indexOf(endIdx);
      // endIdx sonda: ya p+1'den başlayıp ileri, ya p-1'den başlayıp geri
      const fwdDrop = legDur[p] ?? 0, backDrop = legDur[(p - 1 + n) % n] ?? 0;
      return { order: fwdDrop >= backDrop ? rotate(p + 1, 1) : rotate(p - 1, -1), source: "osrm" };
    }
    if (startIdx !== undefined) {
      const p = cyc.indexOf(startIdx);
      const dropIn = legDur[(p - 1 + n) % n] ?? 0, dropOut = legDur[p] ?? 0;
      return { order: dropIn >= dropOut ? rotate(p, 1) : rotate(p, -1), source: "osrm" };
    }
    // ikisi de serbest: en uzun bağlantıyı kopar
    let worst = 0; legDur.forEach((d, k) => { if (d > legDur[worst]) worst = k; });
    return { order: rotate(worst + 1, 1), source: "osrm" };
  } catch (err) { console.error("osrm trip", err); }
  return { order: crowOrder(pts, startIdx, endIdx), source: "fallback" };
}

function tripOrder(j: { code?: string; waypoints?: { waypoint_index: number }[] }, seq: number[]): number[] {
  if (j.code !== "Ok" || !j.waypoints) throw new Error(`OSRM trip: ${j.code}`);
  const out: number[] = new Array(seq.length);
  j.waypoints.forEach((w, inputPos) => { out[w.waypoint_index] = seq[inputPos]; });
  return out;
}
const centroid = (pts: LL[]): LL => ({ lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length, lng: pts.reduce((s, p) => s + p.lng, 0) / pts.length });

// ---------------- çizim + süre ----------------
/** Noktaları verilen sırayla yollardan geçerek bağlar */
export async function routeThrough(ordered: LL[]): Promise<Omit<RoadRoute, "order">> {
  if (ordered.length < 2) return { source: "osrm", polyline: null, legs: [], distance_m: 0, duration_s: 0 };
  if (GKEY()) {
    try {
      const g = await googleRoutes(ordered, false);
      return { source: "google", polyline: g.polyline, legs: g.legs, distance_m: g.distance_m, duration_s: g.duration_s };
    } catch (err) { console.error("google route", err); }
  }
  try {
    const j = await fetchJson(`${OSRM}/route/v1/driving/${coords(ordered)}?overview=full&geometries=polyline&steps=false`);
    const r = j.routes?.[0];
    if (j.code !== "Ok" || !r) throw new Error(`OSRM route: ${j.code}`);
    return {
      source: "osrm", polyline: r.geometry as string,
      legs: (r.legs ?? []).map((l: { distance: number; duration: number }) => ({ distance_m: Math.round(l.distance), duration_s: Math.round(l.duration) })),
      distance_m: Math.round(r.distance), duration_s: Math.round(r.duration),
    };
  } catch (err) { console.error("osrm route", err); }
  const legs = ordered.slice(1).map((p, k) => crowLeg(ordered[k], p));
  return { source: "fallback", polyline: null, legs, distance_m: legs.reduce((s, l) => s + l.distance_m, 0), duration_s: legs.reduce((s, l) => s + l.duration_s, 0) };
}

async function googleRoutes(pts: LL[], optimize: boolean) {
  const ll = (p: LL) => ({ location: { latLng: { latitude: p.lat, longitude: p.lng } } });
  const inter = pts.slice(1, -1);
  const j = await fetchJson("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json", "X-Goog-Api-Key": GKEY(),
      "X-Goog-FieldMask": "routes.optimizedIntermediateWaypointIndex,routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline,routes.legs.distanceMeters,routes.legs.duration",
    },
    body: JSON.stringify({
      origin: ll(pts[0]), destination: ll(pts[pts.length - 1]), intermediates: inter.map(ll),
      travelMode: "DRIVE", routingPreference: "TRAFFIC_AWARE", optimizeWaypointOrder: optimize && inter.length > 1,
      languageCode: "tr-TR", units: "METRIC",
    }),
  });
  const r = j.routes?.[0];
  if (!r) throw new Error("Google: rota yok");
  const sec = (s?: string) => parseInt(String(s ?? "0s").replace("s", ""), 10);
  return {
    optimized: (r.optimizedIntermediateWaypointIndex ?? []) as number[],
    polyline: (r.polyline?.encodedPolyline ?? null) as string | null,
    legs: (r.legs ?? []).map((l: { distanceMeters?: number; duration?: string }) => ({ distance_m: l.distanceMeters ?? 0, duration_s: sec(l.duration) })),
    distance_m: r.distanceMeters as number, duration_s: sec(r.duration),
  };
}

/** Sıralama + çizim tek çağrıda */
export async function bestRoute(pts: LL[], opts: { startIdx?: number; endIdx?: number; fixedOrder?: boolean }): Promise<RoadRoute> {
  const ord = opts.fixedOrder ? { order: pts.map((_, i) => i), source: "osrm" as const } : await optimizeOrder(pts, opts.startIdx, opts.endIdx);
  const geo = await routeThrough(ord.order.map((i) => pts[i]));
  return { ...geo, order: ord.order };
}
