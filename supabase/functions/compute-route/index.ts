// compute-route — Aracın bugünkü rotasını yol ağı üzerinden hesaplar ve daily_routes'a yazar.
//
// POST { vehicle_id, origin?: { lat, lng } }
// Yetki: (a) aracın sürücüsü veya şirketin yöneticisi / şirkete girmiş platform yöneticisi
//        (b) veritabanı tetikleyicisi (x-internal-secret)
//
// Başlangıç: verilen konum → aracın son görülen konumu → ilk durak.
// Bitiş: sabah seferinde aracın fabrikası (varsa); akşam seferinde (fabrikadan dönüş) son yolcu.
// Sıra: rota modu "manual" ise yöneticinin alış sırası (stops.pickup_order);
//       "auto" ise yollardan en hızlı sıra (Google Routes; anahtar yoksa OSRM).
// Çizim (polyline), süre ve mesafe gerçek yollara göredir. Bugün "kullanmayacağım"
// diyen yolcular rotaya alınmaz.
import { createClient } from "npm:@supabase/supabase-js@2";
import { bestRoute, type LL } from "../_shared/roads.ts";

type StopIn = { stop_id: string; passenger_id: string; lat: number; lng: number; address: string | null; pickup_order?: number | null };

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
const STOP_DWELL_S = 45; // durakta bekleme

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, secretKey(), { auth: { persistSession: false, autoRefreshToken: false } });

  let body: { vehicle_id?: string; origin?: LL };
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
  let origin: LL | null = body.origin && Number.isFinite(body.origin.lat) ? body.origin : null;
  if (!origin) {
    const { data: lp } = await admin.from("vehicle_last_positions").select("lat, lng").eq("vehicle_id", vehicleId).maybeSingle();
    if (lp) origin = { lat: lp.lat, lng: lp.lng };
  }
  if (!origin && active.length) origin = { lat: active[0].lat, lng: active[0].lng };
  const { data: direction } = await admin.rpc("vehicle_direction_now", { p_vehicle: vehicleId });
  const toFactory = direction !== "from_factory";
  const fixedEnd: LL | null = toFactory && vehicle.end_lat != null && vehicle.end_lng != null ? { lat: vehicle.end_lat, lng: vehicle.end_lng } : null;

  let ordered: (StopIn & { eta_s: number; dist_m: number })[] = [];
  let source: "google" | "osrm" | "fallback" = "osrm";
  let distance_m: number | null = null, duration_s: number | null = null, polyline: string | null = null;

  if (origin && active.length) {
    // noktalar: 0 = başlangıç, 1..n = duraklar, (n+1) = varış noktası
    const pts: LL[] = [origin, ...active, ...(fixedEnd ? [fixedEnd] : [])];
    const endIdx = fixedEnd ? pts.length - 1 : undefined;
    const r = await bestRoute(pts, { startIdx: 0, endIdx, fixedOrder: manual });
    source = r.source; polyline = r.polyline; distance_m = r.distance_m; duration_s = r.duration_s;
    let t = 0, d = 0;
    r.order.forEach((pi, k) => {
      if (k > 0) { t += r.legs[k - 1]?.duration_s ?? 0; d += r.legs[k - 1]?.distance_m ?? 0; }
      if (pi >= 1 && pi <= active.length) {
        ordered.push({ ...active[pi - 1], eta_s: Math.round(t), dist_m: Math.round(d) });
        t += STOP_DWELL_S;
      }
    });
    duration_s = Math.round((duration_s ?? 0) + STOP_DWELL_S * ordered.length);
  }

  const row = {
    company_id: vehicle.company_id, vehicle_id: vehicleId, service_date: today,
    origin_lat: origin?.lat ?? null, origin_lng: origin?.lng ?? null,
    stops: ordered, end_point: fixedEnd ? { ...fixedEnd, label: vehicle.end_label } : null,
    polyline, distance_m, duration_s, source, computed_at: new Date().toISOString(),
  };
  const { error } = await admin.from("daily_routes").upsert(row, { onConflict: "vehicle_id,service_date" });
  if (error) return json(500, { error: "Rota kaydedilemedi", detail: error.message });

  return json(200, { ok: true, source, direction: toFactory ? "to_factory" : "from_factory", mode: manual ? "manual" : "auto", stops: ordered.length, absent: absent.size, distance_m, duration_s, has_polyline: !!polyline });
});
