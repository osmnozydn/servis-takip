// dev-e2e — Sanal kullanıcılarla uçtan uca test (gerçek Auth + gerçek API + RLS)
// YALNIZCA GELİŞTİRME İÇİN. Önce dev-seed çalıştırılmış olmalı.
//
// POST /functions/v1/dev-e2e   (header: x-dev-secret)
// Her test, bir mobil/web istemcisinin yaptığının aynısını yapar: publishable
// key ile bağlanır, giriş yapar, kendi oturumuyla sorgu atar.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const PASSWORD = "Demo.2026!";

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

const newClient = () =>
  createClient(URL_, publishableKey(), { auth: { persistSession: false, autoRefreshToken: false } });

type Result = { test: string; ok: boolean; detail?: string };

// Mobil uygulamanın yaptığı giriş: login_email → signInWithPassword
async function login(code: string, ident: string, password = PASSWORD) {
  const c = newClient();
  const { data: email } = await c.rpc("login_email", { p_company_code: code, p_identifier: ident });
  const { data, error } = await c.auth.signInWithPassword({ email: email as string, password });
  return { c, user: data?.user ?? null, session: data?.session ?? null, error, email: email as string };
}

async function count(c: SupabaseClient, table: string) {
  const { data, error } = await c.from(table).select("*");
  return error ? -1 : (data?.length ?? 0);
}

// Türkiye UTC+3 (yaz saati uygulaması yok)
function trNow() {
  const d = new Date(Date.now() + 3 * 3600_000);
  return { dow: ((d.getUTCDay() + 6) % 7) + 1, hm: d.toISOString().slice(11, 16) };
}

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

