// Sürücü canlı konum yayını
//
// - Arka planda çalışan bir konum görevi (TaskManager) konumları toplu olarak
//   vehicle_positions tablosuna yazar; "son görülen konum" veritabanında
//   tetikleyiciyle güncellenir.
// - İnternet yoksa konumlar cihazda kuyruğa alınır, bağlantı gelince gönderilir
//   (en fazla MAX_QUEUE kayıt; sunucu 24 saatten eskileri zaten kabul etmez).
// - Android'de kalıcı bildirim (foreground service) zorunludur. Uygulama
//   kaydırılıp kapatılınca yayın da durur (killServiceOnDestroy) → son görülen
//   konum, uygulamanın kapatıldığı yer olur.
//
// ÖNEMLİ: Bu dosya index.ts'te uygulama başlamadan önce import edilir; görev
// tanımı modül seviyesinde olmalıdır (uygulama arka planda uyandırıldığında da).
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { supabase } from '../lib/supabase';

export const LOCATION_TASK = 'servis-location-task';
const QUEUE_KEY = 'pos_queue_v1';
const VEHICLE_KEY = 'tracking_vehicle_id';
const STATUS_KEY = 'tracking_status_v1';
const MAX_QUEUE = 1000;

type Row = { vehicle_id: string; lat: number; lng: number; heading: number | null; speed: number | null; accuracy: number | null; recorded_at: string };

export interface TrackingStatus {
  lastSentAt: string | null;   // son başarılı gönderim
  lastFixAt: string | null;    // son alınan GPS konumu
  sentCount: number;
  queued: number;
  lastError: string | null;
}

let status: TrackingStatus = { lastSentAt: null, lastFixAt: null, sentCount: 0, queued: 0, lastError: null };
const listeners = new Set<(s: TrackingStatus) => void>();

function setStatus(patch: Partial<TrackingStatus>) {
  status = { ...status, ...patch };
  listeners.forEach((l) => l(status));
  AsyncStorage.setItem(STATUS_KEY, JSON.stringify(status)).catch(() => {});
}

export function subscribeStatus(fn: (s: TrackingStatus) => void) {
  listeners.add(fn);
  fn(status);
  AsyncStorage.getItem(STATUS_KEY).then((v) => {
    if (v && !status.lastSentAt) { status = { ...JSON.parse(v), ...status, sentCount: status.sentCount }; fn(status); }
  }).catch(() => {});
  return () => { listeners.delete(fn); };
}

async function readQueue(): Promise<Row[]> {
  try { return JSON.parse((await AsyncStorage.getItem(QUEUE_KEY)) ?? '[]'); } catch { return []; }
}
async function writeQueue(rows: Row[]) {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(rows.slice(-MAX_QUEUE)));
}

/** Yeni konumları + kuyruktakileri göndermeyi dener. */
export async function sendPositions(fresh: Row[]) {
  const queue = await readQueue();
  // 24 saatten eski kayıtları at (sunucu reddeder)
  const cutoff = Date.now() - 23.5 * 3600_000;
  const all = [...queue, ...fresh].filter((r) => Date.parse(r.recorded_at) > cutoff);
  if (all.length === 0) return;

  // Arka planda token süresi dolmuş olabilir: getSession gerekirse yeniler
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    await writeQueue(all);
    setStatus({ queued: all.length, lastError: 'Oturum yok' });
    return;
  }

  const { error } = await supabase.from('vehicle_positions').insert(all.slice(0, 200));
  if (error) {
    await writeQueue(all);
    setStatus({ queued: Math.min(all.length, MAX_QUEUE), lastError: error.message });
  } else {
    await writeQueue(all.slice(200));
    setStatus({
      lastSentAt: new Date().toISOString(),
      sentCount: status.sentCount + Math.min(all.length, 200),
      queued: Math.max(0, all.length - 200),
      lastError: null,
    });
  }
}

TaskManager.defineTask<{ locations: Location.LocationObject[] }>(LOCATION_TASK, async ({ data, error }) => {
  if (error) { setStatus({ lastError: error.message }); return; }
  const locations = data?.locations ?? [];
  if (locations.length === 0) return;
  const vehicleId = await AsyncStorage.getItem(VEHICLE_KEY);
  if (!vehicleId) return;
  const rows: Row[] = locations.map((l) => ({
    vehicle_id: vehicleId,
    lat: l.coords.latitude,
    lng: l.coords.longitude,
    heading: l.coords.heading != null && l.coords.heading >= 0 ? l.coords.heading : null,
    speed: l.coords.speed != null && l.coords.speed >= 0 ? l.coords.speed : null,
    accuracy: l.coords.accuracy ?? null,
    recorded_at: new Date(l.timestamp).toISOString(),
  }));
  setStatus({ lastFixAt: rows[rows.length - 1].recorded_at });
  await sendPositions(rows);
});

export type PermissionResult = 'granted' | 'foreground_only' | 'denied' | 'services_off';

export async function ensurePermissions(): Promise<PermissionResult> {
  if (!(await Location.hasServicesEnabledAsync())) return 'services_off';
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') return 'denied';
  const bg = await Location.requestBackgroundPermissionsAsync();
  return bg.status === 'granted' ? 'granted' : 'foreground_only';
}

export async function isTracking() {
  try { return await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK); } catch { return false; }
}

export async function startTracking(vehicleId: string) {
  await AsyncStorage.setItem(VEHICLE_KEY, vehicleId);
  if (await isTracking()) return;
  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: Location.Accuracy.High,
    timeInterval: 5000,          // Android: en sık 5 sn'de bir
    distanceInterval: 10,        // en az 10 m hareket
    deferredUpdatesInterval: 5000,
    pausesUpdatesAutomatically: false,
    activityType: Location.ActivityType.AutomotiveNavigation,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'Servis Takip',
      notificationBody: 'Konumunuz servis yolcularıyla paylaşılıyor',
      notificationColor: '#1F4E79',
      killServiceOnDestroy: true,
    },
  });
}

export async function stopTracking() {
  if (await isTracking()) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  await AsyncStorage.removeItem(VEHICLE_KEY);
}
