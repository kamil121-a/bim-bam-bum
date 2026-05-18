/**
 * Two-stage AI Routing valuation pipeline
 *
 * Stage 1 – AI Classifier (gpt-4o-mini, temperature=0, ~80 tokens)
 *   Classifies the user's input and extracts the Yahoo Finance ticker if it's
 *   a financial instrument (stock, ETF, crypto, metal, index).
 *
 * Stage 2A – Market Path (ticker is known)
 *   Fetches real-time price from Yahoo Finance.
 *   Converts to PLN via NBP API (for USD-priced assets).
 *   Returns a high-confidence result without any further AI call.
 *
 * Stage 2B – OpenAI Path (physical / unrecognised asset)
 *   Asks gpt-4o-mini to estimate the value based on current market prices
 *   (Allegro/OLX for electronics, PLN/m² for real estate, etc.).
 *
 * Fallback
 *   Any stage can fail independently. Errors cascade to the next stage.
 *   A full pipeline failure returns estimatedValue = 0 (handled by the UI).
 *
 * Total budget: 8 s (AbortController shared across stages → safe for Vercel Hobby 10 s limit).
 */

import yahooFinance from 'yahoo-finance2';
import OpenAI from 'openai';
import type { AssetCategory } from '@/types';

// ─── Exported result type ─────────────────────────────────────────────────────

export interface ValuationResult {
  estimatedValue: number; // total PLN value (unitPrice × quantity)
  unitPrice:      number; // PLN per 1 unit
  currency:       'PLN';
  confidence:     'high' | 'medium' | 'low';
  source:         string;
  suggestedCategory: AssetCategory; // maps to valid DB enum value
  aiCategory:        string;        // human-readable label shown in UI
  reasoning:         string;
}

// ─── DB category mapping ──────────────────────────────────────────────────────

const AI_TO_DB: Record<string, AssetCategory> = {
  'Giełda/Krypto': 'Finanse',
  Metale:          'Finanse',
  Elektronika:     'Elektronika',
  Nieruchomości:   'Nieruchomości',
  Finanse:         'Finanse',
  Inne:            'Inne',
};

function resolveCategory(raw: string): { db: AssetCategory; ai: string } {
  const s = (raw ?? '').trim();
  return { db: AI_TO_DB[s] ?? 'Inne', ai: s || 'Inne' };
}

// ─── Fallback result ──────────────────────────────────────────────────────────

const FALLBACK: ValuationResult = {
  estimatedValue:    0,
  unitPrice:         0,
  currency:          'PLN',
  confidence:        'low',
  source:            'Błąd wyceny',
  suggestedCategory: 'Inne',
  aiCategory:        'Inne',
  reasoning:         'Nie udało się pobrać wyceny. Wartość ustawiona tymczasowo na 0 PLN.',
};

// ─── OpenAI singleton ─────────────────────────────────────────────────────────

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

// ─── NBP USD/PLN (module-level cache – survives warm invocations) ─────────────

let _nbpCache: { rate: number; ts: number } | null = null;
const NBP_TTL_MS = 30 * 60 * 1000; // 30 minutes

async function getUsdPln(signal: AbortSignal): Promise<number> {
  if (_nbpCache && Date.now() - _nbpCache.ts < NBP_TTL_MS) return _nbpCache.rate;

  const res = await fetch(
    'https://api.nbp.pl/api/exchangerates/rates/a/usd/?format=json',
    { signal, headers: { Accept: 'application/json' } },
  );
  if (!res.ok) throw new Error(`NBP API HTTP ${res.status}`);

  const data = await res.json() as { rates: Array<{ mid: number }> };
  const rate = data.rates[0].mid;
  _nbpCache = { rate, ts: Date.now() };
  return rate;
}

// ─── Yahoo Finance price fetcher ──────────────────────────────────────────────

async function getMarketPrice(ticker: string): Promise<number | null> {
  try {
    // validateResult:false prevents crashes on minor Yahoo schema deviations
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const quote: any = await yahooFinance.quote(ticker, {}, { validateResult: false });
    const price = quote?.regularMarketPrice as unknown;
    return typeof price === 'number' && price > 0 ? price : null;
  } catch (err) {
    console.warn(`[valuate] Yahoo Finance error for "${ticker}":`, err);
    return null;
  }
}

// ─── Ticker metadata (derived, no static map needed) ─────────────────────────

