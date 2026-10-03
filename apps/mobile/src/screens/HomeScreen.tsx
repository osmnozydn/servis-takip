import { StyleSheet, Text, View } from 'react-native';
import { ROLE_LABELS } from '@servis/shared';
import { useAuth } from '../auth/AuthProvider';
import { Button, Card, Screen } from '../ui/components';
import { colors } from '../ui/theme';

// Faz 2: role göre ana ekran iskeleti.
// Faz 3'te sürücü ekranına konum yayını, Faz 4'te yolcu ekranına harita gelecek.
export function HomeScreen() {
  const { profile, signOut } = useAuth();
  if (!profile) return null;

  const next =
    profile.role === 'driver' ? 'Konum yayını bir sonraki sürümde bu ekrana eklenecek.'
    : profile.role === 'passenger' ? 'Servis aracının haritası bir sonraki sürümde bu ekrana eklenecek.'
    : 'Şirket yönetimi web panelinden yapılır.';

  return (
    <Screen>
      <Text style={styles.hello}>Merhaba, {profile.full_name.split(' ')[0]}</Text>
      <Card>
        <Row label="Şirket" value={profile.company?.name ?? '—'} />
        <Row label="Rol" value={ROLE_LABELS[profile.role]} />
        {profile.role !== 'admin' ? (
          <Row label="Servis aracı" value={profile.vehicle ? `${profile.vehicle.plate}${profile.vehicle.name ? ` · ${profile.vehicle.name}` : ''}` : 'Atanmamış'} />
        ) : null}
        <Row label="Kullanıcı adı" value={profile.username} />
        <View style={styles.note}><Text style={styles.noteText}>{next}</Text></View>
        <Button title="Çıkış yap" variant="ghost" onPress={signOut} />
      </Card>
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hello: { fontSize: 26, fontWeight: '800', color: colors.primary, marginBottom: 16 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#EEF1F5', gap: 12 },
  label: { color: colors.muted, fontSize: 14 },
  value: { color: colors.text, fontSize: 15, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  note: { backgroundColor: '#FFF8E1', borderRadius: 8, padding: 12, marginTop: 16 },
  noteText: { color: '#7A5A00', fontSize: 14 },
});
