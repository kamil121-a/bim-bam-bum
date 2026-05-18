import {
  createBrowserClient,
  createServerClient as createSSRServerClient,
} from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * Browser client – use in Client Components and AuthContext.
 * Safe to call multiple times; returns a stable singleton per tab.
 *
 * detectSessionInUrl: false  – prevents the client from parsing session tokens
 *   out of URL hash fragments (happens after OAuth). Without this flag, a stale
 *   or malformed URL can corrupt the stored session and cause an auth loop.
 */
export function createSupabaseBrowserClient() {
  return createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
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
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      // Cookie writes happen in middleware; route handlers are read-only.
      setAll() {},
    },
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
