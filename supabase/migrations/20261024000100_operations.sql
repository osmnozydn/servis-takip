-- =====================================================================
-- Operasyon: fabrikalar, servis saatleri, sefer yönü, otomatik tamamlanma,
-- bildirimler ve operasyon sorumlusu rolü
-- =====================================================================
-- * Operasyon sorumlusu ('operator'): yönetici ile aynı yetkiler; yalnızca
--   yönetici / operasyon sorumlusu hesaplarını ekleyemez, değiştiremez, silemez.
--   Platform yöneticisi (süper yönetici) şirketlerin üstündedir (değişmedi).
-- * Fabrikalar: şirket başına birden çok; her araç bir fabrikaya bağlanır.
-- * Servis saatleri (visibility_windows): yön (sabah: fabrikaya / akşam:
--   fabrikadan), servis kalkış saati ve yolcuya kaç dk önce görüneceği.
--   start_time = kalkış − görünme süresi (ör. 06:10 − 30 dk = 05:40).
-- * Sefer otomatik tamamlanır: sabah seferi araç fabrikaya varınca, akşam
--   seferi son yolcu durağına varılınca. Sürücünün düğmeye basması gerekmez.
-- * Bildirimler: sefer başlayınca yöneticilere/operasyona ve o aracın
--   yolcularına; sefer bitince yöneticilere/operasyona. Telefonlara push
--   gönderimi send-push Edge Function'ı ile (pg_net).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Roller
-- ---------------------------------------------------------------------
-- Yönetim yetkisi: yönetici + operasyon sorumlusu + şirkete girmiş platform yöneticisi
create or replace function private.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select role in ('admin', 'operator') from public.profiles where id = auth.uid()), false)
      or exists (select 1 from private.platform_admins where user_id = auth.uid() and active_company_id is not null)
$$;

-- Hesap yönetimi yetkisi (yönetici / operasyon hesapları): yalnızca yönetici + platform yöneticisi
create or replace function private.is_company_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false)
      or exists (select 1 from private.platform_admins where user_id = auth.uid() and active_company_id is not null)
$$;

create or replace function public.admin_company_of(p_uid uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select company_id from public.profiles where id = p_uid and role in ('admin', 'operator')),
    (select active_company_id from private.platform_admins where user_id = p_uid))
$$;
create or replace function public.is_company_admin_uid(p_uid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = p_uid and role = 'admin')
      or exists (select 1 from private.platform_admins where user_id = p_uid and active_company_id is not null)
$$;
revoke execute on function public.admin_company_of(uuid), public.is_company_admin_uid(uuid) from public, anon, authenticated;
grant  execute on function public.admin_company_of(uuid), public.is_company_admin_uid(uuid) to service_role;

alter policy companies_update on public.companies
  using (id = (select private.current_company_id()) and (select private.is_company_admin()));

alter policy profiles_admin_insert on public.profiles
  with check (company_id = (select private.current_company_id()) and (select private.is_admin())
              and ((select private.is_company_admin()) or role not in ('admin', 'operator')));
alter policy profiles_update on public.profiles
  using (
    company_id = (select private.current_company_id())
    and (id = (select auth.uid())
         or ((select private.is_admin()) and ((select private.is_company_admin()) or role not in ('admin', 'operator'))))
  );
alter policy profiles_admin_delete on public.profiles
  using (company_id = (select private.current_company_id()) and (select private.is_admin())
         and ((select private.is_company_admin()) or role not in ('admin', 'operator'))
         and id <> (select auth.uid()));

-- Rol, araç, kullanıcı adı yalnızca yönetim tarafından; yönetim rollerine geçiş yalnızca yönetici tarafından
create or replace function private.guard_profile_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new; -- service_role, postgres (migration / Edge Function)
  end if;
  if private.is_company_admin() then
    return new;
  end if;
  if private.is_admin() then
    if new.role is distinct from old.role
       and (new.role in ('admin', 'operator') or old.role in ('admin', 'operator')) then
      raise exception 'Yönetici ve operasyon rollerini yalnızca şirket yöneticisi değiştirebilir' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.role is distinct from old.role
     or new.vehicle_id is distinct from old.vehicle_id
     or new.username is distinct from old.username then
    raise exception 'Bu alanları yalnızca yönetici değiştirebilir' using errcode = '42501';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 2) Fabrikalar
