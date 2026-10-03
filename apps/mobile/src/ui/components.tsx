import { forwardRef, type ReactNode } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View, type TextInputProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, radius, space } from './theme';

export function Screen({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  const body = scroll ? (
    <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">{children}</ScrollView>
  ) : <View style={styles.scroll}>{children}</View>;
  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {body}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function Brand({ subtitle }: { subtitle?: string }) {
  return (
    <View style={styles.brand}>
      <View style={styles.logo}><Text style={styles.logoText}>S</Text></View>
      <Text style={styles.brandTitle}>Servis Takip</Text>
      {subtitle ? <Text style={styles.brandSub}>{subtitle}</Text> : null}
    </View>
  );
}

export function Card({ children }: { children: ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

type FieldProps = TextInputProps & { label: string; hint?: string };
export const Field = forwardRef<TextInput, FieldProps>(({ label, hint, style, ...rest }, ref) => (
  <View style={{ marginBottom: space(4) }}>
    <Text style={styles.label}>{label}</Text>
    <TextInput
      ref={ref}
      placeholderTextColor={colors.muted}
      style={[styles.input, style]}
      {...rest}
    />
    {hint ? <Text style={styles.hint}>{hint}</Text> : null}
  </View>
));

export function Button({ title, onPress, loading, disabled, variant = 'primary' }: {
  title: string; onPress: () => void; loading?: boolean; disabled?: boolean; variant?: 'primary' | 'ghost';
}) {
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={off}
      style={({ pressed }) => [
        variant === 'primary' ? styles.btn : styles.btnGhost,
        off && { opacity: 0.5 },
        pressed && !off && { opacity: 0.85 },
      ]}
    >
      {loading
        ? <ActivityIndicator color={variant === 'primary' ? '#fff' : colors.primary} />
        : <Text style={variant === 'primary' ? styles.btnText : styles.btnGhostText}>{title}</Text>}
    </Pressable>
  );
}

export function ErrorBox({ message }: { message: string | null }) {
  if (!message) return null;
  return <View style={styles.error}><Text style={styles.errorText}>{message}</Text></View>;
}

export function Checkbox({ checked, onToggle, label }: { checked: boolean; onToggle: () => void; label: string }) {
  return (
    <Pressable onPress={onToggle} style={styles.checkRow} accessibilityRole="checkbox" accessibilityState={{ checked }}>
      <View style={[styles.box, checked && styles.boxOn]}>{checked ? <Text style={styles.tick}>✓</Text> : null}</View>
      <Text style={styles.checkLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { flexGrow: 1, padding: space(5), justifyContent: 'center' },
  brand: { alignItems: 'center', marginBottom: space(6) },
  logo: { width: 64, height: 64, borderRadius: 18, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 5, borderBottomColor: colors.accent },
  logoText: { color: '#fff', fontSize: 32, fontWeight: '800' },
  brandTitle: { marginTop: space(3), fontSize: 26, fontWeight: '800', color: colors.primary },
  brandSub: { marginTop: space(1), fontSize: 15, color: colors.muted, textAlign: 'center' },
  card: { backgroundColor: colors.card, borderRadius: radius, padding: space(5), shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  label: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: space(1.5) },
  hint: { fontSize: 12, color: colors.muted, marginTop: space(1) },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: space(3.5), paddingVertical: space(3), fontSize: 16, color: colors.text, backgroundColor: '#fff' },
  btn: { backgroundColor: colors.primary, borderRadius: 10, paddingVertical: space(3.5), alignItems: 'center', marginTop: space(2) },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  btnGhost: { borderRadius: 10, paddingVertical: space(3), alignItems: 'center', marginTop: space(2), borderWidth: 1, borderColor: colors.border, backgroundColor: '#fff' },
  btnGhostText: { color: colors.primary, fontSize: 15, fontWeight: '600' },
  error: { backgroundColor: colors.dangerBg, borderRadius: 8, padding: space(3), marginBottom: space(4) },
  errorText: { color: colors.danger, fontSize: 14 },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space(3), marginVertical: space(3) },
  box: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  boxOn: { backgroundColor: colors.primary },
  tick: { color: '#fff', fontWeight: '800' },
  checkLabel: { flex: 1, fontSize: 14, color: colors.text, lineHeight: 20 },
});
