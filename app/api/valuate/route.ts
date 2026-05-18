import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase';
import { estimateValue } from '@/lib/valuate';

// Tell Vercel the maximum allowed duration for this function.
// Hobby plan hard cap = 10 s; we declare it explicitly so deploys fail fast
// if the plan is misconfigured instead of hanging silently.
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
  let name: string;
  let quantity: number;

  try {
    const body = (await request.json()) as { name?: string; quantity?: number };
    name     = (body.name ?? '').trim();
    quantity = typeof body.quantity === 'number' && body.quantity > 0 ? body.quantity : 1;
  } catch {
    return NextResponse.json({ error: 'Nieprawidłowe dane żądania.' }, { status: 400 });
  }

  if (name.length < 2) {
    return NextResponse.json(
      { error: 'Nazwa aktywa jest za krótka (minimum 2 znaki).' },
      { status: 400 },
    );
  }

  // ── Valuate ─────────────────────────────────────────────────────────────────
  // estimateValue never throws – on any failure it returns a safe fallback
  // with estimatedValue = 0 and a human-readable reasoning string.
  const result = await estimateValue(name, quantity);

  return NextResponse.json(result);
}
