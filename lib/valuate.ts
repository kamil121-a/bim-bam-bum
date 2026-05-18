/**
 * Hybrid asset valuation:
 *  1. If the asset matches a known ticker → fetch real market price from Yahoo Finance
 *     + convert to PLN via NBP API (for USD-priced assets).
 *  2. Everything else → OpenAI gpt-4o-mini estimate (physical items, misc. assets).
 */

import yahooFinance from 'yahoo-finance2';
import OpenAI from 'openai';
import type { AssetCategory } from '@/types';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ValuationResult {
  estimatedValue: number; // total value in PLN (unitPrice × quantity)
  unitPrice: number;      // PLN per 1 unit
  currency: 'PLN';
  confidence: 'high' | 'medium' | 'low';
  source: string;
  suggestedCategory: AssetCategory;
  aiCategory: string;    // raw label shown to user
  reasoning: string;
}

// ─── Known financial assets map ───────────────────────────────────────────────

interface KnownAsset {
  patterns: string[];     // lowercase keywords/tickers that trigger this entry
  ticker: string;         // Yahoo Finance ticker symbol
  label: string;          // human-readable name shown in reasoning
  dbCategory: AssetCategory;
  aiCategory: string;
  /** Price returned by Yahoo Finance is already in PLN (GPW stocks ending in .WA). */
  isPLN?: boolean;
  /** Price is in USD per troy ounce; requires special unit handling. */
  isMetal?: boolean;
  /** Default unit assumed when name doesn't mention 'uncja'/'oz'.
   *  'g' = grams (gold), 'oz' = troy ounces (silver, platinum). */
  defaultUnit?: 'g' | 'oz';
}

