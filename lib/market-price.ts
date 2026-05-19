/**
 * Shared market-price helpers used by:
 *   app/api/valuate/route.ts          (Option A – single ticker)
 *   app/api/assets/refresh/route.ts   (batch refresh)
 *
 * Pipeline:
 *   ticker (GPW .PL / .WA)
 *     → Yahoo Chart API (notowania .WA, mapy symboli np. KRUK.PL → KRU.WA)
 *     → w razie braku: Tavily → extractMarketPrice (OpenAI) → NBP
 */

import OpenAI from 'openai';

export interface MarketPriceResult {
  unitPricePLN: number;
  reasoning:    string;
  /** Źródło wyceny — Yahoo Chart jest pewniejszy dla GPW niż Tavily+GPT. */
  source?: 'yahoo_chart' | 'tavily_ai';
}

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

/**
 * Yahoo używa czasem innego kodu niż „litera z GPW + .WA” (np. KRUK → KRU.WA).
 * Samo KRUK.WA w Yahoo to często „pusty” wpis bez notowań.
 */
const GPW_YAHOO_SYMBOL: Record<string, string> = {
  'KRUK.PL': 'KRU.WA',
  'KRUK.WA': 'KRU.WA',
};

/** Symbol Yahoo dla akcji z GPW (.PL / .WA lub mapa powyżej). */
export function resolvePolishYahooSymbol(raw: string): string | null {
  const t = raw.trim().toUpperCase();
  const mapped = GPW_YAHOO_SYMBOL[t];
  if (mapped) return mapped;
  if (t.endsWith('.PL')) {
    const base = t.slice(0, -3);
    if (!/^[A-Z0-9-]+$/.test(base)) return null;
    return `${base}.WA`;
  }
  if (t.endsWith('.WA')) return t;
  return null;
}

// ─── Tavily query builder → Yahoo Finance only ────────────────────────────────

