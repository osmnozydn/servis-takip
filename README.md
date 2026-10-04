# Servis Takip

Şirket bazlı servis aracı takip sistemi: sürücü canlı konum yayınlar, yolcu yetkili saatlerde aracı haritada görür, rota durak sırasına göre otomatik hesaplanır.

```
apps/web        React + Vite (yönetim paneli, Faz 7)
apps/mobile     Expo SDK 57 (sürücü + yolcu uygulaması)
packages/shared Ortak tipler ve sabitler
supabase/       Migration'lar ve RLS testleri
```

## Kurulum

```bash
npm install
cp apps/web/.env.example apps/web/.env          # URL + anon key girin
cp apps/mobile/.env.example apps/mobile/.env    # URL + anon key girin
```

### Veritabanı (Supabase projesine)

```bash
npx supabase login
npx supabase link --project-ref <PROJE_REF>
npx supabase db push            # supabase/migrations/* uygulanır
```

### RLS testleri

Testler tek transaction içinde çalışır ve sonunda ROLLBACK eder; veritabanında iz bırakmaz.
Önce **staging / boş bir projede** çalıştırmanız önerilir.

```bash
# Supabase Dashboard > Project Settings > Database > Connection string (URI)
DB_URL="postgresql://postgres:...@...:5432/postgres" npm run db:test
```

Beklenen çıktı: `62 testin tamamı geçti`. Giriş testleri: `supabase/tests/login.sql` (16 test).

