// compute-route — Aracın bugünkü rotasını hesaplar ve daily_routes'a yazar.
//
// POST { vehicle_id, origin?: { lat, lng } }
// Yetki: (a) aracın sürücüsü veya şirketin yöneticisi (Authorization: Bearer <oturum>)
//        (b) veritabanı tetikleyicisi (x-internal-secret)
//
// Rota: başlangıç = verilen konum → aracın son görülen konumu → ilk durak.
//       bitiş     = aracın bitiş noktası (fabrika/okul) varsa o; yoksa başlangıca en uzak durak.
//       Ara duraklar Google Routes API ile (optimizeWaypointOrder) sıralanır.
//       GOOGLE_MAPS_API_KEY tanımlı değilse veya Google hata verirse yedek algoritma
//       (en yakın komşu + 2-opt, kuş uçuşu mesafe) kullanılır.
// Aracın rota modu "manual" ise duraklar yöneticinin belirlediği alış sırasıyla (stops.pickup_order)
// gezilir; yalnızca süre/mesafe hesaplanır.
// Bugün "kullanmayacağım" diyen yolcuların durakları rotaya alınmaz.
import { createClient } from "npm:@supabase/supabase-js@2";

type LatLng = { lat: number; lng: number };
type StopIn = { stop_id: string; passenger_id: string; lat: number; lng: number; address: string | null; pickup_order?: number | null };
type StopOut = StopIn & { eta_s: number; dist_m: number };

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

function secretKey(): string {
  const keys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (keys) { try { const k = JSON.parse(keys)["default"]; if (k) return k; } catch { /* */ } }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
}

// ---------------- Yedek algoritma ----------------
const R = 6371000;
export function haversine(a: LatLng, b: LatLng) {
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const ROAD_FACTOR = 1.35;        // kuş uçuşu → yol mesafesi
const CITY_SPEED_MS = 25 / 3.6;  // şehir içi ortalama 25 km/s
const STOP_DWELL_S = 45;         // durakta bekleme

function pathLen(origin: LatLng, seq: LatLng[], end: LatLng | null) {
  let d = 0, prev = origin;
  for (const p of seq) { d += haversine(prev, p); prev = p; }
  if (end) d += haversine(prev, end);
  return d;
}

/** En yakın komşu + 2-opt. Bitiş sabitse ara durakların sırası optimize edilir. */
export function fallbackOrder(origin: LatLng, stops: StopIn[], end: LatLng | null): StopIn[] {
  const left = [...stops];
  const seq: StopIn[] = [];
  let cur: LatLng = origin;
  while (left.length) {
    let bi = 0, bd = Infinity;
    left.forEach((s, i) => { const d = haversine(cur, s); if (d < bd) { bd = d; bi = i; } });
    cur = left[bi];
    seq.push(left.splice(bi, 1)[0]);
  }
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < seq.length - 1; i++) {
      for (let k = i + 1; k < seq.length; k++) {
        const cand = [...seq.slice(0, i), ...seq.slice(i, k + 1).reverse(), ...seq.slice(k + 1)];
        if (pathLen(origin, cand, end) + 1 < pathLen(origin, seq, end)) { seq.splice(0, seq.length, ...cand); improved = true; }
      }
    }
  }
  return seq;
}

function withEta(origin: LatLng, seq: StopIn[], legs?: { distanceMeters?: number; duration?: string }[]): StopOut[] {
  let t = 0, d = 0, prev = origin;
  return seq.map((s, i) => {
    if (legs?.[i]) {
      d += legs[i].distanceMeters ?? 0;
      t += parseInt((legs[i].duration ?? "0s").replace("s", ""), 10);
    } else {
      const seg = haversine(prev, s) * ROAD_FACTOR;
      d += seg; t += seg / CITY_SPEED_MS;
    }
    const out = { ...s, eta_s: Math.round(t), dist_m: Math.round(d) };
    t += STOP_DWELL_S; prev = s;
    return out;
  });
}

