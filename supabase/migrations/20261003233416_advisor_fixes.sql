-- Supabase Advisor düzeltmeleri (güvenlik + performans)

-- [Güvenlik] search_path sabitlenmemiş fonksiyon
alter function private.forbid_company_change() set search_path = '';

-- [Güvenlik] "Enable automatic RLS" ayarının oluşturduğu event-trigger fonksiyonu
-- API'den (anon/authenticated) çağrılabilir görünüyor. Event trigger bu yetkiye
-- ihtiyaç duymaz; dışarıya kapatıyoruz.
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'rls_auto_enable') then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end $$;

-- [Performans] Bileşik FK'ler için kapsayan indeksler (company_id ile başlar;
-- tekil company_id FK'lerini de kapsar)
create index if not exists absences_company_passenger_idx      on public.absences (company_id, passenger_id);
create index if not exists profiles_company_vehicle_idx        on public.profiles (company_id, vehicle_id);
create index if not exists stops_company_passenger_idx         on public.stops (company_id, passenger_id);
create index if not exists stops_company_vehicle_idx           on public.stops (company_id, vehicle_id);
create index if not exists vehicle_last_positions_company_idx  on public.vehicle_last_positions (company_id, vehicle_id);
create index if not exists vehicle_positions_company_vehicle_idx on public.vehicle_positions (company_id, vehicle_id);
create index if not exists vehicle_positions_company_driver_idx  on public.vehicle_positions (company_id, driver_id);
create index if not exists visibility_windows_company_vehicle_idx on public.visibility_windows (company_id, vehicle_id);

-- Not: Tek sütunluk stops_vehicle_idx bilerek bırakıldı (silme komutu uzak
-- ortamda onay gerektiriyor; indeks zararsız).
