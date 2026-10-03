import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useRef, useState } from 'react';
import { type TextInput } from 'react-native';
import { signIn } from '@servis/shared';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthProvider';
import { Brand, Button, Card, ErrorBox, Field, Screen } from '../ui/components';

const LAST_CODE_KEY = 'last_company_code';

export function LoginScreen() {
  const { refresh } = useAuth();
  const [code, setCode] = useState('');
  const [ident, setIdent] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const identRef = useRef<TextInput>(null);
  const pwRef = useRef<TextInput>(null);

  // Şirket kodunu hatırla: bir sonraki girişte tekrar yazılmasın
  useEffect(() => {
    AsyncStorage.getItem(LAST_CODE_KEY).then((v) => { if (v) setCode(v); }).catch(() => {});
  }, []);

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await signIn(supabase, code, ident, password);
    if (res.ok) {
      AsyncStorage.setItem(LAST_CODE_KEY, code.trim().toLowerCase()).catch(() => {});
      await refresh();
    } else {
      setError(res.message);
      setPassword('');
    }
    setBusy(false);
  }

  return (
    <Screen>
      <Brand subtitle="Servis aracınızı canlı takip edin" />
      <Card>
        <ErrorBox message={error} />
        <Field
          label="Şirket kodu"
          value={code}
          onChangeText={setCode}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="örn. demo"
          returnKeyType="next"
          onSubmitEditing={() => identRef.current?.focus()}
        />
        <Field
          ref={identRef}
          label="Kullanıcı adı veya telefon"
          value={ident}
          onChangeText={setIdent}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="örn. yolcu1 veya 0555 000 01 01"
          returnKeyType="next"
          onSubmitEditing={() => pwRef.current?.focus()}
        />
        <Field
          ref={pwRef}
          label="Şifre"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          returnKeyType="go"
          onSubmitEditing={submit}
        />
        <Button title="Giriş yap" onPress={submit} loading={busy} />
      </Card>
    </Screen>
  );
}