-- ---------------------------------------------------------------------
create table public.factories (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null default private.current_company_id() references public.companies(id) on delete cascade,
  name       text not null check (length(btrim(name)) between 1 and 80),
  address    text,
  lat        double precision not null check (lat between -90 and 90),
  lng        double precision not null check (lng between -180 and 180),
  radius_m   integer not null default 150 check (radius_m between 50 and 1000),
  created_at timestamptz not null default now(),
  unique (company_id, id)
);
create index factories_company_idx on public.factories (company_id);
comment on table public.factories is 'Servislerin gittiği fabrikalar/işyerleri. Araç fabrika yarıçapına girince sabah seferi tamamlanır.';
comment on column public.factories.radius_m is 'Varış yarıçapı (m): araç bu mesafeye girince fabrikaya varmış sayılır.';

alter table public.factories enable row level security;
revoke all on public.factories from anon, authenticated;
grant select, insert, update, delete on public.factories to authenticated;
grant all on public.factories to service_role;

create policy factories_select on public.factories for select to authenticated
  using (company_id = (select private.current_company_id()));
create policy factories_admin_insert on public.factories for insert to authenticated
  with check (company_id = (select private.current_company_id()) and (select private.is_admin()));
create policy factories_admin_update on public.factories for update to authenticated
  using (company_id = (select private.current_company_id()) and (select private.is_admin()))
  with check (company_id = (select private.current_company_id()));
create policy factories_admin_delete on public.factories for delete to authenticated
  using (company_id = (select private.current_company_id()) and (select private.is_admin()));
create trigger factories_forbid_company_change before update on public.factories
  for each row execute function private.forbid_company_change();

alter table public.vehicles add column factory_id uuid;
alter table public.vehicles add constraint vehicles_factory_fk
  foreign key (company_id, factory_id) references public.factories(company_id, id) on delete set null (factory_id);
create index vehicles_factory_idx on public.vehicles (factory_id);

-- Aracın rota bitiş noktası (end_*) fabrikadan otomatik doldurulur
create or replace function private.sync_vehicle_factory()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.factory_id is not null then
    select f.lat, f.lng, f.name into new.end_lat, new.end_lng, new.end_label
      from public.factories f where f.id = new.factory_id;
  elsif tg_op = 'UPDATE' and old.factory_id is not null then
    new.end_lat := null; new.end_lng := null; new.end_label := null;
  end if;
  return new;
end $$;
create trigger vehicles_sync_factory before insert or update of factory_id on public.vehicles
  for each row execute function private.sync_vehicle_factory();

create or replace function private.propagate_factory()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    update public.vehicles set end_lat = null, end_lng = null, end_label = null where factory_id = old.id;
    return old;
  end if;
  update public.vehicles set end_lat = new.lat, end_lng = new.lng, end_label = new.name where factory_id = new.id;
  return new;
end $$;
create trigger factories_propagate after update of lat, lng, name on public.factories
  for each row execute function private.propagate_factory();
create trigger factories_propagate_delete before delete on public.factories
  for each row execute function private.propagate_factory();

-- Mevcut "varış noktası" olan araçlar için fabrika kaydı oluştur
with ends as (
  select distinct company_id, coalesce(nullif(btrim(end_label), ''), 'Fabrika') as name, end_lat, end_lng
  from public.vehicles where end_lat is not null and end_lng is not null
), ins as (
  insert into public.factories (company_id, name, lat, lng)
  select company_id, left(name, 80), end_lat, end_lng from ends
  returning id, company_id, name, lat, lng
)
update public.vehicles v set factory_id = ins.id
  from ins where ins.company_id = v.company_id and ins.lat = v.end_lat and ins.lng = v.end_lng;

