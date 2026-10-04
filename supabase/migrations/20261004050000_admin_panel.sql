-- =====================================================================
-- Yönetim paneli: platform yöneticisi, şirket açma, belgeler, alış sırası
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Platform yöneticisi (şirketlerin üstünde; şirket açar, istediği
--    şirkete "girer" ve o şirketin yöneticisi gibi çalışır)
--    Giriş: şirket kodu "platform" + kullanıcı adı + şifre
-- ---------------------------------------------------------------------
create table private.platform_admins (
  user_id              uuid primary key references auth.users(id) on delete cascade,
  username             text not null unique check (username ~ '^[a-z0-9._-]{3,32}$'),
  full_name            text not null,
  active_company_id    uuid references public.companies(id) on delete set null,
  must_change_password boolean not null default true,
  created_at           timestamptz not null default now()
);
revoke all on private.platform_admins from public, anon, authenticated;

alter table public.companies drop constraint if exists companies_code_check;
alter table public.companies add constraint companies_code_check
  check (code ~ '^[a-z0-9-]{2,32}$' and code <> 'platform');
alter table public.companies
  add column contact_name  text,
  add column contact_phone text;

-- Yetki yardımcıları: platform yöneticisi aktif şirkette "admin" sayılır
create or replace function private.current_company_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select company_id from public.profiles where id = auth.uid()),
    (select active_company_id from private.platform_admins where user_id = auth.uid()))
$$;

create or replace function private.current_app_role()
returns public.user_role language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select role from public.profiles where id = auth.uid()),
    (select 'admin'::public.user_role from private.platform_admins
      where user_id = auth.uid() and active_company_id is not null))
$$;

create or replace function private.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false)
      or exists (select 1 from private.platform_admins where user_id = auth.uid() and active_company_id is not null)
$$;

create or replace function private.is_platform_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.platform_admins where user_id = auth.uid())
$$;

-- Konum görme yetkisi (platform yöneticisini de kapsayacak şekilde yeniden)
create or replace function private.can_view_vehicle(p_vehicle_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.vehicles v
    where v.id = p_vehicle_id
      and v.company_id = private.current_company_id()
      and (
        private.is_admin()
        or (private.current_app_role() = 'driver'    and private.current_vehicle_id() = p_vehicle_id)
        or (private.current_app_role() = 'passenger' and private.current_vehicle_id() = p_vehicle_id
                                                     and private.visibility_window_open(p_vehicle_id))
      )
  )
$$;

-- Edge Function'lar için: bu kullanıcı hangi şirketin yöneticisi? (yalnızca service_role)
create or replace function public.admin_company_of(p_uid uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select company_id from public.profiles where id = p_uid and role = 'admin'),
    (select active_company_id from private.platform_admins where user_id = p_uid))
$$;
create or replace function public.is_platform_admin_uid(p_uid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.platform_admins where user_id = p_uid)
$$;
revoke execute on function public.admin_company_of(uuid), public.is_platform_admin_uid(uuid) from public, anon, authenticated;
grant  execute on function public.admin_company_of(uuid), public.is_platform_admin_uid(uuid) to service_role;

-- Giriş e-postası: "platform" kodu platform yöneticilerine bakar
create or replace function public.login_email(p_company_code text, p_identifier text)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  v_code  text := lower(btrim(coalesce(p_company_code, '')));
  v_ident text := lower(btrim(coalesce(p_identifier, '')));
  v_phone text := private.normalize_phone(p_identifier);
  v_email text;
  v_salt  text;
begin
  if v_code = 'platform' then
    select u.email into v_email
    from private.platform_admins a join auth.users u on u.id = a.user_id
    where a.username = v_ident;
  else
    select u.email into v_email
    from public.profiles p
    join public.companies c on c.id = p.company_id
    join auth.users u       on u.id = p.id
    where c.code = v_code
      and (p.username = v_ident or (v_phone is not null and p.phone = v_phone))
    limit 1;
  end if;
  if v_email is not null then return v_email; end if;
  select value into v_salt from private.app_secrets where key = 'login_salt';
  return 'u-' || md5(v_salt || '|' || v_code || '|' || v_ident) || '@servis.local';
