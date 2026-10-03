-- =====================================================================
-- Faz 2: Giriş sistemi — veritabanı katmanı
-- =====================================================================
-- Giriş akışı:
--   1) İstemci public.login_email(şirket_kodu, kullanıcı_adı_veya_telefon)
--      çağırır ve bir giriş e-postası alır.
--   2) Bu e-posta + şifre ile Supabase Auth'a normal şekilde giriş yapar.
-- Kullanıcıların gerçek e-postası yoktur; Auth e-postası rastgele bir
-- kimliktir: u-<32 hex>@servis.local
-- Var olmayan kullanıcı için de AYNI biçimde (deterministik, sahte) bir
-- e-posta döner: dışarıdan bakan biri hangi kullanıcı adı/telefonun
-- kayıtlı olduğunu anlayamaz; giriş yalnızca "hatalı bilgiler" der.
-- =====================================================================

-- Edge Function → dış HTTP çağrıları ve test tetikleme için (Supabase'de mevcut)
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net with schema extensions;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Gizli değerler (yalnızca veritabanı içinde; API'den erişilemez)
-- ---------------------------------------------------------------------
create table private.app_secrets (
  key   text primary key,
  value text not null
);
insert into private.app_secrets (key, value) values
  ('login_salt',  md5(gen_random_uuid()::text || clock_timestamp()::text) || md5(gen_random_uuid()::text)),
  ('dev_secret',  md5(gen_random_uuid()::text || clock_timestamp()::text) || md5(gen_random_uuid()::text));
revoke all on private.app_secrets from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Profil: KVKK rızası + ilk girişte şifre değiştirme
-- ---------------------------------------------------------------------
alter table public.profiles
  add column consent_version      text,
  add column consent_at           timestamptz,
  add column must_change_password boolean not null default true;

comment on column public.profiles.consent_version is 'Kabul edilen KVKK aydınlatma/rıza metninin sürümü.';
comment on column public.profiles.must_change_password is 'Yönetici şifre belirledi; kullanıcı ilk girişte değiştirmeli.';

-- ---------------------------------------------------------------------
-- Telefon normalizasyonu: 0532 123 45 67 / 5321234567 / +90 532… → +905321234567
-- ---------------------------------------------------------------------
create or replace function private.normalize_phone(p text)
returns text language plpgsql immutable set search_path = '' as $$
declare d text;
begin
  if p is null or btrim(p) = '' then return null; end if;
  d := regexp_replace(p, '\D', '', 'g');
  if d ~ '^0?5[0-9]{9}$'  then return '+90' || right(d, 10); end if;   -- TR cep
  if d ~ '^905[0-9]{9}$'   then return '+' || d; end if;
  if d ~ '^00[0-9]{10,13}$' then return '+' || substr(d, 3); end if;
  if left(btrim(p), 1) = '+' then return '+' || d; end if;
  return d;
end $$;

create or replace function private.normalize_profile()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.username := lower(btrim(new.username));
  new.phone    := private.normalize_phone(new.phone);
  return new;
end $$;
create trigger profiles_normalize before insert or update of username, phone on public.profiles
  for each row execute function private.normalize_profile();

-- ---------------------------------------------------------------------
-- Giriş e-postası çözümleme (giriş yapmamış kullanıcı çağırır)
-- ---------------------------------------------------------------------
create or replace function public.login_email(p_company_code text, p_identifier text)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  v_code  text := lower(btrim(coalesce(p_company_code, '')));
  v_ident text := lower(btrim(coalesce(p_identifier, '')));
  v_phone text := private.normalize_phone(p_identifier);
  v_email text;
  v_salt  text;
begin
  select u.email into v_email
  from public.profiles p
  join public.companies c on c.id = p.company_id
  join auth.users u       on u.id = p.id
  where c.code = v_code
    and (p.username = v_ident or (v_phone is not null and p.phone = v_phone))
  limit 1;

  if v_email is not null then
    return v_email;
  end if;

  -- Bulunamadı: gerçek e-postalarla aynı biçimde, deterministik sahte değer
  select value into v_salt from private.app_secrets where key = 'login_salt';
  return 'u-' || md5(v_salt || '|' || v_code || '|' || v_ident) || '@servis.local';
end $$;

revoke execute on function public.login_email(text, text) from public;
grant  execute on function public.login_email(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Geliştirme/test fonksiyonları için gizli anahtar kontrolü (yalnızca service_role)
-- ---------------------------------------------------------------------
create or replace function public.dev_verify_secret(p_secret text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.app_secrets where key = 'dev_secret' and value = p_secret)
$$;
revoke execute on function public.dev_verify_secret(text) from public, anon, authenticated;
grant  execute on function public.dev_verify_secret(text) to service_role;
