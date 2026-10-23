// Sürücü ana ekranı
// - Ekran açılınca konum yayını OTOMATİK başlar (izin varsa).
// - Servis başlarken bugünkü rota hesaplatılır; yolcu devamsızlıkları rotaya
//   anlık yansır (daily_routes Realtime aboneliği).
import * as Location from 'expo-location';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, Platform, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import { ago, duration, todayTR } from '../lib/time';
import {
  ensurePermissions, isTracking, startTracking, stopTracking, subscribeStatus,
  type PermissionResult, type TrackingStatus,
} from '../location/tracking';
import { Button, Card, ErrorBox, Screen } from '../ui/components';
import { LiveMap } from '../ui/LiveMap';
import { VehicleCard } from '../ui/VehicleCard';
import { colors } from '../ui/theme';

type RouteStop = { passenger_id: string; lat: number; lng: number; address: string | null; eta_s: number };
type TripState = {
  open: { id: string; started_at: string; direction: 'to_factory' | 'from_factory' | null } | null;
  last: { id: string; started_at: string; ended_at: string; end_reason: string; direction: string | null } | null;
  factory: { name: string; lat: number; lng: number; radius_m: number } | null;
} | null;
const hhmm = (iso: string) => new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' }).format(new Date(iso));

type DailyRoute = { stops: RouteStop[]; polyline: string | null; distance_m: number | null; duration_s: number | null; source: string; computed_at: string };

