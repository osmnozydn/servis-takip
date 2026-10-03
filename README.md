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

Beklenen çıktı: `62 testin tamamı geçti`.

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
