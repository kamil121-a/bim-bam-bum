import { createServerClient as createSSRServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';

export { createSupabaseBrowserClient } from '@/lib/supabase-browser';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * Server client for Route Handlers (API routes).
 * Reads the user session from request cookies.
 * Call `supabase.auth.getUser()` to validate the session.
 */
/** Serwer API — sesja z ciasteczek (opcjonalnie) lub Bearer z klienta. */
export function createSupabaseServerClient(request: NextRequest) {
  return createSSRServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
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
  let token: string | undefined;
  try {
    const raced = await Promise.race([
      supabase.auth.getSession(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 3_000)),
    ]);
    if (raced && typeof raced === 'object' && 'data' in raced) {
      token = raced.data.session?.access_token;
    }
  } catch {
    /* brak tokena — API zwróci 401 */
  }

  const headers = new Headers(init?.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);

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
