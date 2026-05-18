/**
 * Two-step valuation – no external libraries, only native fetch.
 *
 * STEP 1  AI Classification (gpt-4o-mini, temp=0, ~80 tokens)
 *   AI classifies the user's input and returns: { type, asset_id, category }
 *   AI is FORBIDDEN from providing any prices.
 *
 * STEP 2  TypeScript math with free, stable APIs
 *   "financial" → route by asset_id:
 *     gold          → NBP cenyzłota  (PLN/gram, authoritative PL source)
 *     silver/etc.   → metals.live    (USD/troy oz) + NBP USD/PLN
 *     bitcoin/etc.  → CoinGecko      (PLN direct, free, no key)
 *     stock/ETF     → Twelve Data    (USD) + NBP USD/PLN [needs TWELVE_DATA_API_KEY]
 *     PLN cash      → 1:1 PLN
 *   "physical" → requiresManualPrice = true (user enters their own price)
 *
 * Every API call logs the raw price to console so the server terminal shows
 * exactly what was fetched before the value is saved to the database.
 */

import OpenAI from 'openai';
import type { AssetCategory } from '@/types';

// ─── Exported result type ─────────────────────────────────────────────────────

export interface ValuationResult {
  estimatedValue:      number;
  unitPrice:           number;
  currency:            'PLN';
  confidence:          'high' | 'medium' | 'low';
  source:              string;
  suggestedCategory:   AssetCategory;
  aiCategory:          string;
  reasoning:           string;
  requiresManualPrice?: boolean;
}

// ─── DB category mapping ──────────────────────────────────────────────────────

const AI_TO_DB: Record<string, AssetCategory> = {
  Giełda:        'Finanse',
  Krypto:        'Finanse',
  Metale:        'Finanse',
  Waluty:        'Finanse',
  Elektronika:   'Elektronika',
  Nieruchomości: 'Nieruchomości',
  Inne:          'Inne',
};

function toDbCategory(raw: string): AssetCategory {
  return AI_TO_DB[(raw ?? '').trim()] ?? 'Inne';
}

// ─── Fallback for physical / unresolvable assets ──────────────────────────────

function physicalResult(category: string, reason?: string): ValuationResult {
  return {
    estimatedValue:      0,
    unitPrice:           0,
    currency:            'PLN',
    confidence:          'low',
    source:              'Manualna wycena',
    suggestedCategory:   toDbCategory(category),
    aiCategory:          category || 'Inne',
    reasoning:           reason ?? 'Wpisz szacowaną wartość rynkową (np. z Allegro / OLX).',
    requiresManualPrice: true,
  };
}

// ─── OpenAI singleton ─────────────────────────────────────────────────────────

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

// ─── Known CoinGecko crypto IDs ───────────────────────────────────────────────

const COINGECKO_IDS = new Set([
  'bitcoin', 'ethereum', 'tether', 'binancecoin', 'solana', 'ripple',
  'cardano', 'dogecoin', 'avalanche-2', 'polkadot', 'chainlink', 'litecoin',
  'cosmos', 'uniswap', 'stellar', 'monero', 'filecoin', 'aave', 'maker',
  'the-graph', 'compound', 'ethereum-classic', 'tron', 'near', 'algorand',
  'vechain', 'internet-computer', 'fantom', 'shiba-inu', 'pepe', 'toncoin',
  'aptos', 'arbitrum', 'optimism', 'bonk', 'polygon', 'injective',
]);

// ─── Known metals (asset_id → metals.live slug) ───────────────────────────────

const METAL_SLUGS: Record<string, string> = {
  silver:    'silver',
  srebro:    'silver',
  platinum:  'platinum',
  platyna:   'platinum',
  palladium: 'palladium',
  pallad:    'palladium',
  copper:    'copper',
  miedz:     'copper',
  miedź:     'copper',
};

// ─── API 1: NBP USD/PLN (30-min cache) ───────────────────────────────────────

let _nbpCache: { rate: number; ts: number } | null = null;

async function getUsdPln(signal: AbortSignal): Promise<number> {
  if (_nbpCache && Date.now() - _nbpCache.ts < 30 * 60 * 1000) {
    console.log('[NBP] USD/PLN from cache:', _nbpCache.rate);
    return _nbpCache.rate;
  }
  const res = await fetch(
    'https://api.nbp.pl/api/exchangerates/rates/a/usd/?format=json',
    { signal, headers: { Accept: 'application/json' } },
  );
  if (!res.ok) throw new Error(`NBP HTTP ${res.status}`);
  const data = await res.json() as { rates: Array<{ mid: number }> };
  const rate = data.rates[0].mid;
  _nbpCache = { rate, ts: Date.now() };
  console.log('[NBP] Pobrana cena: kurs USD/PLN =', rate);
  return rate;
}

// ─── API 2: NBP złoto (PLN per gram) ─────────────────────────────────────────

async function fetchGoldPlnPerGram(signal: AbortSignal): Promise<number | null> {
  try {
    const res = await fetch(
      'https://api.nbp.pl/api/cenyzlota/?format=json',
      { signal, headers: { Accept: 'application/json' } },
    );
    if (!res.ok) throw new Error(`NBP cenyzlota HTTP ${res.status}`);
    const data = await res.json() as Array<{ data: string; cena: number }>;
    const price = data[0]?.cena;
    if (typeof price !== 'number' || price <= 0) return null;
    console.log('[NBP] Pobrana cena: złoto =', price, 'PLN/gram');
    return price;
  } catch (err) {
    console.warn('[valuate] NBP cenyzlota error:', err);
    return null;
  }
}