end $$;

-- Oturum bilgisi (web + mobil): şirket üyesi veya platform yöneticisi
create or replace function public.my_session()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  p  public.profiles;
  a  private.platform_admins;
  c  public.companies;
  v  public.vehicles;
begin
  select * into p from public.profiles where id = auth.uid();
  if found then
    select * into c from public.companies where id = p.company_id;
    select * into v from public.vehicles where id = p.vehicle_id;
    return jsonb_build_object(
      'id', p.id, 'role', p.role, 'username', p.username, 'full_name', p.full_name, 'phone', p.phone,
      'must_change_password', p.must_change_password, 'consent_version', p.consent_version,
      'is_platform_admin', false,
      'company', jsonb_build_object('id', c.id, 'name', c.name, 'code', c.code),
      'vehicle', case when v.id is null then null else jsonb_build_object('id', v.id, 'plate', v.plate, 'name', v.name) end);
  end if;
  select * into a from private.platform_admins where user_id = auth.uid();
  if found then
    select * into c from public.companies where id = a.active_company_id;
    return jsonb_build_object(
      'id', a.user_id, 'role', 'admin', 'username', a.username, 'full_name', a.full_name, 'phone', null,
      'must_change_password', a.must_change_password, 'consent_version', null,
      'is_platform_admin', true,
      'company', case when c.id is null then null else jsonb_build_object('id', c.id, 'name', c.name, 'code', c.code) end,
      'vehicle', null);
  end if;
  return null;
end $$;
revoke execute on function public.my_session() from public, anon;
grant  execute on function public.my_session() to authenticated;

-- Şifre değiştirildi (her iki kullanıcı türü için)
create or replace function public.mark_password_changed()
returns void language sql security definer set search_path = '' as $$
  update public.profiles set must_change_password = false where id = auth.uid();
  update private.platform_admins set must_change_password = false where user_id = auth.uid();
$$;
revoke execute on function public.mark_password_changed() from public, anon;
grant  execute on function public.mark_password_changed() to authenticated;

-- Platform: şirket listesi ve şirkete girme
create or replace function public.platform_companies()
returns table (id uuid, code text, name text, contact_name text, contact_phone text, created_at timestamptz,
               admins bigint, drivers bigint, passengers bigint, vehicles bigint)
language sql stable security definer set search_path = '' as $$
  select c.id, c.code, c.name, c.contact_name, c.contact_phone, c.created_at,
         (select count(*) from public.profiles p where p.company_id = c.id and p.role = 'admin'),
         (select count(*) from public.profiles p where p.company_id = c.id and p.role = 'driver'),
         (select count(*) from public.profiles p where p.company_id = c.id and p.role = 'passenger'),
         (select count(*) from public.vehicles v where v.company_id = c.id)
  from public.companies c
  where private.is_platform_admin()
  order by c.name
$$;

create or replace function public.platform_enter_company(p_company uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then return false; end if;
  if p_company is not null and not exists (select 1 from public.companies where id = p_company) then return false; end if;
  update private.platform_admins set active_company_id = p_company where user_id = auth.uid();
  return true;
end $$;
revoke execute on function public.platform_companies(), public.platform_enter_company(uuid) from public, anon;
grant  execute on function public.platform_companies(), public.platform_enter_company(uuid) to authenticated;

-- Şirket yöneticisi kendi şirketinin iletişim bilgilerini güncelleyebilir (companies_update politikası zaten var)

-- ---------------------------------------------------------------------
-- 2) Araç, sürücü ve durak alanları
-- ---------------------------------------------------------------------
alter table public.vehicles
  add column brand_model text,
  add column color       text,
  add column capacity    integer check (capacity between 1 and 100),
  add column route_mode  text not null default 'auto' check (route_mode in ('auto', 'manual'));
