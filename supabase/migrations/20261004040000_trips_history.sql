-- =====================================================================
-- Sefer geçmişi (yalnızca yönetici görür)
-- =====================================================================
-- * Sürücünün ilk konumu geldiğinde sefer OTOMATİK açılır (istemcinin ayrıca
--   bir şey yapması gerekmez; çevrimdışı kuyruktan geç gelen konumlar da doğru
--   sefere yazılır).
-- * Sefer açılırken aracın durakları "planlanan duraklar" olarak kopyalanır
--   (o gün gelmeyeceğini bildiren yolcular 'absent').
-- * Her konumda: durağa ARRIVE_M metre yaklaşılınca 'arrived' + varış saati;
--   DEPART_M metre uzaklaşılınca ayrılış saati; her durak için en yakın geçiş
--   mesafesi ve saati tutulur ("durağıma gelmedi" itirazı için kanıt).
-- * Sefer sürücü "Servisi bitir" deyince veya 30 dk konum gelmezse kapanır;
--   hiç varılmayan duraklar 'missed' olur.
-- * Saklama: konum geçmişi 90 gün, sefer özetleri 1 yıl.
-- =====================================================================

-- Kuş uçuşu mesafe (metre)
create or replace function private.distance_m(lat1 double precision, lng1 double precision,
                                              lat2 double precision, lng2 double precision)
returns double precision language sql immutable parallel safe set search_path = '' as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)))
$$;

create table public.trips (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete cascade,
  vehicle_id       uuid not null,
  driver_id        uuid,
  service_date     date not null,
  started_at       timestamptz not null,
  ended_at         timestamptz,
  end_reason       text check (end_reason in ('driver', 'inactivity')),
  last_position_at timestamptz,
  last_lat         double precision,
  last_lng         double precision,
  position_count   integer not null default 0,
  distance_m       double precision not null default 0,
  driver_name      text,          -- anlık görüntü (sürücü sonradan silinse de rapor bozulmasın)
  vehicle_plate    text,
  foreign key (company_id, vehicle_id) references public.vehicles(company_id, id) on delete cascade
);
create unique index trips_one_open_per_vehicle on public.trips (vehicle_id) where ended_at is null;
create index trips_company_date_idx on public.trips (company_id, service_date desc);
create index trips_vehicle_date_idx on public.trips (vehicle_id, service_date desc);

create table public.trip_stop_events (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete cascade,
  trip_id        uuid not null references public.trips(id) on delete cascade,
  passenger_id   uuid not null,
  passenger_name text,
  address        text,
  lat            double precision not null,
  lng            double precision not null,
  planned_order  integer,
  status         text not null default 'pending' check (status in ('pending', 'arrived', 'missed', 'absent')),
  arrived_at     timestamptz,
  departed_at    timestamptz,
  closest_m      double precision,
  closest_at     timestamptz,
  unique (trip_id, passenger_id)
);
create index trip_stop_events_trip_idx on public.trip_stop_events (trip_id);
create index trip_stop_events_company_idx on public.trip_stop_events (company_id);

alter table public.vehicle_positions add column trip_id uuid references public.trips(id) on delete set null;
create index vehicle_positions_trip_time_idx on public.vehicle_positions (trip_id, recorded_at);

-- ---------------------------------------------------------------------
-- RLS: yalnızca kendi şirketinin yöneticisi okur; kimse doğrudan yazamaz
-- ---------------------------------------------------------------------
alter table public.trips enable row level security;
alter table public.trip_stop_events enable row level security;
revoke all on public.trips, public.trip_stop_events from anon, authenticated;
grant select on public.trips, public.trip_stop_events to authenticated;
grant all on public.trips, public.trip_stop_events to service_role;

create policy trips_admin_select on public.trips for select to authenticated
  using (company_id = (select private.current_company_id()) and (select private.is_admin()));
create policy trip_stop_events_admin_select on public.trip_stop_events for select to authenticated
  using (company_id = (select private.current_company_id()) and (select private.is_admin()));

create trigger trips_forbid_company_change before update on public.trips
  for each row execute function private.forbid_company_change();
create trigger trip_stop_events_forbid_company_change before update on public.trip_stop_events
  for each row execute function private.forbid_company_change();

-- Konum GEÇMİŞİ yalnızca yöneticiye açık. Sürücü ve yolcu (yetkiliyse) yalnızca
-- son 15 dakikayı görebilir (canlı takip için yeterli).
alter policy positions_select on public.vehicle_positions
  using (
    company_id = (select private.current_company_id())
    and private.can_view_vehicle(vehicle_id)
    and ((select private.is_admin()) or recorded_at > now() - interval '15 minutes')
  );

