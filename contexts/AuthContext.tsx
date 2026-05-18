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
     * Session guard strategy (two-step, non-blocking)
     * ─────────────────────────────────────────────────
     * Step A  init() – FAST PATH via getSession() (reads localStorage, zero network)
     *   • Token found & not expired → show user instantly, unblock UI.
     *   • No token / expired        → show login page instantly.
     *   Background: getUser() validates the token with the Supabase server.
     *     If invalid → silent signOut, clear user state.
     *
     * This eliminates the "page hangs until browser history is cleared" bug
     * caused by getUser() making a slow/hung network request on every page load.
     *
     * Step B  onAuthStateChange – handles real-time transitions AFTER init.
     *   • INITIAL_SESSION is SKIPPED (init already handled it).
     *   • TOKEN_REFRESH_FAILED → emergency signOut + clear state.
     *   • SIGNED_IN / TOKEN_REFRESHED / SIGNED_OUT → normal state update.
     */
    const init = async () => {
      try {
        // ── Fast path: read cached session from localStorage (no network) ──────
        const { data: { session } } = await supabase.auth.getSession();

        if (!mounted) return;

        if (!session?.user) {
          // No session stored → show login immediately
          setUser(null);
          setLoading(false);
          return;
        }

        // Session found → show user from cache, unblock UI right away
        const cachedUser: AuthUser = {
          id:       session.user.id,
          email:    session.user.email!,
          username: session.user.email!.split('@')[0],  // placeholder until profile loads
        };
        setUser(cachedUser);
        setLoading(false);  // ← UI unblocked instantly

        // ── Background: validate token with server + load real profile ────────
        // If the token is stale/revoked, sign out silently after the page loads.
        supabase.auth.getUser()
          .then(async ({ data: { user: serverUser }, error }) => {
            if (!mounted) return;
            if (error || !serverUser) {
              console.warn('[auth] background token validation failed – signing out:', error?.message);
              await supabase.auth.signOut().catch(() => {});
              if (mounted) setUser(null);
              return;
            }
            // Replace placeholder with real profile data
            const profile = await fetchProfile(supabase, serverUser.id, serverUser.email!);
            if (mounted) setUser(profile);
          })
          .catch((err) => {
            console.warn('[auth] background getUser() error:', err instanceof Error ? err.message : err);
          });

      } catch (err) {
        console.error('[auth] init() error:', err);
        if (mounted) {
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
          // For a fresh SIGNED_IN (login form submit), hold loading=true until
          // profile is ready – prevents the dashboard from briefly seeing null user
          // and redirecting to /login. For TOKEN_REFRESHED, user is already shown
          // so we update silently without touching the loading flag.
          if (event === 'SIGNED_IN' && mounted) setLoading(true);
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
