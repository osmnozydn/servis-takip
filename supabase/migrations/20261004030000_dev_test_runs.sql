-- Geliştirme: arka planda çalışan test fonksiyonlarının sonuçları.
-- Yalnızca service_role erişir (RLS açık, politika yok). Canlıdan önce silinecek.
create table public.dev_test_runs (
  id         bigint generated always as identity primary key,
  name       text not null,
  summary    text,
  result     jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
alter table public.dev_test_runs enable row level security;
revoke all on public.dev_test_runs from anon, authenticated;
grant all on public.dev_test_runs to service_role;
