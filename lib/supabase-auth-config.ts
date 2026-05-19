/**
 * Wspólna nazwa magazynu sesji (ciasteczka @supabase/ssr).
 * Musi być identyczna w: przeglądarce, middleware i Route Handlers.
 */
export function getSupabaseAuthCookieName(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  try {
    const ref = new URL(url).hostname.split('.')[0] || 'project';
    return `sb-${ref}-auth-token-v4`;
  } catch {
    return 'sb-auth-token-v4';
  }
}

/** Trasy wymagające zalogowania — middleware przekierowuje na /login bez renderu dashboardu. */
export const PROTECTED_PATH_PREFIXES = [
  '/dashboard',
  '/add-asset',
  '/ranking',
  '/stats',
] as const;

export const AUTH_PATHS = ['/login', '/register'] as const;

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PATH_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

export function isAuthPath(pathname: string): boolean {
  return AUTH_PATHS.includes(pathname as (typeof AUTH_PATHS)[number]);
}

export function hasSupabaseAuthCookie(
  cookies: { name: string; value: string }[],
): boolean {
  const base = getSupabaseAuthCookieName();
  return cookies.some(
    (c) => c.name === base || c.name.startsWith(`${base}.`),
  );
}
