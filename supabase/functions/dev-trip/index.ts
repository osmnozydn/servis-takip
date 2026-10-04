// dev-trip — Demo sefer verisi üretir ve sefer geçmişini doğrular.
// YALNIZCA GELİŞTİRME İÇİN.  POST (header: x-dev-secret) → 202, sonuç dev_test_runs'a.
//
// Sanal sürücüler gerçek oturumla, geçmiş zaman damgalı konumlar gönderir
// (çevrimdışı kuyruktan gelen konumlar gibi):
//  * 34 DMO 01 (surucu1): Moda → Kozyatağı → Ataşehir. ÜSKÜDAR'A UĞRAMAZ.
//  * 34 DMO 02 (surucu2): Bakırköy → Zeytinburnu → Mecidiyeköy → Beşiktaş (hepsi).
// Seferler kalıcıdır: yönetici panelinde "Sefer geçmişi" ekranında incelenir.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };
const URL_ = Deno.env.get("SUPABASE_URL")!;
const PASSWORD = "Demo.2026!";
const keyFrom = (env: string, legacy: string) => {
  const k = Deno.env.get(env);
  if (k) { try { const v = JSON.parse(k)["default"]; if (v) return v; } catch { /* */ } }
  return Deno.env.get(legacy)!;
};
const SECRET = keyFrom("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
const PUBLISHABLE = keyFrom("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");

type P = [number, number];
// Yol noktaları; "S" işaretli olanlar durak (orada ~2 dk beklenir)
const ROUTE_V1: (P | [number, number, "S"])[] = [
  [40.9907, 29.0230], [40.9862, 29.0257, "S"],                       // Kadıköy iskele → Moda
  [40.9835, 29.0330], [40.9800, 29.0450], [40.9770, 29.0600], [40.9755, 29.0780], [40.9760, 29.0900],
  [40.9765, 29.0978, "S"],                                           // Kozyatağı
  [40.9810, 29.1060], [40.9870, 29.1150], [40.9923, 29.1244, "S"],   // Ataşehir
  [40.9932, 29.1310],
];
const ROUTE_V2: (P | [number, number, "S"])[] = [
  [40.9780, 28.8700], [40.9819, 28.8772, "S"],                       // Bakırköy
  [40.9860, 28.8880], [40.9900, 28.8980], [40.9940, 28.9040, "S"],   // Zeytinburnu
  [41.0050, 28.9180], [41.0200, 28.9350], [41.0350, 28.9550], [41.0500, 28.9750], [41.0600, 28.9880],
  [41.0672, 28.9965, "S"],                                           // Mecidiyeköy
  [41.0600, 29.0010], [41.0520, 29.0040], [41.0428, 29.0076, "S"],   // Beşiktaş
  [41.0410, 29.0090],
];

const R = 6371000;
const dist = (a: P, b: P) => {
  const toRad = (x: number) => (x * Math.PI) / 180;
  const h = Math.sin(toRad(b[0] - a[0]) / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(toRad(b[1] - a[1]) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

/** Yol noktalarını ~250 m aralıklı GPS örneklerine çevirir (ortalama 30 km/s, durakta 2 dk). */
function samples(route: (P | [number, number, "S"])[], start: number) {
  const out: { lat: number; lng: number; t: number; speed: number }[] = [];
  let t = start;
  const SPEED = 30 / 3.6, STEP = 250;
  for (let i = 0; i < route.length; i++) {
    const p: P = [route[i][0], route[i][1]];
    if (i > 0) {
      const q: P = [route[i - 1][0], route[i - 1][1]];
      const d = dist(q, p), n = Math.max(1, Math.round(d / STEP));
      for (let k = 1; k <= n; k++) {
        t += (d / n / SPEED) * 1000;
        out.push({ lat: q[0] + ((p[0] - q[0]) * k) / n, lng: q[1] + ((p[1] - q[1]) * k) / n, t, speed: SPEED });
      }
    } else {
      out.push({ lat: p[0], lng: p[1], t, speed: 0 });
    }
    if (route[i][2] === "S") for (let k = 0; k < 4; k++) { t += 30_000; out.push({ lat: p[0] + 0.00005 * (k % 2), lng: p[1], t, speed: 0 }); }
  }
  return out;
}

async function login(ident: string) {
  const c = createClient(URL_, PUBLISHABLE, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: email } = await c.rpc("login_email", { p_company_code: "demo", p_identifier: ident });
  const { data, error } = await c.auth.signInWithPassword({ email: email as string, password: PASSWORD });
  if (error || !data.session) throw new Error(`giriş ${ident}: ${error?.message}`);
  return c;
}

async function driveTrip(driver: SupabaseClient, route: (P | [number, number, "S"])[], start: number) {
  const { data: v } = await driver.from("vehicles").select("id").single();
  const rows = samples(route, start).map((s) => ({
    vehicle_id: v!.id, lat: +s.lat.toFixed(6), lng: +s.lng.toFixed(6), speed: s.speed, recorded_at: new Date(s.t).toISOString(),
  }));
  for (let i = 0; i < rows.length; i += 50) {
    const { error } = await driver.from("vehicle_positions").insert(rows.slice(i, i + 50));
    if (error) throw new Error(`konum: ${error.message}`);
  }
  const { data: ended } = await driver.rpc("end_my_trip");
  return { vehicle_id: v!.id as string, points: rows.length, ended };
}

async function run(admin: SupabaseClient) {
  const results: { test: string; ok: boolean; detail?: unknown }[] = [];
  const t = (test: string, cond: boolean, detail?: unknown) => results.push({ test, ok: !!cond, ...(cond ? {} : { detail }) });
  try {
    const { data: demo } = await admin.from("companies").select("id").eq("code", "demo").single();
    // Önceki demo seferlerini ve açık kalmış seferleri temizle
    await admin.from("trips").delete().eq("company_id", demo!.id);

    const d1 = await login("surucu1"), d2 = await login("surucu2");
    const now = Date.now();
    const v1 = await driveTrip(d1, ROUTE_V1, now - 150 * 60_000);   // ~2,5 saat önce başladı
    const v2 = await driveTrip(d2, ROUTE_V2, now - 140 * 60_000);
    t(`34 DMO 01: ${v1.points} konum gönderildi, sefer bitirildi`, v1.ended === true, v1);
    t(`34 DMO 02: ${v2.points} konum gönderildi, sefer bitirildi`, v2.ended === true, v2);

    const yon = await login("yonetici");
    const { data: trips } = await yon.from("trips").select("id, vehicle_plate, driver_name, started_at, ended_at, end_reason, distance_m, position_count").order("vehicle_plate");
    t("Yönetici 2 seferi görür", trips?.length === 2, trips);
    const tr1 = trips?.find((x) => x.vehicle_plate === "34 DMO 01");
    const tr2 = trips?.find((x) => x.vehicle_plate === "34 DMO 02");
    t("Sefer kapanış nedeni: sürücü", tr1?.end_reason === "driver" && tr2?.end_reason === "driver", trips);
    t(`34 DMO 01 mesafe ~${Math.round((tr1?.distance_m ?? 0) / 100) / 10} km (8–14 km beklenir)`, (tr1?.distance_m ?? 0) > 8000 && (tr1?.distance_m ?? 0) < 14000, tr1);

    const ev = async (tripId: string) => (await yon.from("trip_stop_events").select("passenger_name, address, status, arrived_at, departed_at, closest_m").eq("trip_id", tripId)).data ?? [];
    const e1 = await ev(tr1!.id), e2 = await ev(tr2!.id);
    const by = (e: typeof e1, a: string) => e.find((x) => x.address?.startsWith(a));
    t("Moda: varıldı", by(e1, "Moda")?.status === "arrived", by(e1, "Moda"));
    t("Kozyatağı: varıldı", by(e1, "Kozyatağı")?.status === "arrived", by(e1, "Kozyatağı"));
    t("Ataşehir: varıldı", by(e1, "Ataşehir")?.status === "arrived", by(e1, "Ataşehir"));
    const usk = by(e1, "Üsküdar");
    t(`Üsküdar (Fatma Kaya): UĞRANMADI — araç en fazla ${((usk?.closest_m ?? 0) / 1000).toFixed(1)} km yaklaştı`, usk?.status === "missed" && (usk?.closest_m ?? 0) > 3000, usk);
    const arr1 = ["Moda", "Kozyatağı", "Ataşehir"].map((a) => Date.parse(by(e1, a)!.arrived_at!));
    t("Varış saatleri gidiş sırasıyla tutarlı", arr1[0] < arr1[1] && arr1[1] < arr1[2], arr1);
    const moda = by(e1, "Moda")!;
    const dwell = (Date.parse(moda.departed_at!) - Date.parse(moda.arrived_at!)) / 60000;
    t(`Moda'da bekleme süresi ~${dwell.toFixed(1)} dk (1–4 dk beklenir)`, dwell >= 1 && dwell <= 4, moda);
    t("34 DMO 02: 4 durağın hepsine varıldı", e2.length === 4 && e2.every((x) => x.status === "arrived"), e2);

    const { data: track } = await yon.from("vehicle_positions").select("lat").eq("trip_id", tr1!.id);
    t("Yönetici seferin tüm güzergâhını görür", (track?.length ?? 0) === v1.points, track?.length);
    const { data: dTrips } = await d1.from("trips").select("id");
    const { data: dTrack } = await d1.from("vehicle_positions").select("id").eq("trip_id", tr1!.id);
    t("Sürücü sefer geçmişini ve eski güzergâhı göremez", (dTrips?.length ?? 0) === 0 && (dTrack?.length ?? 0) === 0, { dTrips, dTrack: dTrack?.length });
    const p2 = await login("yolcu2");
    const { data: pTrips } = await p2.from("trips").select("id");
    t("Yolcu sefer geçmişini göremez", (pTrips?.length ?? 0) === 0, pTrips);
  } catch (e) {
    results.push({ test: "BEKLENMEYEN HATA", ok: false, detail: String(e) });
  }
  const passed = results.filter((r) => r.ok).length;
  return { summary: `${passed}/${results.length} geçti`, failed: results.filter((r) => !r.ok), results: results.map((r) => `${r.ok ? "✓" : "✗"} ${r.test}`) };
}

Deno.serve(async (req) => {
  const admin = createClient(URL_, SECRET, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: ok } = await admin.rpc("dev_verify_secret", { p_secret: req.headers.get("x-dev-secret") ?? "" });
  if (ok !== true) return new Response("forbidden", { status: 403 });
  const { data: r } = await admin.from("dev_test_runs").insert({ name: "dev-trip" }).select("id").single();
  EdgeRuntime.waitUntil(run(admin).then((out) =>
    admin.from("dev_test_runs").update({ summary: out.summary, result: out, finished_at: new Date().toISOString() }).eq("id", r!.id)));
  return new Response(JSON.stringify({ accepted: true, run_id: r!.id }), { status: 202 });
});
