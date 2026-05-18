/**
 * Valuation endpoint – two modes:
 *
 * Option A (ticker/ISIN/krypto/złoto):
 *   Tavily Search → surowe wyniki → OpenAI gpt-4o-mini → unitPricePLN → × quantity
 *
 * Option B (opis / unikaty):
 *   Tavily Search → OpenAI → szacunkowa wartość  (bez zmian)
 */

import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { createSupabaseServerClient } from '@/lib/supabase';
import { estimateByDescription } from '@/lib/valuate';
import type { ValuationResult } from '@/lib/valuate';

export const maxDuration = 10;

// ─── OpenAI client ────────────────────────────────────────────────────────────

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

// ─── Tavily search ────────────────────────────────────────────────────────────

interface TavilyResult { title: string; content: string; url: string }

async function searchTavily(query: string): Promise<string | null> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    console.warn('[tavily] TAVILY_API_KEY not set');
    return null;
  }

  try {
    const res = await fetch('https://api.tavily.com/search', {
      method:  'POST',
      signal:  AbortSignal.timeout(7_000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key:        apiKey,
        query,
        search_depth:   'basic',
        include_answer: false,
        max_results:    5,
      }),
    });

    if (!res.ok) {
      console.warn('[tavily] HTTP', res.status, await res.text().catch(() => ''));
      return null;
    }

    const data    = await res.json() as { results?: TavilyResult[] };
    const results = data.results ?? [];

    if (!results.length) return null;

    const context = results
      .slice(0, 5)
      .map((r, i) => `[${i + 1}] ${r.title}\n${r.content.slice(0, 400)}`)
      .join('\n\n');

    console.log(`[tavily] ${results.length} wyników dla: "${query}"`);
    return context;

  } catch (err) {
    console.warn('[tavily] error:', err instanceof Error ? err.message : err);
    return null;
  }
}

// ─── Tavily query optimizer ───────────────────────────────────────────────────

function buildTavilyQuery(raw: string): string {
  const t = raw.trim().toUpperCase();

  // Polish GPW: KRUK.PL → notowania Bankier/Stooq po polsku
  if (t.endsWith('.PL')) {
    const name = t.slice(0, -3);
    return `${name} notowania giełdowe kurs aktualny bankier stooq 2026`;
  }

  // US stocks: AAPL.US → English search for precision
  if (t.endsWith('.US')) {
    const name = t.slice(0, -3);
    return `Google Finance ${name} stock price current USD 2026`;
  }

  // Crypto tickers (heuristic: short, no dot, known names)
  const cryptoKeywords = ['BTC', 'ETH', 'SOL', 'XRP', 'ADA', 'DOGE', 'BNB', 'LTC',
    'DOT', 'AVAX', 'LINK', 'ATOM', 'XLM', 'NEAR', 'UNI', 'MATIC', 'SHIB', 'TON'];
  if (cryptoKeywords.includes(t) || t.includes('COIN') || t.includes('CRYPTO')) {
    return `CoinGecko ${t} price pln dzisiaj kurs 2026`;
  }

  // Everything else (Złoto, XAUUSD, custom names…)
  return `${raw} aktualna cena rynkowa PLN 2026`;
}

// ─── OpenAI price extraction ──────────────────────────────────────────────────

interface PriceJson {
  success:      boolean;
  unitPricePLN: number;
  reasoning:    string;
}

