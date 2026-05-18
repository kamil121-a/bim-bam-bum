import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase';
import { estimateByDescription } from '@/lib/valuate';
import type { ValuationResult } from '@/lib/valuate';

export const maxDuration = 10;

// ─── Stooq ticker mapper ──────────────────────────────────────────────────────
//
// Converts XTB-style tickers to Stooq query symbols + target currency.
//
//   PKN.PL  → stooq="pkn"       currency=PLN  (GPW Warszawa)
//   AAPL.US → stooq="aapl.us"   currency=USD  (US exchanges)
//   BTC     → stooq="btcusd"    currency=USD  (crypto pair)
//   GOLD    → stooq="xauusd"    currency=USD  (commodity pair)

type StooqCurrency = 'PLN' | 'USD';

interface MappedTicker {
  stooqSymbol: string;
  currency:    StooqCurrency;
  aiCategory:  string;
}

const CRYPTO_TO_STOOQ: Record<string, string> = {
  BTC:  'btcusd',  ETH:  'ethusd',  SOL:  'solusd',
  XRP:  'xrpusd',  ADA:  'adausd',  DOGE: 'dogeusd',
  BNB:  'bnbusd',  LTC:  'ltcusd',  DOT:  'dotusd',
  AVAX: 'avaxusd', LINK: 'linkusd', ATOM: 'atomusd',
  XLM:  'xlmusd',  NEAR: 'nearusd', UNI:  'uniusd',
};

const METAL_TO_STOOQ: Record<string, string> = {
  GOLD:     'xauusd', XAU:      'xauusd',
  SILVER:   'xagusd', XAG:      'xagusd',
  PLATINUM: 'xptusd', PALLADIUM:'xpdusd',
};

function mapTicker(raw: string): MappedTicker {
  const t = raw.trim().toUpperCase();

  // Polish GPW: PKN.PL → stooq "pkn", price already in PLN
  if (t.endsWith('.PL')) {
    return { stooqSymbol: t.slice(0, -3).toLowerCase(), currency: 'PLN', aiCategory: 'Giełda' };
  }

  // US / global stocks: AAPL.US → stooq "aapl.us", price in USD
  if (t.endsWith('.US')) {
    return { stooqSymbol: t.toLowerCase(), currency: 'USD', aiCategory: 'Giełda' };
  }

  // Precious metals: GOLD → xauusd
  if (METAL_TO_STOOQ[t]) {
    return { stooqSymbol: METAL_TO_STOOQ[t], currency: 'USD', aiCategory: 'Metale' };
  }

  // Crypto: BTC → btcusd
  if (CRYPTO_TO_STOOQ[t]) {
    return { stooqSymbol: CRYPTO_TO_STOOQ[t], currency: 'USD', aiCategory: 'Krypto' };
  }

  // Fallback: bare ticker treated as USD instrument (e.g. "TSLA" bare)
  return { stooqSymbol: t.toLowerCase(), currency: 'USD', aiCategory: 'Giełda' };
}

// ─── Stooq CSV price fetch ────────────────────────────────────────────────────
//
// URL format:  https://stooq.pl/q/l/?s={symbol}&f=sd2t2opc1&e=csv
//
// CSV response (with header line via e=csv):
//   Symbol,Date,Time,Open,Close,Change,%Chg
//   PKN,2026-05-18,17:05:00,58.00,58.40,0.40,0.69
//
// The current price is the 4th value (index 3) in the data row.
// Invalid/unknown tickers return "N/D" instead of a number.

