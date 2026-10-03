-- =====================================================================
-- Servis Takip — Faz 1: Çekirdek şema + RLS (şirket izolasyonu)
-- =====================================================================
-- Kurallar:
--   * Her tabloda company_id var; her satır tek bir şirkete aittir.
--   * Tüm tablolarda RLS açık; politikalar yalnızca 'authenticated' rolüne
--     tanımlı. 'anon' rolü hiçbir tabloya erişemez.
--   * Alt tablolar (stops, absences, ...) üst kayda (company_id, id) üzerinden
--     bileşik FK ile bağlıdır: başka şirketin aracına/yolcusuna bağlanamaz.
--   * company_id hiçbir tabloda sonradan değiştirilemez.
--   * Yetki yardımcı fonksiyonları 'private' şemasındadır (API'den çağrılamaz).
--   * Saat penceresi kontrolü sunucu tarafında, Europe/Istanbul saatiyle.
-- =====================================================================

create schema if not exists private;
grant usage on schema private to authenticated;

-- ---------------------------------------------------------------------
-- Tipler
-- ---------------------------------------------------------------------
create type public.user_role as enum ('admin', 'driver', 'passenger');

-- ---------------------------------------------------------------------
-- Tablolar
-- ---------------------------------------------------------------------
create table public.companies (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique check (code ~ '^[a-z0-9-]{2,32}$'),
  name       text not null,
  created_at timestamptz not null default now()
);
comment on column public.companies.code is 'Giriş ekranında yazılan şirket kodu (küçük harf, rakam, tire).';

create table public.vehicles (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  plate      text not null,
  name       text,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, plate)
);

create table public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  role       public.user_role not null,
  username   text not null check (username ~ '^[a-z0-9._-]{3,32}$'),
  phone      text check (phone ~ '^\+?[0-9]{10,15}$'),
  full_name  text not null,
  vehicle_id uuid,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, username),
  foreign key (company_id, vehicle_id) references public.vehicles(company_id, id) on delete set null (vehicle_id)
);
create unique index profiles_company_phone_key on public.profiles (company_id, phone) where phone is not null;
create index profiles_vehicle_idx on public.profiles (vehicle_id);
comment on column public.profiles.vehicle_id is 'Sürücü: kullandığı araç. Yolcu: bindiği servis (konum görme yetkisi buna göre).';

create table public.stops (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  passenger_id uuid not null unique,
  vehicle_id   uuid not null,
  lat          double precision not null check (lat between -90 and 90),
  lng          double precision not null check (lng between -180 and 180),
  address      text,
  created_at   timestamptz not null default now(),
  foreign key (company_id, passenger_id) references public.profiles(company_id, id) on delete cascade,
  foreign key (company_id, vehicle_id)   references public.vehicles(company_id, id) on delete cascade
);
create index stops_vehicle_idx on public.stops (vehicle_id);

create table public.visibility_windows (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  vehicle_id uuid not null,
  weekday    smallint not null check (weekday between 1 and 7), -- ISO: 1=Pzt … 7=Paz
  start_time time not null,
  end_time   time not null,
  created_at timestamptz not null default now(),
  check (start_time < end_time),
  foreign key (company_id, vehicle_id) references public.vehicles(company_id, id) on delete cascade
);
create index visibility_windows_vehicle_idx on public.visibility_windows (vehicle_id, weekday);
comment on table public.visibility_windows is 'Yolcuların aracın konumunu görebildiği saat aralıkları (Europe/Istanbul).';

create table public.absences (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  passenger_id uuid not null,
  date         date not null,
  created_at   timestamptz not null default now(),
  unique (passenger_id, date),
  foreign key (company_id, passenger_id) references public.profiles(company_id, id) on delete cascade
);
create index absences_company_date_idx on public.absences (company_id, date);

