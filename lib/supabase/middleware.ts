import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import {
  getSupabaseAuthCookieName,
  hasSupabaseAuthCookie,
  isAuthPath,
  isProtectedPath,
} from '@/lib/supabase-auth-config';

/**
 * Odświeża sesję w ciasteczkach i przekierowuje niezalogowanych na /login
 * zanim Next.js wyrenderuje chronione strony (brak „wiszącego” dashboardu).
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const pathname = request.nextUrl.pathname;
  const protectedRoute = isProtectedPath(pathname);
  const authPage = isAuthPath(pathname);
  const isHome = pathname === '/';

  const cookieList = request.cookies.getAll();
  const hasCookie = hasSupabaseAuthCookie(cookieList);

  // Szybka ścieżka: chroniona trasa bez ciasteczka sesji → od razu /login (bez wywołania Supabase).
  if (protectedRoute && !hasCookie) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: { name: getSupabaseAuthCookieName() },
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (protectedRoute && !user) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  if (authPage && user) {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    return NextResponse.redirect(url);
  }

  if (isHome) {
    const url = request.nextUrl.clone();
    url.pathname = user ? '/dashboard' : '/login';
    return NextResponse.redirect(url);
  }

  return response;
}
