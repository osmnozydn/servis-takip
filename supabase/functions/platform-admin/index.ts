// platform-admin — Platform yöneticisinin şirket işlemleri
//
// POST /functions/v1/platform-admin   (Authorization: Bearer <platform yöneticisi oturumu>)
//   { action: "create_company", name, code, contact_name?, contact_phone?,
//     admin: { full_name, username, phone?, password } }
//       → şirketi ve ilk şirket yöneticisini oluşturur (yönetici ilk girişte şifresini değiştirir)
//   { action: "update_company", company_id, name?, contact_name?, contact_phone? }
//
// Şirket kodu sonradan değiştirilemez (kullanıcılar giriş ekranında bu kodu yazar).
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
  if (keys) { try { const k = JSON.parse(keys)["default"]; if (k) return k; } catch { /* */ } }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
}

const CODE_RE = /^[a-z0-9-]{2,32}$/;
const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

async function callerIsPlatformAdmin(admin: SupabaseClient, req: Request) {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return false;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return false;
  const { data: ok } = await admin.rpc("is_platform_admin_uid", { p_uid: data.user.id });
  return ok === true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "Yalnızca POST" });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, secretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  if (!(await callerIsPlatformAdmin(admin, req))) return json(403, { error: "Bu işlem yalnızca platform yöneticisine açıktır." });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(400, { error: "Geçersiz istek gövdesi" }); }

  switch (body.action) {
    case "create_company": {
      const name = str(body.name);
      const code = str(body.code).toLowerCase();
      const a = (body.admin ?? {}) as Record<string, unknown>;
      const adminName = str(a.full_name);
      const username = str(a.username).toLowerCase();
      const password = typeof a.password === "string" ? a.password : "";

      if (!name) return json(400, { error: "Şirket adı gerekli" });
      if (!CODE_RE.test(code) || code === "platform")
        return json(400, { error: "Şirket kodu 2-32 karakter olmalı; küçük harf, rakam ve - içerebilir." });
      if (!adminName) return json(400, { error: "Yönetici ad soyad gerekli" });
      if (!USERNAME_RE.test(username)) return json(400, { error: "Yönetici kullanıcı adı 3-32 karakter; küçük harf, rakam, . _ - içerebilir." });
      if (password.length < 8 || password.length > 72) return json(400, { error: "Şifre en az 8 karakter olmalı." });

      const { data: exists } = await admin.from("companies").select("id").eq("code", code).maybeSingle();
      if (exists) return json(409, { error: "Bu şirket kodu zaten kullanılıyor." });

      const { data: company, error: cErr } = await admin.from("companies").insert({
        name, code, contact_name: str(body.contact_name) || null, contact_phone: str(body.contact_phone) || null,
      }).select("id, name, code").single();
      if (cErr || !company) {
        return json(cErr?.code === "23505" ? 409 : 400, {
          error: cErr?.code === "23505" ? "Bu şirket kodu zaten kullanılıyor." : "Şirket oluşturulamadı", detail: cErr?.message,
        });
      }

      const email = `u-${crypto.randomUUID().replaceAll("-", "")}@servis.local`;
      const { data: created, error: uErr } = await admin.auth.admin.createUser({
        email, password, email_confirm: true, app_metadata: { company_id: company.id, role: "admin" },
      });
      if (uErr || !created.user) {
        await admin.from("companies").delete().eq("id", company.id);
        return json(500, { error: "Yönetici hesabı oluşturulamadı", detail: uErr?.message });
      }
      const { error: pErr } = await admin.from("profiles").insert({
        id: created.user.id, company_id: company.id, role: "admin", username, full_name: adminName,
        phone: str(a.phone) || null, must_change_password: true,
      });
      if (pErr) {
        await admin.auth.admin.deleteUser(created.user.id);
        await admin.from("companies").delete().eq("id", company.id);
        return json(400, { error: "Yönetici profili oluşturulamadı", detail: pErr.message });
      }
      return json(201, { company, admin: { id: created.user.id, username } });
    }

    case "update_company": {
      const id = str(body.company_id);
      const patch: Record<string, string | null> = {};
      if (body.name !== undefined) { const n = str(body.name); if (!n) return json(400, { error: "Şirket adı boş olamaz" }); patch.name = n; }
      if (body.contact_name !== undefined) patch.contact_name = str(body.contact_name) || null;
      if (body.contact_phone !== undefined) patch.contact_phone = str(body.contact_phone) || null;
      const { data, error } = await admin.from("companies").update(patch).eq("id", id).select("id").maybeSingle();
      if (error) return json(400, { error: "Güncellenemedi", detail: error.message });
      if (!data) return json(404, { error: "Şirket bulunamadı" });
      return json(200, { ok: true });
    }

    default:
      return json(400, { error: "Bilinmeyen işlem" });
  }
});
