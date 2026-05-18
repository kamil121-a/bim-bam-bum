/**
 * Session refresh middleware + server-side route protection.
 *
 * Named "proxy" per Next.js 16 convention (replaces deprecated "middleware").
 *
 * Two responsibilities:
 *  1. Refresh the Supabase session cookie on every request so Server Components
 *     and Route Handlers always see a valid, non-expired token.
 *  2. Redirect unauthenticated users away from protected pages and
 *     redirect authenticated users away from auth pages (login/register).
 *     This is the PRIMARY auth gate – client-side guards are a secondary safety net.
 *
 * IMPORTANT: Follow the exact Supabase SSR pattern.
 * Do NOT add code between createServerClient and supabase.auth.getUser().
 * See: https://supabase.com/docs/guides/auth/server-side/nextjs
 */

import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Routes that require an active session
const PROTECTED_PATHS = ['/dashboard', '/add-asset'];
// Routes that should redirect authenticated users away
const AUTH_PATHS = ['/login', '/register'];

export async function proxy(request: NextRequest) {
  /**
   * supabaseResponse must be created with NextResponse.next({ request }) and
   * potentially RECREATED inside setAll() when Supabase writes refreshed cookies.
   * Always return `supabaseResponse` (not a new NextResponse) so the refreshed
   * cookies are forwarded to the browser.
   */
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // Write refreshed tokens to the request (for downstream server components)
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          // Recreate the response so the new cookies are included
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Validate session against the Supabase server (not just local cookies).
  // getUser() is the ONLY secure way – getSession() reads from client storage and
  // can return stale/expired data without server validation.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // ── Protected route: must be authenticated ──────────────────────────────────
  if (!user && PROTECTED_PATHS.some(p => pathname.startsWith(p))) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    // No session cookies to preserve; simple redirect is safe.
    return NextResponse.redirect(loginUrl);
  }

  // ── Auth route: authenticated users belong on the dashboard ─────────────────
  if (user && AUTH_PATHS.some(p => pathname.startsWith(p))) {
    const dashboardUrl = request.nextUrl.clone();
    dashboardUrl.pathname = '/dashboard';
    // Forward the refreshed session cookies so the dashboard receives them.
    const redirectResponse = NextResponse.redirect(dashboardUrl);
    supabaseResponse.cookies.getAll().forEach(cookie => {
      redirectResponse.cookies.set(cookie.name, cookie.value, cookie as Parameters<typeof redirectResponse.cookies.set>[2]);
    });
    return redirectResponse;
  }

  // Default: pass through with potentially-refreshed cookies
  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * Match all request paths EXCEPT:
     *  - _next/static  (static assets)
     *  - _next/image   (image optimization)
     *  - favicon.ico
     *  - any file with an extension (images, fonts, etc.)
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)',
  ],
};
