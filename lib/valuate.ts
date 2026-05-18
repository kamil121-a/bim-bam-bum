/**
 * Two-step valuation – strict separation of concerns:
 *
 * STEP 1  AI Classification (gpt-4o-mini, temp=0)
 *   AI does ONE job only: read the user's text and return structured JSON.
 *   { type, ticker, category }
 *   AI is FORBIDDEN from pricing anything.
 *
 * STEP 2  Pure TypeScript math
 *   "financial" → fetch real-time price from Yahoo Finance
 *                 + USD/PLN from NBP API → multiply by quantity
 *   "physical"  → return requiresManualPrice=true, estimatedValue=0
 *                 (user enters their own price in the UI)
 *
 * No AI hallucinations. No estimated prices from language models.
 * 100 % reproducible math.
 */

import yahooFinance from 'yahoo-finance2';
import OpenAI from 'openai';
import type { AssetCategory } from '@/types';

// ─── Exported result type ─────────────────────────────────────────────────────

export interface ValuationResult {
  estimatedValue:    number;         // total PLN (0 when requiresManualPrice)
  unitPrice:         number;         // PLN per 1 user unit (0 when requiresManualPrice)
  currency:          'PLN';
  confidence:        'high' | 'medium' | 'low';
  source:            string;
  suggestedCategory: AssetCategory;
  aiCategory:        string;
  reasoning:         string;
  /** true for physical items – UI should show a manual price input */
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

// ─── OpenAI singleton ─────────────────────────────────────────────────────────

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

// ─── NBP USD/PLN (30-min cache) ───────────────────────────────────────────────

let _nbpCache: { rate: number; ts: number } | null = null;

async function getUsdPln(signal: AbortSignal): Promise<number> {
  if (_nbpCache && Date.now() - _nbpCache.ts < 30 * 60 * 1000) return _nbpCache.rate;
  const res = await fetch(
    'https://api.nbp.pl/api/exchangerates/rates/a/usd/?format=json',
    { signal, headers: { Accept: 'application/json' } },
  );
  if (!res.ok) throw new Error(`NBP HTTP ${res.status}`);
  const data = await res.json() as { rates: Array<{ mid: number }> };
  _nbpCache = { rate: data.rates[0].mid, ts: Date.now() };
  return _nbpCache.rate;
}

// ─── Yahoo Finance price (native currency of the ticker) ──────────────────────

async function getSpotPrice(ticker: string): Promise<number | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const q: any = await yahooFinance.quote(ticker, {}, { validateResult: false });
    const p = q?.regularMarketPrice;
    return typeof p === 'number' && p > 0 ? p : null;
  } catch (err) {
    console.warn(`[valuate] Yahoo Finance "${ticker}":`, err);
    return null;
  }
}

// ─── Step 1 – AI Classifier ───────────────────────────────────────────────────

interface Classification {
  type:     'financial' | 'physical';
  ticker:   string | null;
  category: string;
}

/**
 * AI's ONLY job: classify the user's text. No prices. No estimates.
 * Returns structured JSON: { type, ticker, category }.
 */