interface TickerMeta {
  label:       string;
  dbCategory:  AssetCategory;
  aiCategory:  string;
  /** Price returned by Yahoo Finance is already in PLN (GPW .WA suffix) */
  isPLN:       boolean;
  /** Price is in USD per troy ounce (precious metal futures) */
  isMetal:     boolean;
  /** Default quantity unit when user doesn't specify 'gram/g' or 'uncja/oz' */
  defaultUnit: 'g' | 'oz';
}

const METAL_MAP: Record<string, Pick<TickerMeta, 'label' | 'defaultUnit'>> = {
  'GC=F': { label: 'Złoto',   defaultUnit: 'g'  },
  'SI=F': { label: 'Srebro',  defaultUnit: 'oz' },
  'PL=F': { label: 'Platyna', defaultUnit: 'oz' },
  'HG=F': { label: 'Miedź',   defaultUnit: 'oz' },
};

function getTickerMeta(ticker: string, rawAiCategory: string): TickerMeta {
  const t = ticker.toUpperCase();
  const metalEntry = METAL_MAP[t];

  if (metalEntry) {
    return {
      label:       metalEntry.label,
      dbCategory:  'Finanse',
      aiCategory:  'Metale',
      isPLN:       false,
      isMetal:     true,
      defaultUnit: metalEntry.defaultUnit,
    };
  }

  if (t.endsWith('.WA')) {
    return {
      label:       ticker,
      dbCategory:  'Finanse',
      aiCategory:  'Giełda/Krypto',
      isPLN:       true,
      isMetal:     false,
      defaultUnit: 'oz',
    };
  }

  // Crypto, US stocks, ETFs → priced in USD
  return {
    label:       ticker,
    dbCategory:  'Finanse',
    aiCategory:  rawAiCategory || 'Giełda/Krypto',
    isPLN:       false,
    isMetal:     false,
    defaultUnit: 'oz',
  };
}

// ─── Stage 1 – AI Classifier ──────────────────────────────────────────────────

interface AssetClassification {
  isFinancialAsset: boolean;
  ticker:           string | null;
  category:         string; // 'Giełda/Krypto' | 'Metale' | 'Inne'
}

const CLASSIFY_PROMPT = `Określ, czy wpis użytkownika dotyczy instrumentu finansowego (akcja, ETF, kryptowaluta, metal szlachetny, indeks giełdowy). Zwróć TYLKO poprawny JSON bez żadnego dodatkowego tekstu:
{"isFinancialAsset":<boolean>,"ticker":<string|null>,"category":<"Giełda/Krypto"|"Metale"|"Inne">}

Zasady wyboru tickera (kompatybilne z Yahoo Finance):
- Krypto: BTC-USD, ETH-USD, SOL-USD, XRP-USD, DOGE-USD, BNB-USD, ADA-USD itp.
- US Akcje: AAPL, MSFT, GOOGL, AMZN, TSLA, NVDA, META, JPM, V, MA, NFLX, AMD, PLTR, UBER itp.
- US ETF/Indeksy: SPY (S&P 500), QQQ (NASDAQ 100), VOO, VTI, DIA itp.
- GPW Polska: PKN.WA (Orlen), PKO.WA, CDR.WA (CD Projekt), ALE.WA (Allegro), KGH.WA (KGHM), PZU.WA, LPP.WA, DNO.WA (Dino) itp.
- Metale: GC=F (złoto), SI=F (srebro), PL=F (platyna), HG=F (miedź)
- Jeśli nie jest to instrument finansowy → isFinancialAsset: false, ticker: null, category: "Inne"

Przykłady:
"5 akcji Apple" → {"isFinancialAsset":true,"ticker":"AAPL","category":"Giełda/Krypto"}
"bitcoin" → {"isFinancialAsset":true,"ticker":"BTC-USD","category":"Giełda/Krypto"}
"S&P 500 ETF" → {"isFinancialAsset":true,"ticker":"SPY","category":"Giełda/Krypto"}
"złoto 10g" → {"isFinancialAsset":true,"ticker":"GC=F","category":"Metale"}
"Orlen akcje" → {"isFinancialAsset":true,"ticker":"PKN.WA","category":"Giełda/Krypto"}
"Słuchawki Sony WH-1000XM5" → {"isFinancialAsset":false,"ticker":null,"category":"Inne"}
"MacBook Pro M4" → {"isFinancialAsset":false,"ticker":null,"category":"Inne"}
"mieszkanie 50m²" → {"isFinancialAsset":false,"ticker":null,"category":"Inne"}`;