async function extractPriceFromContext(ticker: string, context: string): Promise<PriceJson> {
  const systemPrompt =
    `Jesteś precyzyjnym botem finansowym. Przeanalizuj dostarczone wyniki wyszukiwania ` +
    `z internetu dla aktywa: "${ticker}". ` +
    `Twoim absolutnym priorytetem jest znalezienie NAJŚWIEŻSZEGO kursu ` +
    `(najlepiej z dzisiejszą datą lub z ostatnich dni maja 2026 roku). ` +
    `Ignoruj artykuły i prognozy sprzed wielu miesięcy. ` +
    `Znajdź cyfrę oznaczającą aktualną cenę na portalach takich jak ` +
    `Bankier, Stooq, BiznesRadar, Google Finance lub CoinGecko. ` +
    `Jeśli cena jest w USD lub EUR, przelicz ją na PLN (kurs z tekstu lub rynkowy 2026). ` +
    `\n\nZwróć WYŁĄCZNIE czysty JSON (bez markdownu, bez \`\`\`json):\n` +
    `{ "success": true, "unitPricePLN": <liczba>, "reasoning": "<b. krótkie potwierdzenie źródła i ceny>" }` +
    `\n\nJeśli nie możesz ustalić ceny, zwróć:\n` +
    `{ "success": false, "unitPricePLN": 0, "reasoning": "Brak aktualnych danych" }`;

  const completion = await getOpenAI().chat.completions.create({
    model:           'gpt-4o-mini',
    response_format: { type: 'json_object' },
    temperature:     0.1,
    max_tokens:      200,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: `Wyniki wyszukiwania:\n\n${context}` },
    ],
  });

  const raw = completion.choices[0]?.message?.content ?? '{}';
  console.log('Odpowiedź OpenAI JSON:', raw);

  const parsed = JSON.parse(raw) as Partial<PriceJson>;
  return {
    success:      parsed.success      === true,
    unitPricePLN: Number(parsed.unitPricePLN ?? 0),
    reasoning:    String(parsed.reasoning    ?? ''),
  };
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // ── Auth ─────────────────────────────────────────────────────────────────────
  const supabase = createSupabaseServerClient(request);
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── Body ─────────────────────────────────────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Nieprawidłowe dane żądania.' }, { status: 400 });
  }

  // ── Option B: opis / unikaty (Tavily + OpenAI, osobna logika) ────────────────
  if (body.mode === 'description') {
    const description = typeof body.description === 'string' ? body.description.trim() : '';
    if (description.length < 10) {
      return NextResponse.json(
        { error: 'Opis jest za krótki (minimum 10 znaków).' },
        { status: 400 },
      );
    }
    return NextResponse.json(await estimateByDescription(description));
  }

  // ── Option A: ticker → Tavily → OpenAI → PLN ─────────────────────────────────
  const ticker   = typeof body.ticker   === 'string' ? body.ticker.trim() : '';
  const quantity = typeof body.quantity === 'number' && body.quantity > 0 ? body.quantity : 1;

  if (!ticker) {
    return NextResponse.json(
      { success: false, error: 'Brak tickera. Wpisz symbol, np. AAPL.US, PKN.PL, BTC lub Złoto.' },
      { status: 400 },
    );
  }

  const displayTicker = ticker.toUpperCase();
  console.log(`[valuate] Opcja A – ticker: "${displayTicker}", qty: ${quantity}`);

  try {
    // 1. Zoptymalizuj zapytanie i szukaj w sieci przez Tavily
    const optimizedQuery = buildTavilyQuery(ticker);
    console.log('Wysłane zapytanie do Tavily:', optimizedQuery);

    const context = await searchTavily(optimizedQuery);

    if (!context) {
      throw new Error('Tavily nie zwróciło żadnych wyników – sprawdź klucz API lub połączenie.');
    }

    // 2. Wyciągnij cenę jednostkową przez OpenAI
    const priceData = await extractPriceFromContext(displayTicker, context);

    if (!priceData.success || !priceData.unitPricePLN || priceData.unitPricePLN <= 0) {
      throw new Error('Nie udało się automatycznie wycenić tego symbolu. Upewnij się, że wpisałeś go poprawnie.');
    }

    // 3. Oblicz wartość łączną
    const unitPrice      = parseFloat(priceData.unitPricePLN.toFixed(2));
    const estimatedValue = Math.round(unitPrice * quantity);

    console.log(
      `Wykryto ticker: ${displayTicker} |`,
      `Pobrana cena końcowa w PLN: ${unitPrice} |`,
      `Wartość łączna: ${estimatedValue}`,
    );

    return NextResponse.json({
      estimatedValue,
      unitPrice,
      currency:          'PLN',
      confidence:        'medium',
      source:            `Tavily Search + GPT-4o-mini (${displayTicker})`,
      suggestedCategory: 'Finanse',
      aiCategory:        'Giełda',
      reasoning:         priceData.reasoning,
    } as ValuationResult);

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Nieznany błąd wyceny.';
    console.error(`[valuate] Błąd dla "${displayTicker}":`, msg);
    return NextResponse.json(
      { success: false, error: 'Nie udało się automatycznie wycenić tego symbolu. Upewnij się, że wpisałeś go poprawnie.' },
      { status: 422 },
    );
  }
}