async function fetchStooqPrice(stooqSymbol: string): Promise<number | null> {
  const url = `https://stooq.pl/q/l/?s=${encodeURIComponent(stooqSymbol)}&f=sd2t2opc1&e=csv`;

  const res = await fetch(url, {
    signal: AbortSignal.timeout(7_000),
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Accept':     'text/csv,text/plain,*/*',
    },
  });

  if (!res.ok) {
    console.warn(`[stooq] HTTP ${res.status} dla "${stooqSymbol}"`);
    return null;
  }

  const text = await res.text();

  // Log the first two lines so the terminal shows exactly what Stooq returned
  const preview = text.split('\n').slice(0, 2).join(' | ');
  console.log(`[stooq] "${stooqSymbol}" → ${preview}`);

  const lines   = text.split('\n');
  const dataRow = lines[1]?.split(',') ?? [];

  // Index 3 = current price in the sd2t2opc1 CSV format
  const rawPrice = dataRow[3]?.trim() ?? '';

  if (!rawPrice || rawPrice === 'N/D' || rawPrice === '-') {
    console.warn(`[stooq] Ticker "${stooqSymbol}" nie znaleziony (N/D)`);
    return null;
  }

  const price = parseFloat(rawPrice);

  if (!isFinite(price) || price <= 0) {
    console.warn(`[stooq] Nieprawidłowa cena dla "${stooqSymbol}": "${rawPrice}"`);
    return null;
  }

  return price;
}

// ─── NBP USD/PLN rate ─────────────────────────────────────────────────────────

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

  // ── Parse body ───────────────────────────────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Nieprawidłowe dane żądania.' }, { status: 400 });
  }

  // ── Option B: opis / unikaty (Tavily + OpenAI) ───────────────────────────────
  if (body.mode === 'description') {
    const description = typeof body.description === 'string' ? body.description.trim() : '';
    if (description.length < 10) {
      return NextResponse.json(
        { error: 'Opis jest za krótki (minimum 10 znaków).' },
        { status: 400 },
      );
    }
    const result = await estimateByDescription(description);
    return NextResponse.json(result);
  }

  // ── Option A: ticker → Stooq → cena w PLN ───────────────────────────────────
  const ticker   = typeof body.ticker   === 'string' ? body.ticker.trim().toUpperCase() : '';
  const quantity = typeof body.quantity === 'number' && body.quantity > 0 ? body.quantity : 1;

  if (!ticker) {
    return NextResponse.json(
      { error: 'Brak tickera. Wpisz symbol, np. AAPL.US, PKN.PL lub BTC.' },
      { status: 400 },
    );
  }

  console.log(`[/api/valuate] Wykryto ticker: "${ticker}", quantity: ${quantity}`);

  const mapped = mapTicker(ticker);
  console.log(`[/api/valuate] Stooq symbol="${mapped.stooqSymbol}", waluta=${mapped.currency}`);

  try {
    // 1. Fetch raw price from Stooq
    const rawPrice = await fetchStooqPrice(mapped.stooqSymbol);

    if (!rawPrice) {
      return NextResponse.json(
        { error: `Nie znaleziono takiego tickera w bazie Stooq/XTB. Sprawdź symbol (np. AAPL.US, PKN.PL, BTC).` },
        { status: 422 },
      );
    }

    // 2. Convert USD → PLN if needed
    let unitPricePln: number;
    let rateInfo = '';

    if (mapped.currency === 'USD') {
      const usdPln = await fetchUsdPln();
      unitPricePln = rawPrice * usdPln;
      rateInfo     = ` × ${usdPln.toFixed(4)} USD/PLN`;
      console.log(`[/api/valuate] Kurs USD/PLN (NBP): ${usdPln.toFixed(4)}`);
    } else {
      unitPricePln = rawPrice;
    }

    const finalPrice    = parseFloat(unitPricePln.toFixed(2));
    const estimatedValue = Math.round(finalPrice * quantity);

    console.log(
      'Wykryto ticker:', ticker,
      '| Cena Stooq:', rawPrice, mapped.currency,
      '| Pobrana cena końcowa w PLN:', finalPrice,
      '| Wartość łączna:', estimatedValue,
    );

    const result: ValuationResult = {
      estimatedValue,
      unitPrice:         parseFloat(finalPrice.toFixed(2)),
      currency:          'PLN',
      confidence:        'high',
      source:            `Stooq.pl (${mapped.stooqSymbol.toUpperCase()})${mapped.currency === 'USD' ? ' + NBP USD/PLN' : ''}`,
      suggestedCategory: 'Finanse',
      aiCategory:        mapped.aiCategory,
      reasoning:         `${ticker}: ${rawPrice} ${mapped.currency}${rateInfo} = ${finalPrice.toLocaleString('pl-PL')} PLN/szt. × ${quantity} szt.`,
    };

    return NextResponse.json(result);

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Błąd pobierania ceny rynkowej.';
    console.error(`[/api/valuate] Błąd dla "${ticker}":`, msg);
    return NextResponse.json(
      { error: `Nie znaleziono takiego tickera na giełdzie. (${msg})` },
      { status: 422 },
    );
  }
}
