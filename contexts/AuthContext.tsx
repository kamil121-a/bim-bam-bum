'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  ReactNode,
} from 'react';
import type { User, SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';
import { fetchWithSupabaseAuth } from '@/lib/supabase';

interface AuthUser {
  id: string;
  username: string;
  email: string;
}

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<{ error?: string }>;
  register: (
    username: string,
    email: string,
    password: string
  ) => Promise<{ error?: string }>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  updateUsername: (username: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

function userFromAuth(u: User): AuthUser {
  const email = u.email ?? '';
  const meta = u.user_metadata as { username?: string } | undefined;
  const metaName =
    typeof meta?.username === 'string' ? meta.username.trim() : '';
  return {
    id:       u.id,
    email,
    username: metaName || email.split('@')[0] || 'użytkownik',
  };
}

async function fetchProfile(
  supabase: SupabaseClient,
  userId: string,
  fallback: AuthUser,
): Promise<AuthUser> {
  try {
    const { data } = await supabase
      .from('profiles')
      .select('username')
      .eq('id', userId)
      .abortSignal(AbortSignal.timeout(6_000))
      .maybeSingle();

    const name = (data?.username as string | null)?.trim();
    if (name) return { ...fallback, username: name };
  } catch {
    /* profil opcjonalny */
  }
  return fallback;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const applySession = useCallback(
    async (client: SupabaseClient, authUser: User | null, skipProfile = false) => {
      if (!authUser) {
        setUser(null);
        return;
      }
      const base = userFromAuth(authUser);
      setUser(base);
      if (!skipProfile) {
        setUser(await fetchProfile(client, authUser.id, base));
      }
    },
    [],
  );

  useEffect(() => {
    const client = createSupabaseBrowserClient();
    setSupabase(client);

    let mounted = true;

    const finishBoot = () => {
      if (mounted) setLoading(false);
    };

    const bootCap = window.setTimeout(finishBoot, 1_500);

    void client.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return;
      if (session?.user) {
        void applySession(client, session.user, true).finally(() => {
          window.clearTimeout(bootCap);
          finishBoot();
        });
      } else {
        setUser(null);
        window.clearTimeout(bootCap);
        finishBoot();
      }
    });

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;

      if (event === 'SIGNED_OUT') {
        setUser(null);
        finishBoot();
        return;
      }

      if ((event as string) === 'TOKEN_REFRESH_FAILED') {
        void client.auth.signOut().finally(() => {
          if (mounted) {
            setUser(null);
            finishBoot();
          }
        });
        return;
      }

      if (session?.user) {
        const fullProfile = event === 'SIGNED_IN';
        void applySession(client, session.user, !fullProfile).finally(finishBoot);
      }
    });

    return () => {
      mounted = false;
      window.clearTimeout(bootCap);
      subscription.unsubscribe();
    };
  }, [applySession]);

  const login = async (email: string, password: string) => {
    if (!supabase) return { error: 'Aplikacja się ładuje, spróbuj za chwilę.' };

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: translateAuthError(error.message) };

    const authUser = data.session?.user ?? data.user;
    if (!authUser) {
      return { error: 'Logowanie powiodło się, ale nie otrzymano sesji. Spróbuj ponownie.' };
    }

    await applySession(supabase, authUser);
    setLoading(false);
    return {};
  };

  const register = async (username: string, email: string, password: string) => {
    if (!supabase) return { error: 'Aplikacja się ładuje, spróbuj za chwilę.' };

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { username } },
    });
    if (error) return { error: translateAuthError(error.message) };

    const authUser = data.session?.user ?? data.user;
    if (authUser) {
      await applySession(supabase, authUser);
      setLoading(false);
    }
    return {};
  };

  const logout = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setUser(null);
    setLoading(false);
  };

  const refresh = useCallback(async () => {
    if (!supabase) return;
    const { data: { session } } = await supabase.auth.getSession();
    await applySession(supabase, session?.user ?? null);
  }, [supabase, applySession]);

  const updateUsername = useCallback(
    async (username: string) => {
      if (!supabase) return;
      const res = await fetchWithSupabaseAuth(supabase, '/api/profile', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ username }),
      });
      let payload: { error?: string } = {};
      try {
        payload = await res.json();
      } catch {
        /* ignore */
      }
      if (!res.ok) {
        throw new Error(
          typeof payload.error === 'string'
            ? payload.error
            : 'Nie udało się zapisać nicku.',
        );
      }
      await supabase.auth.updateUser({ data: { username } }).catch(() => {});
      await refresh();
    },
    [supabase, refresh],
  );

  return (
    <AuthContext.Provider
      value={{ user, loading, login, register, logout, refresh, updateUsername }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

function translateAuthError(msg: string): string {
  if (msg.includes('Invalid login credentials'))   return 'Nieprawidłowy email lub hasło.';
  if (msg.includes('User already registered'))     return 'Konto z tym adresem email już istnieje.';
  if (msg.includes('Password should be at least')) return 'Hasło musi mieć co najmniej 6 znaków.';
  if (msg.includes('Unable to validate email'))    return 'Nieprawidłowy format adresu email.';
  if (msg.includes('Email not confirmed'))
    return 'Potwierdź adres email przed zalogowaniem. Sprawdź skrzynkę odbiorczą.';
  return msg;
}