Supabase olmadan, düz Postgres'te denemek için önce `supabase/tests/support/supabase_shim.sql`, ardından migration'ı çalıştırın (bu shim'i gerçek projede çalıştırmayın).

## Çalıştırma

```bash
npm run web       # http://localhost:5173 → "✓ Bağlantı başarılı"
```

### Mobil — development build (Expo Go kullanılmaz)

Arka planda konum (`expo-location` + `expo-task-manager`) Expo Go'da çalışmaz.

```bash
cd apps/mobile
npm i -g eas-cli && eas login
eas build --profile development --platform android   # APK'yı cihaza kurun
# iOS: eas build --profile development --platform ios  (Apple Developer hesabı gerekir)
npx expo start --dev-client                          # cihazdaki uygulamadan bağlanın
```

Alternatif (yerel, Android Studio kurulu ise): `npx expo run:android`.

## Giriş sistemi (Faz 2)

Giriş: **şirket kodu + kullanıcı adı veya telefon + şifre**.
Kullanıcıların gerçek e-postası yoktur; `public.login_email()` şirket kodu ve kullanıcı adı/telefondan
gizli bir giriş kimliği (`u-<rastgele>@servis.local`) üretir. Var olmayan kullanıcı için de aynı biçimde
bir değer döner; dışarıdan hangi kullanıcıların kayıtlı olduğu anlaşılamaz.

Akış: giriş → (ilk girişte) şifre değiştirme → KVKK aydınlatma + açık rıza → ana ekran.
KVKK metni `packages/shared/src/consent.ts` içinde **taslaktır**; canlıdan önce hukukçu kontrolü gerekir.

### Edge Function'lar

| Fonksiyon | Amaç |
|---|---|
| `admin-users` | Yönetici: kullanıcı oluşturma, şifre sıfırlama, silme (yalnızca kendi şirketinde) |
| `dev-seed` | **Geliştirme:** demo şirketlerini ve sanal kullanıcıları yeniden kurar |
| `compute-route` | Bugünkü rotayı hesaplar (Google Routes; anahtar yoksa yedek algoritma). Sürücü servise başlayınca ve yolcu devamsızlık bildirince çalışır |
| `dev-e2e` | **Geliştirme:** sanal kullanıcılarla uçtan uca test (47 test, sonuç `dev_test_runs` tablosuna) |
| `dev-sim` | **Geliştirme:** canlı konum simülasyonu (16 test, gecikme ölçümü) |

`dev-*` fonksiyonları veritabanındaki gizli anahtarla korunur ve canlıya çıkmadan önce silinecektir.
Son test çıktıları: `supabase/tests/son_e2e_ciktisi.txt`, `supabase/tests/son_simulasyon_ciktisi.txt`.

### Demo hesaplar (şifre: `Demo.2026!`)

| Şirket kodu | Kullanıcı | Rol |
|---|---|---|
| `demo` | `yonetici` | Yönetici |
| `demo` | `surucu1` (34 DMO 01), `surucu2` (34 DMO 02) | Sürücü |
| `demo` | `yolcu1` … `yolcu8` (telefonla da: 0555 000 01 01 …) | Yolcu |
| `demo-b` | `yonetici`, `surucu1`, `yolcu1` | İzolasyon testi için ikinci şirket |

## Canlı konum, rota, devamsızlık (Faz 3–6)

**Sürücü:** uygulamaya girince konum yayını otomatik başlar (arka plan görevi, Android'de kalıcı bildirim).
İnternet yoksa konumlar cihazda kuyruğa alınır. Her konum `vehicle_positions`'a yazılır; tetikleyici
`vehicle_last_positions`'ı (son görülen konum) günceller. Uygulama kapatılınca son görülen konum orada kalır.
Konum geçmişi 30 gün sonra otomatik silinir (pg_cron).

**Yolcu:** aracın konumunu yalnızca tanımlı saat aralığında görür (`my_visibility_state()`; kural RLS'de).
Kapalıyken "bir sonraki: yarın 06:30" gibi bilgi gösterilir. Kendi sırasını ve tahmini varış süresini
`my_route_info()` ile görür; diğer yolcuların durakları gizlidir.

**Rota:** `compute-route` başlangıç (sürücünün konumu) → duraklar → bitiş (aracın `end_lat/lng` noktası
veya en uzak durak). `GOOGLE_MAPS_API_KEY` sırrı tanımlanınca Google Routes API (`optimizeWaypointOrder`)
kullanılır; tanımlı değilse en yakın komşu + 2-opt yedek algoritması çalışır.

**Devamsızlık:** yolcu "Bugün kullanmayacağım" deyince durak bugünkü rotadan saniyeler içinde çıkar
(veritabanı tetikleyicisi → `compute-route`); geri alınca tekrar eklenir.

**Harita:** şimdilik Leaflet + OpenStreetMap (anahtarsız). Canlıdan önce Google Maps'e geçilecek.

## Şema özeti (Faz 1)

| Tablo | Açıklama |
|---|---|
| `companies` | Şirket; `code` giriş ekranında kullanılır |
| `profiles` | Kullanıcı (admin / driver / passenger), `vehicle_id` = atandığı servis |
| `vehicles` | Araç (plaka) |
| `stops` | Yolcu başına bir durak |
| `visibility_windows` | Yolcuların konumu görebildiği gün + saat aralıkları (İstanbul saati) |
| `absences` | "Bugün kullanmayacağım" kayıtları |
| `vehicle_positions` | Konum geçmişi (sürücü yazar) |
| `vehicle_last_positions` | Aracın son görüldüğü konum (tetikleyiciyle güncellenir) |

Yetki kuralları:

- Her kullanıcı yalnızca kendi şirketinin satırlarını görür; alt kayıtlar bileşik FK ile başka şirketin kaydına bağlanamaz, `company_id` değiştirilemez.
- **Admin:** şirketindeki her şey. **Sürücü:** kendi aracı, o aracın yolcuları ve durakları. **Yolcu:** kendisi, durağı, sürücüsü ve aracı.
- **Konum:** admin ve sürücü her zaman görür. Yolcu yalnızca kendi aracı için tanımlı pencere **şu an açıksa** görür (son 15 dk geçmiş + son konum). Kontrol sunucuda RLS ile yapılır, Realtime yayınında da her mesajda uygulanır.
