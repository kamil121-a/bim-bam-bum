'use client';

import { useRef } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';

/**
 * Klient Supabase tylko w przeglądarce (nie wywołuj podczas SSR / prerenderu Vercel).
 */
export function useSupabaseBrowser(): SupabaseClient | null {
  const ref = useRef<SupabaseClient | null>(null);

  if (typeof window !== 'undefined' && !ref.current) {
    ref.current = createSupabaseBrowserClient();
  }

  return ref.current;
}
