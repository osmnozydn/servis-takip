-- Yol ağı üzerinden rota: OSRM (OpenStreetMap) sağlayıcısı da kaydedilebilir
alter table public.daily_routes drop constraint if exists daily_routes_source_check;
alter table public.daily_routes add constraint daily_routes_source_check check (source in ('google', 'osrm', 'fallback'));
comment on column public.daily_routes.polyline is 'Yollardan geçen güzergâh çizgisi (encoded polyline, hassasiyet 5; Google ve OSRM ortak biçim)';