const KNOWN_ASSETS: KnownAsset[] = [
  // ── Cryptocurrencies (USD) ──────────────────────────────────────────────────
  { patterns: ['bitcoin', 'btc'], ticker: 'BTC-USD', label: 'Bitcoin (BTC)', dbCategory: 'Finanse', aiCategory: 'Giełda/Krypto' },
  { patterns: ['ethereum', 'eth'], ticker: 'ETH-USD', label: 'Ethereum (ETH)', dbCategory: 'Finanse', aiCategory: 'Giełda/Krypto' },
  { patterns: ['solana', 'sol'], ticker: 'SOL-USD', label: 'Solana (SOL)', dbCategory: 'Finanse', aiCategory: 'Giełda/Krypto' },
  { patterns: ['ripple', 'xrp'], ticker: 'XRP-USD', label: 'Ripple (XRP)', dbCategory: 'Finanse', aiCategory: 'Giełda/Krypto' },
  { patterns: ['cardano', 'ada'], ticker: 'ADA-USD', label: 'Cardano (ADA)', dbCategory: 'Finanse', aiCategory: 'Giełda/Krypto' },
  { patterns: ['dogecoin', 'doge'], ticker: 'DOGE-USD', label: 'Dogecoin (DOGE)', dbCategory: 'Finanse', aiCategory: 'Giełda/Krypto' },
  { patterns: ['litecoin', 'ltc'], ticker: 'LTC-USD', label: 'Litecoin (LTC)', dbCategory: 'Finanse', aiCategory: 'Giełda/Krypto' },
  { patterns: ['chainlink', 'link'], ticker: 'LINK-USD', label: 'Chainlink (LINK)', dbCategory: 'Finanse', aiCategory: 'Giełda/Krypto' },
  { patterns: ['polkadot', 'dot'], ticker: 'DOT-USD', label: 'Polkadot (DOT)', dbCategory: 'Finanse', aiCategory: 'Giełda/Krypto' },
  { patterns: ['binance coin', 'bnb'], ticker: 'BNB-USD', label: 'BNB', dbCategory: 'Finanse', aiCategory: 'Giełda/Krypto' },
  { patterns: ['avalanche', 'avax'], ticker: 'AVAX-USD', label: 'Avalanche (AVAX)', dbCategory: 'Finanse', aiCategory: 'Giełda/Krypto' },
  { patterns: ['shiba inu', 'shib'], ticker: 'SHIB-USD', label: 'Shiba Inu (SHIB)', dbCategory: 'Finanse', aiCategory: 'Giełda/Krypto' },

  // ── US Indices & ETFs ───────────────────────────────────────────────────────
  { patterns: ['s&p 500', 'sp500', 's&p500', 'spx', 'spy etf'], ticker: 'SPY', label: 'S&P 500 ETF (SPY)', dbCategory: 'Finanse', aiCategory: 'Giełda/Krypto' },
  { patterns: ['nasdaq 100', 'nasdaq100', 'qqq', 'ndx'], ticker: 'QQQ', label: 'NASDAQ 100 ETF (QQQ)', dbCategory: 'Finanse', aiCategory: 'Giełda/Krypto' },
  { patterns: ['voo', 'vanguard s&p'], ticker: 'VOO', label: 'Vanguard S&P 500 (VOO)', dbCategory: 'Finanse', aiCategory: 'Giełda/Krypto' },
  { patterns: ['dow jones', 'djia', 'dia etf'], ticker: 'DIA', label: 'Dow Jones ETF (DIA)', dbCategory: 'Finanse', aiCategory: 'Giełda/Krypto' },
  { patterns: ['vti', 'vanguard total market'], ticker: 'VTI', label: 'Vanguard Total Market (VTI)', dbCategory: 'Finanse', aiCategory: 'Giełda/Krypto' },

  // ── US Stocks ───────────────────────────────────────────────────────────────
  { patterns: ['apple', 'aapl'], ticker: 'AAPL', label: 'Apple (AAPL)', dbCategory: 'Finanse', aiCategory: 'Giełda/Krypto' },
  { patterns: ['microsoft', 'msft'], ticker: 'MSFT', label: 'Microsoft (MSFT)', dbCategory: 'Finanse', aiCategory: 'Giełda/Krypto' },
  { patterns: ['google', 'alphabet', 'googl', 'goog'], ticker: 'GOOGL', label: 'Alphabet/Google (GOOGL)', dbCategory: 'Finanse', aiCategory: 'Giełda/Krypto' },
  { patterns: ['amazon', 'amzn'], ticker: 'AMZN', label: 'Amazon (AMZN)', dbCategory: 'Finanse', aiCategory: 'Giełda/Krypto' },
  { patterns: ['tesla', 'tsla'], ticker: 'TSLA', label: 'Tesla (TSLA)', dbCategory: 'Finanse', aiCategory: 'Giełda/Krypto' },
  { patterns: ['nvidia', 'nvda'], ticker: 'NVDA', label: 'NVIDIA (NVDA)', dbCategory: 'Finanse', aiCategory: 'Giełda/Krypto' },
  { patterns: ['meta', 'facebook', 'meta platforms'], ticker: 'META', label: 'Meta (META)', dbCategory: 'Finanse', aiCategory: 'Giełda/Krypto' },
  { patterns: ['berkshire', 'brk-b', 'brk b'], ticker: 'BRK-B', label: 'Berkshire Hathaway B (BRK-B)', dbCategory: 'Finanse', aiCategory: 'Giełda/Krypto' },
  { patterns: ['jpmorgan', 'jpm', 'jp morgan'], ticker: 'JPM', label: 'JPMorgan Chase (JPM)', dbCategory: 'Finanse', aiCategory: 'Giełda/Krypto' },
  { patterns: ['visa'], ticker: 'V', label: 'Visa (V)', dbCategory: 'Finanse', aiCategory: 'Giełda/Krypto' },
  { patterns: ['mastercard', 'ma akcje'], ticker: 'MA', label: 'Mastercard (MA)', dbCategory: 'Finanse', aiCategory: 'Giełda/Krypto' },
  { patterns: ['netflix', 'nflx'], ticker: 'NFLX', label: 'Netflix (NFLX)', dbCategory: 'Finanse', aiCategory: 'Giełda/Krypto' },
  { patterns: ['amd', 'advanced micro devices'], ticker: 'AMD', label: 'AMD', dbCategory: 'Finanse', aiCategory: 'Giełda/Krypto' },
  { patterns: ['intel', 'intc'], ticker: 'INTC', label: 'Intel (INTC)', dbCategory: 'Finanse', aiCategory: 'Giełda/Krypto' },
  { patterns: ['palantir', 'pltr'], ticker: 'PLTR', label: 'Palantir (PLTR)', dbCategory: 'Finanse', aiCategory: 'Giełda/Krypto' },
  { patterns: ['coinbase', 'coin akcje'], ticker: 'COIN', label: 'Coinbase (COIN)', dbCategory: 'Finanse', aiCategory: 'Giełda/Krypto' },
  { patterns: ['uber'], ticker: 'UBER', label: 'Uber (UBER)', dbCategory: 'Finanse', aiCategory: 'Giełda/Krypto' },
  { patterns: ['airbnb', 'abnb'], ticker: 'ABNB', label: 'Airbnb (ABNB)', dbCategory: 'Finanse', aiCategory: 'Giełda/Krypto' },
  { patterns: ['spotify', 'spot'], ticker: 'SPOT', label: 'Spotify (SPOT)', dbCategory: 'Finanse', aiCategory: 'Giełda/Krypto' },

  // ── Polish stocks (GPW – price already in PLN) ──────────────────────────────
  { patterns: ['orlen', 'pkn orlen', 'pkn'], ticker: 'PKN.WA', label: 'PKN Orlen (GPW)', dbCategory: 'Finanse', aiCategory: 'Giełda/Krypto', isPLN: true },
  { patterns: ['pko', 'pko bp'], ticker: 'PKO.WA', label: 'PKO BP (GPW)', dbCategory: 'Finanse', aiCategory: 'Giełda/Krypto', isPLN: true },
  { patterns: ['cd projekt', 'cdp', 'cdpr'], ticker: 'CDR.WA', label: 'CD Projekt (GPW)', dbCategory: 'Finanse', aiCategory: 'Giełda/Krypto', isPLN: true },
  { patterns: ['allegro'], ticker: 'ALE.WA', label: 'Allegro (GPW)', dbCategory: 'Finanse', aiCategory: 'Giełda/Krypto', isPLN: true },
  { patterns: ['kghm'], ticker: 'KGH.WA', label: 'KGHM (GPW)', dbCategory: 'Finanse', aiCategory: 'Giełda/Krypto', isPLN: true },
  { patterns: ['pzu'], ticker: 'PZU.WA', label: 'PZU (GPW)', dbCategory: 'Finanse', aiCategory: 'Giełda/Krypto', isPLN: true },
  { patterns: ['lpp'], ticker: 'LPP.WA', label: 'LPP (GPW)', dbCategory: 'Finanse', aiCategory: 'Giełda/Krypto', isPLN: true },
  { patterns: ['dino', 'dno'], ticker: 'DNO.WA', label: 'Dino Polska (GPW)', dbCategory: 'Finanse', aiCategory: 'Giełda/Krypto', isPLN: true },
  { patterns: ['santander pl', 'bzwbk', 'wig20'], ticker: 'SPL.WA', label: 'Santander Bank Polska (GPW)', dbCategory: 'Finanse', aiCategory: 'Giełda/Krypto', isPLN: true },

  // ── Precious metals (Yahoo Finance futures – USD per troy ounce) ────────────
  // Gold: default quantity unit = grams (most common in Poland)
  {
    patterns: ['złoto', 'gold', 'xau'],
    ticker: 'GC=F',
    label: 'Złoto',
    dbCategory: 'Finanse',
    aiCategory: 'Metale',
    isMetal: true,
    defaultUnit: 'g',
  },
  // Silver: default quantity unit = troy ounces (silver coins/bars standard)
  {
    patterns: ['srebro', 'silver', 'xag'],
    ticker: 'SI=F',
    label: 'Srebro',
    dbCategory: 'Finanse',
    aiCategory: 'Metale',
    isMetal: true,
    defaultUnit: 'oz',
  },
  // Platinum: default = troy ounces
  {
    patterns: ['platyna', 'platinum', 'xpt'],
    ticker: 'PL=F',
    label: 'Platyna',
    dbCategory: 'Finanse',
    aiCategory: 'Metale',
    isMetal: true,
    defaultUnit: 'oz',
  },
];

