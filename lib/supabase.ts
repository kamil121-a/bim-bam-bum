import {
  createBrowserClient,
  createServerClient as createSSRServerClient,
} from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';
import { getSupabaseSessionCookieName } from '@/lib/supabase-session-storage-key';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const SESSION_COOKIE = { name: getSupabaseSessionCookieName() };

/**
 * Browser client – use in Client Components and AuthContext.
 * Safe to call multiple times; returns a stable singleton per tab.
 *
 * detectSessionInUrl: false  – prevents the client from parsing session tokens
 *   out of URL hash fragments (happens after OAuth). Without this flag, a stale
 *   or malformed URL can corrupt the stored session and cause an auth loop.
 *
 * cookieOptions.name — ten sam prefiks co middleware i Route Handlers; wersja `-v2`
 * odcina stare uszkodzone ciasteczka po zmianach auth.
 */
export function createSupabaseBrowserClient() {
  return createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookieOptions: SESSION_COOKIE,
    auth: {
      detectSessionInUrl: false,
      persistSession:     true,
      autoRefreshToken:   true,
    },
  });
}

/**
 * Server client for Route Handlers (API routes).
 * Reads the user session from request cookies.
 * Call `supabase.auth.getUser()` to validate the session.
 */
export function createSupabaseServerClient(request: NextRequest) {
  return createSSRServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookieOptions: SESSION_COOKIE,
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      // Zapisy obsługuje middleware — tutaj tylko odczyt żądania.
      setAll() {},
    },
  });
}

/** Bearer JWT z nagłówka Authorization (standard dla wywołań fetch z klienta). */
export function extractBearerToken(request: NextRequest): string | null {
  const raw = request.headers.get('authorization');
  if (!raw || !/^Bearer\s+/i.test(raw)) return null;
  const t = raw.replace(/^Bearer\s+/i, '').trim();
  return t.length > 0 ? t : null;
}

/**
 * Użytkownik i klient Supabase dla Route Handlerów.
 *
 * Sesja z `@supabase/ssr` w przeglądarce bywa niedostępna po stronie serwera jako ciasteczka,
 * więc klient wysyła dodatkowo `Authorization: Bearer <access_token>` (patrz `fetchWithSupabaseAuth`).
 */
export async function getSupabaseUserForApiRoute(request: NextRequest) {
  const bearer = extractBearerToken(request);

  const supabase = bearer
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: {
          headers: {
            Authorization: `Bearer ${bearer}`,
          },
        },
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      })
    : createSupabaseServerClient(request);

  const authResult = bearer
    ? await supabase.auth.getUser(bearer)
    : await supabase.auth.getUser();

  return {
    supabase,
    user: authResult.data.user ?? null,
    error: authResult.error,
  };
}

/**
 * fetch z JWT użytkownika — Route Handlers mogą zweryfikować sesję bez polegania wyłącznie na ciasteczkach.
 */
export async function fetchWithSupabaseAuth(
  supabase: SupabaseClient,
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const { data: { session } } = await supabase.auth.getSession();
  const headers = new Headers(init?.headers);
  if (session?.access_token) {
    headers.set('Authorization', `Bearer ${session.access_token}`);
  }
  return fetch(input, {
    ...init,
    credentials: 'same-origin',
    headers,
  });
}

/**
 * Admin client – uses service_role key, bypasses RLS.
 * Server-only. Never expose to the browser.
 */
export function createSupabaseAdminClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
