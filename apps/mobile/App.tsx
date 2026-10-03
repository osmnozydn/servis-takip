import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { APP_TIMEZONE } from '@servis/shared';
import { supabase } from './src/lib/supabase';

type Health = { ok: boolean; server_time: string; istanbul_time: string; schema_version: string };

// Görev 1 bağlantı testi ekranı: Supabase'deki public.health() fonksiyonunu çağırır.
// Faz 2'de giriş ekranıyla değiştirilecek.
export default function App() {
  const [loading, setLoading] = useState(true);
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase.rpc('health');
    if (error) setError(error.message);
    else setHealth(data as Health);
    setLoading(false);
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Servis Takip</Text>
      <Text style={styles.subtitle}>Supabase bağlantı testi</Text>

      {loading ? (
        <ActivityIndicator size="large" />
      ) : error ? (
        <Text style={[styles.status, styles.err]}>✗ Bağlantı hatası: {error}</Text>
      ) : health ? (
        <View style={styles.card}>
          <Text style={[styles.status, styles.ok]}>✓ Bağlantı başarılı</Text>
          <Text style={styles.row}>Sunucu saati ({APP_TIMEZONE}): {health.istanbul_time}</Text>
          <Text style={styles.row}>Şema sürümü: {health.schema_version}</Text>
        </View>
      ) : null}

      <Pressable style={styles.button} onPress={check}>
        <Text style={styles.buttonText}>Tekrar dene</Text>
      </Pressable>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  title: { fontSize: 28, fontWeight: '700', color: '#1F4E79' },
  subtitle: { fontSize: 15, color: '#666' },
  card: { alignItems: 'center', gap: 6 },
  status: { fontSize: 18, fontWeight: '600', textAlign: 'center' },
  ok: { color: '#2E7D32' },
  err: { color: '#C62828' },
  row: { fontSize: 14, color: '#333' },
  button: { backgroundColor: '#1F4E79', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 8 },
  buttonText: { color: '#fff', fontWeight: '600' },
});