// ─── API 3: metals.live (USD per troy ounce) ─────────────────────────────────

async function fetchMetalUsd(slug: string, signal: AbortSignal): Promise<number | null> {
  try {
    const res = await fetch(
      `https://api.metals.live/v1/spot/${slug}`,
      { signal, headers: { Accept: 'application/json' } },
    );
    if (!res.ok) throw new Error(`metals.live HTTP ${res.status}`);
    const raw = await res.json();

    // Handle multiple possible response shapes defensively
    let price: unknown;
    if (typeof raw === 'number') {
      price = raw;
    } else if (Array.isArray(raw) && raw.length > 0) {
      price = raw[0][slug] ?? raw[0].price ?? raw[0].rate;
    } else if (raw && typeof raw === 'object') {
      price = (raw as Record<string, unknown>)[slug]
        ?? (raw as Record<string, unknown>).price
        ?? (raw as Record<string, unknown>).rate;
    }

    const p = typeof price === 'number' && price > 0 ? price : null;
    if (p) console.log(`[metals.live] Pobrana cena: ${slug} =`, p, 'USD/oz');
    return p;
  } catch (err) {
    console.warn(`[valuate] metals.live error for ${slug}:`, err);
    return null;
  }
}

// ─── API 4: CoinGecko (PLN per coin, free, no key required) ──────────────────

