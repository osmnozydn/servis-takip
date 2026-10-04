-- =====================================================================
-- Faz 3: Canlı konum yayını
-- =====================================================================

-- 1) Konum kaydı doğrulaması: gelecekten tarih yok; 24 saatten eski (çevrimdışı
--    kuyruktan çok geç gelen) kayıt kabul edilmez.
alter policy positions_driver_insert on public.vehicle_positions
  with check (
    company_id = (select private.current_company_id())
    and (select private.current_app_role()) = 'driver'
    and driver_id = (select auth.uid())
    and vehicle_id = (select private.current_vehicle_id())
    and recorded_at <= now() + interval '2 minutes'
    and recorded_at >  now() - interval '24 hours'
  );

-- 2) Yolcu ekranı için: aracımın konumu şu an görünür mü, değilse ne zaman açılır?
--    (Yalnızca kendi aracı; hesap sunucuda, İstanbul saatiyle.)
create or replace function public.my_visibility_state()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_vehicle uuid := private.current_vehicle_id();
  v_now     timestamp := now() at time zone 'Europe/Istanbul';
  v_open    boolean;
  v_end     time;
  v_next    timestamp;
  d         int;
begin
  if v_vehicle is null then
    return jsonb_build_object('has_vehicle', false);
  end if;

  select true, w.end_time into v_open, v_end
  from public.visibility_windows w
  where w.vehicle_id = v_vehicle
    and w.weekday = extract(isodow from v_now)::int
    and v_now::time >= w.start_time and v_now::time < w.end_time
  order by w.end_time desc limit 1;

  -- Bir sonraki açılış: bugünden başlayarak 7 gün içinde ilk pencere başlangıcı
  for d in 0..7 loop
    select (v_now::date + d) + w.start_time into v_next
    from public.visibility_windows w
    where w.vehicle_id = v_vehicle
      and w.weekday = extract(isodow from (v_now::date + d))::int
      and (d > 0 or w.start_time > v_now::time)
    order by w.start_time limit 1;
    exit when v_next is not null;
  end loop;

  return jsonb_build_object(
    'has_vehicle', true,
    'open', coalesce(v_open, false),
    'open_until', case when v_open then to_char(v_end, 'HH24:MI') end,
    'next_open', case when v_next is not null then to_char(v_next, 'YYYY-MM-DD"T"HH24:MI') end
  );
end $$;
revoke execute on function public.my_visibility_state() from public, anon;
grant  execute on function public.my_visibility_state() to authenticated;

-- 3) Saklama süresi: 30 günden eski konum geçmişi her gece silinir
--    (son görülen konum ayrı tabloda kalır).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule(
      'purge-old-positions',
      '15 0 * * *',   -- her gün 03:15 İstanbul (00:15 UTC)
      $job$ delete from public.vehicle_positions where recorded_at < now() - interval '30 days' $job$
    );
  end if;
end $$;
