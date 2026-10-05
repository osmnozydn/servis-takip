// dev-roads — Yol üzerinden rota testleri (route-preview + compute-route). YALNIZCA GELİŞTİRME.
// POST (x-dev-secret) → sonuç JSON olarak döner ve public.dev_test_runs'a yazılır.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const key = (name: string, fb: string) => {
  const k = Deno.env.get(name);
  if (k) { try { const v = JSON.parse(k)["default"]; if (v) return v; } catch { /* */ } }
  return Deno.env.get(fb)!;
};
const login = async (code: string, ident: string) => {
  const c = createClient(URL_, key("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY"), { auth: { persistSession: false } });
  const { data: email } = await c.rpc("login_email", { p_company_code: code, p_identifier: ident });
  const { data } = await c.auth.signInWithPassword({ email: email as string, password: "Demo.2026!" });
  return { c, token: data.session?.access_token ?? "" };
};
const call = async (fn: string, token: string, body: unknown) => {
  const r = await fetch(`${URL_}/functions/v1/${fn}`, { method: "POST", headers: { "Content-Type": "application/json", apikey: key("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY"), Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
function decodeCount(s: string | null) { // nokta sayısı
  if (!s) return 0; let i = 0, n = 0;
  while (i < s.length) { for (let k = 0; k < 2; k++) { let b; do { b = s.charCodeAt(i++) - 63; } while (b >= 32 && i < s.length); } n++; }
  return n;
}

Deno.serve(async (req) => {
  const admin: SupabaseClient = createClient(URL_, key("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const { data: ok } = await admin.rpc("dev_verify_secret", { p_secret: req.headers.get("x-dev-secret") ?? "" });
  if (ok !== true) return new Response("forbidden", { status: 403 });

  const results: { test: string; ok: boolean; detail?: string }[] = [];
  const t = (test: string, cond: unknown, detail?: unknown) => results.push({ test, ok: !!cond, ...(cond ? {} : { detail: JSON.stringify(detail)?.slice(0, 500) }) });
  try {
    const A = await login("demo", "yonetici");
    const B = await login("demo-b", "yonetici");
    const Y = await login("demo", "yolcu1");
    const D = await login("demo", "surucu1");
    const { data: v } = await A.c.from("vehicles").select("id, plate, route_mode").eq("plate", "34 DMO 01").single();
    const { data: st } = await A.c.from("stops").select("passenger_id, pickup_order").eq("vehicle_id", v!.id).order("pickup_order");
    const ids = (st ?? []).map((s) => s.passenger_id);

    const auto = await call("route-preview", A.token, { vehicle_id: v!.id });
    t("Önizleme: rota yollardan çizilir (OSRM/Google), yüzlerce nokta", auto.status === 200 && auto.body?.source !== "fallback" && decodeCount(auto.body?.polyline) > 100, { status: auto.status, source: auto.body?.source, n: decodeCount(auto.body?.polyline) });
    t("Önizleme: tüm duraklar sırada, mesafe ve süre gerçekçi", auto.body?.order?.length === ids.length && auto.body?.distance_m > 5000 && auto.body?.duration_s > 300, auto.body && { order: auto.body.order?.length, d: auto.body.distance_m, s: auto.body.duration_s });
    t("Önizleme: her bacak için süre var", auto.body?.legs?.length === ids.length - 1, auto.body?.legs?.length);

    const rev = [...ids].reverse();
    const man = await call("route-preview", A.token, { vehicle_id: v!.id, order: rev });
    t("Kaydedilmemiş sıra önizlemesi o sırayla çizilir", man.status === 200 && JSON.stringify(man.body?.order) === JSON.stringify(rev) && man.body?.mode === "manual", man.body?.order);
    t("Farklı sıra farklı mesafe verir", man.body?.distance_m !== auto.body?.distance_m, [man.body?.distance_m, auto.body?.distance_m]);
    t("Otomatik sıra, ters sıradan uzun değildir", auto.body?.duration_s <= man.body?.duration_s + 60, [auto.body?.duration_s, man.body?.duration_s]);

    const xb = await call("route-preview", B.token, { vehicle_id: v!.id });
    t("Başka şirketin yöneticisi bu aracı göremez (404)", xb.status === 404, xb.status);
    const yp = await call("route-preview", Y.token, { vehicle_id: v!.id });
    t("Yolcu önizleme alamaz (403)", yp.status === 403, yp.status);
    const dp = await call("route-preview", D.token, { vehicle_id: v!.id });
    t("Sürücü yönetici önizlemesi alamaz (403)", dp.status === 403, dp.status);

    const cr = await call("compute-route", D.token, { vehicle_id: v!.id, origin: { lat: 41.0055, lng: 29.03 } });
    t("Sürücü rotası yollardan hesaplanır", cr.status === 200 && cr.body?.has_polyline && cr.body?.source !== "fallback", cr.body);
    const { data: dr } = await D.c.from("daily_routes").select("polyline, stops, source").eq("vehicle_id", v!.id).order("service_date", { ascending: false }).limit(1).single();
    t("Sürücü kendi rotasının yol çizgisini okuyabilir", decodeCount(dr?.polyline ?? null) > 100 && (dr?.stops as unknown[]).length === ids.length, { n: decodeCount(dr?.polyline ?? null) });
    const etas = ((dr?.stops ?? []) as { eta_s: number }[]).map((s) => s.eta_s);
    t("Varış süreleri sırayla artar", etas.every((e, k) => k === 0 || e > etas[k - 1]), etas);
  } catch (e) { t("Beklenmeyen hata", false, String(e)); }
  const out = { summary: `${results.filter((r) => r.ok).length}/${results.length} test geçti`, results };
  await admin.from("dev_test_runs").insert({ name: "dev-roads", summary: out.summary, result: out, finished_at: new Date().toISOString() });
  return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json" } });
});