async function fetchCryptoPln(coingeckoId: string, signal: AbortSignal): Promise<number | null> {
  try {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(coingeckoId)}&vs_currencies=pln&precision=2`;
    const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
    const data = await res.json() as Record<string, { pln?: number }>;
    const price = data[coingeckoId]?.pln;
    if (typeof price !== 'number' || price <= 0) return null;
    console.log(`[CoinGecko] Pobrana cena: ${coingeckoId} =`, price, 'PLN');
    return price;
  } catch (err) {
    console.warn(`[valuate] CoinGecko error for ${coingeckoId}:`, err);
    return null;
  }
}

// ─── API 5a: Stooq.pl (PLN per share, Polish GPW – always free, no key) ───────
//
// URL format: https://stooq.pl/q/l/?s={symbol}&f=sd2t2ohlcv&e=csv
// Response (CSV with header):
//   Symbol,Date,Time,Open,High,Low,Close,Volume
//   PKN,2026-05-18,17:05:00,58.00,58.80,57.90,58.40,1562300
// Close is at column index 6.
// Invalid tickers return "N/D" in all price fields.

async function fetchStooqPln(stooqSymbol: string, signal: AbortSignal): Promise<number | null> {
  // stooqSymbol is already lowercase (e.g. "pkn", "pko", "ale")
  const url = `https://stooq.pl/q/l/?s=${encodeURIComponent(stooqSymbol)}&f=sd2t2ohlcv&e=csv`;

  try {
    const res = await fetch(url, {
      signal,
      headers: {
        // Mimic a browser to avoid bot-detection
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Accept':     'text/csv,text/plain,*/*',
      },
    });

    if (!res.ok) {
      console.warn(`[stooq] HTTP ${res.status} dla "${stooqSymbol}"`);
      return null;
    }

    const text = await res.text();
    console.log(`[stooq] "${stooqSymbol}" surowa odpowiedź:`, text.split('\n').slice(0, 2).join(' | '));

    const lines = text.trim().split('\n');
    if (lines.length < 2) {
      console.warn(`[stooq] Brak linii danych dla "${stooqSymbol}"`);
      return null;
    }

    // Line 0 = header, Line 1 = data
    const cols = lines[1].split(',');
    // Col indices: 0=Symbol 1=Date 2=Time 3=Open 4=High 5=Low 6=Close 7=Volume
    const closeStr = cols[6]?.trim() ?? '';

    if (!closeStr || closeStr === 'N/D' || closeStr === '-') {
      console.warn(`[stooq] Ticker "${stooqSymbol}" nie znaleziony (N/D)`);
      return null;
    }

    const price = parseFloat(closeStr);
    if (!isFinite(price) || price <= 0) {
      console.warn(`[stooq] Nieprawidłowa cena dla "${stooqSymbol}": "${closeStr}"`);
      return null;
    }

    console.log(`[stooq] Pobrana cena: ${stooqSymbol.toUpperCase()} = ${price} PLN`);
    return price;

  } catch (err) {
    if (err instanceof Error && err.name !== 'AbortError') {
      console.warn(`[stooq] Błąd dla "${stooqSymbol}":`, err.message);
    }
    return null;
  }
}

// ─── API 5b: Twelve Data (USD per share – US & global stocks) ─────────────────

async function fetchStockUsd(symbol: string, signal: AbortSignal): Promise<number | null> {
  const apiKey = process.env.TWELVE_DATA_API_KEY;
  if (!apiKey) {
    console.warn('[valuate] TWELVE_DATA_API_KEY not set – manual price required for stocks');
    return null;
  }

  try {
    const url = `https://api.twelvedata.com/price?symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`;
    const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Twelve Data HTTP ${res.status}`);

    const data = await res.json() as { price?: string; code?: number; message?: string; status?: string };

    if (data.code || data.status === 'error' || !data.price) {
      console.warn('[valuate] Twelve Data error:', data.message ?? 'no price field');
      return null;
    }

    const price = parseFloat(data.price);
    if (isNaN(price) || price <= 0) return null;

    console.log(`[TwelveData] Pobrana cena: ${symbol} =`, price, 'USD');
    return price;
  } catch (err) {
    console.warn(`[valuate] Twelve Data error for ${symbol}:`, err);
    return null;
  }
}

// ─── Step 1: AI Classification ────────────────────────────────────────────────

interface Classification {
  type:     'financial' | 'physical';
  asset_id: string | null;
  category: string;
}

/**
 * AI's ONLY job: classify the user's input.
 * Return { type, asset_id, category }.
 * NO prices. NO estimates. ONLY identification.
 */
const CLASSIFY_PROMPT = `Jesteś klasyfikatorem aktywów. Twoje JEDYNE zadanie to przeanalizować wpis użytkownika i zwrócić JSON identyfikujący aktywo. ABSOLUTNIE NIE wolno Ci podawać żadnych cen ani kwot.

Zwróć WYŁĄCZNIE czysty JSON (zero tekstu poza JSON):
{
  "type": "financial" | "physical",
  "asset_id": string | null,
  "category": "Giełda" | "Krypto" | "Metale" | "Waluty" | "Elektronika" | "Nieruchomości" | "Inne"
}

ZASADY IDENTYFIKATORÓW (asset_id):
• Złoto          → "gold"
• Srebro         → "silver"
• Platyna        → "platinum"
• Pallad         → "palladium"
• Miedź          → "copper"
• Bitcoin        → "bitcoin"       (CoinGecko ID)
• Ethereum       → "ethereum"
• Solana         → "solana"
• Ripple / XRP   → "ripple"
• Cardano / ADA  → "cardano"
• Dogecoin       → "dogecoin"
• BNB            → "binancecoin"
• Litecoin       → "litecoin"
• Polkadot       → "polkadot"
• Avalanche      → "avalanche-2"
• Chainlink      → "chainlink"
• Toncoin        → "toncoin"
• Shiba Inu      → "shiba-inu"
• S&P 500 / SPY  → "SPY"          (ticker Twelve Data)
• NASDAQ / QQQ   → "QQQ"
• Apple          → "AAPL"
• Microsoft      → "MSFT"
• Google         → "GOOGL"
• Amazon         → "AMZN"
• Tesla          → "TSLA"
• NVIDIA         → "NVDA"
• Meta           → "META"
• Gotówka PLN    → "pln"
• Fizyczne przedmioty (elektronika, samochód, meble, zegarek itp.) → type: "physical", asset_id: null

══════════════════════════════════════════════════════
ZASADA SUFIKSU .WA – CZYTAJ UWAŻNIE:

Sufiks .WA dodawaj WYŁĄCZNIE do spółek, które:
  - zostały ZAŁOŻONE W POLSCE i
  - są notowane na GPW Warszawa jako GŁÓWNEJ giełdzie.

Dla spółek ZAGRANICZNYCH (USA, Europa, Azja) używaj standardowego
tickera tej giełdy – BEZ jakichkolwiek końcówek .WA.
Jeśli nie znasz tickera zagranicznej spółki, użyj jej oficjalnego
symbolu z NYSE / NASDAQ (bez .WA).

Znane polskie spółki GPW (z .WA):
• Orlen / PKN Orlen  → "PKN.WA"
• PKO BP             → "PKO.WA"
• CD Projekt         → "CDR.WA"
• Allegro            → "ALE.WA"
• KGHM               → "KGH.WA"
• PZU                → "PZU.WA"
• Dino               → "DNO.WA"
• LPP                → "LPP.WA"
• mBank              → "MBK.WA"
• Cyfrowy Polsat     → "CPS.WA"
• JSW                → "JSW.WA"
• CCC                → "CCC.WA"
• Pekao              → "PEO.WA"
• Bank Millennium    → "MIL.WA"
• Budimex            → "BDX.WA"
• Kruk               → "KRU.WA"
• Żabka              → "ZAB.WA"

Znane zagraniczne spółki (BEZ .WA):
• McDonald's         → "MCD"      (USA, NYSE)
• Coca-Cola          → "KO"       (USA, NYSE)
• Nike               → "NKE"      (USA, NYSE)
• Walmart            → "WMT"      (USA, NYSE)
• Johnson & Johnson  → "JNJ"      (USA, NYSE)
• Berkshire          → "BRK.B"    (USA, NYSE)
• LVMH               → "MC"       (Francja, Euronext)
• SAP                → "SAP"      (Niemcy, NYSE ADR)
══════════════════════════════════════════════════════

PRZYKŁADY:
"10g złota"           → {"type":"financial","asset_id":"gold","category":"Metale"}
"srebro 5 uncji"      → {"type":"financial","asset_id":"silver","category":"Metale"}
"bitcoin"             → {"type":"financial","asset_id":"bitcoin","category":"Krypto"}
"S&P 500 ETF"         → {"type":"financial","asset_id":"SPY","category":"Giełda"}
"Apple 3 akcje"       → {"type":"financial","asset_id":"AAPL","category":"Giełda"}
"McDonald's"          → {"type":"financial","asset_id":"MCD","category":"Giełda"}
"Coca-Cola"           → {"type":"financial","asset_id":"KO","category":"Giełda"}
"Orlen"               → {"type":"financial","asset_id":"PKN.WA","category":"Giełda"}
"PKO BP 20 akcji"     → {"type":"financial","asset_id":"PKO.WA","category":"Giełda"}
"Allegro"             → {"type":"financial","asset_id":"ALE.WA","category":"Giełda"}
"mBank akcje"         → {"type":"financial","asset_id":"MBK.WA","category":"Giełda"}
"1000 PLN gotówka"    → {"type":"financial","asset_id":"pln","category":"Waluty"}
"MacBook Pro M4"      → {"type":"physical","asset_id":null,"category":"Elektronika"}
"mieszkanie 50m²"     → {"type":"physical","asset_id":null,"category":"Nieruchomości"}
"Zegarek Rolex"       → {"type":"physical","asset_id":null,"category":"Inne"}`;

async function classifyAsset(name: string, signal: AbortSignal): Promise<Classification> {
  const completion = await getOpenAI().chat.completions.create(
    {
      model:           'gpt-4o-mini',
      response_format: { type: 'json_object' },
      temperature:     0,
      max_tokens:      80,
      messages: [
        { role: 'system', content: CLASSIFY_PROMPT },
        { role: 'user',   content: name },
      ],
    },
    { signal },
  );

  const raw    = completion.choices[0]?.message?.content ?? '{}';
  const parsed = JSON.parse(raw) as Partial<Classification>;

  return {
    type:     parsed.type === 'financial' ? 'financial' : 'physical',
    asset_id: typeof parsed.asset_id === 'string' && parsed.asset_id.length > 0
                ? parsed.asset_id.trim()
                : null,
    category: typeof parsed.category === 'string' ? parsed.category.trim() : 'Inne',
  };
}

// ─── Step 2: Route to the right API and calculate ─────────────────────────────

async function valuateFinancial(
  assetId:  string,
  category: string,
  qty:      number,
  signal:   AbortSignal,
): Promise<ValuationResult | null> {
  const id     = assetId.toLowerCase();
  const isWA   = assetId.toUpperCase().endsWith('.WA');

  // ── PLN cash ─────────────────────────────────────────────────────────────────
  if (id === 'pln') {
    const total = Math.round(qty);
    console.log('[valuate] Pobrana cena: gotówka PLN = 1 PLN (1:1)');
    return {
      estimatedValue:    total,
      unitPrice:         1,
      currency:          'PLN',
      confidence:        'high',
      source:            'Gotówka PLN (kurs 1:1)',
      suggestedCategory: 'Finanse',
      aiCategory:        'Waluty',
      reasoning:         `Gotówka PLN: ${qty.toLocaleString('pl-PL')} PLN`,
    };
  }

  // ── Gold (NBP cenyzłota → PLN per gram) ──────────────────────────────────────
  if (id === 'gold') {
    const plnPerGram = await fetchGoldPlnPerGram(signal);
    if (!plnPerGram) return null;
    const unitPrice  = Math.round(plnPerGram);
    const total      = Math.round(plnPerGram * qty);
    return {
      estimatedValue:    total,
      unitPrice,
      currency:          'PLN',
      confidence:        'high',
      source:            'NBP cenyzłota (PLN/gram)',
      suggestedCategory: 'Finanse',
      aiCategory:        'Metale',
      reasoning:         `Złoto wg NBP: ${plnPerGram.toFixed(2)} PLN/gram × ${qty} g = ${total.toLocaleString('pl-PL')} PLN`,
    };
  }

  // ── Other metals (metals.live → USD/troy oz) ──────────────────────────────────
  const metalSlug = METAL_SLUGS[id];
  if (metalSlug) {
    const [spotUsd, usdPln] = await Promise.all([
      fetchMetalUsd(metalSlug, signal),
      getUsdPln(signal),
    ]);
    if (!spotUsd) return null;
    const unitPrice = Math.round(spotUsd * usdPln);
    const total     = Math.round(unitPrice * qty);
    const metalName = metalSlug.charAt(0).toUpperCase() + metalSlug.slice(1);
    return {
      estimatedValue:    total,
      unitPrice,
      currency:          'PLN',
      confidence:        'high',
      source:            'metals.live + NBP USD/PLN',
      suggestedCategory: 'Finanse',
      aiCategory:        'Metale',
      reasoning:         `${metalName}: ${spotUsd.toFixed(2)} USD/oz × kurs NBP ${usdPln.toFixed(4)} = ${unitPrice.toLocaleString('pl-PL')} PLN/oz`,
    };
  }

  // ── Crypto (CoinGecko → PLN direct) ──────────────────────────────────────────
  if (COINGECKO_IDS.has(id)) {
    const plnPerCoin = await fetchCryptoPln(id, signal);
    if (!plnPerCoin) return null;
    const unitPrice  = Math.round(plnPerCoin);
    const total      = Math.round(plnPerCoin * qty);
    return {
      estimatedValue:    total,
      unitPrice,
      currency:          'PLN',
      confidence:        'high',
      source:            'CoinGecko (PLN)',
      suggestedCategory: 'Finanse',
      aiCategory:        'Krypto',
      reasoning:         `${assetId}: ${plnPerCoin.toLocaleString('pl-PL')} PLN/szt.`,
    };
  }

  // ── Stocks / ETF (Twelve Data → USD, then convert; PLN for .WA) ──────────────
  const [spotUsd, usdPln] = await Promise.all([
    fetchStockUsd(assetId, signal),
    isWA ? Promise.resolve(1) : getUsdPln(signal),
  ]);
  if (!spotUsd) return null;

  const unitPrice = isWA
    ? Math.round(spotUsd)
    : Math.round(spotUsd * usdPln);
  const total     = Math.round(unitPrice * qty);

  const dbCategory  = toDbCategory(category);
  const reasonPrice = isWA
    ? `${spotUsd.toFixed(2)} PLN/szt. (GPW)`
    : `${spotUsd.toFixed(2)} USD × kurs NBP ${usdPln.toFixed(4)} = ${unitPrice.toLocaleString('pl-PL')} PLN/szt.`;

  return {
    estimatedValue:    total,
    unitPrice,
    currency:          'PLN',
    confidence:        'high',
    source:            isWA ? `Twelve Data (${assetId}, GPW)` : `Twelve Data (${assetId}) + NBP USD/PLN`,
    suggestedCategory: dbCategory,
    aiCategory:        category,
    reasoning:         `${assetId}: ${reasonPrice}`,
  };
}

// ─── Tavily Web Search (real-time prices for physical/unique items) ───────────

interface TavilyResult {
  title:   string;
  url:     string;
  content: string;
  score?:  number;
}

/**
 * Searches the web via Tavily and returns a compact context string
 * (up to 5 results, each trimmed to 350 chars) ready to inject into the LLM prompt.
 *
 * Returns null if the API key is missing, the request fails, or no results are found.
 * Errors are swallowed so that the caller can fall back to bare OpenAI.
 */
async function searchTavily(query: string, signal: AbortSignal): Promise<string | null> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    console.warn('[tavily] TAVILY_API_KEY not set – skipping web search');
    return null;
  }

  try {
    const res = await fetch('https://api.tavily.com/search', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        api_key:        apiKey,
        query,
        search_depth:   'basic',
        include_answer: false,
        max_results:    5,
      }),
    });

    if (!res.ok) {
      console.warn('[tavily] HTTP error:', res.status, await res.text().catch(() => ''));
      return null;
    }

    const data    = await res.json() as { results?: TavilyResult[] };
    const results = data.results ?? [];

    if (results.length === 0) {
      console.log('[tavily] No results for query:', query);
      return null;
    }

    const context = results
      .slice(0, 5)
      .map((r, i) =>
        `[${i + 1}] ${r.title}\n${r.content.slice(0, 350)}`,
      )
      .join('\n\n');

    console.log(`[tavily] ${results.length} wyników dla: "${query}"`);
    return context;

  } catch (err) {
    // Absorb abort / network errors so the caller can fall back gracefully
    if (err instanceof Error && err.name !== 'AbortError') {
      console.warn('[tavily] Search error:', err.message);
    }
    return null;
  }
}