-- Konum geçmişi (sürücü yazar). Yüksek hacimli: Faz 3'te saklama süresi eklenecek.
create table public.vehicle_positions (
  id          bigint generated always as identity primary key,
  company_id  uuid not null references public.companies(id) on delete cascade,
  vehicle_id  uuid not null,
  driver_id   uuid not null,
  lat         double precision not null check (lat between -90 and 90),
  lng         double precision not null check (lng between -180 and 180),
  heading     real,
  speed       real,
  accuracy    real,
  recorded_at timestamptz not null default now(),
  foreign key (company_id, vehicle_id) references public.vehicles(company_id, id) on delete cascade,
  foreign key (company_id, driver_id)  references public.profiles(company_id, id) on delete cascade
);
create index vehicle_positions_vehicle_time_idx on public.vehicle_positions (vehicle_id, recorded_at desc);

-- Aracın "son canlı görüldüğü konum". Her konum kaydında tetikleyiciyle
-- güncellenir; uygulama kapansa da son değer burada kalır.
-- (vehicles tablosu yerine ayrı tablo: plaka gibi bilgiler her zaman
--  görülebilirken konum yalnızca saat penceresinde görülebilsin diye.)
create table public.vehicle_last_positions (
  vehicle_id  uuid primary key,
  company_id  uuid not null references public.companies(id) on delete cascade,
  driver_id   uuid,
  lat         double precision not null,
  lng         double precision not null,
  heading     real,
  speed       real,
  recorded_at timestamptz not null,
  foreign key (company_id, vehicle_id) references public.vehicles(company_id, id) on delete cascade
);

-- ---------------------------------------------------------------------
-- Yetki yardımcıları (SECURITY DEFINER: profiles RLS'sine takılmadan okur)
-- ---------------------------------------------------------------------
create or replace function private.current_company_id()
returns uuid language sql stable security definer set search_path = ''
as $$ select company_id from public.profiles where id = auth.uid() $$;

create or replace function private.current_app_role()
returns public.user_role language sql stable security definer set search_path = ''
as $$ select role from public.profiles where id = auth.uid() $$;

create or replace function private.current_vehicle_id()
returns uuid language sql stable security definer set search_path = ''
as $$ select vehicle_id from public.profiles where id = auth.uid() $$;

create or replace function private.is_admin()
returns boolean language sql stable security definer set search_path = ''
as $$ select coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false) $$;

-- Şu an (İstanbul saatiyle) bu araç için tanımlı bir görünürlük penceresi açık mı?
create or replace function private.visibility_window_open(p_vehicle_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.visibility_windows w
    where w.vehicle_id = p_vehicle_id
      and w.weekday   = extract(isodow from (now() at time zone 'Europe/Istanbul'))::int
      and (now() at time zone 'Europe/Istanbul')::time >= w.start_time
      and (now() at time zone 'Europe/Istanbul')::time <  w.end_time
  )
$$;

-- Giriş yapmış kullanıcı bu aracın KONUMUNU görebilir mi?
--   admin   : kendi şirketindeki tüm araçlar, her zaman
--   driver  : atandığı araç, her zaman
--   yolcu   : bindiği araç, yalnızca açık bir görünürlük penceresi varken
create or replace function private.can_view_vehicle(p_vehicle_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    join public.vehicles v on v.id = p_vehicle_id and v.company_id = p.company_id
    where p.id = auth.uid()
      and (
        p.role = 'admin'
        or (p.role = 'driver'    and p.vehicle_id = p_vehicle_id)
        or (p.role = 'passenger' and p.vehicle_id = p_vehicle_id
                                 and private.visibility_window_open(p_vehicle_id))
      )
  )
$$;

revoke execute on all functions in schema private from public;
grant usage on schema private to service_role;
grant execute on all functions in schema private to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Bütünlük tetikleyicileri
-- ---------------------------------------------------------------------

