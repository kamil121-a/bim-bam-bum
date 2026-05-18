/**
 * Shared market-price helpers used by:
 *   app/api/valuate/route.ts          (Option A – single ticker)
 *   app/api/assets/refresh/route.ts   (batch refresh)
 *
 * Pipeline:
 *   ticker
 *     → buildTavilyQuery  (Yahoo Finance site: query)
 *     → searchTavilyMarket
 *     → extractMarketPrice (OpenAI – returns { currency, price })
 *     → if USD: fetchNbpUsdPln → multiply
 *     → unitPricePLN
 */

import OpenAI from 'openai';

// ─── OpenAI singleton ─────────────────────────────────────────────────────────

let _openai: OpenAI | null = null;
export function getMarketOpenAI(): OpenAI {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

// ─── Yahoo Finance symbol maps ────────────────────────────────────────────────

const CRYPTO_YAHOO: Record<string, string> = {
  BTC:   'BTC-USD',  ETH:   'ETH-USD',  SOL:   'SOL-USD',
  XRP:   'XRP-USD',  ADA:   'ADA-USD',  DOGE:  'DOGE-USD',
  BNB:   'BNB-USD',  LTC:   'LTC-USD',  DOT:   'DOT-USD',
  AVAX:  'AVAX-USD', LINK:  'LINK-USD', ATOM:  'ATOM-USD',
  XLM:   'XLM-USD',  NEAR:  'NEAR-USD', UNI:   'UNI-USD',
  MATIC: 'MATIC-USD',SHIB:  'SHIB-USD', TON:   'TON-USD',
};

const METAL_YAHOO: Record<string, string> = {
  GOLD:     'GC=F',  XAU:      'GC=F',  ZLOTO: 'GC=F',  'ZŁOTO': 'GC=F',
  SILVER:   'SI=F',  XAG:      'SI=F',  SREBRO:'SI=F',
  PLATINUM: 'PL=F',  XPT:      'PL=F',
  PALLADIUM:'PA=F',  XPD:      'PA=F',
};

// ─── Tavily query builder → Yahoo Finance only ────────────────────────────────

export function buildTavilyQuery(raw: string): string {
  const t = raw.trim().toUpperCase();

  // Polish GPW: KRUK.PL → KRUK.WA on Yahoo Finance (PLN quotes)
  if (t.endsWith('.PL')) {
    const sym = t.slice(0, -3);
    return `site:finance.yahoo.com ${sym}.WA quote price 2026`;
  }

  // US stocks: NVDA.US → NVDA on Yahoo Finance (USD quotes)
  if (t.endsWith('.US')) {
    const sym = t.slice(0, -3);
    return `site:finance.yahoo.com ${sym} quote price 2026`;
  }

  // Crypto
  if (CRYPTO_YAHOO[t]) {
    return `site:finance.yahoo.com ${CRYPTO_YAHOO[t]} quote price 2026`;
  }

  // Precious metals (Yahoo futures)
  if (METAL_YAHOO[t]) {
    return `site:finance.yahoo.com ${METAL_YAHOO[t]} quote price 2026`;
  }

  // Fallback: bare ticker (e.g. "TSLA", "MSFT")
  return `site:finance.yahoo.com ${t} quote price 2026`;
}

// ─── isForeignTicker helper (still needed for callers) ───────────────────────

const CRYPTO_SET = new Set(Object.keys(CRYPTO_YAHOO));
const METAL_SET  = new Set(Object.keys(METAL_YAHOO));

export function isForeignTicker(raw: string): boolean {
  const t = raw.trim().toUpperCase();
  return t.endsWith('.US') || CRYPTO_SET.has(t) || METAL_SET.has(t);
}

// ─── NBP USD/PLN (official Polish central bank) ───────────────────────────────

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
  if (!apiKey) { console.warn('[tavily] TAVILY_API_KEY not set'); return null; }

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
    if (!res.ok) { console.warn('[tavily] HTTP', res.status); return null; }

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
 * Ask GPT-4o-mini to extract the price from Yahoo Finance search results.
 * AI returns { currency: "USD"|"PLN", price: number }.
 * TypeScript code then converts USD → PLN using the official NBP rate.
 */
export async function extractMarketPrice(
  ticker:  string,
  context: string,
): Promise<MarketPriceResult | null> {
  const systemPrompt =
    `Twoim jedynym zadaniem jest wyciągnięcie aktualnej ceny aktywa "${ticker}" ` +
    `z dostarczonych wyników wyszukiwania z portalu Yahoo Finance.\n` +
    `Zasady:\n` +
    `- Jeśli cena jest w USD (giełda USA, krypto, kruszce) → "currency": "USD"\n` +
    `- Jeśli cena jest w PLN (polskie spółki .WA na Yahoo Finance) → "currency": "PLN"\n` +
    `- Szukaj najświeższych danych (maj 2026). Ignoruj stare artykuły i prognozy.\n` +
    `\nZwróć WYŁĄCZNIE czysty JSON (bez markdown, bez \`\`\`json):\n` +
    `{ "currency": "USD", "price": <liczba>, "reasoning": "<krótkie źródło>" }\n` +
    `lub gdy brak danych:\n` +
    `{ "currency": "USD", "price": 0, "reasoning": "Brak danych" }`;

  try {
    const completion = await getMarketOpenAI().chat.completions.create({
      model:           'gpt-4o-mini',
      response_format: { type: 'json_object' },
      temperature:     0.1,
      max_tokens:      150,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: `Wyniki wyszukiwania Yahoo Finance:\n\n${context}` },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? '{}';
    console.log('Odpowiedź OpenAI JSON:', raw);

    const parsed = JSON.parse(raw) as { currency?: string; price?: number; reasoning?: string };
    const price  = Number(parsed.price ?? 0);
    if (price <= 0) return null;

    const currency  = parsed.currency === 'PLN' ? 'PLN' : 'USD';
    const reasoning = String(parsed.reasoning ?? '');

    // Convert USD → PLN using official NBP rate
    if (currency === 'USD') {
      const usdPln     = await fetchNbpUsdPln();
      const pricePln   = price * usdPln;
      console.log(`[NBP] ${price} USD × ${usdPln.toFixed(4)} = ${pricePln.toFixed(2)} PLN`);
      return { unitPricePLN: pricePln, reasoning };
    }

    // Already PLN (Polish stocks on Yahoo Finance)
    return { unitPricePLN: price, reasoning };

  } catch (err) {
    console.error('[extractMarketPrice] error:', err instanceof Error ? err.message : err);
    return null;
  }
}

// ─── High-level pipeline (used by refresh route) ──────────────────────────────

export async function getMarketUnitPrice(ticker: string): Promise<MarketPriceResult | null> {
  const query = buildTavilyQuery(ticker);
  console.log('Wysłane zapytanie do Tavily:', query);

  const context = await searchTavilyMarket(query);
  if (!context) return null;

  return extractMarketPrice(ticker, context);
}
