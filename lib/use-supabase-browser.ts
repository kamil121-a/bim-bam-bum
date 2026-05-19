'use client';

import { useRef } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';

/** Jedna instancja Supabase na komponent (tylko w przeglądarce). */
export function useSupabaseBrowser(): SupabaseClient {
  const ref = useRef<SupabaseClient | null>(null);
  if (!ref.current) {
    ref.current = createSupabaseBrowserClient();
  }
  return ref.current;
}
