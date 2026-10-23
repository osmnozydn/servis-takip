-- Operasyon testleri: operasyon sorumlusu, fabrikalar, servis saatleri, otomatik
-- sefer tamamlanması ve bildirimler (ROLLBACK eder)
\set QUIET on
\set ON_ERROR_STOP on
begin;
\o /dev/null
create schema tests;
grant usage on schema tests to anon, authenticated;
create table tests.results (n serial, label text);
grant all on tests.results, tests.results_n_seq to anon, authenticated;
create function tests.ok(label text, cond boolean) returns void language plpgsql as $$
begin if cond is not true then raise exception 'BAŞARISIZ: %', label; end if; insert into tests.results(label) values (label); end $$;
create function tests.cnt(q text) returns bigint language plpgsql as $$ declare c bigint; begin execute format('select count(*) from (%s) x', q) into c; return c; end $$;
create function tests.fails(q text) returns boolean language plpgsql as $$ begin begin execute q; exception when others then return true; end; return false; end $$;
-- Dün (İstanbul) saat hh:mm → timestamptz. Testler saatten bağımsız çalışsın diye sabit "dün".
create function tests.at(hhmm text) returns timestamptz language sql stable as $$
  select ((date_trunc('day', now() at time zone 'Europe/Istanbul') - interval '1 day') + hhmm::time) at time zone 'Europe/Istanbul' $$;
create function tests.yday() returns date language sql stable as $$ select (now() at time zone 'Europe/Istanbul')::date - 1 $$;
grant execute on all functions in schema tests to anon, authenticated;

-- Kişiler: A şirketi yönetici, operasyon sorumlusu, sürücü, 4 yolcu; B şirketi yönetici; platform yöneticisi
insert into public.companies (id, code, name) values ('c0000000-0000-0000-0000-00000000000a','firma-a','Firma A'),('c0000000-0000-0000-0000-00000000000b','firma-b','Firma B');
insert into public.vehicles (id, company_id, plate) values
 ('aaaa0000-0000-0000-0000-0000000000a1','c0000000-0000-0000-0000-00000000000a','34 A 1'),
 ('aaaa0000-0000-0000-0000-0000000000a2','c0000000-0000-0000-0000-00000000000a','34 A 2');
insert into auth.users (id) values
 ('00000000-0000-0000-0000-0000000a0001'),('00000000-0000-0000-0000-0000000a0009'),('00000000-0000-0000-0000-0000000a0002'),
 ('00000000-0000-0000-0000-0000000a0011'),('00000000-0000-0000-0000-0000000a0012'),('00000000-0000-0000-0000-0000000a0013'),('00000000-0000-0000-0000-0000000a0014'),
 ('00000000-0000-0000-0000-0000000b0001'),('00000000-0000-0000-0000-0000000f0001'),('00000000-0000-0000-0000-0000000a0003');
insert into public.profiles (id, company_id, role, username, full_name, vehicle_id) values
 ('00000000-0000-0000-0000-0000000a0001','c0000000-0000-0000-0000-00000000000a','admin','admin','A Yönetici',null),
 ('00000000-0000-0000-0000-0000000a0009','c0000000-0000-0000-0000-00000000000a','operator','operasyon','Op Sorumlu',null),
 ('00000000-0000-0000-0000-0000000a0002','c0000000-0000-0000-0000-00000000000a','driver','surucu','Mehmet Sürücü','aaaa0000-0000-0000-0000-0000000000a1'),
 ('00000000-0000-0000-0000-0000000a0003','c0000000-0000-0000-0000-00000000000a','driver','surucu2','Ali Sürücü','aaaa0000-0000-0000-0000-0000000000a2'),
 ('00000000-0000-0000-0000-0000000a0011','c0000000-0000-0000-0000-00000000000a','passenger','moda','Moda Yolcu','aaaa0000-0000-0000-0000-0000000000a1'),
 ('00000000-0000-0000-0000-0000000a0012','c0000000-0000-0000-0000-00000000000a','passenger','kozyatagi','Kozyatağı Yolcu','aaaa0000-0000-0000-0000-0000000000a1'),
 ('00000000-0000-0000-0000-0000000a0013','c0000000-0000-0000-0000-00000000000a','passenger','uskudar','Üsküdar Yolcu','aaaa0000-0000-0000-0000-0000000000a1'),
 ('00000000-0000-0000-0000-0000000a0014','c0000000-0000-0000-0000-00000000000a','passenger','atasehir','Ataşehir Yolcu','aaaa0000-0000-0000-0000-0000000000a1'),
 ('00000000-0000-0000-0000-0000000b0001','c0000000-0000-0000-0000-00000000000b','admin','admin','B Yönetici',null);
