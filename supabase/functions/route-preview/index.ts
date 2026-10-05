// route-preview — Yönetim paneli için aracın güzergâhı (yollar üzerinden)
//
// POST { vehicle_id, order?: string[] }   (Authorization: yönetici oturumu)
//   order verilirse (kaydedilmemiş sıralama önizlemesi) o yolcu sırasıyla çizilir.
//   Verilmezse: rota modu "manual" → alış sırası; "auto" → en hızlı sıra hesaplanır.
// Cevap: { mode, order: [passenger_id], polyline, legs, distance_m, duration_s, source }
// Bugünkü devamsızlıklar dikkate alınmaz (planlama görünümü). Hiçbir şey kaydedilmez.
import { createClient } from "npm:@supabase/supabase-js@2";
import { bestRoute, type LL } from "../_shared/roads.ts";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "Yalnızca POST" });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, secretKey(), { auth: { persistSession: false, autoRefreshToken: false } });

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: u } = await admin.auth.getUser(token);
  if (!u?.user) return json(403, { error: "Giriş gerekli" });
  const { data: companyId } = await admin.rpc("admin_company_of", { p_uid: u.user.id });
  if (!companyId) return json(403, { error: "Bu işlem için yönetici olarak giriş yapmalısınız." });

  let body: { vehicle_id?: string; order?: string[] };
  try { body = await req.json(); } catch { return json(400, { error: "Geçersiz istek" }); }
  const { data: vehicle } = await admin.from("vehicles").select("id, company_id, end_lat, end_lng, end_label, route_mode")
    .eq("id", body.vehicle_id ?? "").eq("company_id", companyId).maybeSingle();
  if (!vehicle) return json(404, { error: "Araç bulunamadı" });

  const { data: stops } = await admin.from("stops").select("passenger_id, lat, lng, pickup_order").eq("vehicle_id", vehicle.id);
  let list = (stops ?? []).slice();
  const custom = Array.isArray(body.order) && body.order.length > 0;
  const manual = custom || vehicle.route_mode === "manual";
  if (custom) {
    const pos = new Map(body.order!.map((id, i) => [id, i]));
    list = list.filter((s) => pos.has(s.passenger_id)).sort((a, b) => pos.get(a.passenger_id)! - pos.get(b.passenger_id)!);
  } else if (manual) list.sort((a, b) => (a.pickup_order ?? 1e9) - (b.pickup_order ?? 1e9));

  const end: LL | null = vehicle.end_lat != null && vehicle.end_lng != null ? { lat: vehicle.end_lat, lng: vehicle.end_lng } : null;
  if (list.length === 0 || (list.length === 1 && !end)) {
    return json(200, { mode: manual ? "manual" : "auto", order: list.map((s) => s.passenger_id), polyline: null, legs: [], distance_m: 0, duration_s: 0, source: "osrm" });
  }
  const pts: LL[] = [...list.map((s) => ({ lat: s.lat, lng: s.lng })), ...(end ? [end] : [])];
  const r = await bestRoute(pts, { endIdx: end ? pts.length - 1 : undefined, fixedOrder: manual });
  return json(200, {
    mode: manual ? "manual" : "auto",
    order: r.order.filter((i) => i < list.length).map((i) => list[i].passenger_id),
    polyline: r.polyline, legs: r.legs, distance_m: r.distance_m, duration_s: r.duration_s, source: r.source,
  });
});
