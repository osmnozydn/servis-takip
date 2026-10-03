import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { acceptConsent, consentCheckboxLabel, consentSections } from '@servis/shared';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthProvider';
import { Button, Card, Checkbox, ErrorBox, Screen } from '../ui/components';
import { colors } from '../ui/theme';

export function ConsentScreen() {
  const { profile, refresh, signOut } = useAuth();
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!profile) return null;

  async function accept() {
    setBusy(true);
    setError(null);
    if (await acceptConsent(supabase, profile!.id)) await refresh();
    else setError('Kaydedilemedi. Tekrar deneyin.');
    setBusy(false);
  }

  return (
    <Screen>
      <Text style={styles.title}>Kişisel Verilerin Korunması</Text>
      <Text style={styles.sub}>KVKK Aydınlatma Metni ve Açık Rıza</Text>
      <Card>
        {consentSections(profile.role).map((s) => (
          <View key={s.title} style={{ marginBottom: 14 }}>
            <Text style={styles.h}>{s.title}</Text>
            <Text style={styles.p}>{s.body}</Text>
          </View>
        ))}
        <ErrorBox message={error} />
        <Checkbox checked={checked} onToggle={() => setChecked(!checked)} label={consentCheckboxLabel(profile.role)} />
        <Button title="Onayla ve devam et" onPress={accept} disabled={!checked} loading={busy} />
        <Button title="Onaylamıyorum, çıkış yap" variant="ghost" onPress={signOut} />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 22, fontWeight: '800', color: colors.primary, marginBottom: 4 },
  sub: { fontSize: 14, color: colors.muted, marginBottom: 16 },
  h: { fontSize: 15, fontWeight: '700', color: colors.text, marginBottom: 4 },
  p: { fontSize: 14, color: colors.text, lineHeight: 20 },
});
