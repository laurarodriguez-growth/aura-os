import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { getSupabase } from '../lib/supabase';
import { configProblems } from '../lib/config';
import { api } from '../lib/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const problems = configProblems();
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(problems.length === 0);
  const [profileError, setProfileError] = useState('');

  useEffect(() => {
    if (problems.length) return undefined;
    const supabase = getSupabase();
    let alive = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      setSession(data.session || null);
      setLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession || null);
      if (!nextSession) setProfile(null);
    });

    return () => {
      alive = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session) return;
    setProfileError('');
    api('/api/me')
      .then(setProfile)
      .catch((error) => setProfileError(error.message));
  }, [session?.access_token]);

  const value = useMemo(
    () => ({
      session,
      profile,
      loading,
      profileError,
      async signIn(email, password) {
        const { error } = await getSupabase().auth.signInWithPassword({ email, password });
        if (error) throw error;
      },
      async signOut() {
        await getSupabase().auth.signOut();
      },
      refreshProfile: async () => setProfile(await api('/api/me')),
    }),
    [session, profile, loading, profileError],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return context;
}
