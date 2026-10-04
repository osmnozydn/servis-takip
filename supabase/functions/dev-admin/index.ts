// dev-admin — Yönetim paneli uçtan uca testi (gerçek Auth + Storage + RLS + Edge Function'lar)
// YALNIZCA GELİŞTİRME İÇİN. Önce dev-seed çalıştırılmış olmalı (demo şirketi izolasyon için kullanılır).
//
// POST /functions/v1/dev-admin   (header: x-dev-secret) → 202; sonuç public.dev_test_runs'a yazılır.
// Senaryo: geçici platform yöneticisi → şirket açar → şirkete girer → araç, sürücü (belgeli),
// yolcular (duraklı) ekler → belge erişimleri → alış sırası + manuel rota → silme → her şeyi temizler.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const URL_ = Deno.env.get("SUPABASE_URL")!;
function secretKey(): string {
  const keys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (keys) { try { const k = JSON.parse(keys)["default"]; if (k) return k; } catch { /* */ } }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
}
function publishableKey(): string {
  const keys = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  if (keys) { try { const k = JSON.parse(keys)["default"]; if (k) return k; } catch { /* */ } }
  return Deno.env.get("SUPABASE_ANON_KEY")!;
}
const newClient = () => createClient(URL_, publishableKey(), { auth: { persistSession: false, autoRefreshToken: false } });