async function classifyAsset(
  name: string,
  signal: AbortSignal,
): Promise<AssetClassification> {
  const completion = await getOpenAI().chat.completions.create(
    {
      model:           'gpt-4o-mini',
      response_format: { type: 'json_object' },
      temperature:     0,      // fully deterministic
      max_tokens:      80,     // classification JSON is tiny
      messages: [
        { role: 'system', content: CLASSIFY_PROMPT },
        { role: 'user',   content: name },
      ],
    },
    { signal },
  );

  const raw = completion.choices[0]?.message?.content ?? '{}';
  const parsed = JSON.parse(raw) as Partial<AssetClassification>;

  return {
    isFinancialAsset: parsed.isFinancialAsset === true,
    ticker:           typeof parsed.ticker === 'string' && parsed.ticker.length > 0
                        ? parsed.ticker.trim()
                        : null,
    category:         typeof parsed.category === 'string' ? parsed.category : 'Inne',
  };
}

// ─── Stage 2A – Market valuation ──────────────────────────────────────────────

const TROY_OZ_TO_G = 31.1035;

async function valuateFromMarket(
  ticker:      string,
  aiCategory:  string,
  name:        string,
  qty:         number,
  signal:      AbortSignal,
): Promise<ValuationResult | null> {
  const meta = getTickerMeta(ticker, aiCategory);

  // Fetch price and (if needed) USD/PLN rate in parallel
  const [spotPrice, usdPln] = await Promise.all([
    getMarketPrice(ticker),
    meta.isPLN ? Promise.resolve(1) : getUsdPln(signal),
  ]);

  if (!spotPrice) return null;

  let unitPricePln: number;
  let reasoningDetail: string;

  if (meta.isMetal) {
    const nl = name.toLowerCase();
    const userWantsOz = nl.includes('uncja') || nl.includes(' oz') || nl.includes('oz)') || nl.includes('/oz');
    const useGrams    = !userWantsOz && meta.defaultUnit === 'g';

    if (useGrams) {
      unitPricePln   = Math.round((spotPrice / TROY_OZ_TO_G) * usdPln);
      reasoningDetail = `Kurs spot ${meta.label}: ${spotPrice.toFixed(2)} USD/oz ÷ ${TROY_OZ_TO_G} g/oz × kurs NBP USD/PLN ${usdPln.toFixed(4)} = ${unitPricePln.toLocaleString('pl-PL')} PLN/g`;
    } else {
      unitPricePln   = Math.round(spotPrice * usdPln);
      reasoningDetail = `Kurs spot ${meta.label}: ${spotPrice.toFixed(2)} USD/oz × kurs NBP USD/PLN ${usdPln.toFixed(4)} = ${unitPricePln.toLocaleString('pl-PL')} PLN/oz`;
    }
  } else if (meta.isPLN) {
    unitPricePln   = Math.round(spotPrice);
    reasoningDetail = `Pobrano aktualny kurs giełdowy dla tickera ${ticker} z Yahoo Finance: ${spotPrice.toFixed(2)} PLN/szt.`;
  } else {
    unitPricePln   = Math.round(spotPrice * usdPln);
    reasoningDetail = `Pobrano aktualny kurs giełdowy dla tickera ${ticker} z Yahoo Finance: ${spotPrice.toFixed(2)} USD × kurs NBP USD/PLN ${usdPln.toFixed(4)} = ${unitPricePln.toLocaleString('pl-PL')} PLN/szt.`;
  }

  const totalValue = Math.round(unitPricePln * qty);

  return {
    estimatedValue:    totalValue,
    unitPrice:         unitPricePln,
    currency:          'PLN',
    confidence:        'high',
    source:            `Yahoo Finance (${ticker})${meta.isPLN ? '' : ' + NBP USD/PLN'}`,
    suggestedCategory: meta.dbCategory,
    aiCategory:        meta.aiCategory,
    reasoning:         reasoningDetail,
  };
}

// ─── Stage 2B – OpenAI physical-asset valuation ───────────────────────────────

const PHYSICAL_PROMPT =
  'Wyceniaj fizyczne aktywa w PLN (rok 2026). Odpowiedz TYLKO poprawnym JSON:\n' +
  '{"unit_value":<PLN za 1 szt., integer>,"value":<unit_value×ilość, integer>,' +
  '"category":"Elektronika|Nieruchomości|Inne",' +
  '"reasoning":"<max 15 słów>"}\n' +
  'Zasady: zawsze >0. Elektronika→ceny Allegro/OLX używane. Nieruchomości→PLN/m² 2026.';

