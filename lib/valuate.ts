/**
 * Two-stage AI Routing valuation pipeline
 *
 * Stage 1 – AI Classifier  (gpt-4o-mini, temperature=0, max_tokens=100)
 *   Classifies the user's input and extracts:
 *     • isFinancialAsset – whether it's a traded instrument
 *     • ticker           – Yahoo Finance symbol (e.g. AAPL, BTC-USD, GC=F)
 *     • multiplier       – unit conversion factor (critical for metals:
 *                          if user enters grams, multiplier = 0.03215 g→oz
 *                          so the formula works with Yahoo Finance's $/oz price)
 *     • category         – 'Giełda/Krypto' | 'Metale' | 'Inne'
 *
 * Stage 2A – Market Path  (ticker resolved)
 *   price  = Yahoo Finance regularMarketPrice   (USD/oz for metals, USD/share for stocks)
 *   value  = (price × multiplier) × qty × usdPln
 *   PLN rate from NBP API (cached 30 min per warm instance).
 *
 * Stage 2B – OpenAI Path  (physical / unrecognised asset)
 *   gpt-4o-mini estimates PLN value using Allegro/OLX/RE market data.
 *
 * Total budget: 8 s AbortController shared across both stages (Vercel Hobby ≤ 10 s).
 */

import yahooFinance from 'yahoo-finance2';
import OpenAI from 'openai';
import type { AssetCategory } from '@/types';

// ─── Exported result type ─────────────────────────────────────────────────────

export interface ValuationResult {
  estimatedValue: number; // total PLN (unitPrice × quantity)
  unitPrice:      number; // PLN per 1 user-unit (gram, share, etc.)
  currency:       'PLN';
  confidence:     'high' | 'medium' | 'low';
  source:         string;
  suggestedCategory: AssetCategory;
  aiCategory:        string;
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

// ─── Fallback ─────────────────────────────────────────────────────────────────

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

// ─── NBP USD/PLN (module-level cache) ─────────────────────────────────────────

let _nbpCache: { rate: number; ts: number } | null = null;
const NBP_TTL_MS = 30 * 60 * 1000;

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

// ─── Yahoo Finance ────────────────────────────────────────────────────────────

async function getMarketPrice(ticker: string): Promise<number | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const quote: any = await yahooFinance.quote(ticker, {}, { validateResult: false });
    const price = quote?.regularMarketPrice as unknown;
    return typeof price === 'number' && price > 0 ? price : null;
  } catch (err) {
    console.warn(`[valuate] Yahoo Finance error for "${ticker}":`, err);
    return null;
  }
}

// ─── Ticker metadata ──────────────────────────────────────────────────────────

const METAL_TICKERS = new Set(['GC=F', 'SI=F', 'PL=F', 'HG=F', 'PA=F']);

const METAL_LABELS: Record<string, string> = {
  'GC=F': 'Złoto',
  'SI=F': 'Srebro',
  'PL=F': 'Platyna',
  'HG=F': 'Miedź',
  'PA=F': 'Pallad',
};

function isMetal(ticker: string) { return METAL_TICKERS.has(ticker.toUpperCase()); }
function isGPW(ticker: string)   { return ticker.toUpperCase().endsWith('.WA'); }
function isPLN(ticker: string)   { return isGPW(ticker); }

function getLabel(ticker: string): string {
  return METAL_LABELS[ticker.toUpperCase()] ?? ticker;
}

// ─── Stage 1 – AI Classifier ──────────────────────────────────────────────────

interface AssetClassification {
  isFinancialAsset: boolean;
  ticker:           string | null;
  /** Unit-conversion multiplier.
   *  For metals: converts the user's unit to Yahoo Finance's unit (troy oz).
   *  Example: user enters grams → multiplier = 0.03215 (1 g = 0.03215 troy oz)
   *  For stocks/ETFs/crypto: always 1.0 (no conversion needed).
   *  Formula: finalValueUSD = spotPrice × multiplier × userQty */
  multiplier:       number;
  category:         string; // 'Giełda/Krypto' | 'Metale' | 'Inne'
}

