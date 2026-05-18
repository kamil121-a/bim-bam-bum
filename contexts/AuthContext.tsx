'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  ReactNode,
} from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase';
import type { SupabaseClient } from '@supabase/supabase-js';

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
}

const AuthContext = createContext<AuthContextType | null>(null);

// Singleton browser client – one instance per tab, never recreated.
let _supabase: SupabaseClient | null = null;
function getSupabase() {
  if (!_supabase) _supabase = createSupabaseBrowserClient();
  return _supabase;
}

async function fetchProfile(
  supabase: SupabaseClient,
  userId: string,
  fallbackEmail: string
): Promise<AuthUser> {
  const { data } = await supabase
    .from('profiles')
    .select('username')
    .eq('id', userId)
    .single();

  return {
    id: userId,
    email: fallbackEmail,
    username: (data?.username as string | null) ?? fallbackEmail.split('@')[0],
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const supabase = getSupabase();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const {
      data: { user: supaUser },
    } = await supabase.auth.getUser();
    if (supaUser) {
      const profile = await fetchProfile(supabase, supaUser.id, supaUser.email!);
      setUser(profile);
    } else {
      setUser(null);
    }
  }, [supabase]);

  useEffect(() => {
    // Initialise from current session (fast, no network call for the token itself).
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        const profile = await fetchProfile(
          supabase,
          session.user.id,
          session.user.email!
        );
        setUser(profile);
      }
      setLoading(false);
    });

    // Keep user in sync when the session changes (login / logout / token refresh).
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        const profile = await fetchProfile(
          supabase,
          session.user.id,
          session.user.email!
        );
        setUser(profile);
      } else {
        setUser(null);
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, [supabase]);

  const login = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: translateAuthError(error.message) };
    return {};
  };

  const register = async (username: string, email: string, password: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        // Stored in auth.users.raw_user_meta_data – consumed by the DB trigger.
        data: { username },
      },
    });
    if (error) return { error: translateAuthError(error.message) };
    return {};
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{ user, loading, login, register, logout, refresh }}
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

// Map common Supabase error messages to Polish
function translateAuthError(msg: string): string {
  if (msg.includes('Invalid login credentials'))
    return 'Nieprawidłowy email lub hasło.';
  if (msg.includes('User already registered'))
    return 'Konto z tym adresem email już istnieje.';
  if (msg.includes('Password should be at least'))
    return 'Hasło musi mieć co najmniej 6 znaków.';
  if (msg.includes('Unable to validate email'))
    return 'Nieprawidłowy format adresu email.';
  if (msg.includes('Email not confirmed'))
    return 'Potwierdź adres email przed zalogowaniem. Sprawdź skrzynkę odbiorczą.';
  return msg;
}