// ─── Ticker-based valuation (Option A – no AI) ────────────────────────────────
//
// Accepts XTB-style tickers:
//   AAPL.US  → US stock  (Twelve Data, USD → NBP PLN)
//   PKN.PL   → GPW stock (Twelve Data, already PLN)
//   BTC      → crypto    (CoinGecko, PLN direct)
//   GOLD     → metal     (NBP cenyzłota or metals.live)
//   PLN      → cash      (1:1)

/** Maps XTB / common crypto ticker → CoinGecko asset ID */
const CRYPTO_TICKER_TO_CG: Record<string, string> = {
  BTC:   'bitcoin',    ETH:   'ethereum',   SOL:   'solana',
  XRP:   'ripple',     ADA:   'cardano',    DOGE:  'dogecoin',
  BNB:   'binancecoin',LTC:   'litecoin',   DOT:   'polkadot',
  AVAX:  'avalanche-2',LINK:  'chainlink',  TON:   'toncoin',
  SHIB:  'shiba-inu',  MATIC: 'polygon',    UNI:   'uniswap',
  ATOM:  'cosmos',     XLM:   'stellar',    NEAR:  'near',
  PEPE:  'pepe',       ARB:   'arbitrum',   OP:    'optimism',
  INJ:   'injective',  BONK:  'bonk',       XMR:   'monero',
  TRX:   'tron',       FIL:   'filecoin',   AAVE:  'aave',
};

