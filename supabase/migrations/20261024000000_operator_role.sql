-- Operasyon sorumlusu rolü (ayrı dosya: yeni enum değeri aynı işlemde kullanılamaz)
alter type public.user_role add value if not exists 'operator';
