-- Yönetim paneli testleri: platform yöneticisi, belgeler, alış sırası (ROLLBACK eder)
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
grant execute on all functions in schema tests to anon, authenticated;

insert into public.companies (id, code, name) values ('c0000000-0000-0000-0000-00000000000a','firma-a','Firma A'),('c0000000-0000-0000-0000-00000000000b','firma-b','Firma B');
insert into public.vehicles (id, company_id, plate) values
 ('aaaa0000-0000-0000-0000-0000000000a1','c0000000-0000-0000-0000-00000000000a','34 A 1'),
 ('aaaa0000-0000-0000-0000-0000000000a2','c0000000-0000-0000-0000-00000000000a','34 A 2'),
 ('bbbb0000-0000-0000-0000-0000000000b1','c0000000-0000-0000-0000-00000000000b','34 B 1');
insert into auth.users (id, email) values
 ('00000000-0000-0000-0000-0000000f0001','u-p1@servis.local'),
 ('00000000-0000-0000-0000-0000000a0001','u-a1@servis.local'),('00000000-0000-0000-0000-0000000a0002','u-a2@servis.local'),
 ('00000000-0000-0000-0000-0000000a0011','u-a11@servis.local'),('00000000-0000-0000-0000-0000000a0012','u-a12@servis.local'),
 ('00000000-0000-0000-0000-0000000a0013','u-a13@servis.local'),('00000000-0000-0000-0000-0000000a0021','u-a21@servis.local'),
 ('00000000-0000-0000-0000-0000000b0001','u-b1@servis.local');
insert into private.platform_admins (user_id, username, full_name) values ('00000000-0000-0000-0000-0000000f0001','osman','Platform Sahibi');
insert into public.profiles (id, company_id, role, username, full_name, vehicle_id) values
 ('00000000-0000-0000-0000-0000000a0001','c0000000-0000-0000-0000-00000000000a','admin','admin','A Yönetici',null),
 ('00000000-0000-0000-0000-0000000a0002','c0000000-0000-0000-0000-00000000000a','driver','surucu','A Sürücü','aaaa0000-0000-0000-0000-0000000000a1'),
 ('00000000-0000-0000-0000-0000000a0011','c0000000-0000-0000-0000-00000000000a','passenger','yolcu1','Yolcu 1','aaaa0000-0000-0000-0000-0000000000a1'),
 ('00000000-0000-0000-0000-0000000a0012','c0000000-0000-0000-0000-00000000000a','passenger','yolcu2','Yolcu 2','aaaa0000-0000-0000-0000-0000000000a1'),
 ('00000000-0000-0000-0000-0000000a0013','c0000000-0000-0000-0000-00000000000a','passenger','yolcu3','Yolcu 3','aaaa0000-0000-0000-0000-0000000000a1'),
 ('00000000-0000-0000-0000-0000000a0021','c0000000-0000-0000-0000-00000000000a','passenger','yolcu21','A2 Yolcusu','aaaa0000-0000-0000-0000-0000000000a2'),
 ('00000000-0000-0000-0000-0000000b0001','c0000000-0000-0000-0000-00000000000b','admin','admin','B Yönetici',null);
insert into public.stops (company_id, passenger_id, lat, lng) values
 ('c0000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000a0011',41.00,29.00),
 ('c0000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000a0012',41.01,29.01),
 ('c0000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000a0013',41.02,29.02),
 ('c0000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000a0021',41.03,29.03);
insert into public.documents (company_id, owner_type, owner_id, doc_type, file_path) values
 ('c0000000-0000-0000-0000-00000000000a','driver','00000000-0000-0000-0000-0000000a0002','driver_photo','c0000000-0000-0000-0000-00000000000a/driver/a2/photo.jpg'),
 ('c0000000-0000-0000-0000-00000000000a','driver','00000000-0000-0000-0000-0000000a0002','license','c0000000-0000-0000-0000-00000000000a/driver/a2/license.pdf'),
 ('c0000000-0000-0000-0000-00000000000a','vehicle','aaaa0000-0000-0000-0000-0000000000a1','vehicle_photo','c0000000-0000-0000-0000-00000000000a/vehicle/a1/photo.jpg'),
 ('c0000000-0000-0000-0000-00000000000a','vehicle','aaaa0000-0000-0000-0000-0000000000a1','insurance','c0000000-0000-0000-0000-00000000000a/vehicle/a1/sigorta.pdf');

