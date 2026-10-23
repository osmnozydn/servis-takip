# READY LIVE

Şirket bazlı servis aracı takip sistemi: sürücü canlı konum yayınlar, yolcu yetkili saatlerde aracı haritada görür, rota durak sırasına göre otomatik hesaplanır.

```
apps/web        React + Vite (yönetim paneli)
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

Test dosyaları: `rls_isolation.sql` (62), `login.sql` (16), `live_location.sql` (9), `routes.sql` (10), `trips.sql` (26), `admin_panel.sql` (36).

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
| `admin-users` | Yönetici: kullanıcı oluşturma (sürücüde ehliyet bilgisi, yolcuda durak), şifre sıfırlama, silme (sürücünün belgeleriyle) — yalnızca kendi şirketinde |
| `platform-admin` | Platform yöneticisi: yeni şirket + ilk şirket yöneticisini açma, şirket bilgisi güncelleme |
| `dev-seed` | **Geliştirme:** demo şirketlerini ve sanal kullanıcıları yeniden kurar |
| `compute-route` | Bugünkü rotayı hesaplar (Google Routes; anahtar yoksa yedek algoritma). Sürücü servise başlayınca ve yolcu devamsızlık bildirince çalışır |
| `dev-e2e` | **Geliştirme:** sanal kullanıcılarla uçtan uca test (47 test, sonuç `dev_test_runs` tablosuna) |
| `dev-sim` | **Geliştirme:** canlı konum simülasyonu (16 test, gecikme ölçümü) |
| `dev-admin` | **Geliştirme:** yönetim paneli uçtan uca testi — şirket açma, belge erişimi, alış sırası (37 test) |
| `route-preview` | Yönetici: aracın yollardan geçen güzergâh önizlemesi (otomatik en hızlı sıra veya verilen sıra) |
| `dev-roads` | **Geliştirme:** yol üzerinden rota testleri (12 test) |
| `dev-trip` | **Geliştirme:** demo sefer verisi üretir (bir durağa uğranmayan sefer dahil) ve sefer geçmişini doğrular (15 test) |

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

**Rota (yollar üzerinden):** Ortak modül `supabase/functions/_shared/roads.ts`. Duraklar düz çizgiyle değil, gerçek yol
ağı üzerinden bağlanır; sıra en hızlı sürüş süresine göre seçilir. Sağlayıcı: `GOOGLE_MAPS_API_KEY` sırrı tanımlıysa
Google Routes API (trafiğe göre), değilse OSRM (OpenStreetMap yol verisi). Varsayılan OSRM adresi genel deneme sunucusudur
(`router.project-osrm.org`, yoğun ticari kullanım için uygun değil); canlıda Google anahtarı veya `OSRM_URL` sırrıyla kendi
OSRM sunucunuz kullanılmalı. İkisine de ulaşılamazsa kuş uçuşu tahmine düşülür.
- `compute-route`: sürücünün konumu → duraklar → (varsa) varış noktası; yol çizgisi `daily_routes.polyline`'a yazılır, sürücü haritasında çizilir.
- `route-preview`: yönetim panelinde aracın güzergâhını ve toplam km/süreyi gösterir; sıra elle değiştirilirken çizgi anında güncellenir.

**Devamsızlık:** yolcu "Bugün kullanmayacağım" deyince durak bugünkü rotadan saniyeler içinde çıkar
(veritabanı tetikleyicisi → `compute-route`); geri alınca tekrar eklenir.

**Harita:** şimdilik Leaflet + OpenStreetMap (anahtarsız). Canlıdan önce Google Maps'e geçilecek.

## Sefer geçmişi (yalnızca yönetici)

Her servis bir **sefer** olarak kaydedilir; sürücünün ilk konumuyla otomatik açılır, "Servisi bitir" ile
veya 30 dk sinyal gelmezse kapanır. Sunucu her konumda durakları kontrol eder:

| Alan | Anlamı |
|---|---|
| Varış | Araç durağa **80 m** yaklaştığı ilk an |
| Ayrılış | Durağa vardıktan sonra **150 m** uzaklaştığı an |
| Uğranmadı | Sefer bittiğinde hiç varılmamış durak |
| En yakın geçiş | Uğranmayan durağa aracın en fazla ne kadar yaklaştığı ve saati (itiraz için kanıt) |
| Gelmeyecekti | Yolcu o gün "kullanmayacağım" demiş |

Web panelinde **Sefer geçmişi** sekmesi: tarih + araç → sefer → harita üzerinde gidilen yol, renkli duraklar,
varış/ayrılış tablosu, CSV indirme. Sürücü ve yolcu sefer geçmişini ve 15 dakikadan eski konumları göremez.
Saklama: konumlar 90 gün, sefer özetleri 1 yıl (pg_cron).

## Yönetim paneli

**Platform yöneticisi** (şirket kodu `platform`): tüm şirketleri görür, **yeni şirket açar** (şirket adı, giriş kodu,
yetkili, ilk şirket yöneticisi ve geçici şifresi), bir şirkete “girip” o şirketin yöneticisi gibi çalışır.
Şirkete girmeden hiçbir şirketin verisini göremez; girdiği şirket dışındakini de göremez.

Şirket içi sekmeler:

| Sekme | İçerik |
|---|---|
| Yolcular ve duraklar | Araç seçilir → yolcular **alış sırasıyla** listelenir, oklarla sıra değiştirilip kaydedilir; haritada numaralı duraklar ve varış noktası. Yeni yolcu: ad, telefon, otomatik kullanıcı adı + geçici şifre, durak adres aramasıyla veya haritaya tıklayarak |
| Sürücüler | Yeni sürücü kaydı: kişisel bilgiler, giriş bilgileri, araç (mevcut veya yeni), ehliyet; **kayıt sırasında** sürücü fotoğrafı, ehliyet, SRC, psikoteknik, adli sicil ve araç fotoğrafı/ruhsat/sigorta/muayene yükleme (son geçerlilik tarihleriyle). Süresi 30 günden az kalan belgeler uyarı olarak görünür |
| Araçlar | Plaka, hat adı, marka/model, renk, kapasite; rota modu (otomatik en kısa / belirlenen alış sırası); varış noktası (fabrika/okul); yolcuların konumu görebileceği gün ve saatler; belgeler |
| Sefer geçmişi | Önceki bölüm |
| Yöneticiler | Şirket yöneticileri: ekle, şifre sıfırla, sil |

**Belgeler** Storage'da özel `documents` kovasında `{şirket}/{driver|vehicle}/{sahip}/{dosya}` yolunda tutulur
(JPG/PNG/WEBP/HEIC/PDF, en fazla 10 MB). Yönetici tüm belgeleri görür; sürücü ve yolcu yalnızca kendi servisinin
**sürücü fotoğrafını ve araç fotoğrafını** görebilir. Ehliyet, sabıka kaydı vb. yalnızca yöneticiye açıktır.
Başka şirketin klasörüne yükleme/okuma yapılamaz (RLS + Storage politikaları).

**Alış sırası:** her durağın `pickup_order` değeri vardır; yeni yolcu aracın sonuna eklenir, araç değiştiren yolcu
yeni aracın sonuna taşınır. Aracın rota modu `manual` ise `compute-route` durakları bu sırayla gezer (yalnızca süre
hesaplanır); `auto` ise en kısa sıra hesaplanır.

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
