// send-push — Yeni bildirimleri kullanıcıların telefonlarına gönderir (Expo Push).
//
// POST { ids: number[] }   (yalnızca veritabanı tetikleyicisi çağırır: x-internal-secret)
// Her bildirim, alıcısının kayıtlı tüm cihazlarına (push_tokens) gider.
// Expo "DeviceNotRegistered" derse token silinir (uygulama kaldırılmış).
// İsteğe bağlı: EXPO_ACCESS_TOKEN (Expo hesabında "push security" açıksa).
import { createClient } from "npm:@supabase/supabase-js@2";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function secretKey(): string {
  const keys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (keys) { try { const k = JSON.parse(keys)["default"]; if (k) return k; } catch { /* */ } }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
}

type Msg = { to: string; title: string; body: string; data: Record<string, unknown>; sound: "default"; priority: "high"; channelId: string };

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "Yalnızca POST" });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, secretKey(), { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: ok } = await admin.rpc("verify_internal_secret", { p_secret: req.headers.get("x-internal-secret") ?? "" });
  if (ok !== true) return json(403, { error: "forbidden" });

  let ids: number[] = [];
  try { ids = ((await req.json()).ids ?? []).filter((x: unknown) => Number.isInteger(x)).slice(0, 2000); } catch { /* */ }
  if (!ids.length) return json(200, { sent: 0 });

  const { data: notes } = await admin.from("notifications")
    .select("id, recipient_id, kind, title, body, vehicle_id, trip_id").in("id", ids);
  if (!notes?.length) return json(200, { sent: 0 });
  const { data: tokens } = await admin.from("push_tokens")
    .select("token, user_id").in("user_id", [...new Set(notes.map((n) => n.recipient_id))]);

  const byUser = new Map<string, string[]>();
  for (const t of tokens ?? []) byUser.set(t.user_id, [...(byUser.get(t.user_id) ?? []), t.token]);

  const msgs: Msg[] = [];
  for (const n of notes) {
    for (const to of byUser.get(n.recipient_id) ?? []) {
      msgs.push({
        to, title: n.title, body: n.body, sound: "default", priority: "high",
        channelId: n.kind === "bus_departed" ? "servis" : "operasyon",
        data: { kind: n.kind, notification_id: n.id, vehicle_id: n.vehicle_id, trip_id: n.trip_id },
      });
    }
  }

  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
  const access = Deno.env.get("EXPO_ACCESS_TOKEN");
  if (access) headers.Authorization = `Bearer ${access}`;

  let sent = 0;
  const dead: string[] = [];
  for (let i = 0; i < msgs.length; i += 100) {
    const batch = msgs.slice(i, i + 100);
    try {
      const r = await fetch("https://exp.host/--/api/v2/push/send", { method: "POST", headers, body: JSON.stringify(batch) });
      const j = await r.json() as { data?: { status: string; details?: { error?: string } }[] };
      (j.data ?? []).forEach((t, k) => {
        if (t.status === "ok") sent++;
        else if (t.details?.error === "DeviceNotRegistered") dead.push(batch[k].to);
      });
    } catch (e) {
      console.error("expo push", e);
    }
  }
  if (dead.length) await admin.from("push_tokens").delete().in("token", dead);
  return json(200, { sent, messages: msgs.length, removed: dead.length });
});