// ─── NBP USD/PLN rate (cached at module level – reused across warm invocations) ─

let _nbpCache: { rate: number; ts: number } | null = null;
const NBP_TTL_MS = 30 * 60 * 1000; // 30 minutes

async function getUsdPln(): Promise<number> {
  if (_nbpCache && Date.now() - _nbpCache.ts < NBP_TTL_MS) {
    return _nbpCache.rate;
  }
  const res = await fetch(
    'https://api.nbp.pl/api/exchangerates/rates/a/usd/?format=json',
    { signal: AbortSignal.timeout(4_000), headers: { Accept: 'application/json' } },
  );
  if (!res.ok) throw new Error(`NBP API error ${res.status}`);
  const data = await res.json() as { rates: Array<{ mid: number }> };
  const rate = data.rates[0].mid;
  _nbpCache = { rate, ts: Date.now() };
  return rate;
}

// ─── Yahoo Finance price fetcher ──────────────────────────────────────────────

async function getMarketPrice(ticker: string): Promise<number | null> {
  try {
    // validateResult:false prevents crashes on minor schema deviations in Yahoo's response.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const quote: any = await yahooFinance.quote(ticker, {}, { validateResult: false });
    const price = quote?.regularMarketPrice as unknown;
    return typeof price === 'number' && price > 0 ? price : null;
  } catch (err) {
    console.warn(`[valuate] Yahoo Finance failed for ${ticker}:`, err);
    return null;
  }
}