-- company_id hiçbir tabloda sonradan değiştirilemez.
create or replace function private.forbid_company_change()
returns trigger language plpgsql as $$
begin
  if new.company_id is distinct from old.company_id then
    raise exception 'company_id değiştirilemez' using errcode = '42501';
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['vehicles','profiles','stops','visibility_windows','absences','vehicle_positions','vehicle_last_positions']
  loop
    execute format('create trigger %I before update on public.%I for each row execute function private.forbid_company_change()',
                   t || '_forbid_company_change', t);
  end loop;
end $$;

-- Kullanıcı kendi profilinde yalnızca ad ve telefonu değiştirebilir;
-- rol, araç ve kullanıcı adı yalnızca admin (veya service role) tarafından değişir.
-- (SECURITY INVOKER: current_user, isteği yapan rolü gösterir.)
create or replace function private.guard_profile_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new; -- service_role, postgres (migration / Edge Function)
  end if;
  if private.is_admin() then
    return new;
  end if;
  if new.role is distinct from old.role
     or new.vehicle_id is distinct from old.vehicle_id
     or new.username is distinct from old.username then
    raise exception 'Bu alanları yalnızca yönetici değiştirebilir' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger profiles_guard_update before update on public.profiles
  for each row execute function private.guard_profile_update();

-- Yolcu profili gerektiren tablolarda (stops, absences) rolü doğrula.
create or replace function private.require_passenger()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles where id = new.passenger_id and role = 'passenger') then
    raise exception 'passenger_id bir yolcu profili olmalı' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger absences_require_passenger before insert or update on public.absences
  for each row execute function private.require_passenger();

-- Durak, yolcunun atandığı servise aittir: vehicle_id boşsa profilden doldur,
-- farklıysa reddet.
create or replace function private.sync_stop_vehicle()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  select vehicle_id into v from public.profiles where id = new.passenger_id and role = 'passenger';
  if not found then
    raise exception 'passenger_id bir yolcu profili olmalı' using errcode = '23514';
  end if;
  if new.vehicle_id is null then
    new.vehicle_id := v;
  elsif v is distinct from new.vehicle_id then
    raise exception 'Durağın aracı, yolcunun atandığı araçla aynı olmalı' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger stops_sync_vehicle before insert or update on public.stops
  for each row execute function private.sync_stop_vehicle();

-- Yolcunun aracı değişince durağı da yeni araca taşınır.
create or replace function private.cascade_passenger_vehicle()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.role = 'passenger' and new.vehicle_id is distinct from old.vehicle_id then
    if new.vehicle_id is null then
      delete from public.stops where passenger_id = new.id;
    else
      update public.stops set vehicle_id = new.vehicle_id where passenger_id = new.id;
    end if;
  end if;
  return new;
end $$;
create trigger profiles_cascade_vehicle after update of vehicle_id on public.profiles
  for each row execute function private.cascade_passenger_vehicle();

-- Her konum kaydında "son görülen konum"u güncelle (geç gelen eski kayıtlar ezmez).
create or replace function private.update_last_position()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.vehicle_last_positions as l
    (vehicle_id, company_id, driver_id, lat, lng, heading, speed, recorded_at)
  values
    (new.vehicle_id, new.company_id, new.driver_id, new.lat, new.lng, new.heading, new.speed, new.recorded_at)
  on conflict (vehicle_id) do update
    set driver_id = excluded.driver_id, lat = excluded.lat, lng = excluded.lng,
        heading = excluded.heading, speed = excluded.speed, recorded_at = excluded.recorded_at
    where l.recorded_at <= excluded.recorded_at;
  return null;
end $$;
create trigger vehicle_positions_update_last after insert on public.vehicle_positions
  for each row execute function private.update_last_position();