comment on column public.vehicles.route_mode is 'auto: rota en kısa sıraya göre hesaplanır; manual: yöneticinin belirlediği alış sırası (stops.pickup_order)';

alter table public.profiles
  add column license_no         text,
  add column license_class      text,
  add column license_expires_on date;

alter table public.stops add column pickup_order integer;
create index stops_vehicle_order_idx on public.stops (vehicle_id, pickup_order);

-- Yolcu yeni araca taşınınca alış sırası sıfırlanır (yeni aracın sonuna eklenir)
create or replace function private.cascade_passenger_vehicle()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.role = 'passenger' and new.vehicle_id is distinct from old.vehicle_id then
    if new.vehicle_id is null then
      delete from public.stops where passenger_id = new.id;
    else
      update public.stops set vehicle_id = new.vehicle_id,
             pickup_order = (select coalesce(max(pickup_order), 0) + 1 from public.stops where vehicle_id = new.vehicle_id)
       where passenger_id = new.id;
    end if;
  end if;
  return new;
end $$;

-- Yeni durak: sıra verilmemişse aracın sonuna
create or replace function private.default_pickup_order()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.pickup_order is null then
    select coalesce(max(pickup_order), 0) + 1 into new.pickup_order from public.stops where vehicle_id = new.vehicle_id;
  end if;
  return new;
end $$;
-- ad bilerek "stops_z…": stops_sync_vehicle aracı doldurduktan sonra çalışmalı
create trigger stops_z_default_order before insert on public.stops
  for each row execute function private.default_pickup_order();

-- Mevcut duraklara sıra ver (oluşturulma sırasına göre)
update public.stops s set pickup_order = x.rn
  from (select id, row_number() over (partition by vehicle_id order by created_at, id) rn from public.stops) x
 where x.id = s.id and s.pickup_order is null;

-- Alış sırasını toplu kaydet (yönetici): sıralı yolcu id listesi
create or replace function public.set_pickup_order(p_vehicle uuid, p_passengers uuid[])
returns integer language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if not private.is_admin() or not exists (
    select 1 from public.vehicles where id = p_vehicle and company_id = private.current_company_id()) then
    raise exception 'yetki yok' using errcode = '42501';
  end if;
  update public.stops s set pickup_order = x.ord
    from unnest(p_passengers) with ordinality as x(pid, ord)
   where s.passenger_id = x.pid and s.vehicle_id = p_vehicle;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.set_pickup_order(uuid, uuid[]) from public, anon;
grant  execute on function public.set_pickup_order(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------
-- 3) Belgeler (sürücü fotoğrafı, ehliyet, SRC, psikoteknik, sabıka kaydı,
--    araç fotoğrafı, ruhsat, sigorta, muayene)
--    Dosyalar Storage'da: documents/{şirket}/{driver|vehicle}/{sahip}/{dosya}
-- ---------------------------------------------------------------------
create table public.documents (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null default private.current_company_id() references public.companies(id) on delete cascade,
  owner_type  text not null check (owner_type in ('driver', 'vehicle')),
  owner_id    uuid not null,
  doc_type    text not null check (doc_type in (
                'driver_photo', 'license', 'src', 'psychotechnic', 'criminal_record',
                'vehicle_photo', 'registration', 'insurance', 'inspection', 'other')),
  title       text,
  file_path   text not null unique,
  mime_type   text,
  size_bytes  integer,
  expires_on  date,
  uploaded_by uuid default auth.uid(),
  created_at  timestamptz not null default now()
);
create index documents_owner_idx on public.documents (company_id, owner_type, owner_id);
comment on table public.documents is 'Sürücü ve araç belgeleri. Fotoğraflar aynı servisteki kullanıcılara, diğer belgeler yalnızca yöneticiye açıktır.';

