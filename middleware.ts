import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseSessionCookieName } from '@/lib/supabase-session-storage-key';

/**
 * Odświeża sesję Supabase i synchronizuje ciasteczka chunków przed renderem.
 * Bez tego przeglądarka bywa w „śmierci” między starym JWT a odświeżeniem —
 * jedynym wyjściem zostaje ręczne czyszczenie danych witryny.
 *
 * @see https://supabase.com/docs/guides/auth/server-side/nextjs
 */
export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: {
        name: getSupabaseSessionCookieName(),
      },
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Wywołanie inicjalizuje sesję z ciasteczek i — przy potrzebie — odświeża token zapisem przez setAll.
  await supabase.auth.getUser();

  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * Pomijaj statyczne zasoby i obrazy — reszta przechodzi przez middleware.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
