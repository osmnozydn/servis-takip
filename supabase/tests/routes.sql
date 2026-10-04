-- Faz 5-6: rota tablosu yetkileri + yolcu rota bilgisi (ROLLBACK eder)
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
create function tests.fails(q text) returns boolean language plpgsql as $$ begin begin execute q; exception when others then return true; end; return false; end $$;
grant execute on all functions in schema tests to authenticated;

insert into public.companies (id, code, name) values ('c0000000-0000-0000-0000-00000000000a','firma-a','A'),('c0000000-0000-0000-0000-00000000000b','firma-b','B');
insert into public.vehicles (id, company_id, plate) values
 ('aaaa0000-0000-0000-0000-0000000000a1','c0000000-0000-0000-0000-00000000000a','34 A 1'),
 ('bbbb0000-0000-0000-0000-0000000000b1','c0000000-0000-0000-0000-00000000000b','34 B 1');
insert into auth.users (id) values ('00000000-0000-0000-0000-0000000a0001'),('00000000-0000-0000-0000-0000000a0002'),('00000000-0000-0000-0000-0000000a0003'),('00000000-0000-0000-0000-0000000a0004'),('00000000-0000-0000-0000-0000000b0001');
insert into public.profiles (id, company_id, role, username, full_name, vehicle_id) values
 ('00000000-0000-0000-0000-0000000a0001','c0000000-0000-0000-0000-00000000000a','admin','admin','A',null),
 ('00000000-0000-0000-0000-0000000a0002','c0000000-0000-0000-0000-00000000000a','driver','surucu','S','aaaa0000-0000-0000-0000-0000000000a1'),
 ('00000000-0000-0000-0000-0000000a0003','c0000000-0000-0000-0000-00000000000a','passenger','yolcu1','Y1','aaaa0000-0000-0000-0000-0000000000a1'),
 ('00000000-0000-0000-0000-0000000a0004','c0000000-0000-0000-0000-00000000000a','passenger','yolcu2','Y2','aaaa0000-0000-0000-0000-0000000000a1'),
 ('00000000-0000-0000-0000-0000000b0001','c0000000-0000-0000-0000-00000000000b','admin','admin','B',null);
insert into public.daily_routes (company_id, vehicle_id, service_date, stops, source) values
 ('c0000000-0000-0000-0000-00000000000a','aaaa0000-0000-0000-0000-0000000000a1',(now() at time zone 'Europe/Istanbul')::date,
  '[{"passenger_id":"00000000-0000-0000-0000-0000000a0004","lat":41,"lng":29,"eta_s":120},{"passenger_id":"00000000-0000-0000-0000-0000000a0003","lat":41.1,"lng":29.1,"eta_s":600}]','fallback'),
 ('c0000000-0000-0000-0000-00000000000b','bbbb0000-0000-0000-0000-0000000000b1',(now() at time zone 'Europe/Istanbul')::date,'[]','fallback');

select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000a0001"}',true); set local role authenticated;
select tests.ok('Admin kendi şirketinin rotasını görür', tests.cnt('select 1 from public.daily_routes') = 1);
select tests.ok('Admin rota yazamaz (yalnızca sunucu hesaplar)', tests.fails($$update public.daily_routes set distance_m = 1$$) or tests.cnt('select 1 from public.daily_routes where distance_m = 1') = 0);
reset role;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000a0002"}',true); set local role authenticated;
select tests.ok('Sürücü kendi aracının rotasını görür', tests.cnt('select 1 from public.daily_routes') = 1);
reset role;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000a0003"}',true); set local role authenticated;
select tests.ok('Yolcu rota tablosunu doğrudan GÖREMEZ (diğer yolcuların durakları gizli)', tests.cnt('select 1 from public.daily_routes') = 0);
select tests.ok('Yolcu1 kendi sırasını öğrenir: 2/2', (public.my_route_info()->>'my_order')::int = 2 and (public.my_route_info()->>'total_stops')::int = 2);
select tests.ok('Yolcu1 tahmini varış süresini öğrenir (600 sn)', (public.my_route_info()->>'eta_s_from_start')::int = 600);
select tests.ok('Yolcu bilgisi diğer yolcunun konumunu içermez', public.my_route_info()::text not like '%41.0%' and public.my_route_info()::text not like '%a0004%');
insert into public.absences (passenger_id, date) values ('00000000-0000-0000-0000-0000000a0003', (now() at time zone 'Europe/Istanbul')::date);
select tests.ok('Devamsızlık bildirince "bugün yoksunuz" döner', (public.my_route_info()->>'absent_today')::boolean);
reset role;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000b0001"}',true); set local role authenticated;
select tests.ok('Başka şirketin yöneticisi bu rotayı görmez', tests.cnt($$select 1 from public.daily_routes where company_id='c0000000-0000-0000-0000-00000000000a'$$) = 0);
reset role;
select tests.ok('Devamsızlık tetikleyicisi tanımlı', exists(select 1 from pg_trigger where tgname='absences_recompute_route'));

\o
\set QUIET off
\pset footer off
select n as "#", label as "Test", 'GEÇTİ' as "Sonuç" from tests.results order by n;
select count(*) || ' testin tamamı geçti' as "ÖZET" from tests.results;
rollback;