-- ---------------------------------------------------------------------
-- 3) Servis saatleri: yön, kalkış saati, kaç dk önce görünür
-- ---------------------------------------------------------------------
alter table public.visibility_windows
  add column direction    text check (direction in ('to_factory', 'from_factory')),
  add column service_time time,
  add column lead_minutes smallint not null default 30 check (lead_minutes between 0 and 180);
comment on column public.visibility_windows.direction is 'to_factory: sabah (duraklar → fabrika); from_factory: akşam (fabrika → duraklar)';
comment on column public.visibility_windows.service_time is 'Servisin kalkış saati. Yolcu konumu start_time = service_time − lead_minutes itibarıyla görür.';

-- Mevcut pencereler: davranış değişmesin (kalkış = başlangıç, 0 dk önce)
update public.visibility_windows
   set service_time = start_time, lead_minutes = 0,
       direction = case when start_time < time '12:00' then 'to_factory' else 'from_factory' end
 where service_time is null;

create or replace function private.window_defaults()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.service_time is not null then
    if new.service_time < make_time(0, 0, 0) + make_interval(mins => new.lead_minutes) then
      raise exception 'Servis saati, görünme süresinden önce olamaz (gece yarısını geçemez)' using errcode = '23514';
    end if;
    new.start_time := new.service_time - make_interval(mins => new.lead_minutes);
  end if;
  if new.direction is null then
    new.direction := case when coalesce(new.service_time, new.start_time) < time '12:00' then 'to_factory' else 'from_factory' end;
  end if;
  return new;
end $$;
create trigger visibility_windows_defaults before insert or update on public.visibility_windows
  for each row execute function private.window_defaults();

-- O anda (± 60 dk) aracın hangi servis penceresindeyiz?
create or replace function private.service_window_at(p_vehicle uuid, p_at timestamptz)
returns public.visibility_windows language sql stable security definer set search_path = '' as $$
  select w.* from public.visibility_windows w
  where w.vehicle_id = p_vehicle
    and w.weekday = extract(isodow from (p_at at time zone 'Europe/Istanbul'))::int
    and (p_at at time zone 'Europe/Istanbul')::time >= w.start_time - interval '60 minutes'
    and (p_at at time zone 'Europe/Istanbul')::time <= w.end_time + interval '60 minutes'
  order by abs(extract(epoch from ((p_at at time zone 'Europe/Istanbul')::time - coalesce(w.service_time, w.start_time))))
  limit 1
$$;

-- ---------------------------------------------------------------------
-- 4) Sefer: yön, fabrika, otomatik tamamlanma
-- ---------------------------------------------------------------------
alter table public.trips
  add column direction text check (direction in ('to_factory', 'from_factory')),
  add column factory_id uuid references public.factories(id) on delete set null,
  add column window_id uuid references public.visibility_windows(id) on delete set null;
alter table public.trips drop constraint if exists trips_end_reason_check;
alter table public.trips add constraint trips_end_reason_check
  check (end_reason in ('driver', 'inactivity', 'factory', 'last_stop'));
comment on column public.trips.end_reason is 'driver: sürücü bitirdi; inactivity: 30 dk konum yok; factory: fabrikaya varıldı (sabah); last_stop: son yolcuya varıldı (akşam)';

create or replace function private.open_trip(p_vehicle uuid, p_company uuid, p_driver uuid, p_at timestamptz)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_trip  uuid;
  v_date  date := (p_at at time zone 'Europe/Istanbul')::date;
  v_win   public.visibility_windows;
  v_dir   text;
