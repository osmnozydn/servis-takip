-- =====================================================================
-- RLS / şirket izolasyonu testleri
-- Çalıştırma:  psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_isolation.sql
-- Tümü tek transaction içinde çalışır ve sonunda ROLLBACK edilir:
-- veritabanında hiçbir iz bırakmaz. Herhangi bir test başarısız olursa
-- hata mesajıyla durur.
-- =====================================================================
\set QUIET on
\set ON_ERROR_STOP on
begin;
\o /dev/null

-- ---------------------------------------------------------------------
-- Test yardımcıları
-- ---------------------------------------------------------------------
create schema tests;
grant usage on schema tests to authenticated, anon;

create table tests.results (n serial, label text, ok boolean);
grant all on tests.results to authenticated, anon;
grant all on sequence tests.results_n_seq to authenticated, anon;

create function tests.eq(label text, actual bigint, expected bigint) returns void language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'BAŞARISIZ: % (beklenen %, gelen %)', label, expected, actual;
  end if;
  insert into tests.results(label, ok) values (label, true);
end $$;

create function tests.cnt(q text) returns bigint language plpgsql as $$
declare c bigint;
begin execute format('select count(*) from (%s) x', q) into c; return c; end $$;

-- Sorgu hata veriyorsa 1, vermiyorsa 0 (hata savepoint ile geri alınır)
create function tests.fails(q text) returns bigint language plpgsql as $$
begin
  begin execute q; exception when others then return 1; end;
  return 0;
end $$;

-- UPDATE/DELETE'in etkilediği satır sayısı
create function tests.affected(q text) returns bigint language plpgsql as $$
declare c bigint;
begin execute q; get diagnostics c = row_count; return c; end $$;

-- Verilen şirketin satırlarından, giriş yapan kullanıcının görebildiği toplam sayı (8 tablo)
create function tests.visible_rows_of(company uuid) returns bigint language plpgsql as $$
declare t text; c bigint; total bigint := 0;
begin
  foreach t in array array['vehicles','profiles','stops','visibility_windows','absences',
                           'vehicle_positions','vehicle_last_positions']
  loop
    execute format('select count(*) from public.%I where company_id = $1', t) into c using company;
    total := total + c;
  end loop;
  select count(*) into c from public.companies where id = company;
  return total + c;
end $$;

grant execute on all functions in schema tests to authenticated, anon;

-- ---------------------------------------------------------------------
-- Test verisi (service role / postgres olarak)
--   Şirket A: admin, sürücü(A1), yolcu1(A1), yolcu2(A2), sürücü2(A2)
--   Şirket B: admin, sürücü(B1), yolcu(B1)
--   A1 ve B1'in görünürlük penceresi ŞU AN AÇIK; A2'ninki başka bir günde (kapalı).
-- ---------------------------------------------------------------------
insert into public.companies (id, code, name) values
  ('c0000000-0000-0000-0000-00000000000a', 'firma-a', 'Firma A'),
  ('c0000000-0000-0000-0000-00000000000b', 'firma-b', 'Firma B');

insert into public.vehicles (id, company_id, plate) values
  ('aaaa0000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-00000000000a', '34 AAA 01'),
  ('aaaa0000-0000-0000-0000-0000000000a2', 'c0000000-0000-0000-0000-00000000000a', '34 AAA 02'),
  ('bbbb0000-0000-0000-0000-0000000000b1', 'c0000000-0000-0000-0000-00000000000b', '34 BBB 01');

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000a0001', 'admin@firma-a.servis.local'),
  ('00000000-0000-0000-0000-0000000a0002', 'surucu@firma-a.servis.local'),
  ('00000000-0000-0000-0000-0000000a0003', 'yolcu1@firma-a.servis.local'),
  ('00000000-0000-0000-0000-0000000a0004', 'yolcu2@firma-a.servis.local'),
  ('00000000-0000-0000-0000-0000000a0005', 'surucu2@firma-a.servis.local'),
  ('00000000-0000-0000-0000-0000000b0001', 'admin@firma-b.servis.local'),
  ('00000000-0000-0000-0000-0000000b0002', 'surucu@firma-b.servis.local'),
  ('00000000-0000-0000-0000-0000000b0003', 'yolcu@firma-b.servis.local');

