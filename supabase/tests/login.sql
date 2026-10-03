-- =====================================================================
-- Faz 2 giriş testleri (veritabanı katmanı)
-- Tümü tek transaction içinde çalışır ve ROLLBACK eder.
-- =====================================================================
\set QUIET on
\set ON_ERROR_STOP on
begin;
\o /dev/null

create schema tests;
grant usage on schema tests to anon, authenticated;
create table tests.results (n serial, label text);
grant all on tests.results to anon, authenticated;
grant all on sequence tests.results_n_seq to anon, authenticated;
create function tests.ok(label text, cond boolean) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'BAŞARISIZ: %', label; end if;
  insert into tests.results(label) values (label);
end $$;
grant execute on all functions in schema tests to anon, authenticated;

insert into public.companies (id, code, name) values
  ('c0000000-0000-0000-0000-00000000000a', 'firma-a', 'Firma A'),
  ('c0000000-0000-0000-0000-00000000000b', 'firma-b', 'Firma B');
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000a0001', 'u-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1@servis.local'),
  ('00000000-0000-0000-0000-0000000b0001', 'u-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb1@servis.local');
insert into public.profiles (id, company_id, role, username, phone, full_name) values
  ('00000000-0000-0000-0000-0000000a0001', 'c0000000-0000-0000-0000-00000000000a', 'passenger', '  Ali.Veli ', '0532 111 22 33', 'Ali Veli'),
  ('00000000-0000-0000-0000-0000000b0001', 'c0000000-0000-0000-0000-00000000000b', 'passenger', 'ali.veli',   '+90 (532) 111-22-33', 'Ali Veli B');

-- Normalizasyon
select tests.ok('Kullanıcı adı küçük harfe ve boşluksuz kaydedilir',
  (select username from public.profiles where id='00000000-0000-0000-0000-0000000a0001') = 'ali.veli');
select tests.ok('Telefon 0532 111 22 33 → +905321112233',
  (select phone from public.profiles where id='00000000-0000-0000-0000-0000000a0001') = '+905321112233');
select tests.ok('Telefon +90 (532) 111-22-33 → +905321112233',
  (select phone from public.profiles where id='00000000-0000-0000-0000-0000000b0001') = '+905321112233');
select tests.ok('Aynı telefon iki farklı şirkette kayıtlı olabilir', (select count(*) from public.profiles where phone='+905321112233') = 2);

-- Giriş yapmamış kullanıcı olarak
select set_config('request.jwt.claims', '', true);
set local role anon;
select tests.ok('Kullanıcı adıyla: doğru e-posta (A)',
  public.login_email('firma-a', 'ali.veli') = 'u-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1@servis.local');
select tests.ok('Büyük harf/boşluk fark etmez',
  public.login_email('  FIRMA-A ', ' ALI.VELI') = 'u-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1@servis.local');
select tests.ok('Telefonla (5321112233): doğru e-posta (A)',
  public.login_email('firma-a', '5321112233') = 'u-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1@servis.local');
select tests.ok('Telefonla (0532 111 22 33): doğru e-posta (A)',
  public.login_email('firma-a', '0532 111 22 33') = 'u-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1@servis.local');
select tests.ok('Aynı kullanıcı adı, B şirket kodu → B kullanıcısı',
  public.login_email('firma-b', 'ali.veli') = 'u-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb1@servis.local');
select tests.ok('Aynı telefon, B şirket kodu → B kullanıcısı',
  public.login_email('firma-b', '05321112233') = 'u-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb1@servis.local');
select tests.ok('Yanlış şirket kodu → gerçek e-posta DÖNMEZ',
  public.login_email('firma-x', 'ali.veli') not in ('u-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1@servis.local','u-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb1@servis.local'));
select tests.ok('Var olmayan kullanıcı → gerçekle AYNI biçimde e-posta (sızıntı yok)',
  public.login_email('firma-a', 'olmayan.kisi') ~ '^u-[0-9a-f]{32}@servis\.local$');
select tests.ok('Var olmayan kullanıcı → her seferinde aynı değer (tekrar denemede fark edilmez)',
  public.login_email('firma-a', 'olmayan.kisi') = public.login_email('firma-a', 'olmayan.kisi'));
select tests.ok('Boş girdi hata vermez', public.login_email(null, null) ~ '^u-[0-9a-f]{32}@servis\.local$');
select tests.ok('anon gizli anahtarı doğrulayamaz',
  (select count(*) from information_schema.routine_privileges where routine_name='dev_verify_secret' and grantee='anon') = 0);
reset role;

-- Kullanıcı kendi rıza alanlarını güncelleyebilir, rolünü değiştiremez (Faz 1 kuralı sürüyor)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000a0001","role":"authenticated"}', true);
set local role authenticated;
update public.profiles set consent_version='v1', consent_at=now(), must_change_password=false where id='00000000-0000-0000-0000-0000000a0001';
select tests.ok('Kullanıcı KVKK rızasını kaydedebilir',
  (select consent_version='v1' and not must_change_password from public.profiles where id='00000000-0000-0000-0000-0000000a0001'));
reset role;

\o
\set QUIET off
\pset footer off
select n as "#", label as "Test", 'GEÇTİ' as "Sonuç" from tests.results order by n;
select count(*) || ' testin tamamı geçti' as "ÖZET" from tests.results;
rollback;
