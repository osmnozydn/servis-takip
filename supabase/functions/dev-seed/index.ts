// dev-seed — Demo şirketlerini ve sanal kullanıcıları (yeniden) kurar.
// YALNIZCA GELİŞTİRME İÇİN. Canlıya çıkmadan önce silinecek.
//
// POST /functions/v1/dev-seed   (header: x-dev-secret: <private.app_secrets.dev_secret>)
// Çağrı veritabanından pg_net ile yapılır; gizli anahtar veritabanı dışına çıkmaz.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body, null, 2), { status, headers: { "Content-Type": "application/json" } });

function secretKey(): string {
  const keys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (keys) { try { const k = JSON.parse(keys)["default"]; if (k) return k; } catch { /* */ } }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
}

export const DEMO_PASSWORD = "Demo.2026!";

type Person = { username: string; full_name: string; phone: string; role: "admin" | "driver" | "passenger"; vehicle?: string; stop?: [number, number, string] };

const DEMO = {
  code: "demo", name: "Demo Servis A.Ş.",
  vehicles: [
    { key: "V1", plate: "34 DMO 01", name: "Anadolu Hattı" },
    { key: "V2", plate: "34 DMO 02", name: "Avrupa Hattı" },
  ],
  people: [
    { username: "yonetici", full_name: "Demo Yönetici", phone: "05550000001", role: "admin" },
    { username: "surucu1", full_name: "Mehmet Sürücü", phone: "05550000011", role: "driver", vehicle: "V1" },
    { username: "surucu2", full_name: "Ahmet Sürücü",  phone: "05550000012", role: "driver", vehicle: "V2" },
    { username: "yolcu1", full_name: "Ayşe Yılmaz",   phone: "05550000101", role: "passenger", vehicle: "V1", stop: [40.9862, 29.0257, "Moda, Kadıköy"] },
    { username: "yolcu2", full_name: "Fatma Kaya",    phone: "05550000102", role: "passenger", vehicle: "V1", stop: [41.0255, 29.0153, "Üsküdar Meydanı"] },
    { username: "yolcu3", full_name: "Ali Demir",     phone: "05550000103", role: "passenger", vehicle: "V1", stop: [40.9923, 29.1244, "Ataşehir Bulvarı"] },
    { username: "yolcu4", full_name: "Zeynep Çelik",  phone: "05550000104", role: "passenger", vehicle: "V1", stop: [40.9765, 29.0978, "Kozyatağı"] },
    { username: "yolcu5", full_name: "Mustafa Şahin", phone: "05550000105", role: "passenger", vehicle: "V2", stop: [40.9819, 28.8772, "Bakırköy Meydanı"] },
    { username: "yolcu6", full_name: "Emine Arslan",  phone: "05550000106", role: "passenger", vehicle: "V2", stop: [40.9940, 28.9040, "Zeytinburnu"] },
    { username: "yolcu7", full_name: "Hüseyin Koç",   phone: "05550000107", role: "passenger", vehicle: "V2", stop: [41.0672, 28.9965, "Mecidiyeköy, Şişli"] },
    { username: "yolcu8", full_name: "Elif Aydın",    phone: "05550000108", role: "passenger", vehicle: "V2", stop: [41.0428, 29.0076, "Beşiktaş İskele"] },
  ] as Person[],
  windows: [["06:30", "09:30"], ["16:30", "19:30"]],
};

// İzolasyon testleri için ikinci şirket: AYNI kullanıcı adları ve aynı yolcu telefonu
const DEMO_B = {
  code: "demo-b", name: "Demo B Turizm",
  vehicles: [{ key: "V1", plate: "06 DMB 01", name: "Ankara Hattı" }],
  people: [
    { username: "yonetici", full_name: "B Yönetici", phone: "05550000901", role: "admin" },
    { username: "surucu1",  full_name: "B Sürücü",   phone: "05550000911", role: "driver", vehicle: "V1" },
    { username: "yolcu1",   full_name: "B Yolcu",    phone: "05550000101", role: "passenger", vehicle: "V1", stop: [39.9208, 32.8541, "Kızılay, Ankara"] },
  ] as Person[],
  windows: [["06:30", "09:30"], ["16:30", "19:30"]],
};

