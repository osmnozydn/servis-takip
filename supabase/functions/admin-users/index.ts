// admin-users — Şirket yöneticisinin kullanıcı yönetimi
//
// POST /functions/v1/admin-users   (Authorization: Bearer <kullanıcı oturum token'ı>)
//   { action: "create", role, username, full_name, password, phone?, vehicle_id? }
//   { action: "reset_password", user_id, password }
//   { action: "delete", user_id }
//
// Çağıran kişi giriş yapmış bir ADMIN olmalı. İşlemler her zaman çağıranın
// kendi şirketinde yapılır; istek gövdesinde şirket bilgisi kabul edilmez.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

function secretKey(): string {
  const keys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (keys) {
    try { const k = JSON.parse(keys)["default"]; if (k) return k; } catch { /* yoksay */ }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
}

const ROLES = ["admin", "driver", "passenger"] as const;
const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;

function validPassword(p: unknown): p is string {
  return typeof p === "string" && p.length >= 8 && p.length <= 72;
}

async function callerAdmin(admin: SupabaseClient, req: Request) {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;
  const { data: prof } = await admin
    .from("profiles").select("id, company_id, role").eq("id", data.user.id).maybeSingle();
  if (!prof || prof.role !== "admin") return null;
  return prof as { id: string; company_id: string; role: string };
}

async function targetInCompany(admin: SupabaseClient, userId: unknown, companyId: string) {
  if (typeof userId !== "string") return null;
  const { data } = await admin
    .from("profiles").select("id, company_id").eq("id", userId).eq("company_id", companyId).maybeSingle();
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "Yalnızca POST" });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, secretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const me = await callerAdmin(admin, req);
  if (!me) return json(403, { error: "Bu işlem için yönetici olarak giriş yapmalısınız." });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(400, { error: "Geçersiz istek gövdesi" }); }

  switch (body.action) {
    case "create": {
      const role = body.role as string;
      const username = String(body.username ?? "").trim().toLowerCase();
      const fullName = String(body.full_name ?? "").trim();
      const phone = body.phone ? String(body.phone) : null;
      const vehicleId = body.vehicle_id ? String(body.vehicle_id) : null;

      if (!ROLES.includes(role as typeof ROLES[number])) return json(400, { error: "Geçersiz rol" });
      if (!USERNAME_RE.test(username)) return json(400, { error: "Kullanıcı adı 3-32 karakter; küçük harf, rakam, . _ - içerebilir." });
      if (!fullName) return json(400, { error: "Ad soyad gerekli" });
      if (!validPassword(body.password)) return json(400, { error: "Şifre en az 8 karakter olmalı." });

      const { data: exists } = await admin.from("profiles").select("id")
        .eq("company_id", me.company_id).eq("username", username).maybeSingle();
      if (exists) return json(409, { error: "Bu kullanıcı adı şirketinizde zaten kullanılıyor." });

      const email = `u-${crypto.randomUUID().replaceAll("-", "")}@servis.local`;
      const { data: created, error: cErr } = await admin.auth.admin.createUser({
        email, password: body.password, email_confirm: true,
        app_metadata: { company_id: me.company_id, role },
      });
      if (cErr || !created.user) return json(500, { error: "Kullanıcı oluşturulamadı", detail: cErr?.message });

      const { error: pErr } = await admin.from("profiles").insert({
        id: created.user.id, company_id: me.company_id, role, username,
        full_name: fullName, phone, vehicle_id: vehicleId, must_change_password: true,
      });
      if (pErr) {
        await admin.auth.admin.deleteUser(created.user.id);
        const msg = pErr.code === "23505" ? "Bu telefon numarası şirketinizde zaten kayıtlı."
          : pErr.code === "23503" ? "Seçilen araç şirketinize ait değil."
          : "Profil oluşturulamadı";
        return json(400, { error: msg, detail: pErr.message });
      }
      return json(201, { id: created.user.id, username });
    }

    case "reset_password": {
      if (!validPassword(body.password)) return json(400, { error: "Şifre en az 8 karakter olmalı." });
      const t = await targetInCompany(admin, body.user_id, me.company_id);
      if (!t) return json(404, { error: "Kullanıcı bulunamadı" });
      const { error } = await admin.auth.admin.updateUserById(t.id, { password: body.password });
      if (error) return json(500, { error: "Şifre güncellenemedi", detail: error.message });
      await admin.from("profiles").update({ must_change_password: true }).eq("id", t.id);
      return json(200, { ok: true });
    }

    case "delete": {
      const t = await targetInCompany(admin, body.user_id, me.company_id);
      if (!t) return json(404, { error: "Kullanıcı bulunamadı" });
      if (t.id === me.id) return json(400, { error: "Kendi hesabınızı silemezsiniz." });
      const { error } = await admin.auth.admin.deleteUser(t.id);
      if (error) return json(500, { error: "Kullanıcı silinemedi", detail: error.message });
      return json(200, { ok: true });
    }

    default:
      return json(400, { error: "Bilinmeyen işlem" });
  }
});
