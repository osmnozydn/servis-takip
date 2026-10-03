-- Supabase'in olmadığı düz bir Postgres'te migration'ı ve RLS testlerini
-- çalıştırabilmek için asgari taklit (roller, auth.users, auth.uid()).
-- GERÇEK Supabase projesinde ÇALIŞTIRMAYIN — orada bunların hepsi zaten var.

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon')          then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role')  then create role service_role nologin bypassrls; end if;
end $$;

-- "Automatically expose new tables" KAPALI proje gibi: tablolara varsayılan yetki yok,
-- migration kendi GRANT'larını vermeli.
grant usage on schema public to anon, authenticated, service_role;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;

create table auth.users (
  id    uuid primary key default gen_random_uuid(),
  email text unique
);

-- Supabase'teki tanımla aynı
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;