const CLASSIFY_PROMPT = `Przeanalizuj wpis użytkownika (np. "10 jednostek złota", "srebro 5 uncji", "Apple 2 akcje", "Bitcoin") i rozbij go na precyzyjne składowe giełdowe.

Twoim NAJWAŻNIEJSZYM zadaniem jest poprawna obsługa metali szlachetnych:
- Giełda podaje ceny metali za UNCJĘ TROJAŃSKĄ (oz). Twój multiplier musi to uwzględniać.
- Jeśli użytkownik podał ilość w GRAMACH (lub napisał "złoto"/"srebro" bez jednostki → domyślnie gramy): multiplier = 0.03215 (przelicznik g→oz).
- Jeśli użytkownik podał ilość w UNCJACH (wpisał "uncja", "oz", "troy"): multiplier = 1.
- Jeśli wpisał "jednostek" bez sprecyzowania przy złocie → przyjmij gramy (multiplier = 0.03215).

Zwróć WYŁĄCZNIE czysty JSON (bez żadnego tekstu poza JSON):
{
  "isFinancialAsset": <boolean>,
  "ticker": <string|null>,
  "multiplier": <number>,
  "category": <"Giełda/Krypto"|"Metale"|"Inne">
}

Zasady tickerów (Yahoo Finance):
- ZŁOTO → ZAWSZE "GC=F"
- SREBRO → ZAWSZE "SI=F"
- PLATYNA → ZAWSZE "PL=F"
- PALLAD → ZAWSZE "PA=F"
- MIEDŹ → ZAWSZE "HG=F"
- Krypto: BTC-USD, ETH-USD, SOL-USD, XRP-USD, ADA-USD, DOGE-USD, BNB-USD, AVAX-USD itd.
- ETF/Indeksy US: SPY (S&P 500), QQQ (NASDAQ 100), VOO, VTI, DIA itd.
- Akcje US: AAPL, MSFT, GOOGL, AMZN, TSLA, NVDA, META, JPM, V, MA, NFLX, AMD, PLTR, UBER, COIN itd.
- GPW Polska: PKN.WA (Orlen), PKO.WA, CDR.WA (CD Projekt), ALE.WA (Allegro), KGH.WA (KGHM), PZU.WA, LPP.WA, DNO.WA (Dino) itd.
- Dla akcji/ETF/krypto: multiplier = 1

Przykłady:
"10 gramów złota"       → {"isFinancialAsset":true,"ticker":"GC=F","multiplier":0.03215,"category":"Metale"}
"złoto 5"               → {"isFinancialAsset":true,"ticker":"GC=F","multiplier":0.03215,"category":"Metale"}
"10 jednostek złota"    → {"isFinancialAsset":true,"ticker":"GC=F","multiplier":0.03215,"category":"Metale"}
"złoto 2 uncje"         → {"isFinancialAsset":true,"ticker":"GC=F","multiplier":1,"category":"Metale"}
"srebro 5 oz"           → {"isFinancialAsset":true,"ticker":"SI=F","multiplier":1,"category":"Metale"}
"srebro 50 gramów"      → {"isFinancialAsset":true,"ticker":"SI=F","multiplier":0.03215,"category":"Metale"}
"Apple 3 akcje"         → {"isFinancialAsset":true,"ticker":"AAPL","multiplier":1,"category":"Giełda/Krypto"}
"0.5 BTC"               → {"isFinancialAsset":true,"ticker":"BTC-USD","multiplier":1,"category":"Giełda/Krypto"}
"S&P 500 ETF"           → {"isFinancialAsset":true,"ticker":"SPY","multiplier":1,"category":"Giełda/Krypto"}
"Orlen akcje"           → {"isFinancialAsset":true,"ticker":"PKN.WA","multiplier":1,"category":"Giełda/Krypto"}
"Słuchawki Sony"        → {"isFinancialAsset":false,"ticker":null,"multiplier":1,"category":"Inne"}
"MacBook Pro M4"        → {"isFinancialAsset":false,"ticker":null,"multiplier":1,"category":"Inne"}
"mieszkanie 50m²"       → {"isFinancialAsset":false,"ticker":null,"multiplier":1,"category":"Inne"}`;

