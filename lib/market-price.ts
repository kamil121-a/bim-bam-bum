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

// For metals we use natural-language Tavily queries (not futures symbols like GC=F
// which search engines don't resolve well). The label is what goes into the query.
const METAL_QUERY: Record<string, string> = {
  GOLD:      'gold XAU price per ounce USD today',
  XAU:       'gold XAU price per ounce USD today',
  ZLOTO:     'gold XAU cena za uncję USD dziś',
  'ZŁOTO':   'gold XAU cena za uncję USD dziś',
  SILVER:    'silver XAG price per ounce USD today',
  XAG:       'silver XAG price per ounce USD today',
  SREBRO:    'silver XAG cena za uncję USD dziś',
  PLATINUM:  'platinum XPT price per ounce USD today',
  XPT:       'platinum XPT price per ounce USD today',
  PALLADIUM: 'palladium XPD price per ounce USD today',
  XPD:       'palladium XPD price per ounce USD today',
};

// ─── Tavily query builder → Yahoo Finance only ────────────────────────────────

export function buildTavilyQuery(raw: string): string {
  const t = raw.trim().toUpperCase();

  // Polish GPW: KRUK.PL → KRUK.WA, suggest Yahoo Finance but don't lock to it
  if (t.endsWith('.PL')) {
    const sym = t.slice(0, -3);
    return `Yahoo Finance ${sym}.WA aktualny kurs cena akcji 2026`;
  }

  // US stocks: NVDA.US → NVDA
  // For single-letter tickers (e.g. "O" = Realty Income), add "stock" hint
  if (t.endsWith('.US')) {
    const sym = t.slice(0, -3);
    const extra = sym.length <= 2 ? ' NYSE stock' : '';
    return `Yahoo Finance ${sym}${extra} stock price current USD 2026`;
  }

  // UK / London Stock Exchange: IWDA.UK → IWDA.L (Yahoo Finance LSE format)
  // These are often ETFs or international stocks priced in GBP or USD
  if (t.endsWith('.UK')) {
    const sym = t.slice(0, -3);
    return `Yahoo Finance ${sym}.L ${sym} ETF stock price GBP USD current 2026`;
  }

  // European stocks with .DE / .FR / .IT / .ES / .NL etc.
  if (/\.[A-Z]{2}$/.test(t) && !t.endsWith('.PL') && !t.endsWith('.US') && !t.endsWith('.UK')) {
    // Generic European exchange
    return `Yahoo Finance ${t} stock price EUR current 2026`;
  }

  // Crypto – natural language + Yahoo Finance ticker for better search hits
  if (CRYPTO_YAHOO[t]) {
    return `${CRYPTO_YAHOO[t]} Yahoo Finance current price USD 2026`;
  }

  // Precious metals – natural language (GC=F / SI=F not searchable by Tavily)
  if (METAL_QUERY[t]) {
    return `${METAL_QUERY[t]} Yahoo Finance investing.com 2026`;
  }

  // Fallback: any user input (e.g. bare "TSLA", Polish company name)
  return `Yahoo Finance ${raw} aktualna cena kurs giełda 2026`;
}

// ─── isForeignTicker helper (still needed for callers) ───────────────────────

const CRYPTO_SET = new Set(Object.keys(CRYPTO_YAHOO));
const METAL_SET  = new Set(Object.keys(METAL_QUERY));

export function isForeignTicker(raw: string): boolean {
  const t = raw.trim().toUpperCase();
  return t.endsWith('.US') || CRYPTO_SET.has(t) || METAL_SET.has(t);
}

// ─── NBP exchange rates (official Polish central bank) ───────────────────────

async function fetchNbpRate(currency: 'usd' | 'gbp' | 'eur'): Promise<number> {
  const res = await fetch(
    `https://api.nbp.pl/api/exchangerates/rates/a/${currency}/?format=json`,
    { signal: AbortSignal.timeout(5_000) },
  );
  if (!res.ok) throw new Error(`NBP HTTP ${res.status} for ${currency.toUpperCase()}`);
  const data = await res.json() as { rates: { mid: number }[] };
  return data.rates[0].mid;
}

export async function fetchNbpUsdPln(): Promise<number> { return fetchNbpRate('usd'); }
export async function fetchNbpGbpPln(): Promise<number> { return fetchNbpRate('gbp'); }
export async function fetchNbpEurPln(): Promise<number> { return fetchNbpRate('eur'); }

// ─── Tavily search ────────────────────────────────────────────────────────────

interface TavilyResult { title: string; content: string; url: string }

