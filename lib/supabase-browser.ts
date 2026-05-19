/**
 * Klient Supabase wyłącznie w przeglądarce — sesja w localStorage (szybki odczyt, bez chunkowanych ciasteczek).
 * API używa nagłówka Authorization z tokena (fetchWithSupabaseAuth).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/** Stały klucz — zmiana wymusza jednorazowe ponowne logowanie, omija stare śmieci w storage. */
export const AUTH_STORAGE_KEY = 'wealthtracker-auth-v3';

let browserClient: SupabaseClient | null = null;

export function createSupabaseBrowserClient(): SupabaseClient {
  if (typeof window === 'undefined') {
    throw new Error('createSupabaseBrowserClient() tylko w przeglądarce');
  }
  if (!browserClient) {
    browserClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        storage:        window.localStorage,
        storageKey:     AUTH_STORAGE_KEY,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });
  }
  return browserClient;
}