async function classifyAsset(
  name: string,
  signal: AbortSignal,
): Promise<AssetClassification> {
  const completion = await getOpenAI().chat.completions.create(
    {
      model:           'gpt-4o-mini',
      response_format: { type: 'json_object' },
      temperature:     0,
      max_tokens:      100,
      messages: [
        { role: 'system', content: CLASSIFY_PROMPT },
        { role: 'user',   content: name },
      ],
    },
    { signal },
  );

  const raw = completion.choices[0]?.message?.content ?? '{}';
  const parsed = JSON.parse(raw) as Partial<AssetClassification>;

  const multiplierRaw = parsed.multiplier;
  const multiplier =
    typeof multiplierRaw === 'number' && multiplierRaw > 0 ? multiplierRaw : 1;

  return {
    isFinancialAsset: parsed.isFinancialAsset === true,
    ticker:
      typeof parsed.ticker === 'string' && parsed.ticker.length > 0
        ? parsed.ticker.trim().toUpperCase()
        : null,
    multiplier,
    category: typeof parsed.category === 'string' ? parsed.category : 'Inne',
  };
}

// ─── Stage 2A – Market valuation ──────────────────────────────────────────────

async function valuateFromMarket(
  ticker:     string,
  multiplier: number,
  aiCategory: string,
  qty:        number,
  signal:     AbortSignal,
): Promise<ValuationResult | null> {
  const isPlnAsset = isPLN(ticker);
  const label      = getLabel(ticker);

  // Fetch real-time price and USD/PLN rate in parallel
  const [spotPrice, usdPln] = await Promise.all([
    getMarketPrice(ticker),
    isPlnAsset ? Promise.resolve(1) : getUsdPln(signal),
  ]);

  if (!spotPrice) return null;

  const safeMultiplier = multiplier > 0 ? multiplier : 1;

  /**
   * Core formula:
   *   valuePerUserUnit (USD) = spotPrice × multiplier
   *   unitPricePLN            = valuePerUserUnit × usdPln
   *   totalValue              = unitPricePLN × qty
   *
   * For metals: spotPrice = USD/troy oz, multiplier = user_unit→oz
   *   e.g. gold in grams: spotPrice=3200, multiplier=0.03215 → 102.9 USD/g → ~406 PLN/g
   * For stocks/ETF/crypto: multiplier = 1, spotPrice = current share/coin price in USD
   * For GPW stocks: isPlnAsset=true, usdPln=1
   */
  const unitPricePln = isPlnAsset
    ? Math.round(spotPrice * safeMultiplier)
    : Math.round(spotPrice * safeMultiplier * usdPln);

  const totalValue = Math.round(unitPricePln * qty);

  let reasoning: string;
  if (isMetal(ticker)) {
    const isGrams = safeMultiplier < 0.9; // multiplier < 1 means grams (0.03215)
    const unitLabel = isGrams ? 'g' : 'oz';
    if (isPlnAsset) {
      reasoning = `Kurs spot ${label}: ${spotPrice.toFixed(2)} PLN/oz × ${safeMultiplier.toFixed(5)} (→${unitLabel}) = ${unitPricePln.toLocaleString('pl-PL')} PLN/${unitLabel}`;
    } else {
      reasoning = `Kurs spot ${label} (${ticker}): ${spotPrice.toFixed(2)} USD/oz × ${safeMultiplier === 1 ? '1 (uncja)' : `${safeMultiplier.toFixed(5)} (g→oz)`} × kurs NBP USD/PLN ${usdPln.toFixed(4)} = ${unitPricePln.toLocaleString('pl-PL')} PLN/${unitLabel}`;
    }
  } else if (isPlnAsset) {
    reasoning = `Pobrano aktualny kurs giełdowy dla tickera ${ticker} z Yahoo Finance: ${spotPrice.toFixed(2)} PLN/szt.`;
  } else {
    reasoning = `Pobrano aktualny kurs giełdowy dla tickera ${ticker} z Yahoo Finance: ${spotPrice.toFixed(2)} USD × kurs NBP USD/PLN ${usdPln.toFixed(4)} = ${unitPricePln.toLocaleString('pl-PL')} PLN/szt.`;
  }

  const { db: suggestedCategory, ai: resolvedAiCategory } = resolveCategory(
    isMetal(ticker) ? 'Metale' : aiCategory,
  );

  return {
    estimatedValue:    totalValue,
    unitPrice:         unitPricePln,
    currency:          'PLN',
    confidence:        'high',
    source:            `Yahoo Finance (${ticker})${isPlnAsset ? '' : ' + NBP USD/PLN'}`,
    suggestedCategory,
    aiCategory:        resolvedAiCategory,
    reasoning,
  };
}