async function wipeCompany(admin: SupabaseClient, code: string) {
  const { data: c } = await admin.from("companies").select("id").eq("code", code).maybeSingle();
  if (!c) return;
  const { data: profs } = await admin.from("profiles").select("id").eq("company_id", c.id);
  for (const p of profs ?? []) await admin.auth.admin.deleteUser(p.id);
  await admin.from("companies").delete().eq("id", c.id);
}

async function seedCompany(admin: SupabaseClient, spec: typeof DEMO, password: string) {
  const { data: company, error: ce } = await admin.from("companies")
    .insert({ code: spec.code, name: spec.name }).select("id").single();
  if (ce) throw new Error(`şirket: ${ce.message}`);

  const vehicleIds: Record<string, string> = {};
  for (const v of spec.vehicles) {
    const { data, error } = await admin.from("vehicles")
      .insert({ company_id: company.id, plate: v.plate, name: v.name }).select("id").single();
    if (error) throw new Error(`araç: ${error.message}`);
    vehicleIds[v.key] = data.id;
  }

  const users: Record<string, string> = {};
  for (const p of spec.people) {
    const email = `u-${crypto.randomUUID().replaceAll("-", "")}@servis.local`;
    const { data: u, error: ue } = await admin.auth.admin.createUser({
      email, password, email_confirm: true, app_metadata: { company_id: company.id, role: p.role },
    });
    if (ue || !u.user) throw new Error(`auth ${p.username}: ${ue?.message}`);
    const { error: pe } = await admin.from("profiles").insert({
      id: u.user.id, company_id: company.id, role: p.role, username: p.username,
      full_name: p.full_name, phone: p.phone,
      vehicle_id: p.vehicle ? vehicleIds[p.vehicle] : null,
      must_change_password: false,
    });
    if (pe) throw new Error(`profil ${p.username}: ${pe.message}`);
    users[p.username] = u.user.id;
    if (p.stop) {
      const { error: se } = await admin.from("stops").insert({
        company_id: company.id, passenger_id: u.user.id,
        lat: p.stop[0], lng: p.stop[1], address: p.stop[2],
      });
      if (se) throw new Error(`durak ${p.username}: ${se.message}`);
    }
  }

  const windows = [];
  for (const vid of Object.values(vehicleIds))
    for (let d = 1; d <= 5; d++)
      for (const [s, e] of spec.windows)
        windows.push({ company_id: company.id, vehicle_id: vid, weekday: d, start_time: s, end_time: e });
  const { error: we } = await admin.from("visibility_windows").insert(windows);
  if (we) throw new Error(`pencere: ${we.message}`);

  return { company_id: company.id, vehicles: vehicleIds, users };
}

Deno.serve(async (req) => {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, secretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: ok } = await admin.rpc("dev_verify_secret", { p_secret: req.headers.get("x-dev-secret") ?? "" });
  if (ok !== true) return json(403, { error: "forbidden" });

  try {
    await wipeCompany(admin, DEMO.code);
    await wipeCompany(admin, DEMO_B.code);
    const a = await seedCompany(admin, DEMO, DEMO_PASSWORD);
    const b = await seedCompany(admin, DEMO_B, DEMO_PASSWORD);
    return json(200, {
      ok: true,
      password: DEMO_PASSWORD,
      demo: { code: DEMO.code, users: Object.keys(a.users), vehicles: DEMO.vehicles.map((v) => v.plate) },
      demo_b: { code: DEMO_B.code, users: Object.keys(b.users) },
    });
  } catch (e) {
    return json(500, { ok: false, error: String(e) });
  }
});
