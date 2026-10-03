import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { loadProfile, nextStep, type AuthStep, type SessionProfile } from '@servis/shared';
import { supabase } from '../lib/supabase';

interface AuthState {
  loading: boolean;
  profile: SessionProfile | null;
  step: AuthStep;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<SessionProfile | null>(null);

  const refresh = useCallback(async () => {
    setProfile(await loadProfile(supabase));
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        // onAuthStateChange içinde doğrudan await yapılmaz (supabase-js önerisi)
        setTimeout(() => { refresh(); }, 0);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [refresh]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setProfile(null);
  }, []);

  return (
    <Ctx.Provider value={{ loading, profile, step: nextStep(profile), refresh, signOut }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth, AuthProvider içinde kullanılmalı');
  return v;
}