export function buildTavilyQuery(raw: string): string {
  const t = raw.trim().toUpperCase();

  // GPW: zapytanie pod faktyczny symbol Yahoo (np. KRU.WA zamiast mylnego KRUK.WA)
  if (t.endsWith('.PL')) {
    const yahooSym = resolvePolishYahooSymbol(t) ?? `${t.slice(0, -3)}.WA`;
    return `Yahoo Finance ${yahooSym} Warsaw GPW stock price PLN current 2026`;
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

/**
 * Fetches the mid-rate for any currency supported by NBP table A.
 * Pass an ISO-4217 code (case-insensitive), e.g. 'usd', 'EUR', 'GBP'.
 * Returns 1 for PLN (no conversion needed).
 */
export async function fetchNbpRateAny(currency: string): Promise<number> {
  const code = currency.trim().toLowerCase();
  if (code === 'pln') return 1;

  const res = await fetch(
    `https://api.nbp.pl/api/exchangerates/rates/a/${code}/?format=json`,
    { signal: AbortSignal.timeout(5_000) },
  );
  if (!res.ok) {
    throw new Error(`NBP: brak kursu dla ${currency.toUpperCase()} (HTTP ${res.status})`);
  }
  const data = await res.json() as { rates: { mid: number }[] };
  return data.rates[0].mid;
}

export async function fetchNbpUsdPln(): Promise<number> { return fetchNbpRateAny('usd'); }
export async function fetchNbpGbpPln(): Promise<number> { return fetchNbpRateAny('gbp'); }
export async function fetchNbpEurPln(): Promise<number> { return fetchNbpRateAny('eur'); }

const YAHOO_CHART_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

interface YahooChartMeta {
  currency?:           string | null;
  regularMarketPrice?: number;
  chartPreviousClose?: number;
  previousClose?:      number;
  instrumentType?:     string;
  exchangeName?:       string;
}

function parseYahooChartBody(data: unknown): { price: number; currency: string } | null {
  const chart = data as { chart?: { result?: unknown[]; error?: unknown } };
  const result = chart.chart?.result?.[0] as
    | {
        meta?: YahooChartMeta;
        indicators?: { quote?: Array<{ close?: (number | null)[] }> };
      }
    | undefined;
  if (!result?.meta || chart.chart?.error) return null;

  const meta = result.meta;
  let price = meta.regularMarketPrice;
  if (typeof price !== 'number' || !isFinite(price) || price <= 0) {
    price = meta.chartPreviousClose;
  }
  if (typeof price !== 'number' || !isFinite(price) || price <= 0) {
    price = meta.previousClose;
  }
  if (typeof price !== 'number' || !isFinite(price) || price <= 0) {
    const closes = result.indicators?.quote?.[0]?.close?.filter(
      (x): x is number => typeof x === 'number' && isFinite(x) && x > 0,
    );
    if (closes?.length) price = closes[closes.length - 1]!;
  }

  if (typeof price !== 'number' || !isFinite(price) || price <= 0) return null;

  let currency = (meta.currency ?? 'PLN').toUpperCase();
  if (currency === 'NULL' || currency === '') currency = 'PLN';

  return { price, currency };
}

/**
 * Ostatnia znana cena z Yahoo Finance Chart API — działa dla większości GPW (.WA),
 * o ile symbol jest poprawny (patrz {@link resolvePolishYahooSymbol}).
 */
export async function fetchYahooChartPrice(yahooSymbol: string): Promise<MarketPriceResult | null> {
  const sym = yahooSymbol.trim().toUpperCase();
  if (!sym) return null;

  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}` +
    '?interval=1d&range=5d';

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': YAHOO_CHART_UA },
      signal:  AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      console.warn('[yahoo-chart]', sym, 'HTTP', res.status);
      return null;
    }

    const parsed = parseYahooChartBody(await res.json());
    if (!parsed) {
      console.warn('[yahoo-chart]', sym, 'brak ceny w odpowiedzi');
      return null;
    }

    const { price, currency } = parsed;

    if (currency === 'PLN') {
      return {
        unitPricePLN: price,
        reasoning:    `${sym} @ ${price} PLN (Yahoo Finance)`,
        source:       'yahoo_chart',
      };
    }

    let rate: number;
    if (currency === 'GBP') rate = await fetchNbpGbpPln();
    else if (currency === 'EUR') rate = await fetchNbpEurPln();
    else rate = await fetchNbpUsdPln();

    const pricePln = price * rate;
    return {
      unitPricePLN: pricePln,
      reasoning:
        `${sym} @ ${price} ${currency} × ${rate.toFixed(4)} NBP = ${pricePln.toFixed(2)} PLN (Yahoo Finance)`,
      source: 'yahoo_chart',
    };
  } catch (err) {
    console.warn('[yahoo-chart]', sym, err instanceof Error ? err.message : err);
    return null;
  }
}

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
    `3. Kontekst walutowy – ZAWSZE patrz na FAKTYCZNY SYMBOL WALUTY w tekście wyników:\n` +
    `   - '$' lub 'USD' obok ceny → "currency": "USD"\n` +
    `   - 'zł' lub 'PLN' obok ceny → "currency": "PLN"\n` +
    `   - '£' lub 'GBP' obok ceny → "currency": "GBP"\n` +
    `     WAŻNE: jeśli cena LSE jest w pensach (GBX, np. 8023p), podziel przez 100 aby otrzymać GBP.\n` +
    `   - '€' lub 'EUR' obok ceny → "currency": "EUR"\n` +
    `   KLUCZOWE: Akcje/ETF notowane na LSE (.UK / .L) MOGĄ być w USD lub GBP – nie zakładaj.\n` +
    `   Np. ETF towarowe (złoto, ropa) i ETF globalne na LSE są często denominowane w USD.\n` +
    `   Jeśli widzisz '$' lub 'USD' obok ceny dla spółki UK → "currency": "USD", nie GBP!\n` +
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
      return {
        unitPricePLN: price,
        reasoning:    `${ticker} @ ${price} PLN`,
        source:       'tavily_ai',
      };
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
      source:       'tavily_ai',
    };

  } catch (err) {
    console.error('[extractMarketPrice] error:', err instanceof Error ? err.message : err);
    return null;
  }
}

// ─── High-level pipeline (used by refresh route) ──────────────────────────────

export async function getMarketUnitPrice(ticker: string): Promise<MarketPriceResult | null> {
  const t = ticker.trim().toUpperCase();
  const yahooSym = resolvePolishYahooSymbol(t);
  if (yahooSym) {
    const direct = await fetchYahooChartPrice(yahooSym);
    if (direct) return direct;
    console.warn('[getMarketUnitPrice]', yahooSym, '— Yahoo chart bez ceny, fallback Tavily');
  }

  const query = buildTavilyQuery(ticker);
  console.log('Wysłane zapytanie do Tavily:', query);

  const context = await searchTavilyMarket(query);
  if (!context) return null;

  return extractMarketPrice(t.trim(), context);
}
