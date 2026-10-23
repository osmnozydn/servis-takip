// Bildirimler
//
// 1) Push (uygulama kapalıyken de gelir): Expo push token alınır ve sunucuya kaydedilir
//    (register_push_token). Sunucu, "Aracınız yola çıktı" / "Servis başladı" gibi
//    bildirimleri send-push fonksiyonu ile bu token'a gönderir.
//    Android'de push için projeye Firebase (FCM) anahtarı tanımlanmış olmalı; yoksa
//    token alınamaz ve 2. yol devreye girer.
// 2) Uygulama içi (yedek): uygulama açıkken bildirim tablosu canlı dinlenir ve telefonda
//    yerel bildirim gösterilir. Push çalışıyorsa çift bildirim olmasın diye kapanır.
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { supabase } from '../lib/supabase';

const TOKEN_KEY = 'push_token_v1';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

async function ensureChannels() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('servis', {
    name: 'Servis aracım', description: 'Aracınız yola çıktığında haber verir',
    importance: Notifications.AndroidImportance.HIGH, vibrationPattern: [0, 250, 150, 250], lightColor: '#F2A900',
  });
  await Notifications.setNotificationChannelAsync('operasyon', {
    name: 'Operasyon', description: 'Servis başladı / tamamlandı bildirimleri',
    importance: Notifications.AndroidImportance.HIGH, lightColor: '#1F4E79',
  });
}

export type PushResult = 'ok' | 'denied' | 'unavailable';
let pushOk = false;

/** İzin ister, token alır ve sunucuya kaydeder. Hata olursa uygulama içi bildirimle devam edilir. */
export async function registerForPush(): Promise<PushResult> {
  if (Platform.OS === 'web') return 'unavailable';
  try {
    await ensureChannels();
    let perm = await Notifications.getPermissionsAsync();
    if (!perm.granted && perm.canAskAgain) perm = await Notifications.requestPermissionsAsync();
    const iosOk = perm.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
    if (!perm.granted && !iosOk) return 'denied';
    if (!Device.isDevice && Platform.OS === 'ios') return 'unavailable'; // iOS simülatörü push almaz
    const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    const { data: saved } = await supabase.rpc('register_push_token', { p_token: token, p_platform: Platform.OS });
    if (saved !== true) return 'unavailable';
    await AsyncStorage.setItem(TOKEN_KEY, token);
    pushOk = true;
    return 'ok';
  } catch (e) {
    console.warn('push kaydı yapılamadı (uygulama içi bildirim kullanılacak)', e);
    pushOk = false;
    return 'unavailable';
  }
}

/** Çıkışta bu cihazı kullanıcıdan ayır (başkası girerse ona bildirim gitmesin). */
export async function unregisterPush() {
  try {
    const token = await AsyncStorage.getItem(TOKEN_KEY);
    if (token) await supabase.rpc('unregister_push_token', { p_token: token });
    await AsyncStorage.removeItem(TOKEN_KEY);
  } catch { /* yoksay */ }
  pushOk = false;
}

type Note = { id: number; kind: string; title: string; body: string };

/** Giriş yapmış kullanıcının bildirimlerini dinler; push yoksa telefonda yerel bildirim gösterir. */
export function useNotifications(userId: string | null | undefined, onNote?: (n: Note) => void) {
  useEffect(() => {
    if (!userId) return;
    void registerForPush();
    const ch = supabase.channel(`notes-${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${userId}` }, (p) => {
        const n = p.new as Note;
        onNote?.(n);
        if (pushOk) return; // push zaten gelecek
        void Notifications.scheduleNotificationAsync({
          content: { title: n.title, body: n.body, data: { kind: n.kind, notification_id: n.id } },
          trigger: Platform.OS === 'android' ? { channelId: n.kind === 'bus_departed' ? 'servis' : 'operasyon' } : null,
        }).catch(() => {});
      }).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps
}
