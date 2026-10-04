// Ortak giriş mantığı (web + mobil aynı akışı kullanır)
//
// Akış: giriş → (ilk girişse) şifre değiştir → (rıza yoksa/eskiyse) KVKK rızası → ana ekran
import type { SupabaseClient } from '@supabase/supabase-js';
import { CONSENT_VERSION } from './consent';
import type { UserRole } from './index';

export const LOGIN_ERROR_MESSAGE = 'Şirket kodu, kullanıcı adı/telefon veya şifre hatalı.';
export const MIN_PASSWORD_LENGTH = 8;

export interface SessionProfile {
  id: string;
  role: UserRole;
  username: string;
  full_name: string;
  phone: string | null;
  must_change_password: boolean;
  consent_version: string | null;
  /** Platform yöneticisi: şirket açar, istediği şirkete girip yönetici gibi çalışır */
  is_platform_admin: boolean;
  /** Platform yöneticisi için: o an girdiği şirket (yoksa null) */
  company: { id: string; name: string; code: string } | null;
  vehicle: { id: string; plate: string; name: string | null } | null;
}

/** Platform yöneticilerinin giriş ekranında yazdığı şirket kodu */
export const PLATFORM_CODE = 'platform';

/** Bir sonraki ekran */
export type AuthStep = 'login' | 'change_password' | 'consent' | 'home';

export function nextStep(profile: SessionProfile | null): AuthStep {
  if (!profile) return 'login';
  if (profile.must_change_password) return 'change_password';
  if (!profile.is_platform_admin && profile.consent_version !== CONSENT_VERSION) return 'consent';
  return 'home';
}

/** Şirket kodu + kullanıcı adı/telefon + şifre ile giriş */
export async function signIn(
  supabase: SupabaseClient,
  companyCode: string,
  identifier: string,
  password: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!companyCode.trim() || !identifier.trim() || !password) {
    return { ok: false, message: 'Lütfen tüm alanları doldurun.' };
  }
  const { data: email, error: rpcErr } = await supabase.rpc('login_email', {
    p_company_code: companyCode,
    p_identifier: identifier,
  });
  if (rpcErr || typeof email !== 'string') {
    return { ok: false, message: 'Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edin.' };
  }
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    const tooMany = error.status === 429 || /rate limit/i.test(error.message);
    return { ok: false, message: tooMany ? 'Çok fazla deneme yapıldı. Birkaç dakika sonra tekrar deneyin.' : LOGIN_ERROR_MESSAGE };
  }
  return { ok: true };
}

/** Giriş yapmış kullanıcının profili (şirket ve araç bilgisiyle) */
export async function loadProfile(supabase: SupabaseClient): Promise<SessionProfile | null> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data, error } = await supabase.rpc('my_session');
  if (error || !data) return null;
  return data as unknown as SessionProfile;
}

export function validateNewPassword(pw: string, repeat: string): string | null {
  if (pw.length < MIN_PASSWORD_LENGTH) return `Şifre en az ${MIN_PASSWORD_LENGTH} karakter olmalı.`;
  if (!/[A-Za-zÇĞİÖŞÜçğıöşü]/.test(pw) || !/[0-9]/.test(pw)) return 'Şifre en az bir harf ve bir rakam içermeli.';
  if (pw !== repeat) return 'Şifreler birbirini tutmuyor.';
  return null;
}

export async function changePassword(supabase: SupabaseClient, userId: string, newPassword: string) {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) {
    const same = /different from the old/i.test(error.message);
    return { ok: false as const, message: same ? 'Yeni şifre eskisinden farklı olmalı.' : 'Şifre değiştirilemedi. Tekrar deneyin.' };
  }
  void userId;
  await supabase.rpc('mark_password_changed');
  return { ok: true as const };
}

export async function acceptConsent(supabase: SupabaseClient, userId: string) {
  const { error } = await supabase
    .from('profiles')
    .update({ consent_version: CONSENT_VERSION, consent_at: new Date().toISOString() })
    .eq('id', userId);
  return !error;
}

/** +905550000101 → +90 555 000 01 01 (TR cep); diğerleri olduğu gibi */
export function formatPhone(p: string | null | undefined): string {
  if (!p) return '—';
  const m = /^\+90(\d{3})(\d{3})(\d{2})(\d{2})$/.exec(p);
  return m ? `+90 ${m[1]} ${m[2]} ${m[3]} ${m[4]}` : p;
}

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Yönetici',
  driver: 'Sürücü',
  passenger: 'Yolcu',
};