-- ---------- Alış sırası ----------
select tests.ok('Yeni duraklara sırayla alış sırası verilir (1,2,3)',
  (select array_agg(pickup_order order by pickup_order) from public.stops where vehicle_id='aaaa0000-0000-0000-0000-0000000000a1') = array[1,2,3]);

-- ---------- Platform yöneticisi ----------
select set_config('request.jwt.claims','',true); set local role anon;
select tests.ok('"platform" koduyla platform yöneticisinin giriş e-postası bulunur', public.login_email('platform','osman') = 'u-p1@servis.local');
select tests.ok('Platform yöneticisi şirket koduyla giriş yapamaz', public.login_email('firma-a','osman') <> 'u-p1@servis.local');
reset role;
select tests.ok('"platform" şirket kodu olarak alınamaz', tests.fails($$insert into public.companies (code, name) values ('platform','X')$$));

select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000f0001"}',true); set local role authenticated;
select tests.ok('Platform yöneticisi oturum bilgisi: is_platform_admin, şirket yok', (public.my_session()->>'is_platform_admin')::boolean and public.my_session()->'company' = 'null'::jsonb);
select tests.ok('Platform yöneticisi tüm şirketleri listeler (2)', (select count(*) from public.platform_companies()) = 2);
select tests.ok('Şirket listesinde sayılar doğru (A: 1 sürücü, 4 yolcu, 2 araç)',
  (select drivers = 1 and passengers = 4 and vehicles = 2 from public.platform_companies() where code='firma-a'));
select tests.ok('Şirkete girmeden hiçbir şirket verisini görmez', tests.cnt('select 1 from public.profiles') = 0 and tests.cnt('select 1 from public.vehicles') = 0);
select tests.ok('Şirket A''ya girer', public.platform_enter_company('c0000000-0000-0000-0000-00000000000a'));
select tests.ok('Girince A şirketinin verisini yönetici gibi görür (6 profil, 2 araç)', tests.cnt('select 1 from public.profiles') = 6 and tests.cnt('select 1 from public.vehicles') = 2);
select tests.ok('A''dayken B''nin verisini GÖRMEZ', tests.cnt($$select 1 from public.vehicles where company_id='c0000000-0000-0000-0000-00000000000b'$$) = 0);
select tests.ok('A''dayken araç ekleyebilir (A''ya yazılır)', not tests.fails($$insert into public.vehicles (plate) values ('34 PLT 01')$$)
  and tests.cnt($$select 1 from public.vehicles where plate='34 PLT 01' and company_id='c0000000-0000-0000-0000-00000000000a'$$) = 1);
select tests.ok('Oturumda aktif şirket A', public.my_session()->'company'->>'code' = 'firma-a');
select tests.ok('A''dayken tüm belgeleri görür (4)', tests.cnt('select 1 from public.documents') = 4);
select tests.ok('B''ye geçer, A''yı artık görmez', public.platform_enter_company('c0000000-0000-0000-0000-00000000000b')
  and tests.cnt($$select 1 from public.vehicles where company_id='c0000000-0000-0000-0000-00000000000a'$$) = 0);
select tests.ok('Var olmayan şirkete giremez', not public.platform_enter_company('c0000000-0000-0000-0000-0000000000ff'));
reset role;

-- Şirket yöneticisi platform işlemlerini yapamaz
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000a0001"}',true); set local role authenticated;
select tests.ok('Şirket yöneticisi şirket listesini GÖREMEZ', (select count(*) from public.platform_companies()) = 0);
select tests.ok('Şirket yöneticisi başka şirkete GİREMEZ', not public.platform_enter_company('c0000000-0000-0000-0000-00000000000b'));
select tests.ok('Şirket yöneticisinin oturumu: platform değil, şirketi A', not (public.my_session()->>'is_platform_admin')::boolean and public.my_session()->'company'->>'code' = 'firma-a');

-- Alış sırasını değiştirir: y3, y1, y2
select tests.ok('Yönetici alış sırasını kaydeder', public.set_pickup_order('aaaa0000-0000-0000-0000-0000000000a1',
  array['00000000-0000-0000-0000-0000000a0013','00000000-0000-0000-0000-0000000a0011','00000000-0000-0000-0000-0000000a0012']::uuid[]) = 3);
select tests.ok('Yeni sıra: Yolcu 3 → 1 → 2', (select array_agg(passenger_id order by pickup_order) from public.stops where vehicle_id='aaaa0000-0000-0000-0000-0000000000a1')
  = array['00000000-0000-0000-0000-0000000a0013','00000000-0000-0000-0000-0000000a0011','00000000-0000-0000-0000-0000000a0012']::uuid[]);
