import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase';
import { estimateValue, estimateByDescription } from '@/lib/valuate';

// Tell Vercel the maximum allowed duration for this function.
// Hobby plan hard cap = 10 s.
export const maxDuration = 10;

export async function POST(request: NextRequest) {
  // ── Auth ────────────────────────────────────────────────────────────────────
  const supabase = createSupabaseServerClient(request);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── Parse body ──────────────────────────────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Nieprawidłowe dane żądania.' }, { status: 400 });
  }

  // ── Option B: description-based AI valuation ─────────────────────────────────
  if (body.mode === 'description') {
    const description = typeof body.description === 'string' ? body.description.trim() : '';
    if (description.length < 10) {
      return NextResponse.json(
        { error: 'Opis jest za krótki (minimum 10 znaków). Im więcej szczegółów, tym lepsza wycena.' },
        { status: 400 },
      );
    }
    const result = await estimateByDescription(description);
    return NextResponse.json(result);
  }

  // ── Option A: market / exchange valuation ────────────────────────────────────
  const name     = typeof body.name === 'string' ? body.name.trim() : '';
  const quantity = typeof body.quantity === 'number' && body.quantity > 0 ? body.quantity : 1;

  if (name.length < 2) {
    return NextResponse.json(
      { error: 'Nazwa aktywa jest za krótka (minimum 2 znaki).' },
      { status: 400 },
    );
  }

  const result = await estimateValue(name, quantity);
  return NextResponse.json(result);
}
