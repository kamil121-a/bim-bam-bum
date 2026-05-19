/**
 * Valuation endpoint
 *
 * Option A (ticker):
 *   GPW (.PL) → Yahoo Chart API (szybko, poprawne symbole np. KRU.WA dla KRUK.PL), potem Tavily+GPT.
 *
 * Option B (opis / unikaty):
 *   estimateByDescription  (Tavily + OpenAI)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseUserForApiRoute } from '@/lib/supabase';
import { estimateByDescription } from '@/lib/valuate';
import type { ValuationResult } from '@/lib/valuate';
import {
  getMarketUnitPrice,
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

  const { supabase } = await getSupabaseUserForApiRoute(request);

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
        suggestedCategory: 'Gotówka',
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
    // Auth + wycena równolegle (Yahoo Chart dla GPW jest szybki; Tavily+GPT bywa wolniejszy).
    const [authResult, priceData] = await Promise.all([
      supabase.auth.getUser(),
      getMarketUnitPrice(displayTicker),
    ]);

    const { data: { user }, error: authError } = authResult;
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!priceData || priceData.unitPricePLN <= 0) {
      throw new Error('Nie udało się automatycznie wycenić tego symbolu.');
    }

    const unitPrice      = parseFloat(priceData.unitPricePLN.toFixed(2));
    const estimatedValue = Math.round(unitPrice * quantity);

    console.log(
      `[valuate] ${displayTicker} | ${unitPrice} PLN/szt. | razem ${estimatedValue} PLN | źródło: ${priceData.source ?? '?'}`,
    );

    // Detect category from ticker: metals → Kruszce, others → Akcje
    const METAL_BASES = new Set([
      'GOLD','XAU','SILVER','XAG','PLATINUM','XPT','PALLADIUM','XPD',
      'COPPER','XCU','GLD','IAU','SLV','GDX','GDXJ','IGLN','SLVR',
    ]);
    const tickerBase        = displayTicker.split('.')[0];
    const isMetalTicker     = METAL_BASES.has(tickerBase);
    const autoCategory      = isMetalTicker ? 'Kruszce' : 'Akcje';

    const confidence = priceData.source === 'yahoo_chart' ? 'high' : 'medium';
    const sourceLabel =
      priceData.source === 'yahoo_chart'
        ? `Yahoo Finance (${displayTicker})`
        : `Yahoo Finance (Tavily) + GPT-4o-mini (${displayTicker}) + NBP`;

    return NextResponse.json({
      estimatedValue,
      unitPrice,
      currency:          'PLN',
      confidence,
      source:            sourceLabel,
      suggestedCategory: autoCategory,
      aiCategory:        isMetalTicker ? 'Metale' : 'Giełda',
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
