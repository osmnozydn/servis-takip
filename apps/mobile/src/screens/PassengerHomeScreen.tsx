// Yolcu ana ekranı
// - Aracın konumu yalnızca yetkili saat aralığında görünür (kural sunucuda, RLS ile).
// - Canlı konum Realtime ile gelir; uygulama ön plana dönünce tazelenir.
// - "Bugün kullanmayacağım": durak bugünkü rotadan otomatik çıkar (sunucu tetikleyicisi).
import { useCallback, useEffect, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import { ago, duration, friendlyNextOpen, todayTR } from '../lib/time';
import { Button, Card, ErrorBox, Screen } from '../ui/components';
import { LiveMap, type MapPoint } from '../ui/LiveMap';
import { colors } from '../ui/theme';

type Visibility = { has_vehicle: boolean; open?: boolean; open_until?: string | null; next_open?: string | null };
type RouteInfo = { available: boolean; absent_today?: boolean; my_order?: number; total_stops?: number; eta_s_from_start?: number };
type LastPos = { lat: number; lng: number; recorded_at: string; speed: number | null };

export function PassengerHomeScreen() {
  const { profile, signOut } = useAuth();
  const [vis, setVis] = useState<Visibility | null>(null);
  const [pos, setPos] = useState<LastPos | null>(null);
  const [myStop, setMyStop] = useState<MapPoint | null>(null);
  const [info, setInfo] = useState<RouteInfo | null>(null);
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const refresh = useCallback(async () => {
    const [v, i, s, veh] = await Promise.all([
      supabase.rpc('my_visibility_state'),
      supabase.rpc('my_route_info'),
      supabase.from('stops').select('lat, lng').maybeSingle(),
      supabase.from('vehicles').select('id').maybeSingle(),
    ]);
    setVis((v.data as Visibility) ?? null);
    setInfo((i.data as RouteInfo) ?? null);
    setMyStop(s.data ? { lat: s.data.lat, lng: s.data.lng } : null);
    setVehicleId(veh.data?.id ?? null);
    if ((v.data as Visibility)?.open && veh.data?.id) {
      const { data } = await supabase.from('vehicle_last_positions').select('lat, lng, recorded_at, speed').eq('vehicle_id', veh.data.id).maybeSingle();
      setPos((data as LastPos) ?? null);
    } else {
      setPos(null);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  // Pencere açılış/kapanışını yakalamak ve "x dk önce" yazısı için periyodik tazeleme
  useEffect(() => { const t = setInterval(() => { setNow(Date.now()); refresh(); }, 60_000); return () => clearInterval(t); }, [refresh]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') refresh(); });
    return () => sub.remove();
  }, [refresh]);

  // Canlı konum (sunucu yalnızca pencere açıkken gönderir)
  useEffect(() => {
    if (!vehicleId || !vis?.open) return;
    const ch = supabase.channel(`bus-${vehicleId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicle_last_positions', filter: `vehicle_id=eq.${vehicleId}` },
        (p) => { const n = p.new as LastPos; if (n?.lat != null) { setPos(n); setNow(Date.now()); } })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [vehicleId, vis?.open]);

  async function setAbsent(absent: boolean) {
    if (!profile) return;
    setBusy(true); setError(null);
    const today = todayTR();
    const { error: e } = absent
      ? await supabase.from('absences').insert({ passenger_id: profile.id, date: today })
      : await supabase.from('absences').delete().eq('passenger_id', profile.id).eq('date', today);
    if (e && !/duplicate/i.test(e.message)) setError('İşlem yapılamadı. Tekrar deneyin.');
    await refresh();
    setBusy(false);
  }

  if (!profile) return null;
  const absent = info?.absent_today === true;
  const stale = pos && now - Date.parse(pos.recorded_at) > 3 * 60_000;

  return (
    <Screen>
      <Text style={styles.hello}>Merhaba, {profile.full_name.split(' ')[0]}</Text>
      <Text style={styles.sub}>{profile.vehicle ? `${profile.vehicle.plate}${profile.vehicle.name ? ` · ${profile.vehicle.name}` : ''}` : 'Servis atanmamış'}</Text>

      <Card>
        {!vis ? <Text style={styles.p}>Yükleniyor…</Text>
          : !vis.has_vehicle ? <Text style={styles.p}>Henüz bir servise atanmadınız. Yöneticinizle iletişime geçin.</Text>
          : vis.open ? (
            <>
              <View style={styles.row}>
                <Text style={styles.h}>Servis aracı</Text>
                <Text style={styles.meta}>{vis.open_until ? `${vis.open_until}'e kadar görünür` : ''}</Text>
              </View>
              <LiveMap vehicle={pos} stops={myStop ? [{ ...myStop, mine: true }] : []} height={300} />
              <Text style={[styles.meta, { marginTop: 8 }]}>
                {pos
                  ? stale
                    ? `Araç en son ${ago(pos.recorded_at, now)} görüldü (son bilinen konum)`
                    : `Canlı · ${ago(pos.recorded_at, now)} güncellendi`
                  : 'Aracın konumu henüz yok. Sürücü servise başlayınca görünecek.'}
              </Text>
            </>
          ) : (
            <View style={styles.closed}>
              <Text style={styles.closedIcon}>🕑</Text>
              <Text style={styles.h}>Aracın konumu şu an görünmüyor</Text>
              <Text style={styles.p}>Konum, servis saatlerinde görünür. Bir sonraki: <Text style={{ fontWeight: '700' }}>{friendlyNextOpen(vis.next_open)}</Text></Text>
            </View>
          )}
      </Card>

      {vis?.has_vehicle ? (
        <>
          <View style={{ height: 16 }} />
          <Card>
            <Text style={styles.h}>Bugün</Text>
            {absent ? (
              <Text style={styles.p}>Bugün servisi <Text style={{ fontWeight: '700' }}>kullanmayacağınızı</Text> bildirdiniz. Durağınız bugünkü rotadan çıkarıldı.</Text>
            ) : info?.my_order ? (
              <Text style={styles.p}>Sıranız: <Text style={{ fontWeight: '700' }}>{info.my_order}/{info.total_stops}</Text> · Servis başladıktan yaklaşık <Text style={{ fontWeight: '700' }}>{duration(info.eta_s_from_start)}</Text> sonra durağınızda.</Text>
            ) : (
              <Text style={styles.p}>Servis başlayınca sıranız ve tahmini varış süresi burada görünür.</Text>
            )}
            <ErrorBox message={error} />
            {absent
              ? <Button title="Vazgeç, bugün kullanacağım" variant="ghost" onPress={() => setAbsent(false)} loading={busy} />
              : <Button title="Bugün kullanmayacağım" onPress={() => setAbsent(true)} loading={busy} />}
          </Card>
        </>
      ) : null}

      <Button title="Çıkış yap" variant="ghost" onPress={signOut} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hello: { fontSize: 26, fontWeight: '800', color: colors.primary },
  sub: { fontSize: 14, color: colors.muted, marginBottom: 16 },
  h: { fontSize: 17, fontWeight: '700', color: colors.text },
  p: { fontSize: 15, color: colors.text, lineHeight: 21, marginVertical: 8 },
  meta: { fontSize: 13, color: colors.muted },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  closed: { alignItems: 'center', paddingVertical: 12 },
  closedIcon: { fontSize: 36, marginBottom: 8 },
});