-- ---------------------------------------------------------------------
-- company_id varsayılanı: istemci göndermese de kendi şirketi yazılır.
-- ---------------------------------------------------------------------
alter table public.vehicles           alter column company_id set default private.current_company_id();
alter table public.stops              alter column company_id set default private.current_company_id();
alter table public.visibility_windows alter column company_id set default private.current_company_id();
alter table public.absences           alter column company_id set default private.current_company_id();
alter table public.vehicle_positions  alter column company_id set default private.current_company_id();
alter table public.vehicle_positions  alter column driver_id  set default auth.uid();

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.companies              enable row level security;
alter table public.vehicles               enable row level security;
alter table public.profiles               enable row level security;
alter table public.stops                  enable row level security;
alter table public.visibility_windows     enable row level security;
alter table public.absences               enable row level security;
alter table public.vehicle_positions      enable row level security;
alter table public.vehicle_last_positions enable row level security;

-- anon (giriş yapmamış) hiçbir tabloya erişemez.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- Not: (select fn()) kalıbı, fonksiyonun satır başına değil sorgu başına
-- bir kez çalışmasını sağlar (Supabase performans önerisi).

-- companies ------------------------------------------------------------
create policy companies_select on public.companies for select to authenticated
  using (id = (select private.current_company_id()));
create policy companies_update on public.companies for update to authenticated
  using (id = (select private.current_company_id()) and (select private.is_admin()))
  with check (id = (select private.current_company_id()));

-- vehicles -------------------------------------------------------------
create policy vehicles_select on public.vehicles for select to authenticated
  using (
    company_id = (select private.current_company_id())
    and ((select private.is_admin()) or id = (select private.current_vehicle_id()))
  );
create policy vehicles_admin_insert on public.vehicles for insert to authenticated
  with check (company_id = (select private.current_company_id()) and (select private.is_admin()));
create policy vehicles_admin_update on public.vehicles for update to authenticated
  using (company_id = (select private.current_company_id()) and (select private.is_admin()))
  with check (company_id = (select private.current_company_id()));
create policy vehicles_admin_delete on public.vehicles for delete to authenticated
  using (company_id = (select private.current_company_id()) and (select private.is_admin()));

-- profiles -------------------------------------------------------------
-- Kendisi; admin tüm şirketi; sürücü kendi aracının yolcularını;
-- yolcu kendi servisinin sürücüsünü görür.
create policy profiles_select on public.profiles for select to authenticated
  using (
    company_id = (select private.current_company_id())
    and (
      id = (select auth.uid())
      or (select private.is_admin())
      or (
        vehicle_id is not null
        and vehicle_id = (select private.current_vehicle_id())
        and (
          ((select private.current_app_role()) = 'driver'    and role = 'passenger')
          or ((select private.current_app_role()) = 'passenger' and role = 'driver')
        )
      )
    )
  );
create policy profiles_admin_insert on public.profiles for insert to authenticated
  with check (company_id = (select private.current_company_id()) and (select private.is_admin()));
create policy profiles_update on public.profiles for update to authenticated
  using (
    company_id = (select private.current_company_id())
    and (id = (select auth.uid()) or (select private.is_admin()))
  )
  with check (company_id = (select private.current_company_id()));
create policy profiles_admin_delete on public.profiles for delete to authenticated
  using (company_id = (select private.current_company_id()) and (select private.is_admin())
         and id <> (select auth.uid()));

-- stops ----------------------------------------------------------------
create policy stops_select on public.stops for select to authenticated
  using (
    company_id = (select private.current_company_id())
    and (
      (select private.is_admin())
      or passenger_id = (select auth.uid())
      or ((select private.current_app_role()) = 'driver' and vehicle_id = (select private.current_vehicle_id()))
    )
  );
create policy stops_admin_insert on public.stops for insert to authenticated
  with check (company_id = (select private.current_company_id()) and (select private.is_admin()));
create policy stops_admin_update on public.stops for update to authenticated
  using (company_id = (select private.current_company_id()) and (select private.is_admin()))
  with check (company_id = (select private.current_company_id()));
