/**
 * Shared market-price helpers used by:
 *   app/api/valuate/route.ts   (Option A – single ticker)
 *   app/api/assets/refresh/route.ts  (batch refresh)
 *
 * Pipeline:  ticker → buildTavilyQuery → searchTavilyMarket
 *            → fetchNbpUsdPln (for .US / crypto / USD assets)
 *            → extractMarketPrice (OpenAI)
 *            → unitPricePLN
 */

import OpenAI from 'openai';

// ─── OpenAI singleton ─────────────────────────────────────────────────────────

let _openai: OpenAI | null = null;
export function getMarketOpenAI(): OpenAI {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

// ─── Tavily query optimizer ───────────────────────────────────────────────────

const CRYPTO_TICKERS = new Set([
  'BTC','ETH','SOL','XRP','ADA','DOGE','BNB','LTC','DOT',
  'AVAX','LINK','ATOM','XLM','NEAR','UNI','MATIC','SHIB','TON',
]);

export function isForeignTicker(raw: string): boolean {
  const t = raw.trim().toUpperCase();
  return t.endsWith('.US') || CRYPTO_TICKERS.has(t);
}

export function buildTavilyQuery(raw: string): string {
  const t = raw.trim().toUpperCase();

  if (t.endsWith('.PL')) {
    const name = t.slice(0, -3);
    return `${name} notowania giełdowe kurs aktualny bankier stooq 2026`;
  }
  if (t.endsWith('.US')) {
    const name = t.slice(0, -3);
    return `Google Finance ${name} stock price current USD 2026`;
  }
  if (CRYPTO_TICKERS.has(t)) {
    return `CoinGecko ${t} price pln dzisiaj kurs 2026`;
  }
  return `${raw} aktualna cena rynkowa PLN 2026`;
}

// ─── NBP USD/PLN (official Polish central bank rate) ─────────────────────────

export async function fetchNbpUsdPln(): Promise<number> {
  const res = await fetch(
    'https://api.nbp.pl/api/exchangerates/rates/a/usd/?format=json',
    { signal: AbortSignal.timeout(5_000) },
  );
  if (!res.ok) throw new Error(`NBP HTTP ${res.status}`);
  const data = await res.json() as { rates: { mid: number }[] };
  return data.rates[0].mid;
}

// ─── Tavily search ────────────────────────────────────────────────────────────

interface TavilyResult { title: string; content: string; url: string }

export async function searchTavilyMarket(query: string): Promise<string | null> {
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
      console.warn('[tavily] HTTP', res.status);
      return null;
    }
    const data    = await res.json() as { results?: TavilyResult[] };
    const results = data.results ?? [];
    if (!results.length) return null;

    console.log(`[tavily] ${results.length} wyników dla: "${query}"`);
    return results
      .slice(0, 5)
      .map((r, i) => `[${i + 1}] ${r.title}\n${r.content.slice(0, 400)}`)
      .join('\n\n');
  } catch (err) {
    console.warn('[tavily] error:', err instanceof Error ? err.message : err);
    return null;
  }
}

// ─── OpenAI price extraction ──────────────────────────────────────────────────

export interface MarketPriceResult {
  unitPricePLN: number;
  reasoning:    string;
}

/**
 * Ask GPT-4o-mini to extract the unit price in PLN from Tavily search context.
 * @param usdPln  When provided, the exact NBP rate is injected into the prompt
 *                so the model uses it verbatim (no guessing).
 */
export async function extractMarketPrice(
  ticker:  string,
  context: string,
  usdPln?: number,
): Promise<MarketPriceResult | null> {
  const rateHint = usdPln
    ? `\nAKTUALNY KURS USD/PLN z NBP: ${usdPln.toFixed(4)} – użyj DOKŁADNIE tej wartości do przeliczenia USD → PLN.`
    : '';

  const systemPrompt =
    `Jesteś precyzyjnym botem finansowym. Przeanalizuj dostarczone wyniki wyszukiwania ` +
    `z internetu dla aktywa: "${ticker}". ` +
    `Twoim absolutnym priorytetem jest znalezienie NAJŚWIEŻSZEGO kursu ` +
    `(najlepiej z dzisiejszą datą lub z ostatnich dni maja 2026 roku). ` +
    `Ignoruj artykuły i prognozy sprzed wielu miesięcy. ` +
    `Znajdź cyfrę oznaczającą aktualną cenę na portalach takich jak ` +
    `Bankier, Stooq, BiznesRadar, Google Finance lub CoinGecko.` +
    rateHint +
    `\n\nZwróć WYŁĄCZNIE czysty JSON (bez markdownu, bez \`\`\`json):\n` +
    `{ "success": true, "unitPricePLN": <liczba>, "reasoning": "<skrótowe potwierdzenie źródła>" }` +
    `\n\nJeśli nie możesz ustalić ceny, zwróć:\n` +
    `{ "success": false, "unitPricePLN": 0, "reasoning": "Brak aktualnych danych" }`;

  try {
    const completion = await getMarketOpenAI().chat.completions.create({
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

    const parsed = JSON.parse(raw) as { success?: boolean; unitPricePLN?: number; reasoning?: string };
    if (!parsed.success || !parsed.unitPricePLN || parsed.unitPricePLN <= 0) return null;

    return {
      unitPricePLN: Number(parsed.unitPricePLN),
      reasoning:    String(parsed.reasoning ?? ''),
    };
  } catch (err) {
    console.error('[extractMarketPrice] OpenAI error:', err instanceof Error ? err.message : err);
    return null;
  }
}

// ─── High-level: get unit price for any ticker ────────────────────────────────

/**
 * Full pipeline: ticker → Tavily → (NBP if USD) → OpenAI → unitPricePLN
 * Returns null if any step fails.
 */
export async function getMarketUnitPrice(ticker: string): Promise<MarketPriceResult | null> {
  const query   = buildTavilyQuery(ticker);
  console.log('Wysłane zapytanie do Tavily:', query);

  const context = await searchTavilyMarket(query);
  if (!context) return null;

  // Pre-fetch the official NBP rate for foreign (USD) assets
  let usdPln: number | undefined;
  if (isForeignTicker(ticker)) {
    try {
      usdPln = await fetchNbpUsdPln();
      console.log(`[NBP] Kurs USD/PLN: ${usdPln}`);
    } catch {
      console.warn('[NBP] Nie udało się pobrać kursu – AI użyje własnego szacunku');
    }
  }

  return extractMarketPrice(ticker, context, usdPln);
}