// ─── Asset classifier ─────────────────────────────────────────────────────────

function findKnownAsset(name: string): KnownAsset | null {
  const normalized = name.toLowerCase();
  for (const asset of KNOWN_ASSETS) {
    for (const pattern of asset.patterns) {
      // Match as word boundary to avoid false positives (e.g. "sol" in "solartechnik")
      const re = new RegExp(`(^|[\\s,.(/-])${escapeRegex(pattern)}([\\s,.(/-]|$)`);
      if (re.test(normalized)) return asset;
    }
  }
  // Also match standalone uppercase tickers (e.g. user types "AAPL", "BTC", "MSFT")
  const upperInput = name.trim().toUpperCase();
  for (const asset of KNOWN_ASSETS) {
    for (const pattern of asset.patterns) {
      if (pattern.toUpperCase() === upperInput) return asset;
    }
    // Match the ticker itself
    if (asset.ticker.replace('-USD', '').replace('.WA', '') === upperInput) return asset;
  }
  return null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── Market-data valuation ────────────────────────────────────────────────────

const TROY_OZ_TO_G = 31.1035;

async function valuateFromMarket(
  asset: KnownAsset,
  name: string,
  qty: number,
): Promise<ValuationResult | null> {
  // Fetch market price + USD/PLN rate in parallel
  const [spotPrice, usdPln] = await Promise.all([
    getMarketPrice(asset.ticker),
    asset.isPLN ? Promise.resolve(1) : getUsdPln(),
  ]);

  if (!spotPrice) return null;

  let unitPricePln: number;
  let reasoningDetail: string;

  if (asset.isMetal) {
    // Determine whether user's quantity is in grams or troy ounces
    const nl = name.toLowerCase();
    const isOz = nl.includes('uncja') || nl.includes(' oz') || nl.includes('oz)') || nl.includes('/oz');
    const useGrams = !isOz && asset.defaultUnit === 'g';

    if (useGrams) {
      unitPricePln = Math.round((spotPrice / TROY_OZ_TO_G) * usdPln);
      reasoningDetail =
        `Kurs spot ${asset.label}: ${spotPrice.toFixed(2)} USD/oz ÷ ${TROY_OZ_TO_G} g/oz × kurs NBP USD/PLN ${usdPln.toFixed(4)} = ${unitPricePln.toLocaleString('pl-PL')} PLN/g`;
    } else {
      unitPricePln = Math.round(spotPrice * usdPln);
      reasoningDetail =
        `Kurs spot ${asset.label}: ${spotPrice.toFixed(2)} USD/oz × kurs NBP USD/PLN ${usdPln.toFixed(4)} = ${unitPricePln.toLocaleString('pl-PL')} PLN/oz`;
    }
  } else if (asset.isPLN) {
    unitPricePln = Math.round(spotPrice);
    reasoningDetail = `Kurs ${asset.label} na GPW: ${spotPrice.toFixed(2)} PLN/szt. (Yahoo Finance)`;
  } else {
    // USD-priced: stock, crypto, ETF
    unitPricePln = Math.round(spotPrice * usdPln);
    reasoningDetail =
      `Kurs ${asset.label}: ${spotPrice.toFixed(2)} USD × kurs NBP USD/PLN ${usdPln.toFixed(4)} = ${unitPricePln.toLocaleString('pl-PL')} PLN/szt.`;
  }

  const totalValue = Math.round(unitPricePln * qty);

  return {
    estimatedValue: totalValue,
    unitPrice: unitPricePln,
    currency: 'PLN',
    confidence: 'high',
    source: `Yahoo Finance (${asset.ticker})${asset.isPLN ? '' : ' + NBP USD/PLN'}`,
    suggestedCategory: asset.dbCategory,
    aiCategory: asset.aiCategory,
    reasoning: reasoningDetail,
  };
}

// ─── OpenAI fallback ──────────────────────────────────────────────────────────

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

const SYSTEM_PROMPT =
  'Wyceniaj aktywa w PLN (rok 2026). Odpowiedz TYLKO poprawnym JSON:\n' +
  '{"unit_value":<PLN za 1 szt., integer>,"value":<unit_value×ilość, integer>,' +
  '"category":"Elektronika|Nieruchomości|Inne",' +
  '"reasoning":"<max 15 słów>"}\n' +
  'Zasady: zawsze >0. Elektronika→ceny Allegro/OLX używane. Nieruchomości→PLN/m² 2026.';

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

const FALLBACK: ValuationResult = {
  estimatedValue: 0,
  unitPrice: 0,
  currency: 'PLN',
  confidence: 'low',
  source: 'Błąd wyceny',
  suggestedCategory: 'Inne',
  aiCategory: 'Inne',
  reasoning: 'Nie udało się pobrać wyceny. Wartość ustawiona tymczasowo na 0 PLN.',
};

async function valuateWithOpenAI(name: string, qty: number): Promise<ValuationResult> {
  const signal = AbortSignal.timeout(8_000);
  const completion = await getOpenAI().chat.completions.create(
    {
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: 128,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
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
    return { ...FALLBACK, reasoning: `Błąd parsowania odpowiedzi AI.` };
  }

  const rawUnit = parsed.unit_value ?? parsed.unit_price;
  const unitPrice =
    typeof rawUnit === 'number' && rawUnit > 0 ? Math.round(rawUnit) : 0;

  const rawTotal = parsed.value;
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
    estimatedValue: totalValue,
    unitPrice,
    currency: 'PLN',
    confidence: 'medium',
    source: 'OpenAI gpt-4o-mini',
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
 * Strategy:
 *  1. Detect known financial assets (stocks, crypto, metals, ETFs).
 *  2. Fetch real-time price from Yahoo Finance + NBP USD/PLN rate.
 *  3. If lookup fails or asset is unrecognised → fall back to OpenAI.
 *  4. On any error → return FALLBACK with estimatedValue = 0.
 */
export async function estimateValue(
  itemName: string,
  quantity = 1,
): Promise<ValuationResult> {
  const qty = Math.max(0.0001, quantity);

  // ── Step 1: Try real-time market data ───────────────────────────────────────
  const knownAsset = findKnownAsset(itemName);
  if (knownAsset) {
    try {
      const result = await valuateFromMarket(knownAsset, itemName, qty);
      if (result) {
        console.info(
          `[valuate] Market data OK for "${itemName}" → ${result.estimatedValue} PLN`,
        );
        return result;
      }
      console.warn(`[valuate] Market data returned null for "${itemName}", falling back to OpenAI`);
    } catch (err) {
      console.warn(`[valuate] Market data error for "${itemName}":`, err, '→ falling back to OpenAI');
    }
  }

  // ── Step 2: OpenAI for physical / unrecognised assets ───────────────────────
  try {
    const result = await valuateWithOpenAI(itemName, qty);
    console.info(
      `[valuate] OpenAI OK for "${itemName}" → ${result.estimatedValue} PLN`,
    );
    return result;
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    console.error(
      `[valuate] ${isTimeout ? 'TIMEOUT (>8 s)' : 'ERROR'} for "${itemName}":`,
      isTimeout ? 'AbortSignal fired' : err,
    );
    return {
      ...FALLBACK,
      reasoning: isTimeout
        ? 'Przekroczono czas wyceny (>8 s). Spróbuj ponownie.'
        : 'Błąd połączenia z OpenAI. Spróbuj ponownie.',
    };
  }
}
