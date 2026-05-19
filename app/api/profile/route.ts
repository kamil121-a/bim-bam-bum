import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase';

const MIN_LEN = 2;
const MAX_LEN = 40;

/**
 * PATCH /api/profile — zmiana nicku (`profiles.username`), tylko dla zalogowanego użytkownika.
 */
export async function PATCH(request: NextRequest) {
  const supabase = createSupabaseServerClient(request);
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();

  if (authErr || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { username?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Nieprawidłowe dane.' }, { status: 400 });
  }

  const raw = typeof body.username === 'string' ? body.username.trim() : '';
  if (raw.length < MIN_LEN) {
    return NextResponse.json(
      { error: `Nick musi mieć co najmniej ${MIN_LEN} znaki.` },
      { status: 400 },
    );
  }
  if (raw.length > MAX_LEN) {
    return NextResponse.json(
      { error: `Nick może mieć maksymalnie ${MAX_LEN} znaków.` },
      { status: 400 },
    );
  }

  const { error: upErr } = await supabase
    .from('profiles')
    .update({ username: raw })
    .eq('id', user.id);

  if (upErr) {
    console.error('[PATCH /api/profile]', upErr);
    const code = (upErr as { code?: string }).code;
    const msg  = upErr.message ?? '';
    if (code === '23505' || msg.toLowerCase().includes('duplicate') || msg.includes('unique')) {
      return NextResponse.json(
        { error: 'Ten nick jest już zajęty. Wybierz inny.' },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: 'Nie udało się zapisać nicku.' }, { status: 500 });
  }

  return NextResponse.json({ username: raw });
}
