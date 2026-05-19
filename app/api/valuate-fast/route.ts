/**
 * POST /api/valuate-fast
 *
 * Testowa, niezależna wycena bez OpenAI / Tavily.
 * Yahoo + NBP (.US, .UK, .DE, bare US), Stooq (.PL / .WA), CoinGecko, NBP złoto/waluty, metals.live.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseUserForApiRoute } from '@/lib/supabase';

export const maxDuration = 10;

const FETCH_OPTS: RequestInit = {
  headers: {
    'User-Agent': 'Mozilla/5.0 (compatible; WealthTracker/1.0)',
    Accept: '*/*',
  },
};

const CRYPTO_TICKER_TO_CG: Record<string, string> = {
  BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana',
  XRP: 'ripple', ADA: 'cardano', DOGE: 'dogecoin',
  BNB: 'binancecoin', LTC: 'litecoin', DOT: 'polkadot',
  AVAX: 'avalanche-2', LINK: 'chainlink', TON: 'toncoin',
  SHIB: 'shiba-inu', MATIC: 'polygon', UNI: 'uniswap',
  ATOM: 'cosmos', XLM: 'stellar', NEAR: 'near',
  PEPE: 'pepe', ARB: 'arbitrum', OP: 'optimism',
  INJ: 'injective', BONK: 'bonk', XMR: 'monero',
  TRX: 'tron', FIL: 'filecoin', AAVE: 'aave',
};

const METAL_TICKER_TO_SLUG: Record<string, string> = {
  GOLD: 'gold', XAU: 'gold',
  SILVER: 'silver', XAG: 'silver',
  PLATINUM: 'platinum', XPT: 'platinum',
  PALLADIUM: 'palladium', XPD: 'palladium',
  COPPER: 'copper', XCU: 'copper',
};

const CASH_CURRENCIES = new Set(['PLN', 'USD', 'EUR', 'GBP', 'CHF', 'CZK', 'NOK', 'SEK', 'DKK', 'JPY', 'CAD', 'AUD']);

type FastMarket = 'yahoo' | 'gpw' | 'crypto' | 'metal_gold' | 'metal_spot' | 'cash';

interface YahooQuote {
  price: number;
  currency: string;
}

function fail(): NextResponse {
  return NextResponse.json({ success: false });
}

function ok(unitPricePLN: number): NextResponse {
  if (!Number.isFinite(unitPricePLN) || unitPricePLN <= 0) {
    return fail();
  }
  return NextResponse.json({
    success: true,
    unitPricePLN: parseFloat(unitPricePLN.toFixed(4)),
  });
}

function parseFastTicker(raw: string): { market: FastMarket; apiId: string } | null {
  const t = raw.trim().toUpperCase();
  if (!t) return null;

  if (t === 'PLN' || CASH_CURRENCIES.has(t)) {
    return { market: 'cash', apiId: t };
  }

  const metalSlug = METAL_TICKER_TO_SLUG[t];
  if (metalSlug) {
    return metalSlug === 'gold'
      ? { market: 'metal_gold', apiId: metalSlug }
      : { market: 'metal_spot', apiId: metalSlug };
  }

  const cgId = CRYPTO_TICKER_TO_CG[t];
  if (cgId) return { market: 'crypto', apiId: cgId };

  if (t.endsWith('.PL') || t.endsWith('.WA')) {
    return { market: 'gpw', apiId: t.replace(/\.(PL|WA)$/i, '').toLowerCase() };
  }

  // UK (XTB .UK) → Yahoo LSE: IWDA.UK → IWDA.L
  if (t.endsWith('.UK')) {
    const base = t.slice(0, -3);
    return base ? { market: 'yahoo', apiId: `${base}.L` } : null;
  }

  // Niemcy (XTB .DE) → Yahoo Xetra: SAP.DE
  if (t.endsWith('.DE')) {
    const base = t.slice(0, -3);
    return base ? { market: 'yahoo', apiId: `${base}.DE` } : null;
  }

  if (t.endsWith('.US')) {
    const base = t.slice(0, -3);
    return base ? { market: 'yahoo', apiId: base } : null;
  }

  // Bare symbol — Yahoo (US / global)
  if (/^[A-Z0-9.\-]{1,12}$/.test(t)) {
    return { market: 'yahoo', apiId: t };
  }

  return null;
}