/** Maps common metal tickers → internal slug */
const METAL_TICKER_TO_SLUG: Record<string, string> = {
  GOLD: 'gold',  XAU: 'gold',
  SILVER: 'silver', XAG: 'silver',
  PLATINUM: 'platinum', XPT: 'platinum',
  PALLADIUM: 'palladium', XPD: 'palladium',
  COPPER: 'copper', XCU: 'copper',
};

type TickerMarket = 'gpw' | 'us' | 'crypto' | 'metal_gold' | 'metal_spot' | 'cash';

interface ParsedTicker {
  market:   TickerMarket;
  apiId:    string;   // ID passed to the data source
  category: string;
}

/**
 * Parses XTB-style ticker into routing metadata.
 * Rules:
 *   - GOLD / XAU / SILVER / XAG / … → metal
 *   - BTC / ETH / SOL / …            → crypto (CoinGecko)
 *   - XYZ.PL or XYZ.WA               → GPW Warsaw (Twelve Data, PLN)
 *   - XYZ.US                          → US stock (Twelve Data, USD)
 *   - bare ticker                     → assumed US stock
 */
function parseTicker(raw: string): ParsedTicker {
  const t = raw.trim().toUpperCase();

  if (t === 'PLN') return { market: 'cash',       apiId: 'pln',           category: 'Waluty' };

  const metalSlug = METAL_TICKER_TO_SLUG[t];
  if (metalSlug) {
    return metalSlug === 'gold'
      ? { market: 'metal_gold', apiId: metalSlug,  category: 'Metale' }
      : { market: 'metal_spot', apiId: metalSlug,  category: 'Metale' };
  }

  const cgId = CRYPTO_TICKER_TO_CG[t];
  if (cgId) return { market: 'crypto', apiId: cgId, category: 'Krypto' };

  // GPW: apiId is lowercase Stooq symbol (e.g. "pkn", "pko") – no suffix
  if (t.endsWith('.PL')) return { market: 'gpw', apiId: t.slice(0, -3).toLowerCase(), category: 'Giełda' };
  if (t.endsWith('.WA')) return { market: 'gpw', apiId: t.slice(0, -3).toLowerCase(), category: 'Giełda' };

  if (t.endsWith('.US')) return { market: 'us',  apiId: t.slice(0, -3),           category: 'Giełda' };

  // Bare ticker – treat as US/global (Twelve Data resolves most major symbols)
  return { market: 'us', apiId: t, category: 'Giełda' };
}

