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

// Singleton browser client – one instance per browser tab, never recreated.
let _supabase: SupabaseClient | null = null;
function getSupabase() {
  if (!_supabase) _supabase = createSupabaseBrowserClient();
  return _supabase;
}

async function fetchProfile(
  supabase: SupabaseClient,
  userId: string,
  fallbackEmail: string,
): Promise<AuthUser> {
  try {
    const { data } = await supabase
      .from('profiles')
      .select('username')
      .eq('id', userId)
      .single();

    return {
      id:       userId,
      email:    fallbackEmail,
      username: (data?.username as string | null) ?? fallbackEmail.split('@')[0],
    };
  } catch {
    // Profile table unreachable – return minimal object so the app still works.
    return { id: userId, email: fallbackEmail, username: fallbackEmail.split('@')[0] };
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const supabase = getSupabase();
  const [user,    setUser]    = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const { data: { user: u } } = await supabase.auth.getUser();
    if (u) {
      setUser(await fetchProfile(supabase, u.id, u.email!));
    } else {
      setUser(null);
    }
  }, [supabase]);

  useEffect(() => {
    let mounted = true;

    /**
     * Session guard strategy
     * ──────────────────────
     * Step A  init() – calls getUser() which validates the token SERVER-SIDE.
     *   • Valid session  → fetch profile, set user, set loading=false.
     *   • Invalid/error  → signOut() (clears stale localStorage) → set user=null.
     *   This breaks the "must clear browser data" loop because stale tokens
     *   are caught here before onAuthStateChange sees them.
     *
     * Step B  onAuthStateChange – handles real-time transitions AFTER init.
     *   • INITIAL_SESSION is SKIPPED (init already handled it).
     *   • TOKEN_REFRESH_FAILED → emergency signOut + clear state.
     *   • SIGNED_IN / TOKEN_REFRESHED / SIGNED_OUT → normal state update.
     */
    const init = async () => {
      // Safety net: if getUser() never resolves (slow/blocked Supabase or stale token),
      // force loading=false after 6 s so the app doesn't hang forever.
      const safetyTimer = setTimeout(() => {
        if (!mounted) return;
        console.warn('[auth] init() timed out after 6 s – clearing session and unblocking UI');
        supabase.auth.signOut().catch(() => {});
        setUser(null);
        setLoading(false);
      }, 6_000);

      try {
        const { data: { user: serverUser }, error } = await supabase.auth.getUser();
        clearTimeout(safetyTimer);

        if (!mounted) return;

        if (error || !serverUser) {
          if (error) {
            console.warn('[auth] getUser() failed – clearing stale session:', error.message);
            await supabase.auth.signOut().catch(() => {});
          }
          setUser(null);
          setLoading(false);
          return;
        }

        const profile = await fetchProfile(supabase, serverUser.id, serverUser.email!);
        if (mounted) {
          setUser(profile);
          setLoading(false);
        }
      } catch (err) {
        clearTimeout(safetyTimer);
        console.error('[auth] init() threw unexpectedly:', err);
        if (mounted) {
          await supabase.auth.signOut().catch(() => {});
          setUser(null);
          setLoading(false);
        }
      }
    };

    init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!mounted) return;

        // INITIAL_SESSION is handled by init() above.
        // Processing it here would create a race condition.
        if (event === 'INITIAL_SESSION') return;

        // Token refresh failed → the stored refresh token is invalid.
        // signOut() erases all localStorage / cookie auth data so the user
        // is presented with a clean login form instead of an infinite loop.
        if ((event as string) === 'TOKEN_REFRESH_FAILED') {
          console.warn('[auth] TOKEN_REFRESH_FAILED – signing out to clear state');
          await supabase.auth.signOut().catch(() => {});
          if (mounted) { setUser(null); setLoading(false); }
          return;
        }

        if (session?.user) {
          const profile = await fetchProfile(supabase, session.user.id, session.user.email!);
          if (mounted) { setUser(profile); setLoading(false); }
        } else {
          if (mounted) { setUser(null); setLoading(false); }
        }
      },
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
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
      options: { data: { username } },
    });
    if (error) return { error: translateAuthError(error.message) };
    return {};
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refresh }}>
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