begin
  v_win := private.service_window_at(p_vehicle, p_at);
  v_dir := coalesce(v_win.direction,
                    case when (p_at at time zone 'Europe/Istanbul')::time < time '12:00' then 'to_factory' else 'from_factory' end);

  insert into public.trips (company_id, vehicle_id, driver_id, service_date, started_at, driver_name, vehicle_plate,
                            direction, factory_id, window_id)
  values (p_company, p_vehicle, p_driver, v_date, p_at,
          (select full_name from public.profiles where id = p_driver),
          (select plate from public.vehicles where id = p_vehicle),
          v_dir, (select factory_id from public.vehicles where id = p_vehicle), v_win.id)
  on conflict (vehicle_id) where ended_at is null do nothing
  returning id into v_trip;

  if v_trip is null then  -- eşzamanlı başka bir istek açmış
    select id into v_trip from public.trips where vehicle_id = p_vehicle and ended_at is null;
    return v_trip;
  end if;

  insert into public.trip_stop_events (company_id, trip_id, passenger_id, passenger_name, address, lat, lng, planned_order, status)
  select s.company_id, v_trip, s.passenger_id, p.full_name, s.address, s.lat, s.lng,
         (select ord::int from public.daily_routes r, jsonb_array_elements(r.stops) with ordinality t(e, ord)
           where r.vehicle_id = p_vehicle and r.service_date = v_date
             and (e->>'passenger_id')::uuid = s.passenger_id),
         case when exists (select 1 from public.absences a where a.passenger_id = s.passenger_id and a.date = v_date)
              then 'absent' else 'pending' end
  from public.stops s
  join public.profiles p on p.id = s.passenger_id
  where s.vehicle_id = p_vehicle;

  -- Bildirimler, satırlar hazır olduktan sonra (durak sayısı için)
  perform private.notify_trip_started(v_trip);
  return v_trip;
end $$;

-- Önce uğranmayan duraklar "atlandı" yapılır, sonra sefer kapanır (bildirimdeki sayılar doğru olsun)
create or replace function private.close_trip(p_trip uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.trips where id = p_trip and ended_at is null) then return; end if;
  update public.trip_stop_events set status = 'missed'
   where trip_id = p_trip and status = 'pending';
  update public.trips
     set ended_at = coalesce(last_position_at, now()), end_reason = p_reason
   where id = p_trip and ended_at is null;
end $$;

-- Konum eklenmeden önce: açık seferi bul (yoksa aç). Otomatik tamamlanan bir
-- seferin ardından gelen konumlar (sürücü yayını henüz kapatmadıysa) yeni sefer açmaz.
create or replace function private.assign_trip()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_trip uuid;
  v_win  public.visibility_windows;
begin
  select id into v_trip from public.trips where vehicle_id = new.vehicle_id and ended_at is null;
  if v_trip is null then
    if exists (select 1 from public.trips t
                where t.vehicle_id = new.vehicle_id and t.end_reason in ('factory', 'last_stop')
                  and new.recorded_at between t.started_at - interval '5 minutes' and t.ended_at + interval '60 minutes') then
      new.trip_id := null;
      return new;
    end if;
    v_win := private.service_window_at(new.vehicle_id, new.recorded_at);
    if v_win.id is not null and exists (
         select 1 from public.trips t
          where t.window_id = v_win.id and t.end_reason in ('factory', 'last_stop')
            and t.service_date = (new.recorded_at at time zone 'Europe/Istanbul')::date) then
      new.trip_id := null;
      return new;
    end if;
    v_trip := private.open_trip(new.vehicle_id, new.company_id, new.driver_id, new.recorded_at);
  end if;
  new.trip_id := v_trip;
  return new;
end $$;

-- Konum eklendikten sonra: istatistik + durak varış/ayrılış + otomatik tamamlanma
create or replace function private.process_trip_position()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  ARRIVE_M constant double precision := 80;
  DEPART_M constant double precision := 150;
  v_t public.trips;
  v_f public.factories;
