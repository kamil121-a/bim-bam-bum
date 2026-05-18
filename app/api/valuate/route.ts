/**
 * Option A – ticker / ISIN → market price (zero AI, zero Stooq)
 *
 * Data sources:
 *   Stocks (GPW/US/global) → Twelve Data  (TWELVE_DATA_API_KEY)
 *   ISIN lookup            → Twelve Data  /stocks endpoint
 *   Crypto                 → CoinGecko    (free, no key)
 *   Currency conversion    → NBP          (free, official PL source)
 *
 * Option B – description → Tavily + OpenAI (unchanged)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase';
import { estimateByDescription } from '@/lib/valuate';
import type { ValuationResult } from '@/lib/valuate';

export const maxDuration = 10;

// ─── CoinGecko ID mapping ─────────────────────────────────────────────────────

const CRYPTO_TO_CG: Record<string, string> = {
  BTC:   'bitcoin',       ETH:   'ethereum',     SOL:   'solana',
  XRP:   'ripple',        ADA:   'cardano',       DOGE:  'dogecoin',
  BNB:   'binancecoin',   LTC:   'litecoin',      DOT:   'polkadot',
  AVAX:  'avalanche-2',   LINK:  'chainlink',     ATOM:  'cosmos',
  XLM:   'stellar',       NEAR:  'near',          UNI:   'uniswap',
  MATIC: 'polygon',       SHIB:  'shiba-inu',     TON:   'toncoin',
};

// ─── Ticker classification ────────────────────────────────────────────────────

type MarketKind = 'polish' | 'us' | 'crypto' | 'isin_pl' | 'isin_foreign';

interface Classified {
  kind:     MarketKind;
  symbol:   string;   // cleaned ticker or raw ISIN
  cgId?:    string;   // set only when kind === 'crypto'
}

function classify(raw: string): Classified {
  const t = raw.trim().toUpperCase().replace(/\s+/g, '');

  // ISIN: exactly 12 chars, first two are alpha country code
  if (/^[A-Z]{2}[A-Z0-9]{10}$/.test(t)) {
    return { kind: t.startsWith('PL') ? 'isin_pl' : 'isin_foreign', symbol: t };
  }

  // Known crypto
  if (CRYPTO_TO_CG[t]) return { kind: 'crypto', symbol: t, cgId: CRYPTO_TO_CG[t] };

  // XTB-style suffixes
  if (t.endsWith('.PL')) return { kind: 'polish', symbol: t.slice(0, -3) };
  if (t.endsWith('.US')) return { kind: 'us',     symbol: t.slice(0, -3) };

  // Bare ticker → treat as US/global (Twelve Data resolves most majors)
  return { kind: 'us', symbol: t };
}

// ─── Twelve Data helpers ──────────────────────────────────────────────────────

/** Resolve ISIN → { symbol, exchange } via Twelve Data /stocks endpoint */
async function resolveIsin(
  isin:   string,
  apiKey: string,
): Promise<{ symbol: string; exchange: string } | null> {
  try {
    const url = `https://api.twelvedata.com/stocks?isin=${encodeURIComponent(isin)}&apikey=${apiKey}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6_000) });
    if (!res.ok) return null;

    const data = await res.json() as { data?: { symbol: string; exchange: string }[] };
    const hit  = data.data?.[0];
    if (!hit) return null;

    console.log(`[valuate] ISIN ${isin} → ${hit.symbol} (${hit.exchange})`);
    return { symbol: hit.symbol, exchange: hit.exchange };
  } catch {
    return null;
  }
}

/** Fetch latest price from Twelve Data /price endpoint */
async function fetchTwelvePrice(
  symbol:   string,
  exchange: string | null,
  apiKey:   string,
): Promise<number | null> {
  try {
    const params = new URLSearchParams({ symbol, apikey: apiKey });
    if (exchange) params.set('exchange', exchange);

    const url = `https://api.twelvedata.com/price?${params.toString()}`;
    console.log(`[TwelveData] GET ${url}`);

    const res = await fetch(url, {
      signal:  AbortSignal.timeout(7_000),
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      console.warn(`[TwelveData] HTTP ${res.status}`);
      return null;
    }

    const data = await res.json() as { price?: string; status?: string; code?: number; message?: string };

    if (data.status === 'error' || data.code || !data.price) {
      console.warn('[TwelveData] Error:', data.message ?? 'no price field');
      return null;
    }

    const price = parseFloat(data.price);
    if (!isFinite(price) || price <= 0) return null;

    console.log(`[TwelveData] ${symbol}${exchange ? ':' + exchange : ''} = ${price}`);
    return price;
  } catch (err) {
    console.warn('[TwelveData] fetch error:', err instanceof Error ? err.message : err);
    return null;
  }
}

// ─── CoinGecko helper ─────────────────────────────────────────────────────────

async function fetchCryptoPln(cgId: string): Promise<number | null> {
  try {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(cgId)}&vs_currencies=pln`;
    const res = await fetch(url, { signal: AbortSignal.timeout(7_000) });
    if (!res.ok) return null;

    const data  = await res.json() as Record<string, { pln?: number }>;
    const price = data[cgId]?.pln;

    if (!price || price <= 0) return null;

    console.log(`[CoinGecko] ${cgId} = ${price} PLN`);
    return price;
  } catch {
    return null;
  }
}

// ─── NBP USD/PLN helper ───────────────────────────────────────────────────────

async function fetchUsdPln(): Promise<number> {
  const res = await fetch(
    'https://api.nbp.pl/api/exchangerates/rates/a/usd/?format=json',
    { signal: AbortSignal.timeout(5_000) },
  );
  if (!res.ok) throw new Error(`NBP HTTP ${res.status}`);
  const data = await res.json() as { rates: { mid: number }[] };
  return data.rates[0].mid;
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // ── Auth ─────────────────────────────────────────────────────────────────────
  const supabase = createSupabaseServerClient(request);
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── Body ─────────────────────────────────────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Nieprawidłowe dane żądania.' }, { status: 400 });
  }

  // ── Option B: opis / unikaty ──────────────────────────────────────────────────
  if (body.mode === 'description') {
    const description = typeof body.description === 'string' ? body.description.trim() : '';
    if (description.length < 10) {
      return NextResponse.json({ error: 'Opis jest za krótki (minimum 10 znaków).' }, { status: 400 });
    }
    return NextResponse.json(await estimateByDescription(description));
  }

  // ── Option A: ticker / ISIN → cena rynkowa ───────────────────────────────────
  const ticker   = typeof body.ticker   === 'string' ? body.ticker.trim().toUpperCase() : '';
  const quantity = typeof body.quantity === 'number' && body.quantity > 0 ? body.quantity : 1;

  if (!ticker) {
    return NextResponse.json(
      { success: false, error: 'Brak tickera. Wpisz symbol, np. AAPL.US, PKN.PL, BTC lub kod ISIN.' },
      { status: 400 },
    );
  }

  console.log(`[valuate] Ticker: "${ticker}", qty: ${quantity}`);

  try {
    const hit = classify(ticker);
    console.log(`[valuate] Rozpoznano: kind=${hit.kind}, symbol=${hit.symbol}`);

    // ── Crypto (CoinGecko) ───────────────────────────────────────────────────
    if (hit.kind === 'crypto') {
      const pricePln = await fetchCryptoPln(hit.cgId!);
      if (!pricePln) throw new Error('Nie znaleziono ceny kryptowaluty w CoinGecko.');

      const total = Math.round(pricePln * quantity);
      console.log(`Wykryto ticker: ${ticker} | Pobrana cena końcowa w PLN: ${pricePln}`);

      return NextResponse.json({
        estimatedValue:    total,
        unitPrice:         Math.round(pricePln),
        currency:          'PLN',
        confidence:        'high',
        source:            `CoinGecko (${hit.cgId})`,
        suggestedCategory: 'Finanse',
        aiCategory:        'Krypto',
        reasoning:         `${ticker}: ${pricePln.toLocaleString('pl-PL')} PLN/szt.`,
      } as ValuationResult);
    }

    // ── Stocks & ISIN (Twelve Data) ──────────────────────────────────────────
    const apiKey = process.env.TWELVE_DATA_API_KEY ?? '';
    if (!apiKey) throw new Error('TWELVE_DATA_API_KEY nie jest skonfigurowany w zmiennych środowiskowych.');

    let tdSymbol:   string      = hit.symbol;
    let tdExchange: string|null = null;
    let priceCurrency: 'PLN' | 'USD' =
      (hit.kind === 'polish' || hit.kind === 'isin_pl') ? 'PLN' : 'USD';

    // ISIN → resolve to symbol + exchange
    if (hit.kind === 'isin_pl' || hit.kind === 'isin_foreign') {
      const resolved = await resolveIsin(hit.symbol, apiKey);
      if (!resolved) throw new Error(`Nie znaleziono spółki dla kodu ISIN: ${ticker}`);
      tdSymbol   = resolved.symbol;
      tdExchange = resolved.exchange;
    }

    // Polish GPW: hint the exchange so Twelve Data picks the right listing
    if (hit.kind === 'polish') tdExchange = 'WAW';

    const rawPrice = await fetchTwelvePrice(tdSymbol, tdExchange, apiKey);
    if (!rawPrice) throw new Error(`Nie znaleziono podanego symbolu (Sprawdź ticker XTB lub kod ISIN)`);

    // Convert USD → PLN if needed
    let unitPricePln: number;
    let rateInfo = '';

    if (priceCurrency === 'USD') {
      const usdPln = await fetchUsdPln();
      unitPricePln = rawPrice * usdPln;
      rateInfo     = ` × ${usdPln.toFixed(4)} USD/PLN`;
      console.log(`[valuate] Kurs USD/PLN (NBP): ${usdPln.toFixed(4)}`);
    } else {
      unitPricePln = rawPrice;
    }

    const finalPrice     = parseFloat(unitPricePln.toFixed(2));
    const estimatedValue = Math.round(finalPrice * quantity);

    console.log(
      `Wykryto ticker: ${ticker} | Cena ${priceCurrency}: ${rawPrice} |`,
      `Pobrana cena końcowa w PLN: ${finalPrice} | Wartość łączna: ${estimatedValue}`,
    );

    const sourceLabel = `${tdSymbol}${tdExchange ? ':' + tdExchange : ''}`;

    return NextResponse.json({
      estimatedValue,
      unitPrice:         finalPrice,
      currency:          'PLN',
      confidence:        'high',
      source:            `Twelve Data (${sourceLabel})${priceCurrency === 'USD' ? ' + NBP USD/PLN' : ''}`,
      suggestedCategory: 'Finanse',
      aiCategory:        hit.kind === 'isin_pl' || hit.kind === 'polish' ? 'Giełda' : 'Giełda',
      reasoning:         `${ticker}: ${rawPrice} ${priceCurrency}${rateInfo} = ${finalPrice.toLocaleString('pl-PL')} PLN/szt. × ${quantity} szt.`,
    } as ValuationResult);

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Błąd pobierania ceny rynkowej.';
    console.error(`[valuate] Błąd dla "${ticker}":`, msg);
    return NextResponse.json(
      { success: false, error: `Nie znaleziono podanego symbolu (Sprawdź ticker XTB lub kod ISIN)` },
      { status: 422 },
    );
  }
}
