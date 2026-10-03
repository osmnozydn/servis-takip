import { useState } from 'react';
import { Text } from 'react-native';
import { changePassword, MIN_PASSWORD_LENGTH, validateNewPassword } from '@servis/shared';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthProvider';
import { Brand, Button, Card, ErrorBox, Field, Screen } from '../ui/components';
import { colors } from '../ui/theme';

export function ChangePasswordScreen() {
  const { profile, refresh, signOut } = useAuth();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const v = validateNewPassword(pw, pw2);
    if (v) { setError(v); return; }
    setBusy(true);
    setError(null);
    const res = await changePassword(supabase, profile!.id, pw);
    if (!res.ok) setError(res.message);
    else await refresh();
    setBusy(false);
  }

  return (
    <Screen>
      <Brand subtitle={`Hoş geldiniz, ${profile?.full_name ?? ''}`} />
      <Card>
        <Text style={{ fontSize: 15, color: colors.text, marginBottom: 16, lineHeight: 21 }}>
          Güvenliğiniz için, yöneticinizin verdiği geçici şifreyi kendi belirleyeceğiniz bir şifreyle değiştirin.
        </Text>
        <ErrorBox message={error} />
        <Field label="Yeni şifre" value={pw} onChangeText={setPw} secureTextEntry autoCapitalize="none"
          hint={`En az ${MIN_PASSWORD_LENGTH} karakter, en az bir harf ve bir rakam`} />
        <Field label="Yeni şifre (tekrar)" value={pw2} onChangeText={setPw2} secureTextEntry autoCapitalize="none"
          onSubmitEditing={submit} />
        <Button title="Şifreyi kaydet" onPress={submit} loading={busy} />
        <Button title="Çıkış yap" variant="ghost" onPress={signOut} />
      </Card>
    </Screen>
  );
}
