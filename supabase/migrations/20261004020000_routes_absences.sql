-- =====================================================================
-- Faz 5–6: Günlük rota + devamsızlıkta otomatik yeniden hesaplama
-- =====================================================================
-- Rota, compute-route Edge Function'ı tarafından hesaplanır ve daily_routes'a
-- yazılır (Google Routes API, optimizeWaypointOrder; anahtar yoksa yedek
-- algoritma). Tetikleyiciler:
--   * Sürücü uygulamayı açınca (istemci çağırır)
--   * Yolcu bugün için "kullanmayacağım" dediğinde / geri aldığında (bu dosyadaki
--     tetikleyici, pg_net ile sunucu tarafında)
-- Yolcular rota tablosunu doğrudan göremez (diğer yolcuların duraklarını
-- içerir); kendi sırası ve tahmini varış süresi için my_route_info() kullanılır.
-- =====================================================================

-- Rotanın bitiş noktası (ör. fabrika/okul). Boşsa en uzak durak bitiş olur.
alter table public.vehicles
  add column end_lat   double precision check (end_lat between -90 and 90),
  add column end_lng   double precision check (end_lng between -180 and 180),
  add column end_label text;

create table public.daily_routes (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  vehicle_id    uuid not null,
  service_date  date not null,
  origin_lat    double precision,
  origin_lng    double precision,
  stops         jsonb not null default '[]'::jsonb,  -- sıralı: [{passenger_id, stop_id, lat, lng, address, eta_s, dist_m}]
  end_point     jsonb,                               -- {lat, lng, label} veya null
  polyline      text,                                -- Google encoded polyline (yedek algoritmada null)
  distance_m    integer,
  duration_s    integer,
  source        text not null check (source in ('google', 'fallback')),
  computed_at   timestamptz not null default now(),
  unique (vehicle_id, service_date),
  foreign key (company_id, vehicle_id) references public.vehicles(company_id, id) on delete cascade
);
create index daily_routes_company_vehicle_idx on public.daily_routes (company_id, vehicle_id);

alter table public.daily_routes enable row level security;
revoke all on public.daily_routes from anon, authenticated;
grant select on public.daily_routes to authenticated;
grant all on public.daily_routes to service_role;

create trigger daily_routes_forbid_company_change before update on public.daily_routes
  for each row execute function private.forbid_company_change();

-- Admin: şirketin tüm rotaları; sürücü: kendi aracı. Yolcu: doğrudan erişim yok.
create policy daily_routes_select on public.daily_routes for select to authenticated
  using (
    company_id = (select private.current_company_id())
    and (
      (select private.is_admin())
      or ((select private.current_app_role()) = 'driver' and vehicle_id = (select private.current_vehicle_id()))
    )
  );

-- Sürücünün canlı rota güncellemesini alması için
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.daily_routes;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Yolcu: kendi durağının bugünkü sırası ve tahmini varış süresi
-- ---------------------------------------------------------------------
create or replace function public.my_route_info()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid     uuid := auth.uid();
  v_vehicle uuid := private.current_vehicle_id();
  v_today   date := (now() at time zone 'Europe/Istanbul')::date;
  r         public.daily_routes;
  v_idx     int;
  v_stop    jsonb;
begin
  if v_vehicle is null or private.current_app_role() <> 'passenger' then
    return jsonb_build_object('available', false);
  end if;
  if exists (select 1 from public.absences where passenger_id = v_uid and date = v_today) then
    return jsonb_build_object('available', true, 'absent_today', true);
  end if;
  select * into r from public.daily_routes where vehicle_id = v_vehicle and service_date = v_today;
  if not found then
    return jsonb_build_object('available', false, 'absent_today', false);
  end if;
  select ord - 1, e into v_idx, v_stop
  from jsonb_array_elements(r.stops) with ordinality as t(e, ord)
  where (e->>'passenger_id')::uuid = v_uid;
  return jsonb_build_object(
    'available', true,
    'absent_today', false,
    'my_order', case when v_idx is not null then v_idx + 1 end,
    'total_stops', jsonb_array_length(r.stops),
    'eta_s_from_start', v_stop->'eta_s',
    'computed_at', r.computed_at,
    'source', r.source
  );
end $$;
revoke execute on function public.my_route_info() from public, anon;
grant  execute on function public.my_route_info() to authenticated;

-- ---------------------------------------------------------------------
-- Devamsızlık değişince bugünkü rotayı sunucu tarafında yeniden hesapla
-- ---------------------------------------------------------------------
insert into private.app_secrets (key, value) values
  ('internal_secret', md5(gen_random_uuid()::text || clock_timestamp()::text) || md5(gen_random_uuid()::text))
on conflict (key) do nothing;

-- Proje adresi: Edge Function çağrıları için (migration'da projeye göre ayarlanır)
insert into private.app_secrets (key, value) values ('functions_url', 'http://localhost:54321/functions/v1')
on conflict (key) do nothing;

create or replace function public.verify_internal_secret(p_secret text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.app_secrets where key = 'internal_secret' and value = p_secret)
$$;
revoke execute on function public.verify_internal_secret(text) from public, anon, authenticated;
grant  execute on function public.verify_internal_secret(text) to service_role;

create or replace function private.request_route_recompute(p_vehicle_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_url text; v_secret text;
begin
  if p_vehicle_id is null then return; end if;
  if not exists (select 1 from pg_extension where extname = 'pg_net') then return; end if;
  select value into v_url    from private.app_secrets where key = 'functions_url';
  select value into v_secret from private.app_secrets where key = 'internal_secret';
  execute $q$ select net.http_post(
      url := $1 || '/compute-route',
      headers := jsonb_build_object('Content-Type','application/json','x-internal-secret',$2),
      body := jsonb_build_object('vehicle_id',$3),
      timeout_milliseconds := 30000) $q$
    using v_url, v_secret, p_vehicle_id;
end $$;

create or replace function private.on_absence_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_row     public.absences := coalesce(new, old);
  v_vehicle uuid;
begin
  -- Yalnızca bugünün rotası etkilenir (ileri tarihli devamsızlık o günün rotasında dikkate alınır)
  if v_row.date <> (now() at time zone 'Europe/Istanbul')::date then
    return null;
  end if;
  select vehicle_id into v_vehicle from public.profiles where id = v_row.passenger_id;
  -- Bugün için henüz rota yoksa hesaplamaya gerek yok (sürücü başlatınca hesaplanır)
  if exists (select 1 from public.daily_routes where vehicle_id = v_vehicle and service_date = v_row.date) then
    perform private.request_route_recompute(v_vehicle);
  end if;
  return null;
end $$;

create trigger absences_recompute_route after insert or delete on public.absences
  for each row execute function private.on_absence_change();