export function DriverHomeScreen() {
  const { profile, signOut } = useAuth();
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [perm, setPerm] = useState<PermissionResult | null>(null);
  const [tracking, setTracking] = useState(false);
  const [status, setStatus] = useState<TrackingStatus | null>(null);
  const [route, setRoute] = useState<DailyRoute | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [trip, setTrip] = useState<TripState>(null);
  const [autoDone, setAutoDone] = useState<string | null>(null);

  useEffect(() => subscribeStatus(setStatus), []);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(t); }, []);

  useEffect(() => {
    supabase.from('vehicles').select('id').maybeSingle().then(({ data }) => setVehicleId(data?.id ?? null));
  }, []);

  const loadRoute = useCallback(async (vid: string) => {
    const { data } = await supabase.from('daily_routes')
      .select('stops, polyline, distance_m, duration_s, source, computed_at')
      .eq('vehicle_id', vid).eq('service_date', todayTR()).maybeSingle();
    setRoute((data as DailyRoute) ?? null);
  }, []);

  const computeRoute = useCallback(async (vid: string) => {
    let origin: { lat: number; lng: number } | undefined;
    try {
      const p = await Location.getLastKnownPositionAsync() ?? await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      if (p) origin = { lat: p.coords.latitude, lng: p.coords.longitude };
    } catch { /* konum yoksa sunucu son görülen konumu kullanır */ }
    await supabase.functions.invoke('compute-route', { body: { vehicle_id: vid, origin } });
    await loadRoute(vid);
  }, [loadRoute]);

  const [startError, setStartError] = useState<string | null>(null);
  const start = useCallback(async (vid: string) => {
    setBusy(true);
    setStartError(null);
    try {
      const p = await ensurePermissions();
      setPerm(p);
      if (p === 'granted' || p === 'foreground_only') {
        await startTracking(vid);
        setTracking(true);
      }
    } catch (e) {
      setStartError('Konum yayını başlatılamadı. Telefonun konum ayarlarını kontrol edip tekrar deneyin.');
      console.warn('startTracking', e);
    } finally {
      setBusy(false);
    }
    computeRoute(vid).catch(() => {});
  }, [computeRoute]);

  // Ekran açılınca otomatik başlat
  useEffect(() => {
    if (!vehicleId) return;
    (async () => {
      if (await isTracking()) { setTracking(true); setPerm('granted'); loadRoute(vehicleId); }
      else await start(vehicleId);
    })();
  }, [vehicleId, start, loadRoute]);

  // Uygulama ön plana gelince durumu tazele
  useEffect(() => {
    const sub = AppState.addEventListener('change', async (s) => {
      if (s === 'active') { setTracking(await isTracking()); if (vehicleId) loadRoute(vehicleId); }
    });
    return () => sub.remove();
  }, [vehicleId, loadRoute]);

  // Rota değişikliklerini canlı al (yolcu "bugün yokum" dediğinde)
  useEffect(() => {
    if (!vehicleId) return;
    const ch = supabase.channel(`route-${vehicleId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'daily_routes', filter: `vehicle_id=eq.${vehicleId}` },
        () => loadRoute(vehicleId))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [vehicleId, loadRoute]);

  // Sefer durumu: sabah fabrikaya / akşam son yolcuya varınca sunucu seferi kendiliğinden tamamlar;
  // o zaman konum yayını da burada durdurulur (sürücünün düğmeye basması gerekmez).
  useEffect(() => {
    if (!vehicleId) return;
    let alive = true;
    let sawOpen = false;
    const check = async () => {
      const { data } = await supabase.rpc('my_trip_state');
      if (!alive) return;
      const st = (data as TripState) ?? null;
      setTrip(st);
      if (st?.open) sawOpen = true;
      const last = st?.last;
      if (!st?.open && last && (last.end_reason === 'factory' || last.end_reason === 'last_stop')
          && Date.now() - Date.parse(last.ended_at) < 15 * 60_000 && (sawOpen || await isTracking())) {
        if (await isTracking()) { await stopTracking(); setTracking(false); }
        setAutoDone(last.end_reason === 'factory'
          ? `Fabrikaya varıldı · ${hhmm(last.ended_at)}. Servis tamamlandı, konum yayını durduruldu.`
          : `Son yolcuya ulaşıldı · ${hhmm(last.ended_at)}. Servis tamamlandı, konum yayını durduruldu.`);
      }
    };
    void check();
    const t = setInterval(check, 20_000);
    return () => { alive = false; clearInterval(t); };
  }, [vehicleId]);

  async function stop() {
    setBusy(true);
    await stopTracking();
    // Seferi sunucuda kapat: uğranmayan duraklar "uğranmadı" olarak işaretlenir.
    // (Telefon kapanır/uygulama zorla kapatılırsa sunucu 30 dk sonra kendisi kapatır.)
    await supabase.rpc('end_my_trip');
    setTracking(false);
    setBusy(false);
  }

  if (!profile) return null;
  if (!vehicleId) {
    return (
      <Screen>
        <Card>
          <Text style={styles.h}>Araç atanmamış</Text>
          <Text style={styles.p}>Konum yayını için yöneticinizin size bir araç ataması gerekiyor.</Text>
          <Button title="Çıkış yap" variant="ghost" onPress={signOut} />
        </Card>
      </Screen>
    );
  }

  // Araç dururken (trafik, durak) telefon yeni konum üretmez; 5 dk'ya kadar "canlı" say.
  const live = tracking && status?.lastSentAt && now - Date.parse(status.lastSentAt) < 300_000;

  return (
    <Screen>
      <Text style={styles.hello}>{profile.vehicle?.plate ?? 'Servis'}</Text>
      <Text style={styles.sub}>{profile.full_name} · {profile.company?.name}</Text>

      {autoDone ? (
        <View style={styles.done}>
          <Text style={styles.doneTitle}>✓ Servis tamamlandı</Text>
          <Text style={styles.doneText}>{autoDone}</Text>
        </View>
      ) : null}
      {trip?.open ? (
        <View style={styles.tripPill}>
          <Text style={styles.tripPillText}>
            {trip.open.direction === 'from_factory' ? 'Akşam servisi · fabrikadan dönüş' : 'Sabah servisi · fabrikaya'} · {hhmm(trip.open.started_at)}'de başladı
          </Text>
          {trip.factory && trip.open.direction !== 'from_factory' ? <Text style={styles.tripPillSub}>Varış: {trip.factory.name} — yaklaşınca servis kendiliğinden tamamlanır</Text> : null}
          {trip.open.direction === 'from_factory' ? <Text style={styles.tripPillSub}>Son yolcuyu bırakınca servis kendiliğinden tamamlanır</Text> : null}
        </View>
      ) : null}
      <Card>
        <View style={styles.statusRow}>
          <View style={[styles.dot, { backgroundColor: tracking ? (live ? colors.success : colors.accent) : colors.muted }]} />
          <Text style={styles.statusText}>
            {!tracking ? 'Konum yayını kapalı' : live ? 'Canlı konum yayınlanıyor' : 'Konum bekleniyor…'}
          </Text>
        </View>
        {tracking ? (
          <Text style={styles.meta}>
            Son gönderim: {ago(status?.lastSentAt, now)}
            {status?.queued ? ` · ${status.queued} konum kuyrukta (internet bekleniyor)` : ''}
          </Text>
        ) : null}

        <ErrorBox message={startError} />
        {perm === 'denied' || perm === 'services_off' ? (
          <View style={styles.warn}>
            <Text style={styles.warnText}>
              {perm === 'services_off' ? 'Telefonun konum servisi kapalı. Lütfen açın.' : 'Konum izni verilmedi. Yolcular aracı göremez.'}
            </Text>
            <Button title="Ayarları aç" variant="ghost" onPress={() => Linking.openSettings()} />
          </View>
        ) : null}
        {perm === 'foreground_only' ? (
          <View style={styles.warn}>
            <Text style={styles.warnText}>
              {Platform.OS === 'ios'
                ? 'Konum izni "Uygulamayı Kullanırken" olarak verildi. Servis sırasında uygulama arka plandayken de konum gönderilir (üstte mavi konum simgesi görünür). Kesintisiz çalışma için Ayarlar > READY LIVE > Konum > "Her Zaman" seçin.'
                : '"Her zaman" konum izni verilmedi. Uygulama arka plandayken konum gönderilemeyebilir.'}
            </Text>
            <Button title="Ayarları aç" variant="ghost" onPress={() => Linking.openSettings()} />
          </View>
        ) : null}

        {tracking ? (
          <Text style={[styles.meta, { marginTop: 10 }]}>
            Uygulamayı arka plana alabilir, telefonu kilitleyebilirsiniz; konum gönderilmeye devam eder.
            {Platform.OS === 'ios' ? ' Uygulamayı uygulama değiştiriciden yukarı kaydırarak KAPATMAYIN — iOS konum gönderimini durdurur.' : ''}
          </Text>
        ) : null}
        {tracking
          ? <Button title="Servisi bitir (yayını durdur)" variant="ghost" onPress={stop} loading={busy} />
          : <Button title="Servisi başlat" onPress={() => { setAutoDone(null); void start(vehicleId); }} loading={busy} />}
      </Card>

      <View style={{ height: 16 }} />
      <Card>
        <View style={styles.routeHead}>
          <Text style={styles.h}>Bugünkü rota</Text>
          {route ? <Text style={styles.meta}>{route.stops.length} durak · {route.distance_m ? `${(route.distance_m / 1000).toFixed(1)} km` : ''} · {duration(route.duration_s)}</Text> : null}
        </View>
        {route && route.stops.length > 0 ? (
          <>
            <LiveMap stops={route.stops} path={route.polyline} height={220} />
            {route.stops.map((s, i) => (
              <View key={s.passenger_id} style={styles.stopRow}>
                <View style={styles.badge}><Text style={styles.badgeText}>{i + 1}</Text></View>
                <Text style={styles.stopAddr} numberOfLines={1}>{s.address ?? `${s.lat.toFixed(4)}, ${s.lng.toFixed(4)}`}</Text>
                <Text style={styles.stopEta}>{duration(s.eta_s)}</Text>
              </View>
            ))}
            <Text style={[styles.meta, { marginTop: 8 }]}>
              Güncellendi: {ago(route.computed_at, now)}{route.source === 'fallback' ? ' · tahmini sıralama' : ''}
            </Text>
          </>
        ) : (
          <Text style={styles.p}>{route ? 'Bugün alınacak yolcu yok.' : 'Servis başlayınca rota hesaplanır.'}</Text>
        )}
        <Button title="Rotayı yeniden hesapla" variant="ghost" onPress={() => computeRoute(vehicleId)} />
      </Card>

      <View style={{ height: 16 }} />
      <VehicleCard mode="driver" />

      <Button title="Çıkış yap" variant="ghost" onPress={async () => { await stop(); await signOut(); }} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hello: { fontSize: 26, fontWeight: '800', color: colors.primary },
  sub: { fontSize: 14, color: colors.muted, marginBottom: 16 },
  h: { fontSize: 17, fontWeight: '700', color: colors.text },
  p: { fontSize: 14, color: colors.text, lineHeight: 20, marginVertical: 8 },
  meta: { fontSize: 13, color: colors.muted },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 },
  dot: { width: 14, height: 14, borderRadius: 7 },
  statusText: { fontSize: 17, fontWeight: '700', color: colors.text },
  warn: { backgroundColor: '#FFF4D6', borderRadius: 8, padding: 12, marginTop: 12 },
  warnText: { color: '#7A5A00', fontSize: 14 },
  routeHead: { marginBottom: 10, gap: 2 },
  stopRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#EEF1F5' },
  badge: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  stopAddr: { flex: 1, fontSize: 15, color: colors.text },
  stopEta: { fontSize: 13, color: colors.muted },
  done: { backgroundColor: '#E6F3E7', borderRadius: 12, padding: 14, marginBottom: 12 },
  doneTitle: { fontSize: 16, fontWeight: '800', color: colors.success, marginBottom: 2 },
  doneText: { fontSize: 14, color: colors.text, lineHeight: 20 },
  tripPill: { backgroundColor: '#E9EFF6', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 12 },
  tripPillText: { fontSize: 14, fontWeight: '700', color: colors.primary },
  tripPillSub: { fontSize: 12.5, color: colors.muted, marginTop: 2 },
});