insert into public.profiles (id, company_id, role, username, phone, full_name, vehicle_id) values
  ('00000000-0000-0000-0000-0000000a0001', 'c0000000-0000-0000-0000-00000000000a', 'admin',     'admin',   '05320000001', 'A Yönetici', null),
  ('00000000-0000-0000-0000-0000000a0002', 'c0000000-0000-0000-0000-00000000000a', 'driver',    'surucu',  '05320000002', 'A Sürücü',   'aaaa0000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000a0003', 'c0000000-0000-0000-0000-00000000000a', 'passenger', 'yolcu1',  '05320000003', 'A Yolcu 1',  'aaaa0000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000a0004', 'c0000000-0000-0000-0000-00000000000a', 'passenger', 'yolcu2',  '05320000004', 'A Yolcu 2',  'aaaa0000-0000-0000-0000-0000000000a2'),
  ('00000000-0000-0000-0000-0000000a0005', 'c0000000-0000-0000-0000-00000000000a', 'driver',    'surucu2', '05320000005', 'A Sürücü 2', 'aaaa0000-0000-0000-0000-0000000000a2'),
  -- B'de de aynı kullanıcı adı/telefon: şirket bazında benzersizlik
  ('00000000-0000-0000-0000-0000000b0001', 'c0000000-0000-0000-0000-00000000000b', 'admin',     'admin',   '05320000001', 'B Yönetici', null),
  ('00000000-0000-0000-0000-0000000b0002', 'c0000000-0000-0000-0000-00000000000b', 'driver',    'surucu',  '05320000002', 'B Sürücü',   'bbbb0000-0000-0000-0000-0000000000b1'),
  ('00000000-0000-0000-0000-0000000b0003', 'c0000000-0000-0000-0000-00000000000b', 'passenger', 'yolcu',   '05320000006', 'B Yolcu',    'bbbb0000-0000-0000-0000-0000000000b1');

insert into public.stops (company_id, passenger_id, lat, lng, address) values
  ('c0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000a0003', 41.0082, 28.9784, 'Sultanahmet'),
  ('c0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000a0004', 41.0369, 28.9850, 'Taksim'),
  ('c0000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000b0003', 40.9909, 29.0303, 'Kadıköy');

insert into public.visibility_windows (company_id, vehicle_id, weekday, start_time, end_time) values
  ('c0000000-0000-0000-0000-00000000000a', 'aaaa0000-0000-0000-0000-0000000000a1',
     extract(isodow from now() at time zone 'Europe/Istanbul'), '00:00', '23:59:59.999'),
  ('c0000000-0000-0000-0000-00000000000a', 'aaaa0000-0000-0000-0000-0000000000a2',
     (extract(isodow from now() at time zone 'Europe/Istanbul')::int % 7) + 1, '00:00', '23:59:59.999'),
  ('c0000000-0000-0000-0000-00000000000b', 'bbbb0000-0000-0000-0000-0000000000b1',
     extract(isodow from now() at time zone 'Europe/Istanbul'), '00:00', '23:59:59.999');

insert into public.absences (company_id, passenger_id, date) values
  ('c0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000a0004', (now() at time zone 'Europe/Istanbul')::date),
  ('c0000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000b0003', (now() at time zone 'Europe/Istanbul')::date);

-- ---------------------------------------------------------------------
-- 1) Sürücüler konum gönderir (insert politikasının kendisi de test edilir)
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000a0002","role":"authenticated"}', true);
set local role authenticated;
insert into public.vehicle_positions (vehicle_id, lat, lng) values ('aaaa0000-0000-0000-0000-0000000000a1', 41.01, 28.97);
select tests.eq('A sürücüsü başka şirketin aracına konum YAZAMAZ',
  tests.fails($$insert into public.vehicle_positions (vehicle_id, lat, lng) values ('bbbb0000-0000-0000-0000-0000000000b1', 1, 1)$$), 1);
select tests.eq('A sürücüsü kendi şirketindeki BAŞKA araca konum yazamaz',
  tests.fails($$insert into public.vehicle_positions (vehicle_id, lat, lng) values ('aaaa0000-0000-0000-0000-0000000000a2', 1, 1)$$), 1);
select tests.eq('A sürücüsü company_id=B vererek konum yazamaz',
  tests.fails($$insert into public.vehicle_positions (company_id, vehicle_id, lat, lng) values ('c0000000-0000-0000-0000-00000000000b','aaaa0000-0000-0000-0000-0000000000a1', 1, 1)$$), 1);
select tests.eq('A sürücüsü başkası adına (driver_id) konum yazamaz',
  tests.fails($$insert into public.vehicle_positions (driver_id, vehicle_id, lat, lng) values ('00000000-0000-0000-0000-0000000a0005','aaaa0000-0000-0000-0000-0000000000a1', 1, 1)$$), 1);
