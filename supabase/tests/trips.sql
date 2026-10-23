-- Sefer geçmişi testleri (ROLLBACK eder)
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
create function tests.cnt(q text) returns bigint language plpgsql as $$ declare c bigint; begin execute format('select count(*) from (%s) x', q) into c; return c; end $$;
grant execute on all functions in schema tests to authenticated;

insert into public.companies (id, code, name) values ('c0000000-0000-0000-0000-00000000000a','firma-a','A'),('c0000000-0000-0000-0000-00000000000b','firma-b','B');
insert into public.vehicles (id, company_id, plate) values ('aaaa0000-0000-0000-0000-0000000000a1','c0000000-0000-0000-0000-00000000000a','34 A 1');
insert into auth.users (id) values ('00000000-0000-0000-0000-0000000a0001'),('00000000-0000-0000-0000-0000000a0002'),
  ('00000000-0000-0000-0000-0000000a0011'),('00000000-0000-0000-0000-0000000a0012'),('00000000-0000-0000-0000-0000000a0013'),('00000000-0000-0000-0000-0000000a0014'),
  ('00000000-0000-0000-0000-0000000b0001');
insert into public.profiles (id, company_id, role, username, full_name, vehicle_id) values
 ('00000000-0000-0000-0000-0000000a0001','c0000000-0000-0000-0000-00000000000a','admin','admin','A Yönetici',null),
 ('00000000-0000-0000-0000-0000000a0002','c0000000-0000-0000-0000-00000000000a','driver','surucu','Mehmet Sürücü','aaaa0000-0000-0000-0000-0000000000a1'),
 ('00000000-0000-0000-0000-0000000a0011','c0000000-0000-0000-0000-00000000000a','passenger','moda','Moda Yolcu','aaaa0000-0000-0000-0000-0000000000a1'),
 ('00000000-0000-0000-0000-0000000a0012','c0000000-0000-0000-0000-00000000000a','passenger','uskudar','Üsküdar Yolcu','aaaa0000-0000-0000-0000-0000000000a1'),
 ('00000000-0000-0000-0000-0000000a0013','c0000000-0000-0000-0000-00000000000a','passenger','kozyatagi','Kozyatağı Yolcu','aaaa0000-0000-0000-0000-0000000000a1'),
 ('00000000-0000-0000-0000-0000000a0014','c0000000-0000-0000-0000-00000000000a','passenger','atasehir','Ataşehir Yolcu','aaaa0000-0000-0000-0000-0000000000a1'),
 ('00000000-0000-0000-0000-0000000b0001','c0000000-0000-0000-0000-00000000000b','admin','admin','B Yönetici',null);
insert into public.stops (company_id, passenger_id, lat, lng, address) values
 ('c0000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000a0011',40.9862,29.0257,'Moda'),
 ('c0000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000a0012',41.0255,29.0153,'Üsküdar'),
 ('c0000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000a0013',40.9765,29.0978,'Kozyatağı'),
 ('c0000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000a0014',40.9923,29.1244,'Ataşehir');
-- Ataşehir yolcusu bugün gelmeyecek
insert into public.absences (company_id, passenger_id, date) values
 ('c0000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000a0014',((now() - interval '60 min') at time zone 'Europe/Istanbul')::date);

-- Sürücü: Moda (2 dk bekler) → Kozyatağı → Ataşehir yakınından geçer; Üsküdar'a HİÇ gitmez.
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000a0002"}',true);
set local role authenticated;
insert into public.vehicle_positions (vehicle_id, lat, lng, recorded_at) values
 ('aaaa0000-0000-0000-0000-0000000000a1', 40.9800, 29.0300, now() - interval '60 min'),
 ('aaaa0000-0000-0000-0000-0000000000a1', 40.9858, 29.0259, now() - interval '55 min'),   -- Moda'ya ~50 m: VARIŞ
 ('aaaa0000-0000-0000-0000-0000000000a1', 40.9861, 29.0258, now() - interval '54 min'),
 ('aaaa0000-0000-0000-0000-0000000000a1', 40.9862, 29.0257, now() - interval '53 min'),   -- tam durak
 ('aaaa0000-0000-0000-0000-0000000000a1', 40.9840, 29.0350, now() - interval '50 min'),   -- uzaklaştı: AYRILIŞ
 ('aaaa0000-0000-0000-0000-0000000000a1', 40.9780, 29.0700, now() - interval '42 min'),
 ('aaaa0000-0000-0000-0000-0000000000a1', 40.9766, 29.0975, now() - interval '35 min'),   -- Kozyatağı: VARIŞ
 ('aaaa0000-0000-0000-0000-0000000000a1', 40.9800, 29.1100, now() - interval '30 min'),   -- AYRILIŞ
 ('aaaa0000-0000-0000-0000-0000000000a1', 40.9900, 29.1230, now() - interval '25 min');   -- Ataşehir'e ~300 m (devamsız)
