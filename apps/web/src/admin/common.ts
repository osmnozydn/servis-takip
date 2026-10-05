// Yönetim paneli ortak yardımcıları
import { supabase } from '../lib/supabase';

/** Edge Function çağrısı; hata mesajını sunucunun Türkçe mesajından alır */
export async function callFn<T = Record<string, unknown>>(name: string, body: Record<string, unknown>): Promise<{ ok: true; data: T } | { ok: false; message: string }> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (!error) return { ok: true, data: data as T };
  let message = 'İşlem tamamlanamadı. Tekrar deneyin.';
  const ctx = (error as { context?: Response }).context;
  if (ctx && typeof ctx.json === 'function') {
    try { const j = await ctx.json(); if (j?.error) message = j.error; } catch { /* yoksay */ }
  }
  return { ok: false, message };
}

const TR_MAP: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', i: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' };
/** "Ayşe Yılmaz" → "ayse.yilmaz" */
export function slugUsername(fullName: string): string {
  const s = fullName.toLocaleLowerCase('tr-TR').split('').map((c) => TR_MAP[c] ?? c).join('')
    .replace(/[^a-z0-9\s.-]/g, '').trim().split(/\s+/).filter(Boolean);
  if (!s.length) return '';
  const name = s.length > 1 ? `${s[0]}.${s[s.length - 1]}` : s[0];
  return name.slice(0, 32);
}
/** "Demo Servis A.Ş." → "demo-servis" (şirket kodu) */
export function slugCode(name: string): string {
  return name.toLocaleLowerCase('tr-TR').split('').map((c) => TR_MAP[c] ?? c).join('')
    .replace(/\b(a\.?s\.?|ltd\.?|sti\.?|san\.?|tic\.?)\b/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
}

/** Okunması kolay geçici şifre: en az bir harf + rakam, karışabilecek karakterler yok */
export function genPassword(): string {
  const L = 'abcdefghjkmnpqrstuvwxyz', U = 'ABCDEFGHJKLMNPQRSTUVWXYZ', D = '23456789';
  const r = (s: string) => s[crypto.getRandomValues(new Uint32Array(1))[0] % s.length];
  return r(U) + r(L) + r(L) + r(L) + r(D) + r(D) + r(D) + r(D) + r(L) + r(U);
}

export type OwnerType = 'driver' | 'vehicle';
export type DocType =
  | 'driver_photo' | 'license' | 'src' | 'psychotechnic' | 'criminal_record'
  | 'vehicle_photo' | 'registration' | 'insurance' | 'inspection' | 'other';

export const DOC_LABEL: Record<DocType, string> = {
  driver_photo: 'Sürücü fotoğrafı', license: 'Ehliyet', src: 'SRC belgesi', psychotechnic: 'Psikoteknik raporu',
  criminal_record: 'Adli sicil kaydı', vehicle_photo: 'Araç fotoğrafı', registration: 'Ruhsat',
  insurance: 'Sigorta / kasko', inspection: 'Muayene', other: 'Diğer',
};
/** Son geçerlilik tarihi sorulan belgeler */
export const DOC_HAS_EXPIRY: Partial<Record<DocType, boolean>> = {
  license: true, src: true, psychotechnic: true, insurance: true, inspection: true, criminal_record: true,
};
export const DRIVER_DOCS: DocType[] = ['driver_photo', 'license', 'src', 'psychotechnic', 'criminal_record', 'other'];
export const VEHICLE_DOCS: DocType[] = ['vehicle_photo', 'registration', 'insurance', 'inspection', 'other'];
export const isPhotoType = (t: DocType) => t === 'driver_photo' || t === 'vehicle_photo';

export type DocRow = {
  id: string; owner_type: OwnerType; owner_id: string; doc_type: DocType; title: string | null;
  file_path: string; mime_type: string | null; size_bytes: number | null; expires_on: string | null; created_at: string;
};
export const DOC_COLUMNS = 'id, owner_type, owner_id, doc_type, title, file_path, mime_type, size_bytes, expires_on, created_at';

export const MAX_FILE_MB = 10;
export const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,application/pdf';

/** Dosyayı Storage'a yükler ve belge kaydını oluşturur */
export async function uploadDocument(
  companyId: string, ownerType: OwnerType, ownerId: string, docType: DocType, file: File, expiresOn?: string | null, title?: string | null,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (file.size > MAX_FILE_MB * 1024 * 1024) return { ok: false, message: `${file.name}: dosya ${MAX_FILE_MB} MB'tan büyük olamaz.` };
  if (file.type && !ACCEPT.split(',').includes(file.type)) return { ok: false, message: `${file.name}: yalnızca fotoğraf (JPG, PNG, WEBP, HEIC) veya PDF yüklenebilir.` };
  const ext = (file.name.split('.').pop() ?? 'bin').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'bin';
  const path = `${companyId}/${ownerType}/${ownerId}/${crypto.randomUUID()}.${ext}`;
  const up = await supabase.storage.from('documents').upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (up.error) return { ok: false, message: `${file.name}: yüklenemedi (${up.error.message}).` };
  const { error } = await supabase.from('documents').insert({
    owner_type: ownerType, owner_id: ownerId, doc_type: docType, file_path: path,
    mime_type: file.type || null, size_bytes: file.size, expires_on: expiresOn || null, title: title || null,
  });
  if (error) { await supabase.storage.from('documents').remove([path]); return { ok: false, message: `${file.name}: kaydedilemedi.` }; }
  return { ok: true };
}

export async function deleteDocument(doc: Pick<DocRow, 'id' | 'file_path'>) {
  await supabase.storage.from('documents').remove([doc.file_path]);
  const { error } = await supabase.from('documents').delete().eq('id', doc.id);
  return !error;
}

/** Bir sahibin (araç) tüm belgelerini siler — araç silinmeden önce */
export async function deleteOwnerDocuments(ownerType: OwnerType, ownerId: string) {
  const { data } = await supabase.from('documents').select('id, file_path').eq('owner_type', ownerType).eq('owner_id', ownerId);
  if (data?.length) {
    await supabase.storage.from('documents').remove(data.map((d) => d.file_path));
    await supabase.from('documents').delete().in('id', data.map((d) => d.id));
  }
}

export async function signedUrls(paths: string[]): Promise<Record<string, string>> {
  if (!paths.length) return {};
  const { data } = await supabase.storage.from('documents').createSignedUrls(paths, 3600);
  const out: Record<string, string> = {};
  for (const d of data ?? []) if (d.signedUrl && d.path) out[d.path] = d.signedUrl;
  return out;
}

export function daysUntil(date: string | null): number | null {
  if (!date) return null;
  const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Istanbul' }));
  today.setHours(0, 0, 0, 0);
  return Math.round((new Date(date + 'T00:00:00').getTime() - today.getTime()) / 86400000);
}
export function fmtDay(date: string | null) {
  if (!date) return '—';
  const [y, m, d] = date.split('-');
  return `${d}.${m}.${y}`;
}

export const LICENSE_CLASSES = ['B', 'BE', 'C1', 'C', 'CE', 'D1', 'D', 'DE'];
export const WEEKDAYS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];