begin
  if new.trip_id is null then return null; end if;

  update public.trips t set
    position_count   = t.position_count + 1,
    distance_m       = t.distance_m + case
                         when t.last_position_at is not null and new.recorded_at > t.last_position_at
                         then private.distance_m(t.last_lat, t.last_lng, new.lat, new.lng) else 0 end,
    last_lat         = case when t.last_position_at is null or new.recorded_at >= t.last_position_at then new.lat else t.last_lat end,
    last_lng         = case when t.last_position_at is null or new.recorded_at >= t.last_position_at then new.lng else t.last_lng end,
    last_position_at = greatest(t.last_position_at, new.recorded_at),
    started_at       = least(t.started_at, new.recorded_at)
  where t.id = new.trip_id;

  update public.trip_stop_events e set
    closest_m   = case when e.closest_m is null or x.d < e.closest_m then x.d else e.closest_m end,
    closest_at  = case when e.closest_m is null or x.d < e.closest_m then new.recorded_at else e.closest_at end,
    status      = case when e.status = 'pending' and x.d <= ARRIVE_M then 'arrived' else e.status end,
    arrived_at  = case when e.status in ('pending', 'arrived') and x.d <= ARRIVE_M
                       then least(coalesce(e.arrived_at, new.recorded_at), new.recorded_at) else e.arrived_at end,
    departed_at = case when e.status = 'arrived' and e.departed_at is null and x.d > DEPART_M
                            and new.recorded_at > e.arrived_at
                       then new.recorded_at else e.departed_at end
  from (select id, private.distance_m(lat, lng, new.lat, new.lng) as d
          from public.trip_stop_events where trip_id = new.trip_id) x
  where e.id = x.id;

  -- Otomatik tamamlanma (yalnızca en güncel konumla)
  select * into v_t from public.trips where id = new.trip_id;
  if v_t.ended_at is not null or new.recorded_at < v_t.last_position_at then return null; end if;

  if v_t.direction = 'to_factory' and v_t.factory_id is not null then
    select * into v_f from public.factories where id = v_t.factory_id;
    if v_f.id is not null
       and private.distance_m(v_f.lat, v_f.lng, new.lat, new.lng) <= v_f.radius_m
       and (exists (select 1 from public.trip_stop_events where trip_id = v_t.id and status = 'arrived')
            or not exists (select 1 from public.trip_stop_events where trip_id = v_t.id and status = 'pending')) then
      perform private.close_trip(v_t.id, 'factory');
    end if;
  elsif v_t.direction = 'from_factory' then
    if exists (select 1 from public.trip_stop_events where trip_id = v_t.id and status = 'arrived')
       and not exists (select 1 from public.trip_stop_events where trip_id = v_t.id and status = 'pending') then
      perform private.close_trip(v_t.id, 'last_stop');
    end if;
  end if;
  return null;
end $$;

-- Rota hesabı için: aracın şu anki sefer yönü (açık sefer → o anki servis penceresi → saat)
create or replace function public.vehicle_direction_now(p_vehicle uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select direction from public.trips where vehicle_id = p_vehicle and ended_at is null),
    (select (private.service_window_at(p_vehicle, now())).direction),
    case when (now() at time zone 'Europe/Istanbul')::time < time '12:00' then 'to_factory' else 'from_factory' end)
$$;
revoke execute on function public.vehicle_direction_now(uuid) from public, anon, authenticated;
grant  execute on function public.vehicle_direction_now(uuid) to service_role;