-- Çevrimdışı kuyruktan GEÇ gelen eski bir konum (Kozyatağı'na daha erken varış)
insert into public.vehicle_positions (vehicle_id, lat, lng, recorded_at) values
 ('aaaa0000-0000-0000-0000-0000000000a1', 40.9765, 29.0980, now() - interval '36 min');
reset role;

select tests.ok('İlk konumla sefer otomatik açıldı (tek sefer)', (select count(*) from public.trips) = 1);
select tests.ok('Tüm konumlar sefere bağlandı', (select count(*) from public.vehicle_positions where trip_id is null) = 0);
select tests.ok('Sefer başlangıcı = ilk konumun zamanı', (select started_at between now() - interval '61 min' and now() - interval '59 min' from public.trips));
select tests.ok('Sefere 4 planlanan durak kopyalandı', (select count(*) from public.trip_stop_events) = 4);
select tests.ok('Sefer mesafesi hesaplandı (> 8 km)', (select distance_m > 8000 from public.trips));
select tests.ok('Sürücü adı ve plaka sefere kaydedildi', (select driver_name = 'Mehmet Sürücü' and vehicle_plate = '34 A 1' from public.trips));

select tests.ok('Moda: VARILDI, varış saati 55. dakika',
  (select status = 'arrived' and arrived_at between now() - interval '56 min' and now() - interval '54 min' from public.trip_stop_events where address='Moda'));
select tests.ok('Moda: ayrılış saati 50. dakika (durakta ~5 dk)',
  (select departed_at between now() - interval '51 min' and now() - interval '49 min' from public.trip_stop_events where address='Moda'));
select tests.ok('Moda: en yakın geçiş 0 m',
  (select closest_m < 5 from public.trip_stop_events where address='Moda'));
select tests.ok('Kozyatağı: geç gelen konum sayesinde varış 36. dakikaya düzeltildi',
  (select status = 'arrived' and arrived_at between now() - interval '37 min' and now() - interval '35.5 min' from public.trip_stop_events where address='Kozyatağı'));
select tests.ok('Ataşehir: "gelmeyecek" olarak işaretli (absent), en yakın geçiş ~300 m kaydedildi',
  (select status = 'absent' and closest_m between 200 and 400 from public.trip_stop_events where address='Ataşehir'));
select tests.ok('Üsküdar: sefer sürerken hâlâ bekleniyor (pending)',
  (select status = 'pending' from public.trip_stop_events where address='Üsküdar'));

-- Sürücü servisi bitirir
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000a0002"}',true);
set local role authenticated;
select tests.ok('Sürücü seferi bitirir', public.end_my_trip());
reset role;
select tests.ok('Sefer kapandı (bitiş = son konum zamanı, neden: sürücü)',
  (select ended_at between now() - interval '26 min' and now() - interval '24 min' and end_reason = 'driver' from public.trips));
select tests.ok('Üsküdar: UĞRANMADI (missed) — en yakın geçiş > 3 km',
  (select status = 'missed' and closest_m > 3000 and closest_at is not null from public.trip_stop_events where address='Üsküdar'));

-- Yeni konum → yeni sefer
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000a0002"}',true);
set local role authenticated;
insert into public.vehicle_positions (vehicle_id, lat, lng) values ('aaaa0000-0000-0000-0000-0000000000a1', 40.99, 29.02);
reset role;
select tests.ok('Sefer bittikten sonraki konum YENİ sefer açar', (select count(*) from public.trips) = 2 and (select count(*) from public.trips where ended_at is null) = 1);

-- Hareketsizlik: 30 dk konum gelmeyen sefer kapanır
update public.trips set last_position_at = now() - interval '40 min' where ended_at is null;
select tests.ok('Hareketsizlik kontrolü 1 sefer kapattı', private.close_inactive_trips() = 1);
select tests.ok('30 dk konum gelmeyen sefer otomatik kapandı (neden: hareketsizlik)',
  (select end_reason from public.trips order by started_at desc limit 1) = 'inactivity');

-- Yetkiler
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000a0001"}',true);
set local role authenticated;
select tests.ok('Yönetici seferleri görür', tests.cnt('select 1 from public.trips') = 2);
select tests.ok('Yönetici durak olaylarını görür', tests.cnt('select 1 from public.trip_stop_events') = 8);
select tests.ok('Yönetici sefer güzergâhını (tüm konumları) görür', tests.cnt('select 1 from public.vehicle_positions') = 11);
reset role;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000a0002"}',true);
set local role authenticated;
select tests.ok('Sürücü sefer geçmişini GÖREMEZ', tests.cnt('select 1 from public.trips') = 0 and tests.cnt('select 1 from public.trip_stop_events') = 0);
select tests.ok('Sürücü eski konum geçmişini GÖREMEZ (yalnızca son 15 dk)', tests.cnt('select 1 from public.vehicle_positions') = 1);
reset role;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000a0011"}',true);
set local role authenticated;
select tests.ok('Yolcu sefer geçmişini GÖREMEZ', tests.cnt('select 1 from public.trips') = 0 and tests.cnt('select 1 from public.trip_stop_events') = 0);
select tests.ok('Yolcu seferi bitiremez', public.end_my_trip() = false);
reset role;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000b0001"}',true);
set local role authenticated;
select tests.ok('Başka şirketin yöneticisi seferleri GÖREMEZ', tests.cnt('select 1 from public.trips') = 0 and tests.cnt('select 1 from public.trip_stop_events') = 0);
reset role;

\o
\set QUIET off
\pset footer off
select n as "#", label as "Test", 'GEÇTİ' as "Sonuç" from tests.results order by n;
select count(*) || ' testin tamamı geçti' as "ÖZET" from tests.results;
rollback;