export type VehicleRow = {
  id: string; plate: string; name: string | null; brand_model: string | null; color: string | null; capacity: number | null;
  route_mode: 'auto' | 'manual'; end_lat: number | null; end_lng: number | null; end_label: string | null;
};
export const VEHICLE_COLUMNS = 'id, plate, name, brand_model, color, capacity, route_mode, end_lat, end_lng, end_label';

export type PersonRow = {
  id: string; role: 'admin' | 'driver' | 'passenger'; username: string; full_name: string; phone: string | null;
  vehicle_id: string | null; license_no: string | null; license_class: string | null; license_expires_on: string | null;
  must_change_password: boolean; created_at: string;
};
export const PERSON_COLUMNS = 'id, role, username, full_name, phone, vehicle_id, license_no, license_class, license_expires_on, must_change_password, created_at';

/** Telefonu sunucunun beklediği biçime çevirir: 0555 000 01 01 → +905550000101 */
export function normalizePhone(p: string): string | null {
  const d = p.replace(/\D/g, '');
  if (!d) return null;
  if (d.length === 10 && d.startsWith('5')) return '+90' + d;
  if (d.length === 11 && d.startsWith('05')) return '+9' + d;
  if (d.length === 12 && d.startsWith('90')) return '+' + d;
  return d.length >= 10 && d.length <= 15 ? '+' + d : null;
}

export function pgError(e: { code?: string; message?: string } | null, fallback = 'Kaydedilemedi.'): string {
  if (!e) return fallback;
  if (e.code === '23505') return /plate/.test(e.message ?? '') ? 'Bu plaka şirketinizde zaten kayıtlı.' : /phone/.test(e.message ?? '') ? 'Bu telefon numarası şirketinizde zaten kayıtlı.' : 'Bu kayıt zaten var.';
  if (e.code === '23514') return 'Girilen bilgilerden biri geçersiz. Lütfen kontrol edin.';
  if (e.code === '42501') return 'Bu işlem için yetkiniz yok.';
  return fallback;
}

/** Google/OSRM "encoded polyline" (hassasiyet 5) → [enlem, boylam] listesi */
export function decodePolyline(s: string | null | undefined): [number, number][] {
  if (!s) return [];
  const out: [number, number][] = [];
  let i = 0, lat = 0, lng = 0;
  while (i < s.length) {
    for (let k = 0; k < 2; k++) {
      let r = 0, sh = 0, b: number;
      do { b = s.charCodeAt(i++) - 63; r |= (b & 31) << sh; sh += 5; } while (b >= 32 && i < s.length);
      const v = r & 1 ? ~(r >> 1) : r >> 1;
      if (k === 0) lat += v; else lng += v;
    }
    out.push([lat / 1e5, lng / 1e5]);
  }
  return out;
}
export const fmtKm = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} km`);
export const fmtMin = (s: number) => {
  const m = Math.max(1, Math.round(s / 60));
  return m < 60 ? `${m} dk` : `${Math.floor(m / 60)} sa ${m % 60 ? `${m % 60} dk` : ''}`.trim();
};
