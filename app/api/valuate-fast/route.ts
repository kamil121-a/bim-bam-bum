/**
 * POST /api/valuate-fast
 *
 * Testowa, niezależna wycena bez OpenAI / Tavily.
 * Obsługuje wyłącznie tickery .US (Yahoo + NBP) oraz .PL (Stooq CSV).
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

async function fetchNbpUsdPln(): Promise<number | null> {
  try {
    const res = await fetch(
      'https://api.nbp.pl/api/exchangerates/rates/a/usd/?format=json',
      { ...FETCH_OPTS, signal: AbortSignal.timeout(8_000) },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { rates?: { mid?: number }[] };
    const mid = json.rates?.[0]?.mid;
    return typeof mid === 'number' && mid > 0 ? mid : null;
  } catch {
    return null;
  }
}

async function fetchYahooUsdPrice(symbol: string): Promise<number | null> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`,
      { ...FETCH_OPTS, signal: AbortSignal.timeout(8_000) },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as {
      chart?: { result?: { meta?: { regularMarketPrice?: number } }[] };
    };
    const price = json.chart?.result?.[0]?.meta?.regularMarketPrice;
    return typeof price === 'number' && price > 0 ? price : null;
  } catch {
    return null;
  }
}

async function fetchStooqPlPrice(ticker: string): Promise<number | null> {
  const symbol = ticker.replace(/\.PL$/i, '').toLowerCase();
  if (!symbol) return null;

  try {
    const url = `https://stooq.pl/q/l/?s=${encodeURIComponent(symbol)}&f=sd2t2opc1&e=csv`;
    const res = await fetch(url, {
      ...FETCH_OPTS,
      signal: AbortSignal.timeout(8_000),
      headers: {
        ...FETCH_OPTS.headers,
        Accept: 'text/csv,text/plain,*/*',
      },
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

  if (!ticker || quantity <= 0) {
    return fail();
  }

  if (ticker.endsWith('.US')) {
    const yahooSymbol = ticker.slice(0, -3);
    if (!yahooSymbol) return fail();

    const [usdPrice, usdPln] = await Promise.all([
      fetchYahooUsdPrice(yahooSymbol),
      fetchNbpUsdPln(),
    ]);

    if (usdPrice == null || usdPln == null) return fail();
    return ok(usdPrice * usdPln);
  }

  if (ticker.endsWith('.PL')) {
    const plnPrice = await fetchStooqPlPrice(ticker);
    if (plnPrice == null) return fail();
    return ok(plnPrice);
  }

  return fail();
}