-- Geç gelen eski kayıt "son görülen konum"u ezmemeli
insert into public.vehicle_positions (vehicle_id, lat, lng, recorded_at) values ('aaaa0000-0000-0000-0000-0000000000a1', 40.00, 28.00, now() - interval '1 hour');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000a0005","role":"authenticated"}', true);
set local role authenticated;
insert into public.vehicle_positions (vehicle_id, lat, lng) values ('aaaa0000-0000-0000-0000-0000000000a2', 41.04, 28.99);
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000b0002","role":"authenticated"}', true);
set local role authenticated;
insert into public.vehicle_positions (vehicle_id, lat, lng) values ('bbbb0000-0000-0000-0000-0000000000b1', 40.99, 29.03);
reset role;

select tests.eq('Son görülen konum: eski tarihli kayıt yeni kaydı ezmedi',
  tests.cnt($$select 1 from public.vehicle_last_positions where vehicle_id='aaaa0000-0000-0000-0000-0000000000a1' and lat = 41.01$$), 1);
select tests.eq('Son görülen konum: her araç için tek satır',
  tests.cnt($$select 1 from public.vehicle_last_positions$$), 3);

-- ---------------------------------------------------------------------
-- 2) ŞİRKET İZOLASYONU: her kullanıcı, diğer şirketin 8 tablosunda 0 satır görür
-- ---------------------------------------------------------------------
do $$
declare
  u record;
begin
  for u in
    select * from (values
      ('00000000-0000-0000-0000-0000000a0001', 'c0000000-0000-0000-0000-00000000000b', 'A admin'),
      ('00000000-0000-0000-0000-0000000a0002', 'c0000000-0000-0000-0000-00000000000b', 'A sürücü'),
      ('00000000-0000-0000-0000-0000000a0003', 'c0000000-0000-0000-0000-00000000000b', 'A yolcu'),
      ('00000000-0000-0000-0000-0000000b0001', 'c0000000-0000-0000-0000-00000000000a', 'B admin'),
      ('00000000-0000-0000-0000-0000000b0002', 'c0000000-0000-0000-0000-00000000000a', 'B sürücü'),
      ('00000000-0000-0000-0000-0000000b0003', 'c0000000-0000-0000-0000-00000000000a', 'B yolcu')
    ) as t(uid, other_company, label)
  loop
    perform set_config('request.jwt.claims', json_build_object('sub', u.uid, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    perform tests.eq(u.label || ': diğer şirketin hiçbir satırını göremez (8 tablo)',
                     tests.visible_rows_of(u.other_company::uuid), 0);
    execute 'reset role';
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 3) A ADMİN: kendi şirketinin tamamını görür, B'ye yazamaz
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000a0001","role":"authenticated"}', true);
set local role authenticated;
select tests.eq('A admin: kendi şirketi',            tests.cnt('select 1 from public.companies'), 1);
select tests.eq('A admin: tüm A araçları',           tests.cnt('select 1 from public.vehicles'), 2);
select tests.eq('A admin: tüm A profilleri',         tests.cnt('select 1 from public.profiles'), 5);
select tests.eq('A admin: tüm A durakları',          tests.cnt('select 1 from public.stops'), 2);
select tests.eq('A admin: tüm A saat pencereleri',   tests.cnt('select 1 from public.visibility_windows'), 2);
select tests.eq('A admin: A devamsızlıkları',        tests.cnt('select 1 from public.absences'), 1);
select tests.eq('A admin: A konum geçmişi',          tests.cnt('select 1 from public.vehicle_positions'), 3);
select tests.eq('A admin: A araçlarının son konumu (pencereden bağımsız)', tests.cnt('select 1 from public.vehicle_last_positions'), 2);

select tests.eq('A admin: company_id=B ile araç ekleyemez',
  tests.fails($$insert into public.vehicles (company_id, plate) values ('c0000000-0000-0000-0000-00000000000b', '34 XXX 99')$$), 1);
select tests.eq('A admin: company_id vermeden eklediği araç A şirketine yazılır',
  tests.fails($$insert into public.vehicles (plate) values ('34 AAA 03')$$), 0);
select tests.eq('A admin: yeni araç A şirketinde',
  tests.cnt($$select 1 from public.vehicles where plate='34 AAA 03' and company_id='c0000000-0000-0000-0000-00000000000a'$$), 1);
select tests.eq('A admin: B yolcusuna durak ekleyemez',
  tests.fails($$insert into public.stops (passenger_id, lat, lng) values ('00000000-0000-0000-0000-0000000b0003', 41, 29)$$), 1);
select tests.eq('A admin: A yolcusuna B aracını atayamaz (bileşik FK)',
  tests.fails($$update public.profiles set vehicle_id='bbbb0000-0000-0000-0000-0000000000b1' where id='00000000-0000-0000-0000-0000000a0003'$$), 1);
select tests.eq('A admin: B şirketine pencere ekleyemez',
  tests.fails($$insert into public.visibility_windows (company_id, vehicle_id, weekday, start_time, end_time) values ('c0000000-0000-0000-0000-00000000000b','bbbb0000-0000-0000-0000-0000000000b1',1,'07:00','09:00')$$), 1);
select tests.eq('A admin: B yolcusuna devamsızlık ekleyemez',
  tests.fails($$insert into public.absences (passenger_id, date) values ('00000000-0000-0000-0000-0000000b0003', current_date + 1)$$), 1);
select tests.eq('A admin: B araçlarını GÜNCELLEYEMEZ (0 satır)',
  tests.affected($$update public.vehicles set name='hack' where company_id='c0000000-0000-0000-0000-00000000000b'$$), 0);
select tests.eq('A admin: B profillerini SİLEMEZ (0 satır)',
  tests.affected($$delete from public.profiles where company_id='c0000000-0000-0000-0000-00000000000b'$$), 0);
select tests.eq('A admin: B şirketini GÜNCELLEYEMEZ (0 satır)',
  tests.affected($$update public.companies set name='hack' where code='firma-b'$$), 0);
select tests.eq('A admin: kendi kaydının company_id değerini B yapamaz',
  tests.fails($$update public.vehicles set company_id='c0000000-0000-0000-0000-00000000000b' where id='aaaa0000-0000-0000-0000-0000000000a1'$$), 1);
select tests.eq('A admin: yolcu dışındaki birine durak tanımlayamaz',
  tests.fails($$insert into public.stops (passenger_id, lat, lng) values ('00000000-0000-0000-0000-0000000a0002', 41, 29)$$), 1);
reset role;

-- ---------------------------------------------------------------------
-- 4) A SÜRÜCÜ (A1): kendi aracı ve yolcuları
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000a0002","role":"authenticated"}', true);
set local role authenticated;
select tests.eq('A sürücü: yalnızca kendi aracı',               tests.cnt('select 1 from public.vehicles'), 1);
select tests.eq('A sürücü: kendisi + A1 yolcusu',               tests.cnt('select 1 from public.profiles'), 2);
select tests.eq('A sürücü: yalnızca A1 durakları',              tests.cnt('select 1 from public.stops'), 1);
select tests.eq('A sürücü: A2 yolcusunun devamsızlığını görmez', tests.cnt('select 1 from public.absences'), 0);
select tests.eq('A sürücü: kendi aracının son konumu',          tests.cnt('select 1 from public.vehicle_last_positions'), 1);
select tests.eq('A sürücü: araç ekleyemez',
  tests.fails($$insert into public.vehicles (plate) values ('34 ZZZ 01')$$), 1);
