/**
 * Nazwa magazynu sesji Supabase (prefiks ciasteczek chunkowanych przez @supabase/ssr).
 *
 * Musi być identyczna w: createBrowserClient, createServerClient (middleware),
 * oraz createServerClient w Route Handlers — inaczej sesja „rozjeżdża się”.
 *
 * Sufiks `-v2`: jednorazowo ignoruje stare, często uszkodzone ciasteczka z poprzedniej
 * konfiguracji (użytkownicy dostaną wylogowanie zamiast „wiecznego ładowania”).
 */
export function getSupabaseSessionCookieName(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  try {
    const host = new URL(url).hostname;
    const ref = host.split('.')[0] || 'project';
    return `sb-${ref}-auth-token-v2`;
  } catch {
    return 'sb-auth-token-v2';
  }
}
