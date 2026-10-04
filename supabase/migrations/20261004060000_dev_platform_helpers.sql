-- Geliştirme: uçtan uca testlerin geçici platform yöneticisi oluşturup silebilmesi için.
-- Yalnızca service_role çağırabilir. Canlıdan önce dev-* fonksiyonlarıyla birlikte silinecek.
create or replace function public.dev_platform_admin_set(p_uid uuid, p_username text, p_full_name text, p_add boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_add then
    insert into private.platform_admins (user_id, username, full_name, must_change_password)
    values (p_uid, p_username, p_full_name, false)
    on conflict (user_id) do nothing;
  else
    delete from private.platform_admins where user_id = p_uid and username like 'e2e-%';
  end if;
end $$;
revoke execute on function public.dev_platform_admin_set(uuid, text, text, boolean) from public, anon, authenticated;
grant  execute on function public.dev_platform_admin_set(uuid, text, text, boolean) to service_role;
