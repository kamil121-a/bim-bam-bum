import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase';
import { estimateByTicker, estimateByDescription } from '@/lib/valuate';

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

  // ── Option B: description-based AI valuation (Tavily + OpenAI) ───────────────
  if (body.mode === 'description') {
    const description = typeof body.description === 'string' ? body.description.trim() : '';
    if (description.length < 10) {
      return NextResponse.json(
        { error: 'Opis jest za krótki (minimum 10 znaków).' },
        { status: 400 },
      );
    }
    const result = await estimateByDescription(description);
    return NextResponse.json(result);
  }

  // ── Option A: ticker-based market valuation (zero AI, pure API) ──────────────
  const ticker   = typeof body.ticker === 'string' ? body.ticker.trim().toUpperCase() : '';
  const quantity = typeof body.quantity === 'number' && body.quantity > 0 ? body.quantity : 1;

  if (!ticker) {
    return NextResponse.json(
      { error: 'Brak tickera. Wpisz symbol, np. AAPL.US, PKN.PL lub BTC.' },
      { status: 400 },
    );
  }

  try {
    const result = await estimateByTicker(ticker, quantity);
    return NextResponse.json(result);
  } catch (err) {
    // estimateByTicker throws descriptive errors – pass them directly to the frontend
    const msg = err instanceof Error ? err.message : 'Błąd pobierania ceny rynkowej.';
    console.error(`[/api/valuate] ticker error for "${ticker}":`, msg);
    return NextResponse.json({ error: msg }, { status: 422 });
  }
}