insert into private.platform_admins (user_id, username, full_name, active_company_id, must_change_password)
values ('00000000-0000-0000-0000-0000000f0001','osman','Osman','c0000000-0000-0000-0000-00000000000a', false);
insert into public.stops (company_id, passenger_id, lat, lng, address) values
 ('c0000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000a0011',40.9862,29.0257,'Moda'),
 ('c0000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000a0012',40.9765,29.0978,'Kozyatağı'),
 ('c0000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000a0013',41.0255,29.0153,'Üsküdar'),
 ('c0000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000a0014',40.9923,29.1244,'Ataşehir');
-- Ataşehir yolcusu dün gelmeyecek
insert into public.absences (company_id, passenger_id, date) values ('c0000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000a0014', tests.yday());

-- ---------------------------------------------------------------- roller
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000a0009"}',true); set local role authenticated;
select tests.ok('Operasyon sorumlusu fabrika ekler',
  not tests.fails($$insert into public.factories (id, name, lat, lng, radius_m) values ('fa000000-0000-0000-0000-0000000000f1','Gebze Fabrika',40.9900,29.1500,200)$$));
select tests.ok('Operasyon sorumlusu araç ekler', not tests.fails($$insert into public.vehicles (company_id, plate) values ('c0000000-0000-0000-0000-00000000000a','34 OP 9')$$));
select tests.ok('Operasyon sorumlusu araca fabrika atar',
  not tests.fails($$update public.vehicles set factory_id = 'fa000000-0000-0000-0000-0000000000f1' where id = 'aaaa0000-0000-0000-0000-0000000000a1'$$));
update public.profiles set full_name = 'Moda Yolcu (düzenlendi)' where id = '00000000-0000-0000-0000-0000000a0011';
select tests.ok('Operasyon sorumlusu yolcu bilgisini düzenler',
  (select full_name = 'Moda Yolcu (düzenlendi)' from public.profiles where id = '00000000-0000-0000-0000-0000000a0011'));
select tests.ok('Operasyon sorumlusu servis saatlerini düzenler',
  not tests.fails($$insert into public.visibility_windows (company_id, vehicle_id, weekday, start_time, end_time, direction, service_time, lead_minutes)
                    values ('c0000000-0000-0000-0000-00000000000a','aaaa0000-0000-0000-0000-0000000000a2', 1, '00:00', '09:00', 'to_factory', '06:10', 30)$$));
