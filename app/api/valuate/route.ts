/**
 * Valuation endpoint
 *
 * Option A (ticker / krypto / kruszce):
 *   buildTavilyQuery → Tavily Search → [NBP USD/PLN dla aktywów zagranicznych] → OpenAI → unitPricePLN × quantity
 *
 * Option B (opis / unikaty):
 *   estimateByDescription  (Tavily + OpenAI, osobna logika dla rynku wtórnego)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase';
import { estimateByDescription } from '@/lib/valuate';
import type { ValuationResult } from '@/lib/valuate';
import {
  buildTavilyQuery,
  searchTavilyMarket,
  extractMarketPrice,
  fetchNbpRateAny,
} from '@/lib/market-price';

export const maxDuration = 10;

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // ── Parse body first (sync, free) ────────────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Nieprawidłowe dane żądania.' }, { status: 400 });
  }

  const supabase = createSupabaseServerClient(request);

  // ── Option C: gotówka / waluta → przelicz przez kurs NBP ─────────────────────
  if (body.mode === 'cash') {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const currency = typeof body.currency === 'string' ? body.currency.trim().toUpperCase() : 'PLN';
    const amount   = typeof body.amount   === 'number' && body.amount > 0 ? body.amount : 0;

    if (amount <= 0) {
      return NextResponse.json({ error: 'Kwota musi być większa od 0.' }, { status: 400 });
    }

    try {
      const rate     = await fetchNbpRateAny(currency);
      const totalPln = amount * rate;
      const today    = new Date().toLocaleDateString('pl-PL');

      return NextResponse.json({
        estimatedValue:    Math.round(totalPln),
        unitPrice:         parseFloat(rate.toFixed(4)),
        currency:          'PLN',
        confidence:        'high',
        source:            currency === 'PLN' ? 'PLN (bezpośrednio)' : `Kurs NBP ${currency}/PLN (${today})`,
        suggestedCategory: 'Finanse',
        aiCategory:        'Gotówka',
        reasoning:
          currency === 'PLN'
            ? `Gotówka: ${amount.toLocaleString('pl-PL')} PLN`
            : `${amount.toLocaleString('pl-PL')} ${currency} × ${rate.toFixed(4)} PLN/${currency} (kurs NBP, ${today}) = ${totalPln.toFixed(2)} PLN`,
      } as ValuationResult);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Błąd pobierania kursu.';
      return NextResponse.json({ error: msg }, { status: 422 });
    }
  }

  // ── Option B: opis / unikaty ──────────────────────────────────────────────────
  if (body.mode === 'description') {
    // Auth check sequentially (description path is already slow due to Tavily+OpenAI)
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const description = typeof body.description === 'string' ? body.description.trim() : '';
    if (description.length < 10) {
      return NextResponse.json(
        { error: 'Opis jest za krótki (minimum 10 znaków).' },
        { status: 400 },
      );
    }
    return NextResponse.json(await estimateByDescription(description));
  }

  // ── Option A: ticker → Tavily → NBP → OpenAI → PLN ───────────────────────────
  const ticker   = typeof body.ticker   === 'string' ? body.ticker.trim() : '';
  const quantity = typeof body.quantity === 'number' && body.quantity > 0 ? body.quantity : 1;

  if (!ticker) {
    return NextResponse.json(
      { success: false, error: 'Brak tickera. Wpisz symbol, np. AAPL.US, PKN.PL, BTC lub GOLD.' },
      { status: 400 },
    );
  }

  const displayTicker = ticker.toUpperCase();
  console.log(`[valuate] Opcja A – ticker: "${displayTicker}", qty: ${quantity}`);

  try {
    // ── Kluczowa optymalizacja: auth + Tavily równolegle ─────────────────────
    // Vercel Hobby limit: 10 s. Supabase getUser() zajmuje ~2-4 s na cold starcie.
    // Tavily zajmuje do 5 s. Uruchamiając je jednocześnie, całkowity czas ≤ 7 s.
    const optimizedQuery = buildTavilyQuery(ticker);
    console.log('Wysłane zapytanie do Tavily:', optimizedQuery);

    const [authResult, context] = await Promise.all([
      supabase.auth.getUser(),
      searchTavilyMarket(optimizedQuery),
    ]);

    const { data: { user }, error: authError } = authResult;
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!context) {
      throw new Error('Tavily nie zwróciło żadnych wyników. Sprawdź klucz API lub połączenie.');
    }

    // ── Wyciągnij cenę przez OpenAI; konwersja walut via NBP jest wewnątrz ────
    const priceData = await extractMarketPrice(displayTicker, context);

    if (!priceData || priceData.unitPricePLN <= 0) {
      throw new Error('Nie udało się automatycznie wycenić tego symbolu.');
    }

    const unitPrice      = parseFloat(priceData.unitPricePLN.toFixed(2));
    const estimatedValue = Math.round(unitPrice * quantity);

    console.log(
      `Wykryto ticker: ${displayTicker} |`,
      `Cena: ${unitPrice} PLN/szt. |`,
      `Łącznie: ${estimatedValue} PLN`,
    );

    return NextResponse.json({
      estimatedValue,
      unitPrice,
      currency:          'PLN',
      confidence:        'medium',
      source:            `Yahoo Finance (Tavily) + GPT-4o-mini (${displayTicker}) + NBP`,
      suggestedCategory: 'Finanse',
      aiCategory:        'Giełda',
      reasoning:         priceData.reasoning,
    } as ValuationResult);

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Nieznany błąd wyceny.';
    console.error(`[valuate] Błąd dla "${displayTicker}":`, msg);
    return NextResponse.json(
      { success: false, error: 'Nie udało się automatycznie wycenić tego symbolu. Upewnij się, że wpisałeś poprawny ticker (np. MSFT.US, PKN.PL, BTC, GOLD).' },
      { status: 422 },
    );
  }
}