create policy stops_admin_delete on public.stops for delete to authenticated
  using (company_id = (select private.current_company_id()) and (select private.is_admin()));

-- visibility_windows ---------------------------------------------------
create policy windows_select on public.visibility_windows for select to authenticated
  using (
    company_id = (select private.current_company_id())
    and ((select private.is_admin()) or vehicle_id = (select private.current_vehicle_id()))
  );
create policy windows_admin_insert on public.visibility_windows for insert to authenticated
  with check (company_id = (select private.current_company_id()) and (select private.is_admin()));
create policy windows_admin_update on public.visibility_windows for update to authenticated
  using (company_id = (select private.current_company_id()) and (select private.is_admin()))
  with check (company_id = (select private.current_company_id()));
create policy windows_admin_delete on public.visibility_windows for delete to authenticated
  using (company_id = (select private.current_company_id()) and (select private.is_admin()));

-- absences -------------------------------------------------------------
create policy absences_select on public.absences for select to authenticated
  using (
    company_id = (select private.current_company_id())
    and (
      (select private.is_admin())
      or passenger_id = (select auth.uid())
      or (
        (select private.current_app_role()) = 'driver'
        and passenger_id in (select p.id from public.profiles p
                             where p.vehicle_id = (select private.current_vehicle_id()))
      )
    )
  );
-- Yolcu kendi adına bugün ve sonrası için devamsızlık ekler/siler; admin hepsini.
create policy absences_insert on public.absences for insert to authenticated
  with check (
    company_id = (select private.current_company_id())
    and (
      (select private.is_admin())
      or (passenger_id = (select auth.uid())
          and date >= (now() at time zone 'Europe/Istanbul')::date)
    )
  );
create policy absences_delete on public.absences for delete to authenticated
  using (
    company_id = (select private.current_company_id())
    and (
      (select private.is_admin())
      or (passenger_id = (select auth.uid())
          and date >= (now() at time zone 'Europe/Istanbul')::date)
    )
  );

-- vehicle_positions ----------------------------------------------------
-- Yalnızca sürücü, yalnızca kendi aracı için, kendi adına yazar.
create policy positions_driver_insert on public.vehicle_positions for insert to authenticated
  with check (
    company_id = (select private.current_company_id())
    and (select private.current_app_role()) = 'driver'
    and driver_id = (select auth.uid())
    and vehicle_id = (select private.current_vehicle_id())
  );
-- Yolcu, pencere açıkken yalnızca son 15 dakikayı görür (geçmiş rota sızmasın).
create policy positions_select on public.vehicle_positions for select to authenticated
  using (
    company_id = (select private.current_company_id())
    and private.can_view_vehicle(vehicle_id)
    and (
      (select private.current_app_role()) <> 'passenger'
      or recorded_at > now() - interval '15 minutes'
    )
  );

-- vehicle_last_positions ------------------------------------------------
-- Yalnızca okunur; tetikleyici yazar. Yolcu yalnızca pencere açıkken görür.
create policy last_positions_select on public.vehicle_last_positions for select to authenticated
  using (
    company_id = (select private.current_company_id())
    and private.can_view_vehicle(vehicle_id)
  );

-- ---------------------------------------------------------------------
-- Realtime: canlı konum yayını (postgres_changes; RLS her mesajda uygulanır)
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.vehicle_last_positions;
    alter publication supabase_realtime add table public.vehicle_positions;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Bağlantı testi (Görev 1): giriş gerektirmez, veri döndürmez.
-- ---------------------------------------------------------------------
create or replace function public.health()
returns jsonb language sql stable set search_path = ''
as $$
  select jsonb_build_object(
    'ok', true,
    'server_time', now(),
    'istanbul_time', to_char(now() at time zone 'Europe/Istanbul', 'YYYY-MM-DD HH24:MI:SS'),
    'schema_version', '20261004000001'
  )
$$;
grant execute on function public.health() to anon, authenticated;
