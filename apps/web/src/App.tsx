import { useCallback, useEffect, useState } from 'react';
import { APP_TIMEZONE } from '@servis/shared';
import { isConfigured, supabase } from './lib/supabase';

type Health = { ok: boolean; server_time: string; istanbul_time: string; schema_version: string };

// Görev 1 bağlantı testi sayfası: Supabase'deki public.health() fonksiyonunu çağırır.
// Faz 2'de giriş ekranıyla, Faz 7'de yönetim paneliyle değiştirilecek.
export default function App() {
  const [loading, setLoading] = useState(true);
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async () => {
    setLoading(true);
    setError(null);
    if (!isConfigured) {
      setError('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY tanımlı değil (apps/web/.env).');
      setLoading(false);
      return;
    }
    const { data, error } = await supabase.rpc('health');
    if (error) setError(error.message);
    else setHealth(data as Health);
    setLoading(false);
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  return (
    <main className="card">
      <h1>Servis Takip</h1>
      <p className="sub">Supabase bağlantı testi</p>
      {loading ? (
        <p>Kontrol ediliyor…</p>
      ) : error ? (
        <p className="err">✗ Bağlantı hatası: {error}</p>
      ) : health ? (
        <>
          <p className="ok">✓ Bağlantı başarılı</p>
          <p className="row">Sunucu saati ({APP_TIMEZONE}): {health.istanbul_time}</p>
          <p className="row">Şema sürümü: {health.schema_version}</p>
        </>
      ) : null}
      <button onClick={check}>Tekrar dene</button>
    </main>
  );
}