update public.profiles set full_name = 'Değişmemeli' where id = '00000000-0000-0000-0000-0000000a0001';
reset role;
select tests.ok('Operasyon sorumlusu yöneticinin profilini DEĞİŞTİREMEZ',
  (select full_name = 'A Yönetici' from public.profiles where id = '00000000-0000-0000-0000-0000000a0001'));
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000a0009"}',true); set local role authenticated;
select tests.ok('Operasyon sorumlusu yolcuyu yönetici YAPAMAZ',
  tests.fails($$update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000a0012'$$));
select tests.ok('Operasyon sorumlusu kendini yönetici YAPAMAZ',
  tests.fails($$update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000a0009'$$));
delete from public.profiles where id = '00000000-0000-0000-0000-0000000a0001';
update public.companies set name = 'Değişmemeli' where id = 'c0000000-0000-0000-0000-00000000000a';
reset role;
select tests.ok('Operasyon sorumlusu yöneticiyi SİLEMEZ', exists (select 1 from public.profiles where id = '00000000-0000-0000-0000-0000000a0001'));
select tests.ok('Operasyon sorumlusu şirket bilgisini değiştiremez', (select name = 'Firma A' from public.companies where code = 'firma-a'));
select tests.ok('Servis saati 06:10, 30 dk önce → yolcuya 05:40''ta açılır',
  (select start_time = '05:40' and direction = 'to_factory' from public.visibility_windows where vehicle_id = 'aaaa0000-0000-0000-0000-0000000000a2'));
select tests.ok('Gece yarısını geçen görünme süresi reddedilir',
  tests.fails($$insert into public.visibility_windows (company_id, vehicle_id, weekday, start_time, end_time, service_time, lead_minutes)
                values ('c0000000-0000-0000-0000-00000000000a','aaaa0000-0000-0000-0000-0000000000a2', 2, '00:00', '02:00', '00:10', 30)$$));
select tests.ok('Yönetim yetkisi: admin_company_of operasyon sorumlusunu tanır, hesap yönetimi tanımaz',
  public.admin_company_of('00000000-0000-0000-0000-0000000a0009') = 'c0000000-0000-0000-0000-00000000000a'
  and not public.is_company_admin_uid('00000000-0000-0000-0000-0000000a0009')
  and public.is_company_admin_uid('00000000-0000-0000-0000-0000000a0001'));

select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000a0001"}',true); set local role authenticated;
update public.profiles set full_name = 'Operasyon Şefi' where id = '00000000-0000-0000-0000-0000000a0009';
select tests.ok('Şirket yöneticisi operasyon sorumlusunun adını değiştirebilir',
  (select full_name = 'Operasyon Şefi' from public.profiles where id = '00000000-0000-0000-0000-0000000a0009'));
reset role;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000b0001"}',true); set local role authenticated;
select tests.ok('Başka şirketin yöneticisi fabrikaları göremez', tests.cnt('select 1 from public.factories') = 0);
reset role;

-- ---------------------------------------------------------------- fabrika
select tests.ok('Araca fabrika atanınca rota bitiş noktası fabrika olur',
  (select end_lat = 40.99 and end_lng = 29.15 and end_label = 'Gebze Fabrika' from public.vehicles where id = 'aaaa0000-0000-0000-0000-0000000000a1'));
update public.factories set name = 'Gebze OSB' where id = 'fa000000-0000-0000-0000-0000000000f1';
select tests.ok('Fabrika adı değişince araca yansır', (select end_label = 'Gebze OSB' from public.vehicles where id = 'aaaa0000-0000-0000-0000-0000000000a1'));
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000a0011"}',true); set local role authenticated;
select tests.ok('Yolcu kendi şirketinin fabrikalarını görebilir', tests.cnt('select 1 from public.factories') = 1);
select tests.ok('Yolcu fabrika ekleyemez', tests.fails($$insert into public.factories (name, lat, lng) values ('X', 41, 29)$$));
reset role;

-- ------------------------------------------------- sabah seferi (dün 06:10)
insert into public.visibility_windows (company_id, vehicle_id, weekday, start_time, end_time, direction, service_time, lead_minutes) values
 ('c0000000-0000-0000-0000-00000000000a','aaaa0000-0000-0000-0000-0000000000a1', extract(isodow from tests.yday())::int, '00:00','09:00','to_factory','06:10',30),
 ('c0000000-0000-0000-0000-00000000000a','aaaa0000-0000-0000-0000-0000000000a1', extract(isodow from tests.yday())::int, '00:00','20:00','from_factory','17:30',30);

insert into public.vehicle_positions (vehicle_id, driver_id, lat, lng, recorded_at, company_id) values
 ('aaaa0000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000a0002', 40.9800, 29.0300, tests.at('06:08'),'c0000000-0000-0000-0000-00000000000a');
select tests.ok('Sabah: ilk konumla sefer açıldı, yönü fabrikaya, fabrikası atandı',
  (select direction = 'to_factory' and factory_id = 'fa000000-0000-0000-0000-0000000000f1' and window_id is not null from public.trips where vehicle_id = 'aaaa0000-0000-0000-0000-0000000000a1'));
select tests.ok('Sabah: yöneticiye, operasyona ve platform yöneticisine "Servis başladı" gitti (3 kişi)',
  (select count(*) = 3 and bool_and(body like '34 A 1 · sabah servisi başladı · 06:08 · Mehmet Sürücü') from public.notifications where kind = 'trip_started'));
select tests.ok('Sabah: başka şirketin yöneticisine bildirim gitmedi',
  not exists (select 1 from public.notifications where recipient_id = '00000000-0000-0000-0000-0000000b0001'));
select tests.ok('Sabah: 3 yolcuya "Aracınız yola çıktı" gitti, gelmeyecek yolcuya gitmedi',
  (select count(*) = 3 from public.notifications where kind = 'bus_departed')
  and not exists (select 1 from public.notifications where recipient_id = '00000000-0000-0000-0000-0000000a0014'));

insert into public.vehicle_positions (vehicle_id, driver_id, lat, lng, recorded_at, company_id) values
 ('aaaa0000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000a0002', 40.9862, 29.0257, tests.at('06:15'),'c0000000-0000-0000-0000-00000000000a'),  -- Moda
 ('aaaa0000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000a0002', 40.9765, 29.0978, tests.at('06:30'),'c0000000-0000-0000-0000-00000000000a'),  -- Kozyatağı
 ('aaaa0000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000a0002', 40.9880, 29.1400, tests.at('06:40'),'c0000000-0000-0000-0000-00000000000a');  -- fabrikaya ~900 m
select tests.ok('Sabah: fabrikaya yaklaşırken sefer hâlâ açık', (select ended_at is null from public.trips where vehicle_id = 'aaaa0000-0000-0000-0000-0000000000a1'));
insert into public.vehicle_positions (vehicle_id, driver_id, lat, lng, recorded_at, company_id) values
 ('aaaa0000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000a0002', 40.9905, 29.1490, tests.at('06:44'),'c0000000-0000-0000-0000-00000000000a');  -- fabrikaya ~100 m
select tests.ok('Sabah: araç fabrikaya varınca sefer KENDİLİĞİNDEN tamamlandı (06:44, sebep: fabrika)',
  (select end_reason = 'factory' and ended_at = tests.at('06:44') from public.trips where vehicle_id = 'aaaa0000-0000-0000-0000-0000000000a1'));
select tests.ok('Sabah: uğranmayan Üsküdar "atlandı", gelmeyen Ataşehir "gelmedi"',
  (select status = 'missed' from public.trip_stop_events where address = 'Üsküdar')
  and (select status = 'absent' from public.trip_stop_events where address = 'Ataşehir'));
select tests.ok('Sabah: yönetim ekibine "Servis tamamlandı" gitti (2/3 durak, 1 atlandı)',
  (select count(*) = 3 and bool_and(body = '34 A 1 fabrikaya ulaştı (Gebze OSB) · sabah servisi tamamlandı · 06:44 · 2/3 durak, 1 atlandı')
     from public.notifications where kind = 'trip_completed'));
insert into public.vehicle_positions (vehicle_id, driver_id, lat, lng, recorded_at, company_id) values
 ('aaaa0000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000a0002', 40.9902, 29.1495, tests.at('06:46'),'c0000000-0000-0000-0000-00000000000a'),
 ('aaaa0000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000a0002', 40.9901, 29.1498, tests.at('07:20'),'c0000000-0000-0000-0000-00000000000a');
select tests.ok('Sabah: tamamlandıktan sonra gelen konumlar yeni sefer AÇMAZ (sürücü yayını kapatmasa da)',
  (select count(*) = 1 from public.trips where vehicle_id = 'aaaa0000-0000-0000-0000-0000000000a1'));
select tests.ok('Sabah: son görülen konum yine de güncellenir',
  (select recorded_at = tests.at('07:20') from public.vehicle_last_positions where vehicle_id = 'aaaa0000-0000-0000-0000-0000000000a1'));

-- ------------------------------------------------- akşam seferi (dün 17:30)
insert into public.vehicle_positions (vehicle_id, driver_id, lat, lng, recorded_at, company_id) values
 ('aaaa0000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000a0002', 40.9905, 29.1490, tests.at('17:31'),'c0000000-0000-0000-0000-00000000000a');  -- fabrikadan çıkış
select tests.ok('Akşam: fabrikadan çıkışta yeni sefer açıldı, yönü fabrikadan',
  (select direction = 'from_factory' and ended_at is null from public.trips where vehicle_id = 'aaaa0000-0000-0000-0000-0000000000a1' and started_at = tests.at('17:31')));
select tests.ok('Akşam: fabrikada beklerken sefer kapanmadı', (select count(*) = 1 from public.trips where ended_at is null));
insert into public.vehicle_positions (vehicle_id, driver_id, lat, lng, recorded_at, company_id) values
 ('aaaa0000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000a0002', 40.9765, 29.0978, tests.at('17:50'),'c0000000-0000-0000-0000-00000000000a'),  -- Kozyatağı
 ('aaaa0000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000a0002', 40.9862, 29.0257, tests.at('18:10'),'c0000000-0000-0000-0000-00000000000a');  -- Moda
select tests.ok('Akşam: son yolcu kalmadan sefer açık', (select ended_at is null from public.trips where started_at = tests.at('17:31')));
insert into public.vehicle_positions (vehicle_id, driver_id, lat, lng, recorded_at, company_id) values
 ('aaaa0000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000a0002', 41.0256, 29.0152, tests.at('18:30'),'c0000000-0000-0000-0000-00000000000a');  -- Üsküdar (son yolcu)
select tests.ok('Akşam: son yolcuya varınca sefer KENDİLİĞİNDEN tamamlandı (sebep: son durak)',
  (select end_reason = 'last_stop' and ended_at = tests.at('18:30') from public.trips where started_at = tests.at('17:31')));
select tests.ok('Akşam: yönetim ekibine "son yolcuya ulaştı" bildirimi',
  (select count(*) = 3 from public.notifications
    where kind = 'trip_completed' and body = '34 A 1 son yolcuya ulaştı · akşam servisi tamamlandı · 18:30 · 3/3 durak'));

-- --------------------------------------- sürücü bitirince de haber gider
insert into public.vehicle_positions (vehicle_id, driver_id, lat, lng, recorded_at, company_id) values
 ('aaaa0000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000a0003', 41.0, 29.0, now() - interval '2 min','c0000000-0000-0000-0000-00000000000a');
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000a0003"}',true); set local role authenticated;
select tests.ok('Sürücü: açık seferi my_trip_state ile görür', (public.my_trip_state() -> 'open') is not null);
select public.end_my_trip();
select tests.ok('Sürücü: bitirdikten sonra son sefer "driver" olarak görünür', public.my_trip_state() #>> '{last,end_reason}' = 'driver');
reset role;
select tests.ok('Sürücü servisi bitirince yönetim ekibine haber gider',
  (select count(*) = 3 from public.notifications where kind = 'trip_completed' and body like '34 A 2 · % sürücü tarafından bitirildi%'));

-- ---------------------------------------------------- bildirim yetkileri
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000a0011"}',true); set local role authenticated;
select tests.ok('Yolcu yalnızca kendi bildirimlerini görür (sabah + akşam "yola çıktı")', tests.cnt('select 1 from public.notifications') = 2);
select tests.ok('Yolcu bildirim metnini değiştiremez', tests.fails($$update public.notifications set body = 'x'$$));
select tests.ok('Yolcu bildirimlerini okundu işaretler', public.mark_notifications_read() = 2);
select tests.ok('Okunmamış bildirim kalmadı', tests.cnt('select 1 from public.notifications where read_at is null') = 0);
select tests.ok('Yolcu push token kaydeder', public.register_push_token('ExponentPushToken[test-123456]', 'android'));
select tests.ok('Push token tablosu istemciden okunamaz', tests.fails('select * from public.push_tokens'));
select tests.ok('Yolcu ekranı: servis saati bilgisi döner', public.my_visibility_state() ? 'next' and public.my_visibility_state() ? 'trip');
reset role;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000a0009"}',true); set local role authenticated;
select tests.ok('Operasyon sorumlusu kendi bildirimlerini görür (3 sefer × başladı + bitti)', tests.cnt('select 1 from public.notifications') = 6);
select tests.ok('Operasyon sorumlusu sefer geçmişini görür', tests.cnt('select 1 from public.trips') = 3);
reset role;

\o
\set QUIET off
\pset footer off
select n as "#", label as "Test", 'GEÇTİ' as "Sonuç" from tests.results order by n;
select count(*) || ' testin tamamı geçti' as "ÖZET" from tests.results;
rollback;
