-- Faz 3: konum doğrulama + görünürlük durumu testleri (ROLLBACK eder)
\set QUIET on
\set ON_ERROR_STOP on
begin;
\o /dev/null
create schema tests;
grant usage on schema tests to authenticated;
create table tests.results (n serial, label text);
grant all on tests.results, tests.results_n_seq to authenticated;
create function tests.ok(label text, cond boolean) returns void language plpgsql as $$
begin if cond is not true then raise exception 'BAŞARISIZ: %', label; end if; insert into tests.results(label) values (label); end $$;
create function tests.fails(q text) returns boolean language plpgsql as $$
begin begin execute q; exception when others then return true; end; return false; end $$;
grant execute on all functions in schema tests to authenticated;

insert into public.companies (id, code, name) values ('c0000000-0000-0000-0000-00000000000a','firma-a','A');
insert into public.vehicles (id, company_id, plate) values
 ('aaaa0000-0000-0000-0000-0000000000a1','c0000000-0000-0000-0000-00000000000a','34 A 1'),
 ('aaaa0000-0000-0000-0000-0000000000a2','c0000000-0000-0000-0000-00000000000a','34 A 2');
insert into auth.users (id) values ('00000000-0000-0000-0000-0000000a0002'),('00000000-0000-0000-0000-0000000a0003'),('00000000-0000-0000-0000-0000000a0004'),('00000000-0000-0000-0000-0000000a0005');
insert into public.profiles (id, company_id, role, username, full_name, vehicle_id) values
 ('00000000-0000-0000-0000-0000000a0002','c0000000-0000-0000-0000-00000000000a','driver','surucu','S','aaaa0000-0000-0000-0000-0000000000a1'),
 ('00000000-0000-0000-0000-0000000a0003','c0000000-0000-0000-0000-00000000000a','passenger','yolcu1','Y1','aaaa0000-0000-0000-0000-0000000000a1'),
 ('00000000-0000-0000-0000-0000000a0004','c0000000-0000-0000-0000-00000000000a','passenger','yolcu2','Y2','aaaa0000-0000-0000-0000-0000000000a2'),
 ('00000000-0000-0000-0000-0000000a0005','c0000000-0000-0000-0000-00000000000a','passenger','yolcu3','Y3',null);
-- A1: şu an açık pencere; A2: yarın 07:00-09:00
insert into public.visibility_windows (company_id, vehicle_id, weekday, start_time, end_time) values
 ('c0000000-0000-0000-0000-00000000000a','aaaa0000-0000-0000-0000-0000000000a1', extract(isodow from now() at time zone 'Europe/Istanbul'), '00:00','23:59:59'),
 ('c0000000-0000-0000-0000-00000000000a','aaaa0000-0000-0000-0000-0000000000a2', extract(isodow from (now() at time zone 'Europe/Istanbul')::date + 1), '07:00','09:00');

select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000a0002"}',true);
set local role authenticated;
select tests.ok('Sürücü şimdiki konumu yazar', not tests.fails($$insert into public.vehicle_positions (vehicle_id,lat,lng) values ('aaaa0000-0000-0000-0000-0000000000a1',41,29)$$));
select tests.ok('Çevrimdışı kuyruktan 3 saat önceki kayıt kabul edilir', not tests.fails($$insert into public.vehicle_positions (vehicle_id,lat,lng,recorded_at) values ('aaaa0000-0000-0000-0000-0000000000a1',41,29, now()-interval '3 hours')$$));
select tests.ok('Gelecek tarihli kayıt reddedilir', tests.fails($$insert into public.vehicle_positions (vehicle_id,lat,lng,recorded_at) values ('aaaa0000-0000-0000-0000-0000000000a1',41,29, now()+interval '1 hour')$$));
select tests.ok('25 saat önceki kayıt reddedilir', tests.fails($$insert into public.vehicle_positions (vehicle_id,lat,lng,recorded_at) values ('aaaa0000-0000-0000-0000-0000000000a1',41,29, now()-interval '25 hours')$$));
reset role;

select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000a0003"}',true);
set local role authenticated;
select tests.ok('Yolcu1: pencere açık', (public.my_visibility_state()->>'open')::boolean);
select tests.ok('Yolcu1: açık pencerenin bitişi döner', public.my_visibility_state()->>'open_until' = '23:59');
reset role;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000a0004"}',true);
set local role authenticated;
select tests.ok('Yolcu2: pencere kapalı', not (public.my_visibility_state()->>'open')::boolean);
select tests.ok('Yolcu2: bir sonraki açılış yarın 07:00',
  public.my_visibility_state()->>'next_open' = to_char((now() at time zone 'Europe/Istanbul')::date + 1, 'YYYY-MM-DD') || 'T07:00');
reset role;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000a0005"}',true);
set local role authenticated;
select tests.ok('Aracı atanmamış yolcu: has_vehicle=false', not (public.my_visibility_state()->>'has_vehicle')::boolean);
reset role;

\o
\set QUIET off
\pset footer off
select n as "#", label as "Test", 'GEÇTİ' as "Sonuç" from tests.results order by n;
select count(*) || ' testin tamamı geçti' as "ÖZET" from tests.results;
rollback;