-- Belge sahibi aynı şirkette olmalı; dosya yolu şirket klasörüyle başlamalı
create or replace function private.check_document()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.owner_type = 'driver' and not exists (
       select 1 from public.profiles where id = new.owner_id and company_id = new.company_id and role = 'driver') then
    raise exception 'Belge sahibi bu şirketin sürücüsü değil' using errcode = '23514';
  end if;
  if new.owner_type = 'vehicle' and not exists (
       select 1 from public.vehicles where id = new.owner_id and company_id = new.company_id) then
    raise exception 'Belge sahibi bu şirketin aracı değil' using errcode = '23514';
  end if;
  if split_part(new.file_path, '/', 1) <> new.company_id::text then
    raise exception 'Geçersiz dosya yolu' using errcode = '23514';
  end if;
  if (new.owner_type = 'driver' and new.doc_type in ('vehicle_photo', 'registration', 'insurance', 'inspection'))
     or (new.owner_type = 'vehicle' and new.doc_type in ('driver_photo', 'license', 'src', 'psychotechnic', 'criminal_record')) then
    raise exception 'Belge türü sahibiyle uyumsuz' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger documents_check before insert or update on public.documents
  for each row execute function private.check_document();
create trigger documents_forbid_company_change before update on public.documents
  for each row execute function private.forbid_company_change();

-- Okuma: yönetici hepsini; yolcu/sürücü yalnızca KENDİ servisinin araç fotoğrafı ve sürücü fotoğrafı
create or replace function private.can_read_document(p_company uuid, p_owner_type text, p_owner uuid, p_doc_type text)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_company = private.current_company_id() and (
    private.is_admin()
    or (p_doc_type = 'vehicle_photo' and p_owner_type = 'vehicle' and p_owner = private.current_vehicle_id())
    or (p_doc_type = 'driver_photo' and p_owner_type = 'driver' and (
          p_owner = auth.uid()
          or exists (select 1 from public.profiles d where d.id = p_owner and d.role = 'driver'
                       and d.vehicle_id is not null and d.vehicle_id = private.current_vehicle_id())))
  )
$$;
grant execute on function private.can_read_document(uuid, text, uuid, text) to authenticated, service_role;

alter table public.documents enable row level security;
revoke all on public.documents from anon, authenticated;
grant select, insert, update, delete on public.documents to authenticated;
grant all on public.documents to service_role;

create policy documents_select on public.documents for select to authenticated
  using (private.can_read_document(company_id, owner_type, owner_id, doc_type));
create policy documents_admin_insert on public.documents for insert to authenticated
  with check (company_id = (select private.current_company_id()) and (select private.is_admin()));
create policy documents_admin_update on public.documents for update to authenticated
  using (company_id = (select private.current_company_id()) and (select private.is_admin()))
  with check (company_id = (select private.current_company_id()));
create policy documents_admin_delete on public.documents for delete to authenticated
  using (company_id = (select private.current_company_id()) and (select private.is_admin()));

-- Storage kovası ve politikaları (yalnızca Supabase'de; yerel testte storage şeması yok)
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('documents', 'documents', false, 10485760,
            array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'])
    on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
                                   allowed_mime_types = excluded.allowed_mime_types;

    execute $p$ create policy documents_read on storage.objects for select to authenticated
      using (bucket_id = 'documents' and (
               exists (select 1 from public.documents d where d.file_path = storage.objects.name)
               or ((storage.foldername(name))[1] = (select private.current_company_id())::text and (select private.is_admin())))) $p$;
    execute $p$ create policy documents_admin_write on storage.objects for insert to authenticated
      with check (bucket_id = 'documents' and (storage.foldername(name))[1] = (select private.current_company_id())::text
                  and (select private.is_admin())) $p$;
    execute $p$ create policy documents_admin_update on storage.objects for update to authenticated
      using (bucket_id = 'documents' and (storage.foldername(name))[1] = (select private.current_company_id())::text
             and (select private.is_admin())) $p$;
    execute $p$ create policy documents_admin_delete on storage.objects for delete to authenticated
      using (bucket_id = 'documents' and (storage.foldername(name))[1] = (select private.current_company_id())::text
             and (select private.is_admin())) $p$;
  end if;
end $$;

revoke execute on all functions in schema private from public;
grant execute on all functions in schema private to authenticated, service_role;