async function fetchNbpRate(currency: string): Promise<number | null> {
  const code = currency.toLowerCase();
  if (code === 'pln') return 1;
  try {
    const res = await fetch(
      `https://api.nbp.pl/api/exchangerates/rates/a/${encodeURIComponent(code)}/?format=json`,
      { ...FETCH_OPTS, signal: AbortSignal.timeout(8_000), headers: { Accept: 'application/json' } },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { rates?: { mid?: number }[] };
    const mid = json.rates?.[0]?.mid;
    return typeof mid === 'number' && mid > 0 ? mid : null;
  } catch {
    return null;
  }
}

async function fetchNbpUsdPln(): Promise<number | null> {
  return fetchNbpRate('usd');
}

/** GBp/GBX = pensy; GBP = funty. */
function normalizeYahooMoney(quote: YahooQuote): { amount: number; nbpCurrency: string } | null {
  const rawCur = (quote.currency || 'USD').trim();
  const upper = rawCur.toUpperCase();
  let amount = quote.price;
  let nbpCurrency: string;

  if (upper === 'PLN') {
    return { amount, nbpCurrency: 'pln' };
  }
  if (rawCur === 'GBp' || upper === 'GBX') {
    amount = amount / 100;
    nbpCurrency = 'gbp';
  } else if (upper === 'GBP') {
    nbpCurrency = 'gbp';
  } else if (upper === 'EUR') {
    nbpCurrency = 'eur';
  } else if (upper === 'USD') {
    nbpCurrency = 'usd';
  } else if (upper === 'CHF') {
    nbpCurrency = 'chf';
  } else {
    nbpCurrency = 'usd';
  }

  if (!Number.isFinite(amount) || amount <= 0) return null;
  return { amount, nbpCurrency };
}

async function fetchYahooQuote(yahooSymbol: string): Promise<YahooQuote | null> {
  try {
    const url =
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}` +
      '?interval=1d&range=5d';
    const res = await fetch(url, { ...FETCH_OPTS, signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return null;

    const json = (await res.json()) as {
      chart?: {
        error?: unknown;
        result?: {
          meta?: {
            currency?: string | null;
            regularMarketPrice?: number;
            chartPreviousClose?: number;
            previousClose?: number;
          };
          indicators?: { quote?: Array<{ close?: (number | null)[] }> };
        }[];
      };
    };

    if (json.chart?.error) return null;
    const result = json.chart?.result?.[0];
    const meta = result?.meta;
    if (!meta) return null;

    let price = meta.regularMarketPrice;
    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
      price = meta.chartPreviousClose;
    }
    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
      price = meta.previousClose;
    }
    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
      const closes = result.indicators?.quote?.[0]?.close?.filter(
        (x): x is number => typeof x === 'number' && Number.isFinite(x) && x > 0,
      );
      if (closes?.length) price = closes[closes.length - 1]!;
    }

    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return null;

    const currency = (meta.currency ?? 'USD').trim();
    return { price, currency: currency || 'USD' };
  } catch {
    return null;
  }
}

async function fetchYahooPricePln(yahooSymbol: string): Promise<number | null> {
  const quote = await fetchYahooQuote(yahooSymbol);
  if (!quote) return null;

  const normalized = normalizeYahooMoney(quote);
  if (!normalized) return null;

  const rate = await fetchNbpRate(normalized.nbpCurrency);
  if (rate == null) return null;

  return normalized.amount * rate;
}

async function fetchStooqPln(symbol: string): Promise<number | null> {
  const sym = symbol.toLowerCase();
  if (!sym) return null;

  try {
    const url = `https://stooq.pl/q/l/?s=${encodeURIComponent(sym)}&f=sd2t2opc1&e=csv`;
    const res = await fetch(url, {
      ...FETCH_OPTS,
      signal: AbortSignal.timeout(8_000),
      headers: { ...FETCH_OPTS.headers, Accept: 'text/csv,text/plain,*/*' },
    });
    if (!res.ok) return null;

    const text = await res.text();
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return null;

    const cols = lines[1].split(';');
    const raw = cols[3]?.trim().replace(',', '.') ?? '';
    if (!raw || raw === 'N/D' || raw === '-') return null;

    const price = parseFloat(raw);
    return Number.isFinite(price) && price > 0 ? price : null;
  } catch {
    return null;
  }
}