-- ---------------------------------------------------------------------
-- 5) Bildirimler
-- ---------------------------------------------------------------------
create table public.notifications (
  id           bigint generated always as identity primary key,
  company_id   uuid not null references public.companies(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  kind         text not null check (kind in ('trip_started', 'trip_completed', 'trip_closed', 'bus_departed')),
  title        text not null,
  body         text not null,
  vehicle_id   uuid,
  trip_id      uuid references public.trips(id) on delete set null,
  data         jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  read_at      timestamptz
);
create index notifications_recipient_idx on public.notifications (recipient_id, created_at desc);
create index notifications_company_idx on public.notifications (company_id);
comment on table public.notifications is 'Kullanıcıya özel bildirimler (panelde zil, telefonda push).';

alter table public.notifications enable row level security;
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant all on public.notifications to service_role;
create policy notifications_own_select on public.notifications for select to authenticated
  using (recipient_id = (select auth.uid()));
create policy notifications_own_update on public.notifications for update to authenticated
  using (recipient_id = (select auth.uid())) with check (recipient_id = (select auth.uid()));

create or replace function public.mark_notifications_read(p_ids bigint[] default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.notifications set read_at = now()
   where recipient_id = auth.uid() and read_at is null and (p_ids is null or id = any(p_ids));
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.mark_notifications_read(bigint[]) from public, anon;
grant  execute on function public.mark_notifications_read(bigint[]) to authenticated;

-- Push token'ları (Expo). Bir token tek kullanıcıya aittir; başka hesapla girilince devredilir.
create table public.push_tokens (
  token      text primary key check (length(token) between 10 and 300),
  user_id    uuid not null references auth.users(id) on delete cascade,
  platform   text check (platform in ('android', 'ios', 'web')),
  updated_at timestamptz not null default now()
);
create index push_tokens_user_idx on public.push_tokens (user_id);
alter table public.push_tokens enable row level security;
revoke all on public.push_tokens from anon, authenticated;
grant all on public.push_tokens to service_role;

create or replace function public.register_push_token(p_token text, p_platform text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or p_token is null or length(p_token) not between 10 and 300 then return false; end if;
  insert into public.push_tokens (token, user_id, platform) values (p_token, auth.uid(), p_platform)
  on conflict (token) do update set user_id = excluded.user_id, platform = excluded.platform, updated_at = now();
  return true;
end $$;
create or replace function public.unregister_push_token(p_token text)
returns boolean language sql security definer set search_path = '' as $$
  delete from public.push_tokens where token = p_token and user_id = auth.uid() returning true
$$;
revoke execute on function public.register_push_token(text, text), public.unregister_push_token(text) from public, anon;
grant  execute on function public.register_push_token(text, text), public.unregister_push_token(text) to authenticated;

-- Yöneticiler + operasyon sorumluları + o şirkete girmiş platform yöneticileri
create or replace function private.staff_of(p_company uuid)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select id from public.profiles where company_id = p_company and role in ('admin', 'operator')
  union
  select user_id from private.platform_admins where active_company_id = p_company
$$;

create or replace function private.dir_label(p_dir text)
returns text language sql immutable set search_path = '' as $$
  select case p_dir when 'to_factory' then 'sabah servisi' when 'from_factory' then 'akşam servisi' else 'servis' end
$$;

create or replace function private.hhmm(p_at timestamptz)
returns text language sql stable set search_path = '' as $$
  select to_char(p_at at time zone 'Europe/Istanbul', 'HH24:MI')
$$;

create or replace function private.notify_trip_started(p_trip uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  t public.trips;
  v_fac text;
begin
  select * into t from public.trips where id = p_trip;
  if not found then return; end if;
  select name into v_fac from public.factories where id = t.factory_id;

  insert into public.notifications (company_id, recipient_id, kind, title, body, vehicle_id, trip_id, data)
  select t.company_id, s, 'trip_started', 'Servis başladı',
         format('%s · %s başladı · %s%s', t.vehicle_plate, private.dir_label(t.direction), private.hhmm(t.started_at),
                case when t.driver_name is not null then ' · ' || t.driver_name else '' end),
         t.vehicle_id, t.id, jsonb_build_object('direction', t.direction, 'factory', v_fac)
  from private.staff_of(t.company_id) s;

  insert into public.notifications (company_id, recipient_id, kind, title, body, vehicle_id, trip_id, data)
  select t.company_id, p.id, 'bus_departed', 'Aracınız yola çıktı',
         case when t.direction = 'from_factory'
              then format('%s fabrikadan hareket etti. Durağınıza yaklaşınca haritada görebilirsiniz.', t.vehicle_plate)
              else format('%s servisi yola çıktı. Durağınıza gelmeden hazır olun.', t.vehicle_plate) end,
         t.vehicle_id, t.id, jsonb_build_object('direction', t.direction)
  from public.profiles p
  where p.role = 'passenger' and p.vehicle_id = t.vehicle_id
    and not exists (select 1 from public.absences a where a.passenger_id = p.id and a.date = t.service_date);
end $$;

create or replace function private.on_trip_closed()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_arrived int; v_total int; v_missed int;
  v_fac text; v_title text; v_body text; v_kind text := 'trip_completed';
  v_stops text;
begin
  if old.ended_at is not null or new.ended_at is null then return null; end if;
  select count(*) filter (where status = 'arrived'),
         count(*) filter (where status <> 'absent'),
         count(*) filter (where status = 'missed')
    into v_arrived, v_total, v_missed
    from public.trip_stop_events where trip_id = new.id;
  select name into v_fac from public.factories where id = new.factory_id;
  v_stops := case when v_total > 0
                  then format(' · %s/%s durak%s', v_arrived, v_total,
                              case when v_missed > 0 then format(', %s atlandı', v_missed) else '' end)
                  else '' end;

  if new.end_reason = 'factory' then
    v_title := 'Servis tamamlandı';
    v_body := format('%s fabrikaya ulaştı%s · %s tamamlandı · %s%s', new.vehicle_plate,
                     case when v_fac is not null then format(' (%s)', v_fac) else '' end,
                     private.dir_label(new.direction), private.hhmm(new.ended_at), v_stops);
  elsif new.end_reason = 'last_stop' then
    v_title := 'Servis tamamlandı';
    v_body := format('%s son yolcuya ulaştı · %s tamamlandı · %s%s', new.vehicle_plate,
                     private.dir_label(new.direction), private.hhmm(new.ended_at), v_stops);
  elsif new.end_reason = 'driver' then
    v_title := 'Servis bitirildi';
    v_body := format('%s · %s sürücü tarafından bitirildi · %s%s', new.vehicle_plate,
                     private.dir_label(new.direction), private.hhmm(new.ended_at), v_stops);
  else
    v_kind := 'trip_closed';
    v_title := 'Sefer kapatıldı';
    v_body := format('%s · 30 dk konum gelmedi, %s kapatıldı · %s%s', new.vehicle_plate,
                     private.dir_label(new.direction), private.hhmm(new.ended_at), v_stops);
  end if;

  insert into public.notifications (company_id, recipient_id, kind, title, body, vehicle_id, trip_id, data)
  select new.company_id, s, v_kind, v_title, v_body, new.vehicle_id, new.id,
         jsonb_build_object('end_reason', new.end_reason, 'direction', new.direction,
                            'arrived', v_arrived, 'total', v_total, 'missed', v_missed)
  from private.staff_of(new.company_id) s;
  return null;
end $$;
create trigger trips_notify_closed after update of ended_at on public.trips
  for each row execute function private.on_trip_closed();

-- Push: yeni bildirimleri tek istekte send-push fonksiyonuna ilet (pg_net varsa)
create or replace function private.dispatch_push()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_url text; v_secret text; v_ids bigint[];
begin
  if not exists (select 1 from pg_extension where extname = 'pg_net') then return null; end if;
  select array_agg(n.id) into v_ids from new_rows n
   where exists (select 1 from public.push_tokens p where p.user_id = n.recipient_id);
  if v_ids is null then return null; end if;
  select value into v_url    from private.app_secrets where key = 'functions_url';
  select value into v_secret from private.app_secrets where key = 'internal_secret';
  execute $q$ select net.http_post(
      url := $1 || '/send-push',
      headers := jsonb_build_object('Content-Type','application/json','x-internal-secret',$2),
      body := jsonb_build_object('ids', $3),
      timeout_milliseconds := 15000) $q$
    using v_url, v_secret, to_jsonb(v_ids);
  return null;
end $$;
create trigger notifications_dispatch_push after insert on public.notifications
  referencing new table as new_rows
  for each statement execute function private.dispatch_push();

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 6) Yolcu ve sürücü ekranları için durum
-- ---------------------------------------------------------------------
create or replace function public.my_visibility_state()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_vehicle uuid := private.current_vehicle_id();
  v_now     timestamp := now() at time zone 'Europe/Istanbul';
  v_cur     public.visibility_windows;
  v_nextw   public.visibility_windows;
  v_next    timestamp;
  t         public.trips;
  d         int;
begin
  if v_vehicle is null then
    return jsonb_build_object('has_vehicle', false);
  end if;

  select w.* into v_cur from public.visibility_windows w
   where w.vehicle_id = v_vehicle and w.weekday = extract(isodow from v_now)::int
     and v_now::time >= w.start_time and v_now::time < w.end_time
   order by w.end_time desc limit 1;

  for d in 0..7 loop
    select w.* into v_nextw from public.visibility_windows w
     where w.vehicle_id = v_vehicle
       and w.weekday = extract(isodow from (v_now::date + d))::int
       and (d > 0 or w.start_time > v_now::time)
     order by w.start_time limit 1;
    if v_nextw.id is not null then v_next := (v_now::date + d) + v_nextw.start_time; exit; end if;
  end loop;

  -- Bugünkü en son sefer (son 3 saat içinde bitmiş ya da devam eden)
  select * into t from public.trips
   where vehicle_id = v_vehicle and service_date = v_now::date
     and (ended_at is null or ended_at > now() - interval '3 hours')
   order by started_at desc limit 1;

  return jsonb_build_object(
    'has_vehicle', true,
    'open', v_cur.id is not null,
    'open_until', case when v_cur.id is not null then to_char(v_cur.end_time, 'HH24:MI') end,
    'next_open', case when v_next is not null then to_char(v_next, 'YYYY-MM-DD"T"HH24:MI') end,
    'current', case when v_cur.id is null then null else jsonb_build_object(
        'direction', v_cur.direction, 'service_time', to_char(v_cur.service_time, 'HH24:MI'),
        'visible_from', to_char(v_cur.start_time, 'HH24:MI'), 'until', to_char(v_cur.end_time, 'HH24:MI')) end,
    'next', case when v_nextw.id is null then null else jsonb_build_object(
        'direction', v_nextw.direction, 'service_time', to_char(v_nextw.service_time, 'HH24:MI'),
        'visible_from', to_char(v_nextw.start_time, 'HH24:MI'), 'date', to_char(v_next, 'YYYY-MM-DD')) end,
    'trip', case when t.id is null then null else jsonb_build_object(
        'state', case when t.ended_at is null then 'live' else 'completed' end,
        'direction', t.direction, 'started_at', t.started_at, 'ended_at', t.ended_at, 'end_reason', t.end_reason) end
  );
end $$;
revoke execute on function public.my_visibility_state() from public, anon;
grant  execute on function public.my_visibility_state() to authenticated;

-- Sürücü: açık sefer ve bugün en son biten sefer (otomatik tamamlandıysa yayını durdurmak için)
create or replace function public.my_trip_state()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_vehicle uuid := private.current_vehicle_id();
  o public.trips; l public.trips; f public.factories;
begin
  if private.current_app_role() <> 'driver' or v_vehicle is null then return null; end if;
  select * into o from public.trips where vehicle_id = v_vehicle and ended_at is null;
  select * into l from public.trips where vehicle_id = v_vehicle and ended_at is not null
     and ended_at > now() - interval '12 hours' order by ended_at desc limit 1;
  select fa.* into f from public.factories fa join public.vehicles v on v.factory_id = fa.id where v.id = v_vehicle;
  return jsonb_build_object(
    'open', case when o.id is null then null else jsonb_build_object(
        'id', o.id, 'started_at', o.started_at, 'direction', o.direction) end,
    'last', case when l.id is null then null else jsonb_build_object(
        'id', l.id, 'started_at', l.started_at, 'ended_at', l.ended_at, 'end_reason', l.end_reason, 'direction', l.direction) end,
    'factory', case when f.id is null then null else jsonb_build_object(
        'name', f.name, 'lat', f.lat, 'lng', f.lng, 'radius_m', f.radius_m) end
  );
end $$;
revoke execute on function public.my_trip_state() from public, anon;
grant  execute on function public.my_trip_state() to authenticated;

revoke execute on all functions in schema private from public;
grant execute on all functions in schema private to authenticated, service_role;