/**
 * Option A – Direct ticker → market price, zero AI involved.
 * Throws a descriptive Error if the ticker is not found or the API fails;
 * the API route converts it to a 422 JSON response.
 */
export async function estimateByTicker(
  ticker:   string,
  quantity: number,
): Promise<ValuationResult> {
  const qty        = Math.max(0.0001, quantity);
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), HARD_TIMEOUT_MS);

  try {
    const parsed = parseTicker(ticker);
    const label  = ticker.trim().toUpperCase();

    console.log(`[valuate] ticker "${label}" → market=${parsed.market} apiId=${parsed.apiId}`);

    switch (parsed.market) {

      case 'cash': {
        const total = Math.round(qty);
        return {
          estimatedValue:    total,
          unitPrice:         1,
          currency:          'PLN',
          confidence:        'high',
          source:            'Gotówka PLN (1:1)',
          suggestedCategory: 'Finanse',
          aiCategory:        'Waluty',
          reasoning:         `Gotówka: ${qty.toLocaleString('pl-PL')} PLN`,
        };
      }

      case 'metal_gold': {
        const plnPerGram = await fetchGoldPlnPerGram(controller.signal);
        if (!plnPerGram) throw new Error('Nie udało się pobrać ceny złota z NBP. Spróbuj za chwilę.');
        const total = Math.round(plnPerGram * qty);
        return {
          estimatedValue:    total,
          unitPrice:         Math.round(plnPerGram),
          currency:          'PLN',
          confidence:        'high',
          source:            'NBP cenyzłota (PLN/gram)',
          suggestedCategory: 'Finanse',
          aiCategory:        'Metale',
          reasoning:         `Złoto (NBP): ${plnPerGram.toFixed(2)} PLN/gram × ${qty} g`,
        };
      }

      case 'metal_spot': {
        const [spotUsd, usdPln] = await Promise.all([
          fetchMetalUsd(parsed.apiId, controller.signal),
          getUsdPln(controller.signal),
        ]);
        if (!spotUsd) throw new Error(`Nie znaleziono notowania metalu: ${label}. Dostępne: SILVER, XAG, PLATINUM, PALLADIUM.`);
        const unitPrice = Math.round(spotUsd * usdPln);
        const total     = Math.round(unitPrice * qty);
        return {
          estimatedValue:    total,
          unitPrice,
          currency:          'PLN',
          confidence:        'high',
          source:            'metals.live + NBP USD/PLN',
          suggestedCategory: 'Finanse',
          aiCategory:        'Metale',
          reasoning:         `${label}: ${spotUsd.toFixed(2)} USD/oz × ${usdPln.toFixed(4)} = ${unitPrice.toLocaleString('pl-PL')} PLN/oz`,
        };
      }

      case 'crypto': {
        console.log(`[valuate] Wykryto kryptowalutę: ${label} → CoinGecko id="${parsed.apiId}"`);
        const pln = await fetchCryptoPln(parsed.apiId, controller.signal);
        if (!pln) throw new Error(`Nie znaleziono takiego tickera na giełdzie. Dostępne krypto: BTC, ETH, SOL, XRP, ADA, DOGE…`);
        const total = Math.round(pln * qty);
        console.log('Wykryto ticker:', label, '| Pobrana cena końcowa w PLN:', Math.round(pln));
        return {
          estimatedValue:    total,
          unitPrice:         Math.round(pln),
          currency:          'PLN',
          confidence:        'high',
          source:            'CoinGecko (PLN)',
          suggestedCategory: 'Finanse',
          aiCategory:        'Krypto',
          reasoning:         `${label}: ${pln.toLocaleString('pl-PL')} PLN/szt.`,
        };
      }

      case 'gpw': {
        // Stooq.pl – free, reliable, no API key needed; prices in PLN
        console.log(`[valuate] Wykryto ticker GPW: ${label} → Stooq symbol="${parsed.apiId}"`);
        const pricePln = await fetchStooqPln(parsed.apiId, controller.signal);
        if (!pricePln) throw new Error(
          `Nie znaleziono takiego tickera na giełdzie. Upewnij się, że ticker GPW jest poprawny (np. PKN.PL, PKO.PL, CDR.PL).`,
        );
        const unitPrice  = parseFloat(pricePln.toFixed(2));
        const total      = Math.round(unitPrice * qty);
        console.log('Wykryto ticker:', label, '| Pobrana cena końcowa w PLN:', unitPrice);
        return {
          estimatedValue:    total,
          unitPrice,
          currency:          'PLN',
          confidence:        'high',
          source:            `Stooq.pl (${label}, GPW Warszawa)`,
          suggestedCategory: 'Finanse',
          aiCategory:        'Giełda',
          reasoning:         `${label}: ${pricePln.toFixed(2)} PLN/szt. (GPW Warszawa, źródło: Stooq)`,
        };
      }

      case 'us': {
        console.log(`[valuate] Wykryto ticker zagraniczny: ${label} → Twelve Data symbol="${parsed.apiId}"`);
        const [priceUsd, usdPln] = await Promise.all([
          fetchStockUsd(parsed.apiId, controller.signal),
          getUsdPln(controller.signal),
        ]);
        if (!priceUsd) throw new Error(
          `Nie znaleziono takiego tickera na giełdzie. Sprawdź symbol (np. AAPL.US, TSLA.US, MCD.US).`,
        );
        const unitPrice = Math.round(priceUsd * usdPln);
        const total     = Math.round(unitPrice * qty);
        console.log('Wykryto ticker:', label, '| Cena USD:', priceUsd, '| Kurs USD/PLN:', usdPln.toFixed(4), '| Pobrana cena końcowa w PLN:', unitPrice);
        return {
          estimatedValue:    total,
          unitPrice,
          currency:          'PLN',
          confidence:        'high',
          source:            `Twelve Data (${parsed.apiId}) + NBP USD/PLN`,
          suggestedCategory: 'Finanse',
          aiCategory:        'Giełda',
          reasoning:         `${label}: ${priceUsd.toFixed(2)} USD × ${usdPln.toFixed(4)} = ${unitPrice.toLocaleString('pl-PL')} PLN/szt.`,
        };
      }

      default: {
        // TypeScript exhaustiveness guard
        throw new Error(`Nieobsługiwany rynek dla: ${label}`);
      }
    }

  } catch (err) {
    const isAbort = err instanceof Error && (err.name === 'AbortError' || controller.signal.aborted);
    if (isAbort) throw new Error('Przekroczono czas zapytania (8 s). Spróbuj ponownie.');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

const HARD_TIMEOUT_MS = 8_000;

/**
 * Option B – Tavily-augmented AI valuation from a free-text description.
 *
 * Flow:
 *   1. Tavily Web Search – fetches real listings/prices from the Polish internet
 *      (Allegro, OLX, numismatic archives, real-estate portals, etc.)
 *   2. OpenAI gpt-4o-mini – receives the web snippets as grounding context and
 *      derives a realistic market value in PLN.
 *   3. Fallback – if Tavily fails (rate-limit, network error), we fall back to
 *      bare OpenAI with its training knowledge. The app never crashes.
 */
export async function estimateByDescription(description: string): Promise<ValuationResult> {
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), HARD_TIMEOUT_MS);

  try {
    // ── Step 1: Web search for real-time market prices ─────────────────────────
    const tavilyQuery = `${description} cena allegro olx aukcja kupię sprzedam`;
    const webContext  = await searchTavily(tavilyQuery, controller.signal);

    // ── Step 2: Build OpenAI system prompt ────────────────────────────────────
    const systemPrompt = webContext
      ? `Jesteś ekspertem rynkowym wyceniającym rzeczy na polskim rynku wtórnym (2026).
Użytkownik chce wycenić: "${description}"

Aby pomóc Ci w precyzyjnej wycenie, przeszukaliśmy polski internet i znaleźliśmy następujące aktualne oferty oraz archiwa aukcyjne:

${webContext}

Przeanalizuj powyższe realne dane z rynku:
- Odrzuć skrajne anomalie cenowe (wyjątkowo tanie lub drogie oferty)
- Wyznacz realny przedział cenowy dla tego konkretnego przedmiotu/egzemplarza
- Oblicz kwotę możliwą do uzyskania przy normalnej sprzedaży

Zwróć WYŁĄCZNIE JSON (zero dodatkowego tekstu):
{"value":<całkowita wartość PLN, integer, > 0>,"category":"Elektronika"|"Nieruchomości"|"Inne","reasoning":"<max 35 słów, np. 'Na podstawie znalezionych ofert cena waha się od X do Y zł. Przyjęto średnią Z zł.'>"}

Value MUSI być > 0.`
      : `Jesteś ekspertem wyceny aktywów na polskim rynku (rok 2026). Oceń wartość rynkową na podstawie opisu użytkownika — to jest realna cena, za którą można sprzedać ten przedmiot/nieruchomość w Polsce.

Zwróć WYŁĄCZNIE JSON (zero dodatkowego tekstu):
{"value":<całkowita wartość PLN, integer, zawsze > 0>,"category":"Elektronika"|"Nieruchomości"|"Inne","reasoning":"<max 25 słów, krótkie uzasadnienie ceny>"}

Zasady wyceny:
- Podaj realistyczną cenę rynkową (np. z OLX/Allegro dla przedmiotów, z rynku wtórnego dla nieruchomości)
- Dla nieruchomości: uwzględnij lokalizację, metraż i standard
- Dla przedmiotów kolekcjonerskich/unikatowych: oceń stan i rzadkość
- Value MUSI być > 0`;

    // ── Step 3: Call OpenAI with (or without) web context ─────────────────────
    const completion = await getOpenAI().chat.completions.create(
      {
        model:           'gpt-4o-mini',
        response_format: { type: 'json_object' },
        // Lower temperature when grounded with real data → more deterministic
        temperature:     webContext ? 0.1 : 0.3,
        max_tokens:      250,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: description },
        ],
      },
      { signal: controller.signal },
    );

    // ── Step 4: Parse and validate response ───────────────────────────────────
    const raw    = completion.choices[0]?.message?.content ?? '{}';
    console.log('[valuate] estimateByDescription response:', raw);
    const parsed = JSON.parse(raw) as { value?: number; category?: string; reasoning?: string };

    const value       = typeof parsed.value === 'number' && parsed.value > 0
                          ? Math.round(parsed.value) : 0;
    const rawCategory = typeof parsed.category === 'string' ? parsed.category.trim() : 'Inne';

    if (value === 0) {
      return physicalResult(rawCategory, 'AI nie zwróciła wartości. Wpisz ją ręcznie.');
    }

    return {
      estimatedValue:    value,
      unitPrice:         value,
      currency:          'PLN',
      // With real web data the estimate is much more reliable
      confidence:        webContext ? 'high' : 'medium',
      source:            webContext
                           ? 'Tavily Web Search + OpenAI gpt-4o-mini'
                           : 'OpenAI gpt-4o-mini (wycena z opisu)',
      suggestedCategory: toDbCategory(rawCategory),
      aiCategory:        rawCategory,
      reasoning:         parsed.reasoning?.trim() ?? 'Szacunkowa wartość rynkowa wg AI.',
    };

  } catch (err) {
    const isAbort = err instanceof Error && (err.name === 'AbortError' || controller.signal.aborted);
    console.error('[valuate] estimateByDescription error:', err);
    return physicalResult(
      'Inne',
      isAbort ? 'Przekroczono czas wyceny (8 s). Spróbuj ponownie.' : 'Błąd AI. Wpisz wartość ręcznie.',
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function estimateValue(
  itemName: string,
  quantity = 1,
): Promise<ValuationResult> {
  const qty        = Math.max(0.0001, quantity);
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), HARD_TIMEOUT_MS);

  try {
    // ── Step 1: Classify ─────────────────────────────────────────────────────
    let cls: Classification;
    try {
      cls = await classifyAsset(itemName, controller.signal);
      console.log(`[valuate] "${itemName}" → type=${cls.type} asset_id=${cls.asset_id} cat=${cls.category}`);
    } catch (err) {
      console.warn('[valuate] Classification failed → manual fallback:', err);
      return physicalResult('Inne');
    }

    // ── Physical asset ───────────────────────────────────────────────────────
    if (cls.type === 'physical' || !cls.asset_id) {
      return physicalResult(cls.category);
    }

    // ── Financial asset ──────────────────────────────────────────────────────
    try {
      const result = await valuateFinancial(
        cls.asset_id,
        cls.category,
        qty,
        controller.signal,
      );

      if (result) {
        console.log(`[valuate] WYNIK: ${result.estimatedValue} PLN (${result.source})`);
        return result;
      }

      // API returned null (rate limit, unknown ticker, API down, etc.)
      const noApiKey = cls.asset_id && !COINGECKO_IDS.has(cls.asset_id.toLowerCase()) && !process.env.TWELVE_DATA_API_KEY;
      const reason = noApiKey
        ? `Brak klucza API Twelve Data (${cls.asset_id}). Dodaj TWELVE_DATA_API_KEY do .env.local lub wpisz wartość ręcznie.`
        : `Nie udało się pobrać ceny dla "${cls.asset_id}". Wpisz wartość ręcznie.`;

      console.warn(`[valuate] No price for "${cls.asset_id}"`, noApiKey ? '(missing API key)' : '');
      return physicalResult(cls.category, reason);

    } catch (marketErr) {
      console.warn(`[valuate] Market error for "${cls.asset_id}":`, marketErr);
      return physicalResult(cls.category, `Błąd pobierania ceny (${cls.asset_id}). Wpisz wartość ręcznie.`);
    }

  } catch (err) {
    const isAbort = err instanceof Error && (err.name === 'AbortError' || controller.signal.aborted);
    console.error(`[valuate] ${isAbort ? 'TIMEOUT' : 'ERROR'} for "${itemName}":`, err);
    return physicalResult('Inne', isAbort ? 'Przekroczono czas (8 s). Spróbuj ponownie.' : undefined);
  } finally {
    clearTimeout(timer);
  }
}