-- ---------------------------------------------------------------------
-- Sefer açma / kapatma
-- ---------------------------------------------------------------------
create or replace function private.open_trip(p_vehicle uuid, p_company uuid, p_driver uuid, p_at timestamptz)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_trip  uuid;
  v_date  date := (p_at at time zone 'Europe/Istanbul')::date;
begin
  insert into public.trips (company_id, vehicle_id, driver_id, service_date, started_at, driver_name, vehicle_plate)
  values (p_company, p_vehicle, p_driver, v_date, p_at,
          (select full_name from public.profiles where id = p_driver),
          (select plate from public.vehicles where id = p_vehicle))
  on conflict (vehicle_id) where ended_at is null do nothing
  returning id into v_trip;

  if v_trip is null then  -- eşzamanlı başka bir istek açmış
    select id into v_trip from public.trips where vehicle_id = p_vehicle and ended_at is null;
    return v_trip;
  end if;

  -- Planlanan duraklar: aracın yolcuları; sıra bugünkü rotadan (varsa)
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

  return v_trip;
end $$;

create or replace function private.close_trip(p_trip uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.trips
     set ended_at = coalesce(last_position_at, now()), end_reason = p_reason
   where id = p_trip and ended_at is null;
  update public.trip_stop_events set status = 'missed'
   where trip_id = p_trip and status = 'pending';
end $$;

-- Konum eklenmeden önce: açık seferi bul (yoksa aç) ve konuma bağla
create or replace function private.assign_trip()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_trip uuid;
begin
  select id into v_trip from public.trips where vehicle_id = new.vehicle_id and ended_at is null;
  if v_trip is null then
    v_trip := private.open_trip(new.vehicle_id, new.company_id, new.driver_id, new.recorded_at);
  end if;
  new.trip_id := v_trip;
  return new;
end $$;
create trigger vehicle_positions_assign_trip before insert on public.vehicle_positions
  for each row execute function private.assign_trip();

-- Konum eklendikten sonra: sefer istatistikleri + durak varış/ayrılış
create or replace function private.process_trip_position()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  ARRIVE_M constant double precision := 80;
  DEPART_M constant double precision := 150;
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

  return null;
end $$;
create trigger vehicle_positions_process_trip after insert on public.vehicle_positions
  for each row execute function private.process_trip_position();

-- Sürücü "Servisi bitir" dediğinde
create or replace function public.end_my_trip()
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_trip uuid;
begin
  if private.current_app_role() <> 'driver' then return false; end if;
  select id into v_trip from public.trips
   where vehicle_id = private.current_vehicle_id() and ended_at is null;
  if v_trip is null then return false; end if;
  perform private.close_trip(v_trip, 'driver');
  return true;
end $$;
revoke execute on function public.end_my_trip() from public, anon;
grant  execute on function public.end_my_trip() to authenticated;

-- 30 dk konum gelmeyen açık seferleri kapat (pg_cron, 5 dk'da bir)
create or replace function private.close_inactive_trips()
returns integer language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  for r in select id from public.trips
            where ended_at is null and coalesce(last_position_at, started_at) < now() - interval '30 minutes'
  loop
    perform private.close_trip(r.id, 'inactivity');
    n := n + 1;
  end loop;
  return n;
end $$;

-- Devamsızlık açık seferdeki durağı da etkiler
create or replace function private.on_absence_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_row     public.absences := coalesce(new, old);
  v_vehicle uuid;
begin
  if v_row.date <> (now() at time zone 'Europe/Istanbul')::date then
    return null;
  end if;
  select vehicle_id into v_vehicle from public.profiles where id = v_row.passenger_id;

  if tg_op = 'INSERT' then
    update public.trip_stop_events e set status = 'absent'
      from public.trips t
     where t.id = e.trip_id and t.vehicle_id = v_vehicle and t.ended_at is null
       and e.passenger_id = v_row.passenger_id and e.status = 'pending';
  else
    update public.trip_stop_events e set status = 'pending'
      from public.trips t
     where t.id = e.trip_id and t.vehicle_id = v_vehicle and t.ended_at is null
       and e.passenger_id = v_row.passenger_id and e.status = 'absent';
  end if;

  if exists (select 1 from public.daily_routes where vehicle_id = v_vehicle and service_date = v_row.date) then
    perform private.request_route_recompute(v_vehicle);
  end if;
  return null;
end $$;

revoke execute on all functions in schema private from public;
grant execute on all functions in schema private to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Zamanlanmış işler
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('close-inactive-trips', '*/5 * * * *', $j$ select private.close_inactive_trips() $j$);
    perform cron.schedule('purge-old-positions', '15 0 * * *',
      $j$ delete from public.vehicle_positions where recorded_at < now() - interval '90 days' $j$);
    perform cron.schedule('purge-old-trips', '30 0 * * *',
      $j$ delete from public.trips where service_date < (now() at time zone 'Europe/Istanbul')::date - 365 $j$);
  end if;
end $$;