// ---------------- Google Routes API ----------------
async function googleRoute(key: string, origin: LatLng, inter: StopIn[], dest: LatLng, optimize = true) {
  const ll = (p: LatLng) => ({ location: { latLng: { latitude: p.lat, longitude: p.lng } } });
  const r = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": "routes.optimizedIntermediateWaypointIndex,routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline,routes.legs.distanceMeters,routes.legs.duration",
    },
    body: JSON.stringify({
      origin: ll(origin), destination: ll(dest), intermediates: inter.map(ll),
      travelMode: "DRIVE", routingPreference: "TRAFFIC_AWARE",
      optimizeWaypointOrder: optimize && inter.length > 1, languageCode: "tr-TR", units: "METRIC",
    }),
  });
  if (!r.ok) throw new Error(`Google Routes ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const route = (await r.json()).routes?.[0];
  if (!route) throw new Error("Google Routes: rota bulunamadı");
  const order: number[] = route.optimizedIntermediateWaypointIndex?.length ? route.optimizedIntermediateWaypointIndex : inter.map((_, i) => i);
  return {
    order, legs: route.legs as { distanceMeters?: number; duration?: string }[],
    distance_m: route.distanceMeters as number,
    duration_s: parseInt(String(route.duration ?? "0s").replace("s", ""), 10),
    polyline: route.polyline?.encodedPolyline as string | undefined,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, secretKey(), { auth: { persistSession: false, autoRefreshToken: false } });

  let body: { vehicle_id?: string; origin?: LatLng };
  try { body = await req.json(); } catch { return json(400, { error: "Geçersiz istek" }); }
  const vehicleId = body.vehicle_id;
  if (!vehicleId) return json(400, { error: "vehicle_id gerekli" });

  const { data: vehicle } = await admin.from("vehicles")
    .select("id, company_id, end_lat, end_lng, end_label, route_mode").eq("id", vehicleId).maybeSingle();
  if (!vehicle) return json(404, { error: "Araç bulunamadı" });

  // --- Yetki ---
  const internal = req.headers.get("x-internal-secret");
  if (internal) {
    const { data: ok } = await admin.rpc("verify_internal_secret", { p_secret: internal });
    if (ok !== true) return json(403, { error: "forbidden" });
  } else {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: u } = await admin.auth.getUser(token);
    if (!u?.user) return json(403, { error: "Giriş gerekli" });
    const [{ data: p }, { data: adminCompany }] = await Promise.all([
      admin.from("profiles").select("role, company_id, vehicle_id").eq("id", u.user.id).maybeSingle(),
      admin.rpc("admin_company_of", { p_uid: u.user.id }),
    ]);
    const allowed = adminCompany === vehicle.company_id ||
      (p && p.company_id === vehicle.company_id && p.role === "driver" && p.vehicle_id === vehicleId);
    if (!allowed) return json(403, { error: "Bu araç için yetkiniz yok" });
  }

  // --- Bugünkü duraklar (devamsızlar hariç) ---
  const today = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10); // İstanbul (UTC+3)
  const [{ data: stops }, { data: abs }] = await Promise.all([
    admin.from("stops").select("id, passenger_id, lat, lng, address, pickup_order").eq("vehicle_id", vehicleId),
    admin.from("absences").select("passenger_id").eq("company_id", vehicle.company_id).eq("date", today),
  ]);
  const absent = new Set((abs ?? []).map((a) => a.passenger_id));
  const active: StopIn[] = (stops ?? []).filter((s) => !absent.has(s.passenger_id))
    .map((s) => ({ stop_id: s.id, passenger_id: s.passenger_id, lat: s.lat, lng: s.lng, address: s.address, pickup_order: s.pickup_order }));
  const manual = vehicle.route_mode === "manual";
  if (manual) active.sort((a, b) => (a.pickup_order ?? 1e9) - (b.pickup_order ?? 1e9));

  // --- Başlangıç ---
  let origin: LatLng | null = body.origin && Number.isFinite(body.origin.lat) ? body.origin : null;
  if (!origin) {
    const { data: lp } = await admin.from("vehicle_last_positions").select("lat, lng").eq("vehicle_id", vehicleId).maybeSingle();
    if (lp) origin = { lat: lp.lat, lng: lp.lng };
  }
  if (!origin && active.length) origin = { lat: active[0].lat, lng: active[0].lng };

  const fixedEnd: LatLng | null = vehicle.end_lat != null && vehicle.end_lng != null ? { lat: vehicle.end_lat, lng: vehicle.end_lng } : null;

  let ordered: StopOut[] = [];
  let source: "google" | "fallback" = "fallback";
  let distance_m: number | null = null, duration_s: number | null = null, polyline: string | null = null;
  let note: string | undefined;

  if (origin && active.length) {
    // Bitiş: sabit nokta yoksa başlangıca en uzak durak (rotanın "son yolcusu")
    let inter = active, endStop: StopIn | null = null;
    if (manual && !fixedEnd) {
      endStop = active[active.length - 1]; inter = active.slice(0, -1);
    } else if (!fixedEnd && active.length > 1) {
      endStop = active.reduce((a, b) => (haversine(origin!, b) > haversine(origin!, a) ? b : a));
      inter = active.filter((s) => s !== endStop);
    } else if (!fixedEnd) {
      endStop = active[0]; inter = [];
    }
    const dest = fixedEnd ?? endStop!;

    const key = Deno.env.get("GOOGLE_MAPS_API_KEY");
    if (key) {
      try {
        const g = await googleRoute(key, origin, inter, dest, !manual);
        const seq = [...g.order.map((i) => inter[i]), ...(endStop ? [endStop] : [])];
        ordered = withEta(origin, seq, g.legs);
        source = "google"; distance_m = g.distance_m; duration_s = g.duration_s; polyline = g.polyline ?? null;
      } catch (e) {
        note = String(e);
      }
    } else {
      note = "GOOGLE_MAPS_API_KEY tanımlı değil — yedek algoritma kullanıldı";
    }
    if (source === "fallback") {
      const seq = [...(manual ? inter : fallbackOrder(origin, inter, dest)), ...(endStop ? [endStop] : [])];
      ordered = withEta(origin, seq);
      const last = ordered[ordered.length - 1];
      distance_m = last.dist_m + (fixedEnd ? Math.round(haversine(last, fixedEnd) * ROAD_FACTOR) : 0);
      duration_s = last.eta_s + (fixedEnd ? Math.round(haversine(last, fixedEnd) * ROAD_FACTOR / CITY_SPEED_MS) : 0);
    }
  }

  const row = {
    company_id: vehicle.company_id, vehicle_id: vehicleId, service_date: today,
    origin_lat: origin?.lat ?? null, origin_lng: origin?.lng ?? null,
    stops: ordered, end_point: fixedEnd ? { ...fixedEnd, label: vehicle.end_label } : null,
    polyline, distance_m, duration_s, source, computed_at: new Date().toISOString(),
  };
  const { error } = await admin.from("daily_routes").upsert(row, { onConflict: "vehicle_id,service_date" });
  if (error) return json(500, { error: "Rota kaydedilemedi", detail: error.message });

  return json(200, { ok: true, source, mode: manual ? "manual" : "auto", note, stops: ordered.length, absent: absent.size, distance_m, duration_s });
});