export async function searchTavilyMarket(query: string): Promise<string | null> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) { console.warn('[tavily] TAVILY_API_KEY not set'); return null; }

  try {
    const res = await fetch('https://api.tavily.com/search', {
      method:  'POST',
      signal:  AbortSignal.timeout(5_000),  // 5 s: leaves ~4 s for OpenAI + NBP within Vercel's 10 s limit
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
    `Jesteś bezwzględnie precyzyjnym parserem danych finansowych. ` +
    `Twoim jedynym zadaniem jest wyciągnięcie AKTUALNEJ CENY RYNKOWEJ ZA JEDNĄ SZTUKĘ ` +
    `(Last Price / Current Price) dla aktywa: "${ticker}" ` +
    `z dostarczonych wyników wyszukiwania dla maja 2026 roku.\n\n` +
    `ŻELAZNE ZASADY selekcji danych:\n` +
    `1. Szukaj wyłącznie aktualnego kursu (np. "912.40", "452.10", "80.25").\n` +
    `2. BEZWZGLĘDNIE IGNORUJ: kapitalizację rynkową (miliardy/tryliony), wolumen obrotu (Volume), ` +
    `zmianę procentową (np. +1.5%), ceny docelowe analityków (Target Price) ` +
    `oraz ceny historyczne sprzed miesięcy.\n` +
    `3. Kontekst walutowy:\n` +
    `   - Akcje USA (.US), krypto (BTC), kruszce (złoto/srebro) – cena przy '$' lub 'USD' → "currency": "USD"\n` +
    `   - Polska spółka (.WA / .PL) – cena przy 'zł' lub 'PLN' → "currency": "PLN"\n` +
    `   - Spółki UK, LSE (.UK / .L) – cena przy '£' lub 'GBP' → "currency": "GBP"\n` +
    `     WAŻNE: jeśli cena UK jest w pensach (GBX, np. 8023p), podziel przez 100 aby otrzymać GBP.\n` +
    `   - Spółki europejskie (.DE / .FR / .AS / .EU) – cena przy '€' lub 'EUR' → "currency": "EUR"\n` +
    `4. Jeśli nie ma jasnej, niepodważalnej aktualnej ceny giełdowej – ` +
    `NIE ZGADUJ, nie halucynuj. Zwróć "success": false.\n\n` +
    `Zwróć WYŁĄCZNIE surowy JSON (zero markdown, zero \`\`\`json):\n` +
    `{ "success": true, "currency": "USD"|"PLN"|"GBP"|"EUR", "price": <liczba> }\n` +
    `lub gdy brak danych:\n` +
    `{ "success": false, "currency": "USD", "price": 0 }`;

  try {
    const completion = await getMarketOpenAI().chat.completions.create({
      model:           'gpt-4o-mini',
      response_format: { type: 'json_object' },
      temperature:     0.0,   // zero – deterministic extraction, no creativity
      max_tokens:      120,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: `Wyniki wyszukiwania:\n\n${context}` },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? '{}';
    console.log('Odpowiedź OpenAI JSON:', raw);

    const parsed   = JSON.parse(raw) as { success?: boolean; currency?: string; price?: unknown };
    const success  = parsed.success === true;
    const price    = Number(parsed.price);   // explicit cast – guards against string prices
    const currency = (['PLN', 'USD', 'GBP', 'EUR'] as const).includes(parsed.currency as never)
      ? (parsed.currency as 'PLN' | 'USD' | 'GBP' | 'EUR')
      : 'USD';

    // Honour success flag – if AI found no clean price, refuse to guess
    if (!success || !isFinite(price) || price <= 0) {
      console.warn(`[extractMarketPrice] AI returned success=false or invalid price for "${ticker}"`);
      return null;
    }

    // PLN – no conversion needed
    if (currency === 'PLN') {
      return { unitPricePLN: price, reasoning: `${ticker} @ ${price} PLN` };
    }

    // All other currencies → convert to PLN via official NBP rates
    let rate: number;
    if (currency === 'GBP') {
      rate = await fetchNbpGbpPln();
    } else if (currency === 'EUR') {
      rate = await fetchNbpEurPln();
    } else {
      rate = await fetchNbpUsdPln();
    }

    const pricePln = price * rate;
    console.log(`[NBP] ${price} ${currency} × ${rate.toFixed(4)} = ${pricePln.toFixed(2)} PLN`);
    return {
      unitPricePLN: pricePln,
      reasoning:    `${ticker} @ ${price} ${currency} × ${rate.toFixed(4)} NBP = ${pricePln.toFixed(2)} PLN`,
    };

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