select tests.eq('A sürücü: kendi rolünü admin yapamaz',
  tests.fails($$update public.profiles set role='admin' where id='00000000-0000-0000-0000-0000000a0002'$$), 1);
reset role;

-- ---------------------------------------------------------------------
-- 5) A YOLCU 1 (A1, pencere AÇIK)
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000a0003","role":"authenticated"}', true);
set local role authenticated;
select tests.eq('A yolcu1: kendi servis aracı',                  tests.cnt('select 1 from public.vehicles'), 1);
select tests.eq('A yolcu1: kendisi + sürücüsü (diğer yolcular gizli)', tests.cnt('select 1 from public.profiles'), 2);
select tests.eq('A yolcu1: yalnızca kendi durağı',               tests.cnt('select 1 from public.stops'), 1);
select tests.eq('A yolcu1: pencere açık → aracın son konumunu görür', tests.cnt('select 1 from public.vehicle_last_positions'), 1);
select tests.eq('A yolcu1: pencere açık → yalnızca son 15 dk konumlar', tests.cnt('select 1 from public.vehicle_positions'), 1);
select tests.eq('A yolcu1: B aracının konumunu görmez (B penceresi açık olsa da)',
  tests.cnt($$select 1 from public.vehicle_last_positions where vehicle_id='bbbb0000-0000-0000-0000-0000000000b1'$$), 0);
select tests.eq('A yolcu1: bugün için devamsızlık ekleyebilir',
  tests.fails($$insert into public.absences (passenger_id, date) values ('00000000-0000-0000-0000-0000000a0003', (now() at time zone 'Europe/Istanbul')::date)$$), 0);
