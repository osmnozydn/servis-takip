// dev-ops — Demo şirkete operasyon sorumlusu hesabı ekler (operasyon / Demo.2026!). YALNIZCA GELİŞTİRME.
// POST (x-dev-secret) — veritabanından pg_net ile çağrılır.
import { createClient } from "npm:@supabase/supabase-js@2";

function secretKey(): string {
  const keys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (keys) { try { const k = JSON.parse(keys)["default"]; if (k) return k; } catch { /* */ } }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
}
const json = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, secretKey(), { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: ok } = await admin.rpc("dev_verify_secret", { p_secret: req.headers.get("x-dev-secret") ?? "" });
  if (ok !== true) return json(403, { error: "forbidden" });
  const { data: c } = await admin.from("companies").select("id").eq("code", "demo").maybeSingle();
  if (!c) return json(404, { error: "demo yok" });
  const { data: ex } = await admin.from("profiles").select("id").eq("company_id", c.id).eq("username", "operasyon").maybeSingle();
  if (ex) return json(200, { ok: true, existed: true });
  const email = `u-${crypto.randomUUID().replaceAll("-", "")}@servis.local`;
  const { data: u, error } = await admin.auth.admin.createUser({ email, password: "Demo.2026!", email_confirm: true, app_metadata: { company_id: c.id, role: "operator" } });
  if (error || !u.user) return json(500, { error: error?.message });
  const { error: pe } = await admin.from("profiles").insert({
    id: u.user.id, company_id: c.id, role: "operator", username: "operasyon", full_name: "Demo Operasyon",
    phone: "05550000002", must_change_password: false, consent_version: null,
  });
  if (pe) { await admin.auth.admin.deleteUser(u.user.id); return json(500, { error: pe.message }); }
  return json(201, { ok: true, user_id: u.user.id });
});