const CLASSIFY_PROMPT = `Jesteś klasyfikatorem aktywów. Twoje JEDYNE zadanie to przeanalizować wpis użytkownika i zwrócić JSON klasyfikujący aktywo. ABSOLUTNIE NIE wolno Ci podawać żadnych cen ani kwot.

Zwróć WYŁĄCZNIE czysty JSON (zero tekstu poza JSON):
{
  "type": "financial" | "physical",
  "ticker": string | null,
  "category": "Giełda" | "Krypto" | "Metale" | "Waluty" | "Elektronika" | "Nieruchomości" | "Inne"
}

ZASADY TICKERÓW (Yahoo Finance):
• Złoto      → "GC=F"
• Srebro     → "SI=F"
• Platyna    → "PL=F"
• Pallad     → "PA=F"
• Miedź      → "HG=F"
• Krypto     → "BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD", "ADA-USD", "DOGE-USD", "BNB-USD", "AVAX-USD" itp.
• ETF/Indeks → "SPY" (S&P 500), "QQQ" (NASDAQ 100), "VOO", "VTI", "DIA" itp.
• Akcje US   → "AAPL", "MSFT", "GOOGL", "AMZN", "TSLA", "NVDA", "META", "JPM", "V", "MA", "NFLX", "AMD", "PLTR", "COIN", "UBER" itp.
• GPW Polska → "PKN.WA" (Orlen), "PKO.WA", "CDR.WA" (CD Projekt), "ALE.WA" (Allegro), "KGH.WA" (KGHM), "PZU.WA", "LPP.WA", "DNO.WA" (Dino) itp.
• Gotówka PLN → "PLN"
• Fizyczne przedmioty → type: "physical", ticker: null

PRZYKŁADY:
"złoto 10"           → {"type":"financial","ticker":"GC=F","category":"Metale"}
"srebro 5 uncji"     → {"type":"financial","ticker":"SI=F","category":"Metale"}
"Bitcoin"            → {"type":"financial","ticker":"BTC-USD","category":"Krypto"}
"0.5 ETH"           → {"type":"financial","ticker":"ETH-USD","category":"Krypto"}
"Apple akcje"        → {"type":"financial","ticker":"AAPL","category":"Giełda"}
"S&P 500 ETF"        → {"type":"financial","ticker":"SPY","category":"Giełda"}
"Orlen"              → {"type":"financial","ticker":"PKN.WA","category":"Giełda"}
"1000 PLN gotówka"   → {"type":"financial","ticker":"PLN","category":"Waluty"}
"MacBook Pro M4"     → {"type":"physical","ticker":null,"category":"Elektronika"}
"słuchawki Sony"     → {"type":"physical","ticker":null,"category":"Elektronika"}
"mieszkanie 50m²"    → {"type":"physical","ticker":null,"category":"Nieruchomości"}
"samochód"           → {"type":"physical","ticker":null,"category":"Inne"}`;

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
    ticker:   typeof parsed.ticker === 'string' && parsed.ticker.length > 0
                ? parsed.ticker.trim().toUpperCase()
                : null,
    category: typeof parsed.category === 'string' ? parsed.category.trim() : 'Inne',
  };
}

// ─── Step 2A – Financial math ─────────────────────────────────────────────────

/** Tickers whose price is already in PLN (Warsaw Stock Exchange). */
const isPLN = (ticker: string) => ticker.endsWith('.WA');

/** Metal futures – Yahoo Finance price is USD per troy ounce. */
const METAL_LABELS: Record<string, string> = {
  'GC=F': 'Złoto',
  'SI=F': 'Srebro',
  'PL=F': 'Platyna',
  'PA=F': 'Pallad',
  'HG=F': 'Miedź',
};
const isMetal = (t: string) => t in METAL_LABELS;

/**
 * METAL UNIT CONVENTION
 * ─────────────────────
 * Yahoo Finance quotes metals in USD per TROY OUNCE.
 * In this app, quantity for metals always represents TROY OUNCES.
 * If a user means grams, they should convert beforehand:
 *   1 troy oz = 31.1035 g  →  10 g = 0.3215 oz
 * The hint text in the UI reflects this convention.
 */

