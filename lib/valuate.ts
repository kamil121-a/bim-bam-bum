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

// ─── API 5: Twelve Data (USD per share, requires TWELVE_DATA_API_KEY) ────────

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
• S&P 500 / SPY  → "SPY"          (ticker giełdowy dla Twelve Data)
• NASDAQ / QQQ   → "QQQ"
• Apple          → "AAPL"
• Microsoft      → "MSFT"
• Google         → "GOOGL"
• Amazon         → "AMZN"
• Tesla          → "TSLA"
• NVIDIA         → "NVDA"
• Meta           → "META"
• Orlen / PKN    → "PKN.WA"
• PKO BP         → "PKO.WA"
• CD Projekt     → "CDR.WA"
• Allegro        → "ALE.WA"
• KGHM           → "KGH.WA"
• PZU            → "PZU.WA"
• Dino           → "DNO.WA"
• LPP            → "LPP.WA"
• Gotówka PLN    → "pln"
• Fizyczne przedmioty (elektronika, samochód, meble, zegarek itp.) → type: "physical", asset_id: null

PRZYKŁADY:
"10g złota"           → {"type":"financial","asset_id":"gold","category":"Metale"}
"srebro 5 uncji"      → {"type":"financial","asset_id":"silver","category":"Metale"}
"bitcoin"             → {"type":"financial","asset_id":"bitcoin","category":"Krypto"}
"S&P 500 ETF"         → {"type":"financial","asset_id":"SPY","category":"Giełda"}
"Apple 3 akcje"       → {"type":"financial","asset_id":"AAPL","category":"Giełda"}
"Orlen"               → {"type":"financial","asset_id":"PKN.WA","category":"Giełda"}
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

// ─── Public API ───────────────────────────────────────────────────────────────

const HARD_TIMEOUT_MS = 8_000;

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