select tests.ok('Başka şirketin aracının sırasını değiştiremez', tests.fails($$select public.set_pickup_order('bbbb0000-0000-0000-0000-0000000000b1', array[]::uuid[])$$));
-- Belge kuralları
select tests.ok('Yönetici tüm belgeleri görür', tests.cnt('select 1 from public.documents') = 4);
select tests.ok('Başka şirketin klasörüne belge kaydedemez', tests.fails($$insert into public.documents (owner_type, owner_id, doc_type, file_path) values ('driver','00000000-0000-0000-0000-0000000a0002','src','c0000000-0000-0000-0000-00000000000b/x.pdf')$$));
select tests.ok('Yolcuya belge kaydedemez (sahip sürücü olmalı)', tests.fails($$insert into public.documents (owner_type, owner_id, doc_type, file_path) values ('driver','00000000-0000-0000-0000-0000000a0011','src','c0000000-0000-0000-0000-00000000000a/x.pdf')$$));
select tests.ok('Araca "ehliyet" türü belge kaydedemez', tests.fails($$insert into public.documents (owner_type, owner_id, doc_type, file_path) values ('vehicle','aaaa0000-0000-0000-0000-0000000000a1','license','c0000000-0000-0000-0000-00000000000a/y.pdf')$$));
select tests.ok('Sürücüye SRC belgesi ekler (son geçerlilik tarihiyle)', not tests.fails($$insert into public.documents (owner_type, owner_id, doc_type, file_path, expires_on) values ('driver','00000000-0000-0000-0000-0000000a0002','src','c0000000-0000-0000-0000-00000000000a/driver/a2/src.pdf', current_date + 200)$$));
select tests.ok('Ehliyet bilgilerini kaydeder', not tests.fails($$update public.profiles set license_class='D', license_expires_on=current_date+400 where id='00000000-0000-0000-0000-0000000a0002'$$));
reset role;

-- Yolcu: yalnızca kendi servisinin araç + sürücü fotoğrafı
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000a0011"}',true); set local role authenticated;
select tests.ok('Yolcu kendi servisinin araç ve sürücü fotoğrafını görür (2)', tests.cnt('select 1 from public.documents') = 2
  and tests.cnt($$select 1 from public.documents where doc_type in ('vehicle_photo','driver_photo')$$) = 2);
select tests.ok('Yolcu ehliyet/sigorta gibi belgeleri GÖREMEZ', tests.cnt($$select 1 from public.documents where doc_type in ('license','insurance','src')$$) = 0);
select tests.ok('Yolcu belge ekleyemez', tests.fails($$insert into public.documents (owner_type, owner_id, doc_type, file_path) values ('vehicle','aaaa0000-0000-0000-0000-0000000000a1','vehicle_photo','c0000000-0000-0000-0000-00000000000a/z.jpg')$$));
select tests.ok('Yolcu alış sırasını değiştiremez', tests.fails($$select public.set_pickup_order('aaaa0000-0000-0000-0000-0000000000a1', array[]::uuid[])$$));
reset role;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000a0021"}',true); set local role authenticated;
select tests.ok('Başka aracın yolcusu bu fotoğrafları GÖREMEZ', tests.cnt('select 1 from public.documents') = 0);
reset role;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000a0002"}',true); set local role authenticated;
select tests.ok('Sürücü kendi fotoğrafını ve aracının fotoğrafını görür, ehliyet/sigortayı göremez',
  tests.cnt('select 1 from public.documents') = 2 and tests.cnt($$select 1 from public.documents where doc_type in ('license','insurance','src')$$) = 0);
reset role;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000b0001"}',true); set local role authenticated;
select tests.ok('Başka şirketin yöneticisi belgeleri GÖREMEZ', tests.cnt('select 1 from public.documents') = 0);
reset role;

-- Yolcu başka araca taşınınca yeni aracın sonuna eklenir
update public.profiles set vehicle_id = 'aaaa0000-0000-0000-0000-0000000000a2' where id = '00000000-0000-0000-0000-0000000a0011';
select tests.ok('Araç değiştiren yolcu yeni aracın sonuna eklenir (2. sıra)',
  (select vehicle_id = 'aaaa0000-0000-0000-0000-0000000000a2' and pickup_order = 2 from public.stops where passenger_id='00000000-0000-0000-0000-0000000a0011'));

\o
\set QUIET off
\pset footer off
select n as "#", label as "Test", 'GEÇTİ' as "Sonuç" from tests.results order by n;
select count(*) || ' testin tamamı geçti' as "ÖZET" from tests.results;
rollback;
