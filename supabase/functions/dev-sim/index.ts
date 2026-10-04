// dev-sim — Canlı konum simülasyonu (Realtime + RLS + saat penceresi + son görülen konum)
// YALNIZCA GELİŞTİRME İÇİN.  POST (header: x-dev-secret)
//
// Senaryo:
//  A) Pencere KAPALI: sürücü 3 konum gönderir → yolcuya 0 mesaj, admin'e 3 mesaj
//  B) Pencere AÇIK: sürücü Moda → Üsküdar rotasında 12 konum gönderir
//     → yolcu hepsini alır (gecikme ölçülür); başka hattın yolcusu ve başka
//       şirketin yöneticisi hiçbirini almaz
//  C) Sürücü "uygulamayı kapatır" (gönderim durur) → son görülen konum = son nokta
//  D) Pencere kapanır → yolcu son konumu artık sorgulayamaz; admin hâlâ görür
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const PASSWORD = "Demo.2026!";
const keyFrom = (env: string, legacy: string) => {
  const k = Deno.env.get(env);
  if (k) { try { const v = JSON.parse(k)["default"]; if (v) return v; } catch { /* */ } }
  return Deno.env.get(legacy)!;
};
const SECRET = keyFrom("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
const PUBLISHABLE = keyFrom("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Moda → Kadıköy → Haydarpaşa → Harem → Üsküdar (yaklaşık yol noktaları)
const ROUTE: [number, number][] = [
  [40.9862, 29.0257], [40.9880, 29.0270], [40.9905, 29.0262], [40.9928, 29.0240],
  [40.9952, 29.0225], [40.9985, 29.0205], [41.0030, 29.0180], [41.0075, 29.0165],
  [41.0120, 29.0150], [41.0165, 29.0140], [41.0210, 29.0145], [41.0255, 29.0153],
];

async function login(code: string, ident: string) {
  const c = createClient(URL_, PUBLISHABLE, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: email } = await c.rpc("login_email", { p_company_code: code, p_identifier: ident });
  const { data, error } = await c.auth.signInWithPassword({ email: email as string, password: PASSWORD });
  if (error || !data.session) throw new Error(`giriş ${code}/${ident}: ${error?.message}`);
  c.realtime.setAuth(data.session.access_token);
  return c;
}

type Msg = { at: number; lat: number; lng: number; recorded_at: string };

const channelLog: string[] = [];

async function listen(c: SupabaseClient, name: string, filter?: string) {
  const got: Msg[] = [];
  const ch = c.channel(`sim-${name}-${crypto.randomUUID()}`)
    .on("postgres_changes",
      { event: "*", schema: "public", table: "vehicle_last_positions", ...(filter ? { filter } : {}) },
      (p) => {
        const n = p.new as { lat: number; lng: number; recorded_at: string };
        if (n?.lat != null) got.push({ at: Date.now(), lat: n.lat, lng: n.lng, recorded_at: n.recorded_at });
      });
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${name}: abone olunamadı`)), 15000);
    ch.subscribe((s, err) => {
      channelLog.push(`${name}: ${s}${err ? " " + err.message : ""}`);
      if (s === "SUBSCRIBED") { clearTimeout(t); resolve(); }
    });
  });
  return { got, close: () => c.removeChannel(ch) };
}

Deno.serve(async (req) => {
  const admin = createClient(URL_, SECRET, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: ok } = await admin.rpc("dev_verify_secret", { p_secret: req.headers.get("x-dev-secret") ?? "" });
  if (ok !== true) return new Response("forbidden", { status: 403 });

  const results: { test: string; ok: boolean; detail?: unknown }[] = [];
  const t = (test: string, cond: boolean, detail?: unknown) => results.push({ test, ok: !!cond, ...(cond ? {} : { detail }) });
  const metrics: Record<string, unknown> = {};
  let tempWindowId: string | null = null;
  let demoId: string | null = null;

  try {
    const { data: demo } = await admin.from("companies").select("id").eq("code", "demo").single();
    demoId = demo!.id;
    const { data: v1 } = await admin.from("vehicles").select("id").eq("company_id", demoId).eq("plate", "34 DMO 01").single();
    const V1 = v1!.id as string;
    await admin.from("vehicle_last_positions").delete().eq("vehicle_id", V1);

    const driver = await login("demo", "surucu1");
    const p1 = await login("demo", "yolcu1");     // V1 yolcusu
    const p5 = await login("demo", "yolcu5");     // V2 yolcusu
    const dAdmin = await login("demo", "yonetici");
    const bAdmin = await login("demo-b", "yonetici");

    const L1 = await listen(p1, "yolcu1", `vehicle_id=eq.${V1}`);
    const L5 = await listen(p5, "yolcu5");
    const LA = await listen(dAdmin, "admin", `vehicle_id=eq.${V1}`);
    const LB = await listen(bAdmin, "b-admin");
    await sleep(2000);

    const send = async (lat: number, lng: number) => {
      const { error } = await driver.from("vehicle_positions").insert({ vehicle_id: V1, lat, lng, speed: 9 });
      if (error) throw new Error(`konum gönderilemedi: ${error.message}`);
    };

    // ---------- Isınma: Realtime değişiklik akışı gerçekten çalışana kadar bekle ----------
    // (Proje bir süre kullanılmazsa Realtime uykuya geçer; ilk açılış birkaç sn sürebilir.)
    const warmStart = Date.now();
    while (LA.got.length === 0 && Date.now() - warmStart < 45000) {
      await send(ROUTE[0][0], ROUTE[0][1]);
      await sleep(2500);
    }
    metrics.realtime_warmup_ms = Date.now() - warmStart;
    t(`Realtime akışı başladı (ısınma ${Math.round((Date.now() - warmStart) / 1000)} sn)`, LA.got.length > 0, channelLog);
    await sleep(1500);
    const a0 = LA.got.length, p0 = L1.got.length;

    // ---------- A) Pencere kapalı (Pazar gecesi; demo pencereleri hafta içi) ----------
    const { data: stA } = await p1.rpc("my_visibility_state");
    t("Başlangıçta yolcu1 için pencere kapalı", stA?.open === false, stA);
    for (const [lat, lng] of ROUTE.slice(0, 3)) { await send(lat, lng); await sleep(400); }
    await sleep(3000);
    t("A) Pencere kapalıyken yolcuya HİÇ mesaj gitmez (ısınma dahil)", L1.got.length === 0 && p0 === 0, L1.got.length);
    t("A) Admin pencere kapalıyken de 3 mesajın hepsini alır", LA.got.length - a0 === 3, LA.got.length - a0);

    // ---------- B) Pencere açık ----------
    const nowTR = new Date(Date.now() + 3 * 3600_000);
    const dow = ((nowTR.getUTCDay() + 6) % 7) + 1;
    const hm = (d: Date) => d.toISOString().slice(11, 19);
    const start = new Date(nowTR.getTime() - 60_000);
    const endRaw = new Date(nowTR.getTime() + 15 * 60_000);
    const end = endRaw.getUTCDate() !== nowTR.getUTCDate() ? "23:59:59" : hm(endRaw);
    const { data: w, error: we } = await admin.from("visibility_windows")
      .insert({ company_id: demoId, vehicle_id: V1, weekday: dow, start_time: hm(start), end_time: end })
      .select("id").single();
    if (we) throw new Error(`geçici pencere: ${we.message}`);
    tempWindowId = w.id;
    const { data: stB } = await p1.rpc("my_visibility_state");
    t("Geçici pencere eklenince yolcu1 için pencere açık", stB?.open === true, stB);

    const before1 = L1.got.length, beforeA = LA.got.length;
    const sentAt: number[] = [];
    for (const [lat, lng] of ROUTE) { sentAt.push(Date.now()); await send(lat, lng); await sleep(1000); }
    await sleep(3000);
    const recv = L1.got.slice(before1);
    t(`B) Yolcu, rota boyunca gönderilen ${ROUTE.length} konumun hepsini alır`, recv.length === ROUTE.length, recv.length);
    t("B) Konumlar doğru sırada gelir (son mesaj = Üsküdar)",
      recv.length > 0 && recv[recv.length - 1].lat === ROUTE[ROUTE.length - 1][0], recv.at(-1));
    const lat = recv.map((m, i) => m.at - sentAt[i]).filter((x) => x >= 0).sort((a, b) => a - b);
    if (lat.length) {
      metrics.latency_ms = { min: lat[0], median: lat[Math.floor(lat.length / 2)], max: lat[lat.length - 1] };
      t(`B) Gecikme: medyan ${lat[Math.floor(lat.length / 2)]} ms (hedef < 2000 ms)`, lat[Math.floor(lat.length / 2)] < 2000, metrics.latency_ms);
    }
    t("B) Admin de tüm konumları alır", LA.got.length - beforeA === ROUTE.length, LA.got.length - beforeA);
    t("B) Başka hattın yolcusu (V2) bu aracın hiçbir konumunu almaz", L5.got.length === 0, L5.got.length);
    t("B) Başka şirketin yöneticisi hiçbir konum almaz", LB.got.length === 0, LB.got.length);

    // ---------- C) Uygulama kapandı: gönderim durur ----------
    await sleep(2000);
    const { data: lastAdmin } = await dAdmin.from("vehicle_last_positions").select("lat,lng,recorded_at").eq("vehicle_id", V1).single();
    const [elat, elng] = ROUTE[ROUTE.length - 1];
    t("C) Son görülen konum = uygulamanın kapandığı nokta (Üsküdar)", lastAdmin?.lat === elat && lastAdmin?.lng === elng, lastAdmin);
    const { data: lastP1 } = await p1.from("vehicle_last_positions").select("lat").eq("vehicle_id", V1).maybeSingle();
    t("C) Pencere açıkken yolcu da son görülen konumu sorgulayabilir", lastP1?.lat === elat, lastP1);

    // ---------- D) Pencere kapanır ----------
    await admin.from("visibility_windows").delete().eq("id", tempWindowId);
    tempWindowId = null;
    const { data: lastP1b } = await p1.from("vehicle_last_positions").select("lat").eq("vehicle_id", V1);
    t("D) Pencere kapanınca yolcu son konumu artık göremez", (lastP1b ?? []).length === 0, lastP1b);
    const n1 = L1.got.length;
    await send(41.03, 29.02);
    await sleep(2500);
    t("D) Pencere kapandıktan sonra gönderilen konum yolcuya gitmez", L1.got.length === n1, L1.got.length - n1);
    const { data: lastAdmin2 } = await dAdmin.from("vehicle_last_positions").select("lat").eq("vehicle_id", V1).single();
    t("D) Admin son konumu görmeye devam eder", lastAdmin2?.lat === 41.03, lastAdmin2);

    await Promise.all([L1.close(), L5.close(), LA.close(), LB.close()]);
  } catch (e) {
    results.push({ test: "BEKLENMEYEN HATA", ok: false, detail: String(e) });
  } finally {
    if (tempWindowId) await admin.from("visibility_windows").delete().eq("id", tempWindowId);
    if (demoId) {
      await admin.from("vehicle_positions").delete().eq("company_id", demoId);
      await admin.from("vehicle_last_positions").delete().eq("company_id", demoId);
    }
  }

  const passed = results.filter((r) => r.ok).length;
  return new Response(JSON.stringify({
    summary: `${passed}/${results.length} geçti`, metrics, channels: channelLog,
    failed: results.filter((r) => !r.ok),
    results: results.map((r) => `${r.ok ? "✓" : "✗"} ${r.test}`),
  }, null, 2), { headers: { "Content-Type": "application/json" } });
});
