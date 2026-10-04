// Servis aracı + sürücü kartı (fotoğraflarla)
// Yolcu: bindiği aracın fotoğrafı, sürücünün fotoğrafı, adı ve telefonu.
// Sürücü: kendi aracı ve kendi fotoğrafı.
// Fotoğraflar özel depolamada; yalnızca aynı servisteki kullanıcılar süreli bağlantıyla görebilir (RLS).
import { useEffect, useState } from 'react';
import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { formatPhone } from '@servis/shared';
import { supabase } from '../lib/supabase';
import { Card } from './components';
import { colors } from './theme';

type Vehicle = { id: string; plate: string; name: string | null; brand_model: string | null; color: string | null };
type Driver = { id: string; full_name: string; phone: string | null };

export function VehicleCard({ mode }: { mode: 'passenger' | 'driver' }) {
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [driver, setDriver] = useState<Driver | null>(null);
  const [vehiclePhoto, setVehiclePhoto] = useState<string | null>(null);
  const [driverPhoto, setDriverPhoto] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data: v } = await supabase.from('vehicles').select('id, plate, name, brand_model, color').maybeSingle();
      if (!v) { if (alive) setLoaded(true); return; }
      const [{ data: d }, { data: docs }] = await Promise.all([
        mode === 'passenger'
          ? supabase.from('profiles').select('id, full_name, phone').eq('role', 'driver').eq('vehicle_id', v.id).limit(1).maybeSingle()
          : supabase.auth.getUser().then(async ({ data: u }) => supabase.from('profiles').select('id, full_name, phone').eq('id', u.user?.id ?? '').maybeSingle()),
        supabase.from('documents').select('owner_type, owner_id, doc_type, file_path, created_at')
          .in('doc_type', ['vehicle_photo', 'driver_photo']).order('created_at', { ascending: false }),
      ]);
      const vp = (docs ?? []).find((x) => x.doc_type === 'vehicle_photo' && x.owner_id === v.id);
      const dp = (docs ?? []).find((x) => x.doc_type === 'driver_photo' && x.owner_id === d?.id);
      const paths = [vp?.file_path, dp?.file_path].filter(Boolean) as string[];
      const urls: Record<string, string> = {};
      if (paths.length) {
        const { data: signed } = await supabase.storage.from('documents').createSignedUrls(paths, 3600);
        for (const s of signed ?? []) if (s.path && s.signedUrl) urls[s.path] = s.signedUrl;
      }
      if (!alive) return;
      setVehicle(v as Vehicle); setDriver((d as Driver) ?? null);
      setVehiclePhoto(vp ? urls[vp.file_path] ?? null : null);
      setDriverPhoto(dp ? urls[dp.file_path] ?? null : null);
      setLoaded(true);
    })();
    return () => { alive = false; };
  }, [mode]);

  if (!loaded || !vehicle) return null;
  const initials = (driver?.full_name ?? '?').split(' ').filter(Boolean).map((s) => s[0]).slice(0, 2).join('').toLocaleUpperCase('tr-TR');
  const details = [vehicle.brand_model, vehicle.color].filter(Boolean).join(', ');

  return (
    <Card>
      {vehiclePhoto ? <Image source={{ uri: vehiclePhoto }} style={styles.vphoto} resizeMode="cover" accessibilityLabel="Servis aracının fotoğrafı" /> : null}
      <View style={styles.plateRow}>
        <View style={styles.plate}>
          <View style={styles.plateTr}><Text style={styles.plateTrText}>TR</Text></View>
          <Text style={styles.plateText}>{vehicle.plate}</Text>
        </View>
        <View style={{ flex: 1 }}>
          {vehicle.name ? <Text style={styles.vname}>{vehicle.name}</Text> : null}
          {details ? <Text style={styles.meta}>{details}</Text> : null}
        </View>
      </View>
      {driver ? (
        <View style={styles.driverRow}>
          {driverPhoto
            ? <Image source={{ uri: driverPhoto }} style={styles.avatar} accessibilityLabel="Sürücünün fotoğrafı" />
            : <View style={[styles.avatar, styles.avatarIni]}><Text style={styles.ini}>{initials}</Text></View>}
          <View style={{ flex: 1 }}>
            <Text style={styles.meta}>{mode === 'passenger' ? 'Sürücünüz' : 'Sürücü'}</Text>
            <Text style={styles.dname}>{driver.full_name}</Text>
          </View>
          {mode === 'passenger' && driver.phone ? (
            <Pressable style={styles.call} onPress={() => Linking.openURL(`tel:${driver.phone}`)} accessibilityRole="button" accessibilityLabel={`Sürücüyü ara: ${formatPhone(driver.phone)}`}>
              <Text style={styles.callText}>Ara</Text>
            </Pressable>
          ) : null}
        </View>
      ) : mode === 'passenger' ? <Text style={[styles.meta, { marginTop: 10 }]}>Bu araca henüz sürücü atanmadı.</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  vphoto: { width: '100%', height: 150, borderRadius: 10, marginBottom: 12, backgroundColor: '#E8EEF5' },
  plateRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  plate: { flexDirection: 'row', alignItems: 'stretch', borderWidth: 2, borderColor: '#1D2733', borderRadius: 6, backgroundColor: '#fff', overflow: 'hidden' },
  plateTr: { backgroundColor: '#1E4FA8', paddingHorizontal: 5, justifyContent: 'flex-end', paddingBottom: 3 },
  plateTrText: { color: '#fff', fontSize: 9, fontWeight: '800' },
  plateText: { fontSize: 17, fontWeight: '800', color: '#1D2733', paddingHorizontal: 9, paddingVertical: 4, letterSpacing: 1 },
  vname: { fontSize: 15, fontWeight: '700', color: colors.text },
  meta: { fontSize: 13, color: colors.muted },
  driverRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#EEF1F5' },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#E8EEF5' },
  avatarIni: { alignItems: 'center', justifyContent: 'center' },
  ini: { color: colors.primary, fontWeight: '800', fontSize: 17 },
  dname: { fontSize: 16, fontWeight: '700', color: colors.text },
  call: { backgroundColor: colors.primary, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
  callText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