async function login(code: string, ident: string, password: string) {
  const c = newClient();
  const { data: email } = await c.rpc("login_email", { p_company_code: code, p_identifier: ident });
  const { data, error } = await c.auth.signInWithPassword({ email: email as string, password });
  return { c, session: data?.session ?? null, user: data?.user ?? null, error };
}
async function fn(name: string, token: string | null, body: unknown) {
  const r = await fetch(`${URL_}/functions/v1/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: publishableKey(), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

// 1x1 PNG ve minimal PDF
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
const PDF = new TextEncoder().encode("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

Deno.serve(async (req) => {
  const admin = createClient(URL_, secretKey(), { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: ok } = await admin.rpc("dev_verify_secret", { p_secret: req.headers.get("x-dev-secret") ?? "" });
  if (ok !== true) return new Response("forbidden", { status: 403 });
  const { data: run } = await admin.from("dev_test_runs").insert({ name: "dev-admin" }).select("id").single();
  EdgeRuntime.waitUntil(runTests(admin).then((out) =>
    admin.from("dev_test_runs").update({ summary: out.summary, result: out, finished_at: new Date().toISOString() }).eq("id", run!.id)));
  return new Response(JSON.stringify({ accepted: true, run_id: run!.id }), { status: 202, headers: { "Content-Type": "application/json" } });
});

async function runTests(admin: SupabaseClient) {
  type R = { test: string; ok: boolean; detail?: string };
  const results: R[] = [];
  const t = (test: string, cond: unknown, detail?: unknown) => results.push({ test, ok: !!cond, ...(cond ? {} : { detail: JSON.stringify(detail) }) });
  const tag = crypto.randomUUID().slice(0, 6);
  const PW = `E2e-${tag}-Pw9`;
  const code = `e2e-${tag}`;
  let platformUid: string | null = null;
  let companyId: string | null = null;

  try {
    // ---------- Platform yöneticisi ----------
    const { data: pu } = await admin.auth.admin.createUser({ email: `u-e2e${tag}@servis.local`, password: PW, email_confirm: true });
    platformUid = pu.user!.id;
    await admin.rpc("dev_platform_admin_set", { p_uid: platformUid, p_username: `e2e-${tag}`, p_full_name: "E2E Platform", p_add: true });
    const P = await login("platform", `e2e-${tag}`, PW);
    t("Platform yöneticisi 'platform' koduyla giriş yapar", P.session, P.error?.message);
    const { data: s0 } = await P.c.rpc("my_session");
    t("Oturum: platform yöneticisi, aktif şirket yok", s0?.is_platform_admin === true && s0?.company === null, s0);
    const { data: list0 } = await P.c.rpc("platform_companies");
    t("Tüm şirketleri listeler (demo dahil)", (list0 ?? []).some((c: { code: string }) => c.code === "demo"), list0?.length);
    t("Şirkete girmeden hiçbir aracı göremez", ((await P.c.from("vehicles").select("id")).data ?? []).length === 0);

    // ---------- Şirket açma ----------
    const demoAdmin = await login("demo", "yonetici", "Demo.2026!");
    const forbidden = await fn("platform-admin", demoAdmin.session!.access_token, { action: "create_company", name: "X", code: `x-${tag}`, admin: { full_name: "X", username: "xxx", password: "Abcdefg1" } });
    t("Şirket yöneticisi şirket AÇAMAZ (403)", forbidden.status === 403, forbidden);
    const bad = await fn("platform-admin", P.session!.access_token, { action: "create_company", name: "Kötü", code: "platform", admin: { full_name: "A", username: "aaa", password: "Abcdefg1" } });
    t("'platform' şirket kodu reddedilir", bad.status === 400, bad);
    const created = await fn("platform-admin", P.session!.access_token, {
      action: "create_company", name: "E2E Turizm", code, contact_name: "Yetkili", contact_phone: "05551112233",
      admin: { full_name: "E2E Yönetici", username: "yonetici", password: PW },
    });
    companyId = created.body?.company?.id ?? null;
    t("Platform yöneticisi şirket açar (yönetici hesabıyla)", created.status === 201 && companyId, created);
    const dup = await fn("platform-admin", P.session!.access_token, { action: "create_company", name: "Tekrar", code, admin: { full_name: "B", username: "bbb", password: "Abcdefg1" } });
    t("Aynı şirket kodu ikinci kez alınamaz (409)", dup.status === 409, dup);

    const A = await login(code, "yonetici", PW);
    const { data: sa } = await A.c.rpc("my_session");
    t("Yeni şirketin yöneticisi giriş yapar; ilk girişte şifre değiştirmesi istenir", A.session && sa?.must_change_password === true && sa?.company?.code === code, sa);

    // ---------- Şirkete gir ----------
    const { data: entered } = await P.c.rpc("platform_enter_company", { p_company: companyId });
    const { data: s1 } = await P.c.rpc("my_session");
    t("Platform yöneticisi şirkete girer", entered === true && s1?.company?.code === code, s1);
    const { data: veh, error: vErr } = await P.c.from("vehicles").insert({ plate: `34 E2E ${tag.slice(0, 3).toUpperCase()}`, brand_model: "Sprinter", capacity: 16 }).select("id").single();
    t("Şirketin içinde araç ekler", veh?.id, vErr?.message);
    const vehicleId = veh!.id as string;
    const { data: demoVeh } = await P.c.from("vehicles").select("id").neq("company_id", companyId);
    t("Girdiği şirket dışındaki araçları GÖRMEZ", (demoVeh ?? []).length === 0, demoVeh);

    // ---------- Sürücü (platform yöneticisi ekler) ----------
    const drv = await fn("admin-users", P.session!.access_token, {
      action: "create", role: "driver", username: "surucu", full_name: "E2E Sürücü", password: PW, phone: "05557770001",
      vehicle_id: vehicleId, license_no: "123456", license_class: "D", license_expires_on: "2030-01-01",
    });
    t("Platform yöneticisi sürücü ekler (ehliyet bilgileriyle)", drv.status === 201, drv);
    const driverId = drv.body?.id as string;
    const { data: dprof } = await A.c.from("profiles").select("license_class, license_expires_on, vehicle_id").eq("id", driverId).single();
    t("Ehliyet bilgileri ve araç kaydedildi", dprof?.license_class === "D" && dprof?.license_expires_on === "2030-01-01" && dprof?.vehicle_id === vehicleId, dprof);

    // ---------- Belgeler (şirket yöneticisi yükler) ----------
    const up = async (c: SupabaseClient, path: string, body: Uint8Array, type: string) => (await c.storage.from("documents").upload(path, body, { contentType: type })).error;
    const pPhoto = `${companyId}/driver/${driverId}/photo-${tag}.png`;
    const pLicense = `${companyId}/driver/${driverId}/license-${tag}.pdf`;
    const pVPhoto = `${companyId}/vehicle/${vehicleId}/photo-${tag}.png`;
    const pIns = `${companyId}/vehicle/${vehicleId}/ins-${tag}.pdf`;
    const e1 = await up(A.c, pPhoto, PNG, "image/png");
    const e2 = await up(A.c, pLicense, PDF, "application/pdf");
    const e3 = await up(A.c, pVPhoto, PNG, "image/png");
    const e4 = await up(A.c, pIns, PDF, "application/pdf");
    t("Yönetici fotoğraf ve PDF'leri yükler", !e1 && !e2 && !e3 && !e4, [e1, e2, e3, e4].map((e) => e?.message));
    const { error: dErr } = await A.c.from("documents").insert([
      { owner_type: "driver", owner_id: driverId, doc_type: "driver_photo", file_path: pPhoto, mime_type: "image/png" },
      { owner_type: "driver", owner_id: driverId, doc_type: "license", file_path: pLicense, mime_type: "application/pdf", expires_on: "2030-01-01" },
      { owner_type: "vehicle", owner_id: vehicleId, doc_type: "vehicle_photo", file_path: pVPhoto, mime_type: "image/png" },
      { owner_type: "vehicle", owner_id: vehicleId, doc_type: "insurance", file_path: pIns, mime_type: "application/pdf", expires_on: "2027-01-01" },
    ]);
    t("Belge kayıtları oluşturulur", !dErr, dErr?.message);
    const exe = await up(A.c, `${companyId}/driver/${driverId}/x.exe`, PDF, "application/x-msdownload");
    t("İzin verilmeyen dosya türü yüklenemez", exe, "yüklendi");
    const demoFolder = (await demoAdmin.c.from("vehicles").select("company_id").limit(1).single()).data?.company_id;
    const cross = await up(A.c, `${demoFolder}/driver/x/hack.png`, PNG, "image/png");
    t("Başka şirketin klasörüne dosya yükleyemez", cross, "yüklendi");

    // ---------- Yolcular (duraklı) ----------
    const stopsSpec = [
      ["yolcu1", "E2E Yolcu Bir", 40.9862, 29.0257, "Moda"],
      ["yolcu2", "E2E Yolcu İki", 41.0255, 29.0153, "Üsküdar"],
      ["yolcu3", "E2E Yolcu Üç", 40.9923, 29.1244, "Ataşehir"],
    ] as const;
    const pids: string[] = [];
    for (const [u, n, lat, lng, addr] of stopsSpec) {
      const r = await fn("admin-users", A.session!.access_token, { action: "create", role: "passenger", username: u, full_name: n, password: PW, vehicle_id: vehicleId, stop: { lat, lng, address: addr } });
      if (r.status === 201) pids.push(r.body.id);
      else t(`Yolcu ${u} eklenemedi`, false, r);
    }
    t("Yönetici 3 yolcuyu durağıyla ekler", pids.length === 3);
    const { data: so } = await A.c.from("stops").select("passenger_id, pickup_order").eq("vehicle_id", vehicleId).order("pickup_order");
    t("Duraklar eklenme sırasıyla 1-2-3 alış sırası alır", JSON.stringify((so ?? []).map((s) => s.pickup_order)) === "[1,2,3]" && so?.[0]?.passenger_id === pids[0], so);
    const noVeh = await fn("admin-users", A.session!.access_token, { action: "create", role: "passenger", username: "yolcu9", full_name: "Araçsız", password: PW, stop: { lat: 41, lng: 29 } });
    t("Araç seçilmeden duraklı yolcu eklenemez", noVeh.status === 400, noVeh);

    // ---------- Belge erişimi ----------
    const Y = await login(code, "yolcu1", PW);
    const { data: yd } = await Y.c.from("documents").select("doc_type");
    const ytypes = (yd ?? []).map((d) => d.doc_type).sort();
    t("Yolcu yalnızca sürücü fotoğrafını ve araç fotoğrafını görür", JSON.stringify(ytypes) === JSON.stringify(["driver_photo", "vehicle_photo"]), ytypes);
    const yPhoto = await Y.c.storage.from("documents").download(pPhoto);
    t("Yolcu sürücü fotoğrafını indirebilir", !yPhoto.error && yPhoto.data && yPhoto.data.size === PNG.length, yPhoto.error?.message);
    const yLic = await Y.c.storage.from("documents").download(pLicense);
    t("Yolcu ehliyet PDF'ini İNDİREMEZ", yLic.error, "indirdi");
    const yUp = await up(Y.c, `${companyId}/vehicle/${vehicleId}/y.png`, PNG, "image/png");
    t("Yolcu dosya yükleyemez", yUp, "yükledi");
    const D = await login(code, "surucu", PW);
    const { data: dd } = await D.c.from("documents").select("doc_type");
    t("Sürücü kendi fotoğrafını ve aracının fotoğrafını görür, ehliyet/sigortayı görmez",
      JSON.stringify((dd ?? []).map((d) => d.doc_type).sort()) === JSON.stringify(["driver_photo", "vehicle_photo"]), dd);
    const { data: demoDocs } = await demoAdmin.c.from("documents").select("id").eq("company_id", companyId);
    t("Başka şirketin yöneticisi belgeleri GÖREMEZ", (demoDocs ?? []).length === 0, demoDocs);
    const demoDl = await demoAdmin.c.storage.from("documents").download(pPhoto);
    t("Başka şirketin yöneticisi dosyayı İNDİREMEZ", demoDl.error, "indirdi");
    const { data: signed } = await A.c.storage.from("documents").createSignedUrl(pLicense, 60);
    t("Yönetici belge için süreli bağlantı alır", signed?.signedUrl, null);

    // ---------- Alış sırası + manuel rota ----------
    const rev = [pids[2], pids[0], pids[1]];
    const { data: n, error: oErr } = await A.c.rpc("set_pickup_order", { p_vehicle: vehicleId, p_passengers: rev });
    t("Yönetici alış sırasını değiştirir (3 → 1 → 2)", n === 3, oErr?.message);
    const { error: yOrd } = await Y.c.rpc("set_pickup_order", { p_vehicle: vehicleId, p_passengers: pids });
    t("Yolcu alış sırasını DEĞİŞTİREMEZ", yOrd, "değiştirdi");
    await A.c.from("vehicles").update({ route_mode: "manual" }).eq("id", vehicleId);
    const rm = await fn("compute-route", A.session!.access_token, { vehicle_id: vehicleId, origin: { lat: 41.05, lng: 29.0 } });
    const { data: dr } = await A.c.from("daily_routes").select("stops").eq("vehicle_id", vehicleId).order("service_date", { ascending: false }).limit(1).single();
    const routeOrder = ((dr?.stops ?? []) as { passenger_id: string }[]).map((s) => s.passenger_id);
    t("Manuel modda rota belirlenen alış sırasıyla oluşur", rm.body?.mode === "manual" && JSON.stringify(routeOrder) === JSON.stringify(rev), { rm: rm.body, routeOrder, rev });
    await A.c.from("vehicles").update({ route_mode: "auto" }).eq("id", vehicleId);
    const ra = await fn("compute-route", P.session!.access_token, { vehicle_id: vehicleId, origin: { lat: 41.05, lng: 29.0 } });
    t("Otomatik modda rota yeniden hesaplanır (platform yöneticisi de çağırabilir)", ra.status === 200 && ra.body?.mode === "auto" && ra.body?.stops === 3, ra);
    const rx = await fn("compute-route", demoAdmin.session!.access_token, { vehicle_id: vehicleId });
    t("Başka şirketin yöneticisi bu aracın rotasını hesaplatamaz", rx.status === 403, rx);

    // ---------- Silme ----------
    const del = await fn("admin-users", A.session!.access_token, { action: "delete", user_id: driverId });
    t("Sürücü silinir", del.status === 200, del);
    const { data: left } = await admin.from("documents").select("id").eq("owner_id", driverId);
    const { data: files } = await admin.storage.from("documents").list(`${companyId}/driver/${driverId}`);
    t("Sürücünün belgeleri ve dosyaları da silinir", (left ?? []).length === 0 && (files ?? []).length === 0, { left, files });

    // Platform yöneticisi şirketten çıkar
    await P.c.rpc("platform_enter_company", { p_company: null });
    const { data: s2 } = await P.c.rpc("my_session");
    t("Platform yöneticisi şirketten çıkar", s2?.company === null, s2);
  } catch (e) {
    t("Beklenmeyen hata", false, String(e));
  } finally {
    // ---------- Temizlik ----------
    if (companyId) {
      const { data: docs } = await admin.from("documents").select("file_path").eq("company_id", companyId);
      if (docs?.length) await admin.storage.from("documents").remove(docs.map((d) => d.file_path));
      const { data: profs } = await admin.from("profiles").select("id").eq("company_id", companyId);
      for (const p of profs ?? []) await admin.auth.admin.deleteUser(p.id);
      await admin.from("companies").delete().eq("id", companyId);
    }
    if (platformUid) {
      await admin.rpc("dev_platform_admin_set", { p_uid: platformUid, p_username: "", p_full_name: "", p_add: false });
      await admin.auth.admin.deleteUser(platformUid);
    }
  }
  const passed = results.filter((r) => r.ok).length;
  return { summary: `${passed}/${results.length} test geçti`, results };
}