select tests.eq('A yolcu1: geçmiş tarihe devamsızlık ekleyemez',
  tests.fails($$insert into public.absences (passenger_id, date) values ('00000000-0000-0000-0000-0000000a0003', (now() at time zone 'Europe/Istanbul')::date - 1)$$), 1);
select tests.eq('A yolcu1: başka yolcu adına devamsızlık ekleyemez',
  tests.fails($$insert into public.absences (passenger_id, date) values ('00000000-0000-0000-0000-0000000a0004', (now() at time zone 'Europe/Istanbul')::date + 1)$$), 1);
select tests.eq('A yolcu1: konum yazamaz',
  tests.fails($$insert into public.vehicle_positions (vehicle_id, lat, lng) values ('aaaa0000-0000-0000-0000-0000000000a1', 1, 1)$$), 1);
select tests.eq('A yolcu1: kendi adını değiştirebilir',
  tests.affected($$update public.profiles set full_name='Yeni Ad' where id='00000000-0000-0000-0000-0000000a0003'$$), 1);
select tests.eq('A yolcu1: kendini başka araca atayamaz',
  tests.fails($$update public.profiles set vehicle_id='aaaa0000-0000-0000-0000-0000000000a2' where id='00000000-0000-0000-0000-0000000a0003'$$), 1);
select tests.eq('A yolcu1: durağını değiştiremez (0 satır)',
  tests.affected($$update public.stops set lat=0$$), 0);
reset role;

-- ---------------------------------------------------------------------
-- 6) A YOLCU 2 (A2, pencere KAPALI) — 7/24 görünmeme kuralı
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000a0004","role":"authenticated"}', true);
set local role authenticated;
select tests.eq('A yolcu2: araç bilgisini (plaka) görür',            tests.cnt('select 1 from public.vehicles'), 1);
select tests.eq('A yolcu2: pencere kapalı → son konumu GÖREMEZ',     tests.cnt('select 1 from public.vehicle_last_positions'), 0);
select tests.eq('A yolcu2: pencere kapalı → konum geçmişi GÖREMEZ',  tests.cnt('select 1 from public.vehicle_positions'), 0);
select tests.eq('A yolcu2: pencerelerini görür (ne zaman açılacağını bilsin)', tests.cnt('select 1 from public.visibility_windows'), 1);
reset role;

-- A2 sürücüsü pencereden bağımsız kendi aracını görür
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000a0005","role":"authenticated"}', true);
set local role authenticated;
select tests.eq('A sürücü2: pencere kapalı olsa da kendi aracının konumunu görür', tests.cnt('select 1 from public.vehicle_last_positions'), 1);
reset role;

-- Pencere açılınca yolcu2 görmeye başlar
insert into public.visibility_windows (company_id, vehicle_id, weekday, start_time, end_time) values
  ('c0000000-0000-0000-0000-00000000000a', 'aaaa0000-0000-0000-0000-0000000000a2',
   extract(isodow from now() at time zone 'Europe/Istanbul'), '00:00', '23:59:59.999');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000a0004","role":"authenticated"}', true);
set local role authenticated;
select tests.eq('A yolcu2: pencere açılınca son konumu görür', tests.cnt('select 1 from public.vehicle_last_positions'), 1);
reset role;

-- Yolcunun aracı değişince durağı da taşınır
update public.profiles set vehicle_id = 'aaaa0000-0000-0000-0000-0000000000a1' where id = '00000000-0000-0000-0000-0000000a0004';
select tests.eq('Yolcu araç değiştirince durağı yeni araca taşındı',
  tests.cnt($$select 1 from public.stops where passenger_id='00000000-0000-0000-0000-0000000a0004' and vehicle_id='aaaa0000-0000-0000-0000-0000000000a1'$$), 1);

-- ---------------------------------------------------------------------
-- 7) Giriş yapmamış (anon)
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', '', true);
set local role anon;
select tests.eq('anon: tablolara erişemez',      tests.fails('select * from public.vehicles'), 1);
select tests.eq('anon: profilleri okuyamaz',     tests.fails('select * from public.profiles'), 1);
select tests.eq('anon: health() çalışır',        tests.cnt($$select 1 where (public.health()->>'ok')::boolean$$), 1);
reset role;

-- ---------------------------------------------------------------------
-- Sonuç
-- ---------------------------------------------------------------------
\o
\set QUIET off
\pset footer off
select n as "#", label as "Test", case when ok then 'GEÇTİ' end as "Sonuç" from tests.results order by n;
select count(*) || ' testin tamamı geçti' as "ÖZET" from tests.results;

rollback;