// Testler arka planda çalışır (istek hemen 202 döner); sonuç public.dev_test_runs'a yazılır.
// Böylece veritabanının HTTP kuyruğu (pg_net) test boyunca meşgul kalmaz ve
// devamsızlık tetikleyicisinin rota isteği gerçek hayattaki gibi hemen işlenir.
Deno.serve(async (req) => {
  const admin = createClient(URL_, secretKey(), { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: ok } = await admin.rpc("dev_verify_secret", { p_secret: req.headers.get("x-dev-secret") ?? "" });
  if (ok !== true) return new Response("forbidden", { status: 403 });
  const { data: run } = await admin.from("dev_test_runs").insert({ name: "dev-e2e" }).select("id").single();
  EdgeRuntime.waitUntil(runTests(admin).then((out) =>
    admin.from("dev_test_runs").update({ summary: out.summary, result: out, finished_at: new Date().toISOString() }).eq("id", run!.id)));
  return new Response(JSON.stringify({ accepted: true, run_id: run!.id }), { status: 202, headers: { "Content-Type": "application/json" } });
});

async function runTests(admin: SupabaseClient) {
  const results: Result[] = [];
  const t = (test: string, cond: boolean, detail?: unknown) =>
    results.push({ test, ok: !!cond, ...(cond ? {} : { detail: JSON.stringify(detail) }) });

  const fnUrl = `${URL_}/functions/v1/admin-users`;
  const callAdminFn = async (session: { access_token: string } | null, body: unknown) => {
    const r = await fetch(fnUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: publishableKey(),
                 ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}) },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  };

  let e2eUserId: string | null = null;
  try {
    // ---------------- GİRİŞ ----------------
    const dAdmin = await login("demo", "yonetici");
    t("Admin kullanıcı adıyla giriş yapar", !!dAdmin.session, dAdmin.error?.message);
    const dDriver = await login("demo", "surucu1");
    t("Sürücü kullanıcı adıyla giriş yapar", !!dDriver.session, dDriver.error?.message);
    const dP1 = await login("demo", "0555 000 01 01");
    t("Yolcu telefonla (0555 000 01 01) giriş yapar", !!dP1.session, dP1.error?.message);
    const dP1b = await login("DEMO", "+90 (555) 000-0101");
    t("Farklı telefon yazımı ve büyük harf şirket kodu da çalışır",
      !!dP1b.session && dP1b.user?.id === dP1.user?.id, dP1b.error?.message);
    const dP5 = await login("demo", "yolcu5");

    const wrongPw = await login("demo", "yonetici", "yanlis-sifre-123");
    t("Yanlış şifre reddedilir", !wrongPw.session);
    const wrongCode = await login("demo-x", "yonetici");
    t("Yanlış şirket kodu reddedilir", !wrongCode.session);
    const noUser = await login("demo", "boyle.biri.yok");
    t("Olmayan kullanıcı ile yanlış şifre AYNI hatayı verir (kullanıcı tespit edilemez)",
      !noUser.session && noUser.error?.message === wrongPw.error?.message,
      { noUser: noUser.error?.message, wrongPw: wrongPw.error?.message });
    t("Olmayan kullanıcı için de gerçekle aynı biçimde giriş e-postası döner",
      /^u-[0-9a-f]{32}@servis\.local$/.test(noUser.email) && /^u-[0-9a-f]{32}@servis\.local$/.test(dAdmin.email));

    const bAdmin = await login("demo-b", "yonetici");
    t("Aynı kullanıcı adı + 'demo-b' kodu → B şirketinin yöneticisi (farklı hesap)",
      !!bAdmin.session && bAdmin.user?.id !== dAdmin.user?.id, bAdmin.error?.message);
    const bP1 = await login("demo-b", "05550000101");
    t("Aynı telefon + 'demo-b' kodu → B şirketinin yolcusu",
      !!bP1.session && bP1.user?.id !== dP1.user?.id, bP1.error?.message);

    // ---------------- API ÜZERİNDEN İZOLASYON ----------------
    const { data: myCo } = await dP1.c.from("companies").select("code");
    t("Yolcu yalnızca kendi şirketini görür", myCo?.length === 1 && myCo[0].code === "demo", myCo);
    const { data: myV } = await dP1.c.from("vehicles").select("plate");
    t("Yolcu yalnızca kendi servis aracını görür", myV?.length === 1 && myV[0].plate === "34 DMO 01", myV);
    t("Yolcu: kendisi + sürücüsü (diğer yolcular gizli)", (await count(dP1.c, "profiles")) === 2);
    t("Yolcu yalnızca kendi durağını görür", (await count(dP1.c, "stops")) === 1);
    t("Demo admin: 2 araç, 11 profil", (await count(dAdmin.c, "vehicles")) === 2 && (await count(dAdmin.c, "profiles")) === 11);

    for (const tbl of ["vehicles", "profiles", "stops", "visibility_windows", "absences"]) {
      const { data: rows } = await bAdmin.c.from(tbl).select("company_id");
      const { data: bCo } = await bAdmin.c.from("companies").select("id");
      t(`B admin '${tbl}' tablosunda yalnızca kendi şirketini görür`,
        (rows ?? []).every((r) => r.company_id === bCo?.[0]?.id), rows?.length);
    }

    const anon = newClient();
    const { data: anonRows, error: anonErr } = await anon.from("vehicles").select("*");
    t("Giriş yapmamış istemci tablo okuyamaz", !!anonErr || (anonRows?.length ?? 0) === 0);

    // ---------------- KONUM + SAAT PENCERESİ ----------------
    const { data: v1 } = await dDriver.c.from("vehicles").select("id").single();
    const { error: posErr } = await dDriver.c.from("vehicle_positions")
      .insert({ vehicle_id: v1!.id, lat: 40.99, lng: 29.03, speed: 8.3 });
    t("Sürücü kendi aracı için konum gönderir", !posErr, posErr?.message);

    const now = trNow();
    const { data: wins } = await admin.from("visibility_windows")
      .select("weekday,start_time,end_time").eq("vehicle_id", v1!.id);
    const open = (wins ?? []).some((w) => w.weekday === now.dow && now.hm >= w.start_time.slice(0, 5) && now.hm < w.end_time.slice(0, 5));
    const p1Sees = await count(dP1.c, "vehicle_last_positions");
    t(`Yolcu konumu ${open ? "GÖRÜR (pencere açık)" : "GÖRMEZ (şu an pencere kapalı)"} — İstanbul ${now.hm}, gün ${now.dow}`,
      p1Sees === (open ? 1 : 0), p1Sees);
    t("Başka hattın yolcusu bu aracın konumunu hiç görmez", (await count(dP5.c, "vehicle_last_positions")) <= 1 &&
      !((await dP5.c.from("vehicle_last_positions").select("vehicle_id")).data ?? []).some((r) => r.vehicle_id === v1!.id));
    t("Demo admin aracın son konumunu her zaman görür",
      ((await dAdmin.c.from("vehicle_last_positions").select("vehicle_id")).data ?? []).some((r) => r.vehicle_id === v1!.id));
    t("B admin demo aracının konumunu görmez", (await count(bAdmin.c, "vehicle_last_positions")) === 0);

    // ---------------- KULLANICI YÖNETİMİ (admin-users) ----------------
    const asPassenger = await callAdminFn(dP1.session, { action: "create", role: "passenger", username: "hacker", full_name: "x", password: "12345678" });
    t("Yolcu kullanıcı oluşturamaz (403)", asPassenger.status === 403, asPassenger);
    const noAuth = await callAdminFn(null, { action: "create" });
    t("Girişsiz istek reddedilir (403)", noAuth.status === 403, noAuth);

    const created = await callAdminFn(dAdmin.session, {
      action: "create", role: "passenger", username: "e2e.yolcu", full_name: "E2E Test Yolcusu",
      password: "Ilk.Sifre1", phone: "0555 999 88 77", vehicle_id: v1!.id,
    });
    e2eUserId = created.body?.id ?? null;
    t("Admin yeni yolcu oluşturur (201)", created.status === 201, created);

    const dup = await callAdminFn(dAdmin.session, { action: "create", role: "passenger", username: "e2e.yolcu", full_name: "x", password: "12345678" });
    t("Aynı kullanıcı adı ikinci kez oluşturulamaz (409)", dup.status === 409, dup);

    const { data: bVeh } = await bAdmin.c.from("vehicles").select("id").single();
    const crossVeh = await callAdminFn(dAdmin.session, { action: "create", role: "passenger", username: "e2e.capraz", full_name: "x", password: "12345678", vehicle_id: bVeh!.id });
    t("Admin, başka şirketin aracına yolcu atayamaz", crossVeh.status === 400, crossVeh);

    const nu = await login("demo", "e2e.yolcu", "Ilk.Sifre1");
    const { data: nuProf } = await nu.c.from("profiles").select("must_change_password, phone").eq("id", nu.user?.id ?? "").single();
    t("Yeni kullanıcı giriş yapar, ilk girişte şifre değiştirmesi istenir",
      !!nu.session && nuProf?.must_change_password === true, { err: nu.error?.message, nuProf });
    t("Telefon +90 biçiminde kaydedilmiş", nuProf?.phone === "+905559998877", nuProf);

    const { error: chErr } = await nu.c.auth.updateUser({ password: "Yeni.Sifre2" });
    await nu.c.from("profiles").update({ must_change_password: false, consent_version: "kvkk-v1", consent_at: new Date().toISOString() }).eq("id", nu.user!.id);
    const nu2 = await login("demo", "05559998877", "Yeni.Sifre2");
    const { data: nu2Prof } = await nu2.c.from("profiles").select("must_change_password, consent_version").eq("id", nu2.user?.id ?? "").single();
    t("Kullanıcı kendi şifresini değiştirir, KVKK rızasını kaydeder, yeni şifreyle telefonla girer",
      !chErr && !!nu2.session && nu2Prof?.must_change_password === false && nu2Prof?.consent_version === "kvkk-v1", { chErr, nu2Prof });

    const { error: roleErr } = await nu2.c.from("profiles").update({ role: "admin" }).eq("id", nu2.user!.id);
    t("Kullanıcı kendini admin yapamaz", !!roleErr, roleErr?.message);

    const bDel = await callAdminFn(bAdmin.session, { action: "delete", user_id: e2eUserId });
    t("B admin, demo şirketinin kullanıcısını silemez (404)", bDel.status === 404, bDel);

    const rst = await callAdminFn(dAdmin.session, { action: "reset_password", user_id: e2eUserId, password: "Sifirlandi.3" });
    const nu3 = await login("demo", "e2e.yolcu", "Sifirlandi.3");
    t("Admin şifre sıfırlar; kullanıcı yeni şifreyle girer", rst.status === 200 && !!nu3.session, rst);

    const del = await callAdminFn(dAdmin.session, { action: "delete", user_id: e2eUserId });
    const nu4 = await login("demo", "e2e.yolcu", "Sifirlandi.3");
    t("Admin kullanıcıyı siler; silinen kullanıcı giriş yapamaz", del.status === 200 && !nu4.session, del);
    if (del.status === 200) e2eUserId = null;

    // ---------------- ROTA + DEVAMSIZLIK (Faz 5-6) ----------------
    const today = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
    const routeFnUrl = `${URL_}/functions/v1/compute-route`;
    const callRoute = async (session: { access_token: string } | null, vehicle_id: string, origin?: { lat: number; lng: number }) => {
      const r = await fetch(routeFnUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: publishableKey(), ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}) },
        body: JSON.stringify({ vehicle_id, origin }),
      });
      return { status: r.status, body: await r.json().catch(() => null) };
    };
    const routeAddrs = async () => {
      const { data } = await dDriver.c.from("daily_routes").select("stops, computed_at").eq("vehicle_id", v1!.id).eq("service_date", today).maybeSingle();
      return { addrs: ((data?.stops ?? []) as { address: string }[]).map((s) => s.address), at: data?.computed_at as string | undefined };
    };
    const waitRoute = async (pred: (a: string[]) => boolean, after?: string) => {
      for (let i = 0; i < 20; i++) {
        const r = await routeAddrs();
        if ((!after || (r.at && r.at > after)) && pred(r.addrs)) return r;
        await new Promise((res) => setTimeout(res, 1000));
      }
      return await routeAddrs();
    };

    const dP2 = await login("demo", "yolcu2");   // Üsküdar durağı
    // Önceki çalıştırmalardan kalan devamsızlık varsa yolcu kendisi geri alır
    await dP2.c.from("absences").delete().eq("passenger_id", dP2.user!.id).eq("date", today);

    const p1Route = await callRoute(dP1.session, v1!.id);
    t("Yolcu rota hesaplatamaz (403)", p1Route.status === 403, p1Route);
    const bRoute = await callRoute(bAdmin.session, v1!.id);
    t("Başka şirketin yöneticisi rota hesaplatamaz (403)", bRoute.status === 403, bRoute);

    const start = await callRoute(dDriver.session, v1!.id, { lat: 41.0082, lng: 28.9784 }); // Sultanahmet
    const r0 = await routeAddrs();
    t("Sürücü servise başlayınca rota hesaplanır (4 durak)", start.status === 200 && r0.addrs.length === 4, { start, r0 });
    t("Rota tüm durakları bir kez içerir", new Set(r0.addrs).size === 4 && r0.addrs.includes("Üsküdar Meydanı"), r0.addrs);

    const info1 = (await dP2.c.rpc("my_route_info")).data;
    t("Yolcu kendi sırasını ve tahmini varış süresini görür", info1?.my_order >= 1 && info1?.total_stops === 4 && typeof info1?.eta_s_from_start === "number", info1);

    const { error: absErr } = await dP2.c.from("absences").insert({ passenger_id: dP2.user!.id, date: today });
    t("Yolcu 'Bugün kullanmayacağım' der", !absErr, absErr?.message);
    const r1 = await waitRoute((a) => a.length === 3, r0.at);
    t("Durağı bugünkü rotadan OTOMATİK çıkarılır (3 durak, Üsküdar yok)", r1.addrs.length === 3 && !r1.addrs.includes("Üsküdar Meydanı"), r1.addrs);
    const info2 = (await dP2.c.rpc("my_route_info")).data;
    t("Yolcu ekranı 'bugün yoksunuz' gösterir", info2?.absent_today === true, info2);

    const { error: undoErr } = await dP2.c.from("absences").delete().eq("passenger_id", dP2.user!.id).eq("date", today);
    const r2 = await waitRoute((a) => a.length === 4, r1.at);
    t("Yolcu geri alınca durağı rotaya geri eklenir", !undoErr && r2.addrs.length === 4 && r2.addrs.includes("Üsküdar Meydanı"), { undoErr, r2 });
  } catch (e) {
    results.push({ test: "BEKLENMEYEN HATA", ok: false, detail: String(e) });
  } finally {
    // Temizlik: test konumları ve (kaldıysa) test kullanıcısı
    const { data: demo } = await admin.from("companies").select("id").eq("code", "demo").maybeSingle();
    if (demo) {
      await admin.from("vehicle_positions").delete().eq("company_id", demo.id);
      await admin.from("vehicle_last_positions").delete().eq("company_id", demo.id);
    }
    if (e2eUserId) await admin.auth.admin.deleteUser(e2eUserId);
  }

  const passed = results.filter((r) => r.ok).length;
  return {
    summary: `${passed}/${results.length} geçti`,
    failed: results.filter((r) => !r.ok),
    results: results.map((r) => `${r.ok ? "✓" : "✗"} ${r.test}`),
  };
}
