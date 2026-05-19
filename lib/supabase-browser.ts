/**
 * Klient Supabase w przeglądarce — sesja w ciasteczkach (@supabase/ssr),
 * ta sama nazwa co w middleware (szybkie przekierowania po stronie serwera).
 */
import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAuthCookieName } from '@/lib/supabase-auth-config';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

let browserClient: SupabaseClient | null = null;

export function createSupabaseBrowserClient(): SupabaseClient {
  if (typeof window === 'undefined') {
    throw new Error('createSupabaseBrowserClient() tylko w przeglądarce');
  }
  if (!browserClient) {
    browserClient = createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      cookieOptions: { name: getSupabaseAuthCookieName() },
      auth: {
        detectSessionInUrl: false,
        persistSession:     true,
        autoRefreshToken:   true,
      },
    });
  }
  return browserClient;
}