async function valuateFinancial(
  ticker:   string,
  category: string,
  qty:      number,
  signal:   AbortSignal,
): Promise<ValuationResult | null> {
  // ── Special case: PLN cash (no external fetch needed) ───────────────────────
  if (ticker === 'PLN') {
    const total = Math.round(qty);
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

  const plnAsset = isPLN(ticker);

  // Fetch spot price + USD/PLN rate in parallel (skip NBP for PLN-priced assets)
  const [spot, usdPln] = await Promise.all([
    getSpotPrice(ticker),
    plnAsset ? Promise.resolve(1) : getUsdPln(signal),
  ]);

  if (!spot) return null;

  let unitPricePln: number;
  let reasoning:    string;
  const metalLabel = METAL_LABELS[ticker];

  if (isMetal(ticker)) {
    // spot = USD per troy ounce, qty = troy ounces
    unitPricePln = Math.round(spot * usdPln);
    reasoning    = `${metalLabel} (${ticker}): ${spot.toFixed(2)} USD/oz × kurs NBP ${usdPln.toFixed(4)} USD/PLN = ${unitPricePln.toLocaleString('pl-PL')} PLN/oz`;
  } else if (plnAsset) {
    unitPricePln = Math.round(spot);
    reasoning    = `${ticker} na GPW: ${spot.toFixed(2)} PLN/szt.`;
  } else {
    unitPricePln = Math.round(spot * usdPln);
    reasoning    = `${ticker}: ${spot.toFixed(2)} USD × kurs NBP ${usdPln.toFixed(4)} USD/PLN = ${unitPricePln.toLocaleString('pl-PL')} PLN/szt.`;
  }

  const totalValue = Math.round(unitPricePln * qty);

  const aiCategory      = isMetal(ticker) ? 'Metale' : category;
  const suggestedCategory = toDbCategory(aiCategory);

  return {
    estimatedValue:    totalValue,
    unitPrice:         unitPricePln,
    currency:          'PLN',
    confidence:        'high',
    source:            plnAsset
                         ? `Yahoo Finance (${ticker})`
                         : `Yahoo Finance (${ticker}) + NBP USD/PLN`,
    suggestedCategory,
    aiCategory,
    reasoning,
  };
}

// ─── Step 2B – Physical asset (manual price) ──────────────────────────────────

function physicalResult(category: string): ValuationResult {
  return {
    estimatedValue:     0,
    unitPrice:          0,
    currency:           'PLN',
    confidence:         'low',
    source:             'Manualna wycena',
    suggestedCategory:  toDbCategory(category),
    aiCategory:         category || 'Inne',
    reasoning:          'Wpisz szacowaną wartość rynkową tego przedmiotu (np. z Allegro/OLX).',
    requiresManualPrice: true,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

const HARD_TIMEOUT_MS = 8_000; // leaves 2 s headroom for Vercel Hobby 10 s limit

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
      console.info(`[valuate] "${itemName}" → type=${cls.type} ticker=${cls.ticker} cat=${cls.category}`);
    } catch (classifyErr) {
      console.warn('[valuate] Classification failed → physical fallback:', classifyErr);
      return physicalResult('Inne');
    }

    // ── Step 2B: Physical item ────────────────────────────────────────────────
    if (cls.type === 'physical' || !cls.ticker) {
      return physicalResult(cls.category);
    }

    // ── Step 2A: Financial instrument ────────────────────────────────────────
    try {
      const result = await valuateFinancial(
        cls.ticker,
        cls.category,
        qty,
        controller.signal,
      );
      if (result) {
        console.info(`[valuate] Market OK → ${result.estimatedValue} PLN`);
        return result;
      }
      // Yahoo Finance returned null (bad ticker, market closed, etc.)
      console.warn(`[valuate] No price for "${cls.ticker}" → manual fallback`);
      return {
        ...physicalResult(cls.category),
        reasoning: `Nie udało się pobrać ceny dla tickera "${cls.ticker}" (Yahoo Finance). Wpisz wartość ręcznie.`,
      };
    } catch (marketErr) {
      console.warn(`[valuate] Market error for "${cls.ticker}":`, marketErr);
      return {
        ...physicalResult(cls.category),
        reasoning: `Błąd pobierania ceny (${cls.ticker}). Wpisz wartość ręcznie.`,
      };
    }

  } catch (err) {
    const isAbort = err instanceof Error && (err.name === 'AbortError' || controller.signal.aborted);
    console.error(`[valuate] ${isAbort ? 'TIMEOUT' : 'ERROR'} for "${itemName}":`, err);
    return physicalResult('Inne');
  } finally {
    clearTimeout(timer);
  }
}
