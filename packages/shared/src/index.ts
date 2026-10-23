// Web ve mobil uygulamaların ortak kullandığı tipler ve sabitler.
// Veritabanı tipleri Faz 2'de `supabase gen types typescript` ile
// otomatik üretilip database.types.ts olarak buraya eklenecek.

export const APP_TIMEZONE = 'Europe/Istanbul';

export type UserRole = 'admin' | 'operator' | 'driver' | 'passenger';

/** Yönetim paneli kullanıcıları (yönetici + operasyon sorumlusu) */
export const isStaffRole = (r: UserRole | null | undefined) => r === 'admin' || r === 'operator';

export interface Company {
  id: string;
  code: string;
  name: string;
}

export interface Profile {
  id: string;
  company_id: string;
  role: UserRole;
  username: string;
  phone: string | null;
  full_name: string;
  vehicle_id: string | null;
  consent_version: string | null;
  consent_at: string | null;
  must_change_password: boolean;
}

export interface Vehicle {
  id: string;
  company_id: string;
  plate: string;
  name: string | null;
}

/** Aracın son canlı görüldüğü konum (uygulama kapansa da kalır). */
export interface VehicleLastPosition {
  vehicle_id: string;
  company_id: string;
  lat: number;
  lng: number;
  heading: number | null;
  speed: number | null;
  recorded_at: string;
}

export interface VehiclePosition {
  id: number;
  company_id: string;
  vehicle_id: string;
  driver_id: string;
  lat: number;
  lng: number;
  heading: number | null;
  speed: number | null;
  accuracy: number | null;
  recorded_at: string;
}

export interface Stop {
  id: string;
  company_id: string;
  passenger_id: string;
  vehicle_id: string;
  lat: number;
  lng: number;
  address: string | null;
}

/** ISO gün numarası: 1 = Pazartesi … 7 = Pazar */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface VisibilityWindow {
  id: string;
  company_id: string;
  vehicle_id: string;
  weekday: IsoWeekday;
  start_time: string; // "07:00:00"
  end_time: string;   // "09:00:00"
}

export interface Absence {
  id: string;
  company_id: string;
  passenger_id: string;
  date: string; // "2026-10-05"
}

export * from './auth';
export * from './consent';