// ─── Stage 2B – OpenAI (physical assets) ─────────────────────────────────────

const PHYSICAL_PROMPT =
  'Wyceniaj fizyczne aktywa w PLN (rok 2026). Odpowiedz TYLKO poprawnym JSON:\n' +
  '{"unit_value":<PLN za 1 szt., integer>,"value":<unit_value×ilość, integer>,' +
  '"category":"Elektronika|Nieruchomości|Inne","reasoning":"<max 15 słów>"}\n' +
  'Zasady: zawsze >0. Elektronika→Allegro/OLX używane. Nieruchomości→PLN/m² 2026.';

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

  const rawUnit   = parsed.unit_value ?? parsed.unit_price;
  const unitPrice = typeof rawUnit === 'number' && rawUnit > 0 ? Math.round(rawUnit) : 0;

  const rawTotal   = parsed.value;
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
 * Shared 8-second AbortController spans the entire pipeline (Stage 1 + 2),
 * guaranteeing we never exceed Vercel Hobby's 10-second serverless limit.
 */
export async function estimateValue(
  itemName: string,
  quantity = 1,
): Promise<ValuationResult> {
  const qty = Math.max(0.0001, quantity);

  const controller  = new AbortController();
  const budgetTimer = setTimeout(() => controller.abort(), 8_000);

  try {
    // ── Stage 1: Classify ────────────────────────────────────────────────────
    let cls: AssetClassification | null = null;
    try {
      cls = await classifyAsset(itemName, controller.signal);
      console.info(
        `[valuate] Classified "${itemName}" →`,
        `isFinancial=${cls.isFinancialAsset}`,
        `ticker=${cls.ticker}`,
        `multiplier=${cls.multiplier}`,
        `category=${cls.category}`,
      );
    } catch (err) {
      console.warn('[valuate] Classification failed → OpenAI fallback:', err);
    }

    // ── Stage 2A: Market data ────────────────────────────────────────────────
    if (cls?.isFinancialAsset && cls.ticker) {
      try {
        const result = await valuateFromMarket(
          cls.ticker,
          cls.multiplier,
          cls.category,
          qty,
          controller.signal,
        );
        if (result) {
          console.info(`[valuate] Market OK → ${result.estimatedValue} PLN`);
          return result;
        }
        console.warn(
          `[valuate] Yahoo Finance returned no price for "${cls.ticker}" → OpenAI fallback`,
        );
      } catch (err) {
        console.warn(`[valuate] Market data error for "${cls.ticker}":`, err, '→ OpenAI fallback');
      }
    }

    // ── Stage 2B: OpenAI ─────────────────────────────────────────────────────
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