async function valuateWithOpenAI(
  name:   string,
  qty:    number,
  signal: AbortSignal,
): Promise<ValuationResult> {
  const completion = await getOpenAI().chat.completions.create(
    {
      model:           'gpt-4o-mini',
      response_format: { type: 'json_object' },
      temperature:     0.1,
      max_tokens:      128,
      messages: [
        { role: 'system', content: PHYSICAL_PROMPT },
        { role: 'user',   content: `"${name}", ilość: ${qty}` },
      ],
    },
    { signal },
  );

  const raw = completion.choices[0]?.message?.content ?? '';

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    console.error('[valuate] OpenAI JSON parse failed. raw:', raw);
    return { ...FALLBACK, reasoning: 'Błąd parsowania odpowiedzi AI.' };
  }

  const rawUnit  = parsed.unit_value ?? parsed.unit_price;
  const unitPrice =
    typeof rawUnit === 'number' && rawUnit > 0 ? Math.round(rawUnit) : 0;

  const rawTotal  = parsed.value;
  const totalValue =
    typeof rawTotal === 'number' && rawTotal > 0
      ? Math.round(rawTotal)
      : unitPrice > 0
        ? Math.round(unitPrice * qty)
        : 0;

  if (totalValue === 0) {
    console.warn('[valuate] OpenAI returned 0 for:', name, '| raw:', raw);
    return FALLBACK;
  }

  const { db: suggestedCategory, ai: aiCategory } = resolveCategory(
    String(parsed.category ?? ''),
  );

  return {
    estimatedValue:    totalValue,
    unitPrice,
    currency:          'PLN',
    confidence:        'medium',
    source:            'OpenAI gpt-4o-mini',
    suggestedCategory,
    aiCategory,
    reasoning:
      typeof parsed.reasoning === 'string' && parsed.reasoning.length > 0
        ? parsed.reasoning
        : 'Wycena AI.',
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Estimates the total PLN value of `quantity` units of an asset named `itemName`.
 *
 * Uses an 8-second shared AbortController so the entire pipeline (Stage 1 + Stage 2)
 * can never exceed 8 s, leaving 2 s headroom inside Vercel Hobby's 10 s limit.
 */
export async function estimateValue(
  itemName: string,
  quantity = 1,
): Promise<ValuationResult> {
  const qty = Math.max(0.0001, quantity);

  const controller = new AbortController();
  const budgetTimer = setTimeout(() => controller.abort(), 8_000);

  try {
    // ── Stage 1: Classify the asset ──────────────────────────────────────────
    let classification: AssetClassification | null = null;
    try {
      classification = await classifyAsset(itemName, controller.signal);
      console.info(
        `[valuate] Classified "${itemName}" →`,
        `isFinancial=${classification.isFinancialAsset}`,
        `ticker=${classification.ticker}`,
        `category=${classification.category}`,
      );
    } catch (err) {
      console.warn('[valuate] Classification failed (falling back to OpenAI):', err);
    }

    // ── Stage 2A: Market data path ────────────────────────────────────────────
    if (classification?.isFinancialAsset && classification.ticker) {
      try {
        const result = await valuateFromMarket(
          classification.ticker,
          classification.category,
          itemName,
          qty,
          controller.signal,
        );
        if (result) {
          console.info(`[valuate] Market OK → ${result.estimatedValue} PLN`);
          return result;
        }
        console.warn(
          `[valuate] Yahoo Finance returned no price for "${classification.ticker}" – falling back to OpenAI`,
        );
      } catch (err) {
        console.warn(`[valuate] Market data error for "${classification.ticker}":`, err, '– falling back to OpenAI');
      }
    }

    // ── Stage 2B: OpenAI physical-asset path ──────────────────────────────────
    const result = await valuateWithOpenAI(itemName, qty, controller.signal);
    console.info(`[valuate] OpenAI OK → ${result.estimatedValue} PLN`);
    return result;

  } catch (err) {
    const isAbort =
      err instanceof Error && (err.name === 'AbortError' || controller.signal.aborted);

    console.error(
      `[valuate] ${isAbort ? 'TIMEOUT (>8 s)' : 'ERROR'} for "${itemName}":`,
      isAbort ? 'shared AbortController fired' : err,
    );

    return {
      ...FALLBACK,
      reasoning: isAbort
        ? 'Przekroczono czas wyceny (>8 s). Spróbuj ponownie.'
        : 'Błąd połączenia z serwisem wyceny. Spróbuj ponownie.',
    };
  } finally {
    clearTimeout(budgetTimer);
  }
}