async function fetchGoldPlnPerGram(): Promise<number | null> {
  try {
    const res = await fetch('https://api.nbp.pl/api/cenyzlota/?format=json', {
      ...FETCH_OPTS,
      signal: AbortSignal.timeout(8_000),
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{ cena?: number }>;
    const price = data[0]?.cena;
    return typeof price === 'number' && price > 0 ? price : null;
  } catch {
    return null;
  }
}

async function fetchMetalUsd(slug: string): Promise<number | null> {
  try {
    const res = await fetch(`https://api.metals.live/v1/spot/${slug}`, {
      ...FETCH_OPTS,
      signal: AbortSignal.timeout(8_000),
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const raw = await res.json();
    let price: unknown;
    if (typeof raw === 'number') {
      price = raw;
    } else if (Array.isArray(raw) && raw.length > 0) {
      price = raw[0][slug] ?? raw[0].price ?? raw[0].rate;
    } else if (raw && typeof raw === 'object') {
      const o = raw as Record<string, unknown>;
      price = o[slug] ?? o.price ?? o.rate;
    }
    return typeof price === 'number' && price > 0 ? price : null;
  } catch {
    return null;
  }
}

async function fetchCryptoPln(coingeckoId: string): Promise<number | null> {
  try {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(coingeckoId)}&vs_currencies=pln&precision=2`;
    const res = await fetch(url, {
      ...FETCH_OPTS,
      signal: AbortSignal.timeout(8_000),
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, { pln?: number }>;
    const price = data[coingeckoId]?.pln;
    return typeof price === 'number' && price > 0 ? price : null;
  } catch {
    return null;
  }
}

async function priceByMarket(parsed: { market: FastMarket; apiId: string }): Promise<number | null> {
  switch (parsed.market) {
    case 'cash':
      return fetchNbpRate(parsed.apiId);

    case 'metal_gold':
      return fetchGoldPlnPerGram();

    case 'metal_spot': {
      const [spotUsd, usdPln] = await Promise.all([
        fetchMetalUsd(parsed.apiId),
        fetchNbpUsdPln(),
      ]);
      if (spotUsd == null || usdPln == null) return null;
      return spotUsd * usdPln;
    }

    case 'crypto':
      return fetchCryptoPln(parsed.apiId);

    case 'gpw':
      return fetchStooqPln(parsed.apiId);

    case 'yahoo':
      return fetchYahooPricePln(parsed.apiId);

    default:
      return null;
  }
}

export async function POST(request: NextRequest) {
  const { supabase } = await getSupabaseUserForApiRoute(request);
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return fail();
  }

  const ticker =
    typeof body.ticker === 'string' ? body.ticker.trim().toUpperCase() : '';
  const quantity =
    typeof body.quantity === 'number' && body.quantity > 0 ? body.quantity : 1;
  const category = typeof body.category === 'string' ? body.category : '';

  if (!ticker || quantity <= 0) {
    return fail();
  }

  // Gotówka: nazwa aktywa to kod waluty (USD, EUR…)
  if (category === 'Gotówka') {
    const currency = ticker.length === 3 ? ticker : ticker.split(/\s+/)[0]?.slice(0, 3) ?? ticker;
    const rate = await fetchNbpRate(currency);
    if (rate == null) return fail();
    return ok(rate);
  }

  const parsed = parseFastTicker(ticker);
  if (!parsed) return fail();

  const unitPrice = await priceByMarket(parsed);
  if (unitPrice == null) return fail();

  return ok(unitPrice);
}
