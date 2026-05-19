'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import Navigation from '@/components/Navigation';
import CategoryBadge from '@/components/CategoryBadge';
import { formatPLN } from '@/components/AssetCard';
import type { AssetCategory } from '@/types';
import { ASSET_CATEGORIES } from '@/types';
import {
  Search,
  Hash,
  Sparkles,
  CheckCircle,
  RotateCcw,
  ChevronDown,
  Lock,
  PenLine,
  TrendingUp,
  FileText,
  Banknote,
} from 'lucide-react';
import { fetchWithSupabaseAuth } from '@/lib/supabase';
import { useSupabaseBrowser } from '@/lib/use-supabase-browser';

// ── Types ─────────────────────────────────────────────────────────────────────

type Mode = 'market' | 'description' | 'cash';
type Step = 'input' | 'valuating' | 'confirm' | 'saving' | 'saved';

interface ValuationResult {
  estimatedValue:      number;
  unitPrice:           number;
  currency:            string;
  confidence:          'high' | 'medium' | 'low';
  source:              string;
  suggestedCategory:   AssetCategory;
  aiCategory:          string;
  reasoning:           string;
  requiresManualPrice?: boolean;
  // Real estate / vehicle
  isRealEstate?:       boolean;
  isVehicle?:          boolean;
  pricePerM2?:         number;
  area?:               number;
  priceRange?:         { low: number; mid: number; high: number };
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CONFIDENCE_LABEL: Record<string, string> = {
  high:   'Giełdowa',
  medium: 'Szacunkowa AI',
  low:    'Manualna',
};

const CONFIDENCE_COLOR: Record<string, string> = {
  high:   'text-emerald-600 bg-emerald-50 border-emerald-200',
  medium: 'text-amber-600  bg-amber-50  border-amber-200',
  low:    'text-violet-600 bg-violet-50 border-violet-200',
};

const MARKET_EXAMPLES: Array<{ label: string; ticker: string; qty: string }> = [
  { label: 'S&P 500',    ticker: 'SPY.US',  qty: '10'  },
  { label: 'Bitcoin',    ticker: 'BTC',     qty: '0.5' },
  { label: 'Ethereum',   ticker: 'ETH',     qty: '1'   },
  { label: 'Złoto (g)',  ticker: 'GOLD',    qty: '10'  },
  { label: 'Srebro (oz)',ticker: 'SILVER',  qty: '5'   },
  { label: 'Apple',      ticker: 'AAPL.US', qty: '3'   },
  { label: 'NVIDIA',     ticker: 'NVDA.US', qty: '1'   },
  { label: 'Tesla',      ticker: 'TSLA.US', qty: '2'   },
  { label: 'Orlen',      ticker: 'PKN.PL',  qty: '10'  },
  { label: 'PKO BP',     ticker: 'PKO.PL',  qty: '20'  },
  { label: 'Allegro',    ticker: 'ALE.PL',  qty: '5'   },
];

const DESC_EXAMPLES = [
  'Stara moneta 2 złote z 1995 roku, stan menniczy, w oryginalnym etui kolekcjonerskim',
  'Mieszkanie w centrum Krakowa, 45m2, 4 piętro, wysoki standard wykończenia, balkon, garaż',
  'Zegarek Rolex Submariner rocznik 2020, stalowy, stan bardzo dobry, kompletny zestaw',
  'BMW 320d xDrive 2019, 120 tys. km, pierwszy właściciel, serwis ASO',
  'iPhone 15 Pro 256GB, kolor tytanowy, używany 6 miesięcy, stan idealny, oryginalne opakowanie',
];

const CASH_CURRENCIES: Array<{ code: string; name: string; flag: string }> = [
  { code: 'PLN', name: 'Złoty polski', flag: '🇵🇱' },
  { code: 'USD', name: 'Dolar USA',    flag: '🇺🇸' },
  { code: 'EUR', name: 'Euro',         flag: '🇪🇺' },
  { code: 'DKK', name: 'Korona duń.',  flag: '🇩🇰' },
];

// ── Component ─────────────────────────────────────────────────────────────────

export default function AddAssetPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const supabase = useSupabaseBrowser();

  // Mode
  const [mode, setMode] = useState<Mode>('market');

  // Shared state
  const [step,        setStep]        = useState<Step>('input');
  const [valuation,   setValuation]   = useState<ValuationResult | null>(null);
  const [category,    setCategory]    = useState<AssetCategory>('Inne');
  const [manualValue, setManualValue] = useState('');
  const [error,       setError]       = useState('');

  // Real estate / vehicle tiered price variant
  const [priceVariant, setPriceVariant] = useState<'low' | 'mid' | 'high'>('mid');

  // Market-mode state (ticker = XTB-style symbol, e.g. AAPL.US, PKN.PL, BTC)
  const [ticker,   setTicker]   = useState('');
  const [quantity, setQuantity] = useState('1');

  // Description-mode state
  const [description, setDescription] = useState('');

  // Cash-mode state
  const [cashCurrency, setCashCurrency] = useState('PLN');
  const [cashAmount,   setCashAmount]   = useState('');

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [user, loading, router]);

  // ── Switch mode ──────────────────────────────────────────────────────────────

  const handleSwitchMode = (m: Mode) => {
    setMode(m);
    setStep('input');
    setError('');
    setTicker('');
    setDescription('');
    setCashAmount('');
  };

  // ── Valuate helpers ──────────────────────────────────────────────────────────

  const applyValuationResult = (data: ValuationResult) => {
    setValuation(data);
    setCategory(data.suggestedCategory);
    setManualValue('');
    setPriceVariant('mid');
    setStep('confirm');
  };

  const handleValuateError = (err: unknown) => {
    console.error('[add-asset] valuate error:', err);
    const msg =
      err instanceof Error ? err.message : 'Błąd połączenia. Sprawdź internet i spróbuj ponownie.';
    setError(msg);
    setStep('input');
  };

  // ── Valuate: Market / Ticker (Option A – no AI) ──────────────────────────────

  const handleValuateMarket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (step === 'valuating') return;

    const t = ticker.trim().toUpperCase();
    if (!t) {
      setError('Wpisz ticker, np. AAPL.US, PKN.PL lub BTC.');
      return;
    }
    const qty = parseFloat(quantity);
    if (isNaN(qty) || qty <= 0) {
      setError('Podaj prawidłową ilość (większą niż 0).');
      return;
    }

    setError('');
    setStep('valuating');

    try {
      const res = await fetchWithSupabaseAuth(supabase, '/api/valuate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ticker: t, quantity: qty }),
      });

      if (res.status === 401) { router.replace('/login'); return; }
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error ?? `Ticker nie znaleziony (HTTP ${res.status})`);
      }
      applyValuationResult(await res.json());
    } catch (err) {
      handleValuateError(err);
    }
  };

  // ── Valuate: Description (Option B) ─────────────────────────────────────────

  const handleValuateDescription = async (e: React.FormEvent) => {
    e.preventDefault();
    if (step === 'valuating') return;

    if (description.trim().length < 10) {
      setError('Opis jest za krótki (min. 10 znaków). Im więcej szczegółów, tym dokładniejsza wycena.');
      return;
    }

    setError('');
    setStep('valuating');

    try {
      const res = await fetchWithSupabaseAuth(supabase, '/api/valuate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ mode: 'description', description: description.trim() }),
      });

      if (res.status === 401) { router.replace('/login'); return; }
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error ?? `Błąd HTTP ${res.status}`);
      }
      applyValuationResult(await res.json());
    } catch (err) {
      handleValuateError(err);
    }
  };

  // ── Valuate: Cash (Option C – NBP exchange rate) ─────────────────────────────

  const handleValuateCash = async (e: React.FormEvent) => {
    e.preventDefault();
    if (step === 'valuating') return;

    const amt = parseFloat(cashAmount);
    if (isNaN(amt) || amt <= 0) {
      setError('Podaj kwotę większą od 0.');
      return;
    }

    setError('');
    setStep('valuating');

    try {
      const res = await fetchWithSupabaseAuth(supabase, '/api/valuate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ mode: 'cash', currency: cashCurrency, amount: amt }),
      });

      if (res.status === 401) { router.replace('/login'); return; }
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error ?? `Błąd HTTP ${res.status}`);
      }
      applyValuationResult(await res.json());
    } catch (err) {
      handleValuateError(err);
    }
  };

  // ── Save ─────────────────────────────────────────────────────────────────────

  const handleConfirm = async () => {
    if (!valuation || step === 'saving') return;

    let saveValue: number;
    if (valuation.requiresManualPrice) {
      saveValue = parseFloat(manualValue);
      if (isNaN(saveValue) || saveValue <= 0) {
        setError('Podaj szacowaną wartość przedmiotu (musi być > 0 PLN).');
        return;
      }
    } else if (
      valuation.priceRange &&
      !valuation.requiresManualPrice &&
      (valuation.isRealEstate || valuation.isVehicle)
    ) {
      saveValue = valuation.priceRange[priceVariant];
    } else {
      saveValue = valuation.estimatedValue;
      if (saveValue <= 0) {
        setError('Brak wyceny do zatwierdzenia.');
        return;
      }
    }
    const finalValue = saveValue;

    // Asset name: market → ticker; cash → currency code; description → first 200 chars
    const assetName =
      mode === 'market'      ? ticker.trim().toUpperCase() :
      mode === 'cash'        ? cashCurrency :
      description.trim().slice(0, 200);

    // Quantity: cash → amount; description → 1; market → typed qty
    const assetQty =
      mode === 'cash'        ? (parseFloat(cashAmount) || 1) :
      mode === 'market'      ? (parseFloat(quantity)   || 1) :
      1;

    setError('');
    setStep('saving');

    try {
      const res = await fetchWithSupabaseAuth(supabase, '/api/assets', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          name:      assetName,
          category,
          value:     Math.round(finalValue),
          quantity:  assetQty,
          reasoning: valuation.reasoning,
        }),
      });

      const d = await res.json().catch(() => ({}));

      if (res.status === 401) { router.replace('/login'); return; }

      if (!res.ok) {
        const msg = (d as { error?: string }).error ?? `Błąd zapisu (HTTP ${res.status}).`;
        console.error('[add-asset] save failed:', d);
        setError(msg);
        setStep('confirm');
        return;
      }

      setStep('saved');
    } catch (err) {
      console.error('[add-asset] save error:', err);
      setError('Błąd połączenia z bazą danych. Spróbuj ponownie.');
      setStep('confirm');
    }
  };

  // ── Reset ────────────────────────────────────────────────────────────────────

  const handleReset = () => {
    setStep('input');
    setTicker('');
    setQuantity('1');
    setDescription('');
    setCashAmount('');
    setValuation(null);
    setManualValue('');
    setPriceVariant('mid');
    setError('');
  };

  // ── Derived values ────────────────────────────────────────────────────────────

  const displayQty  =
    mode === 'cash'    ? (parseFloat(cashAmount) || 1) :
    mode === 'market'  ? (parseFloat(quantity)   || 1) :
    1;
  const displayName =
    mode === 'cash'    ? cashCurrency :
    mode === 'market'  ? ticker.trim().toUpperCase() :
    (description.slice(0, 70) + (description.length > 70 ? '…' : ''));
  const isManual        = valuation?.requiresManualPrice === true;
  const tieredPricing   = valuation?.priceRange &&
    !valuation.requiresManualPrice &&
    ((valuation.isRealEstate === true) || (valuation.isVehicle === true));
  const selectedRange   = tieredPricing ? (valuation!.priceRange![priceVariant]) : undefined;
  const finalValue      = isManual
                            ? (parseFloat(manualValue) || 0)
                            : tieredPricing
                              ? (selectedRange ?? valuation?.estimatedValue ?? 0)
                              : (valuation?.estimatedValue ?? 0);
  const showBreakdown = !isManual && valuation && valuation.unitPrice > 0 && displayQty !== 1;

  if (loading) {
    return (
      <>
        <Navigation />
        <div className="min-h-screen flex items-center justify-center">
          <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
        </div>
      </>
    );
  }

  return (
    <>
      <Navigation />
      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-8">

        <div className="mb-6">
          <h2 className="text-2xl font-bold text-slate-100">Dodaj nowe aktywo</h2>
          <p className="text-slate-500 mt-1">Wybierz sposób wyceny odpowiedni dla swojego aktywa.</p>
        </div>

        {/* ── Mode tabs (only on input / valuating) ── */}
        {(step === 'input' || step === 'valuating') && (
          <div className="grid grid-cols-3 gap-2 mb-6">
            <button
              type="button"
              onClick={() => handleSwitchMode('market')}
              className={`flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl border font-medium text-xs transition-colors ${
                mode === 'market'
                  ? 'bg-indigo-600 text-white border-indigo-600 shadow-md shadow-indigo-200'
                  : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}
            >
              <TrendingUp className="w-4 h-4" />
              Giełda / Kruszce
            </button>
            <button
              type="button"
              onClick={() => handleSwitchMode('cash')}
              className={`flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl border font-medium text-xs transition-colors ${
                mode === 'cash'
                  ? 'bg-emerald-600 text-white border-emerald-600 shadow-md shadow-emerald-200'
                  : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}
            >
              <Banknote className="w-4 h-4" />
              Gotówka / Waluty
            </button>
            <button
              type="button"
              onClick={() => handleSwitchMode('description')}
              className={`flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl border font-medium text-xs transition-colors ${
                mode === 'description'
                  ? 'bg-violet-600 text-white border-violet-600 shadow-md shadow-violet-200'
                  : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}
            >
              <FileText className="w-4 h-4" />
              Opis / Unikaty
            </button>
          </div>
        )}

        {/* ── Step: Input / Valuating ── */}
        {(step === 'input' || step === 'valuating') && (
          <div className="bg-slate-800 rounded-2xl border border-slate-700/60 shadow-xl p-8">

            {/* ── OPTION A: Ticker / Market (no AI) ── */}
            {mode === 'market' && (
              <form onSubmit={handleValuateMarket} className="space-y-5">
                <div className="text-sm text-slate-400 bg-indigo-500/10 border border-indigo-500/20 rounded-xl px-4 py-3 space-y-1">
                  <p className="font-medium text-indigo-300">Format tickerów:</p>
                  <p>Akcje US: <code className="bg-indigo-500/20 px-1 rounded text-xs text-indigo-300">AAPL.US</code> &nbsp; GPW: <code className="bg-indigo-500/20 px-1 rounded text-xs text-indigo-300">PKN.PL</code> &nbsp; Krypto: <code className="bg-indigo-500/20 px-1 rounded text-xs text-indigo-300">BTC</code> &nbsp; Metale: <code className="bg-indigo-500/20 px-1 rounded text-xs text-indigo-300">GOLD</code></p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Ticker / Symbol</label>
                  <div className="relative">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
                    <input
                      type="text"
                      value={ticker}
                      onChange={e => setTicker(e.target.value.toUpperCase())}
                      placeholder='np. AAPL.US, PKN.PL, BTC, GOLD'
                      className="w-full pl-12 pr-4 py-3.5 rounded-xl bg-slate-700 border border-slate-600 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition font-mono tracking-wide"
                      disabled={step === 'valuating'}
                      autoFocus
                      autoCapitalize="characters"
                      spellCheck={false}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Ilość / liczba jednostek</label>
                  <div className="relative">
                    <Hash className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
                    <input
                      type="number"
                      min="0.0001"
                      step="any"
                      value={quantity}
                      onChange={e => setQuantity(e.target.value)}
                      placeholder="np. 1, 2.5, 0.5"
                      className="w-full pl-12 pr-4 py-3.5 rounded-xl bg-slate-700 border border-slate-600 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
                      disabled={step === 'valuating'}
                    />
                  </div>
                  <p className="text-xs text-slate-500 mt-1.5">Akcje / crypto: sztuki. Złoto: gramy. Metale: uncje (oz).</p>
                </div>

                {error && (
                  <div className="px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-xl text-sm text-red-400 font-medium">{error}</div>
                )}

                <button
                  type="submit"
                  disabled={step === 'valuating' || !ticker.trim()}
                  className="w-full flex items-center justify-center gap-2 py-3.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-70 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors shadow-lg shadow-indigo-900/30"
                >
                  {step === 'valuating' ? (
                    <><div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /><span>Pobieram kurs…</span></>
                  ) : (
                    <><TrendingUp className="w-4 h-4" /><span>Pobierz kurs rynkowy</span></>
                  )}
                </button>

                {step === 'valuating' && (
                  <p className="text-center text-xs text-slate-500 animate-pulse">Pobieranie kursu…</p>
                )}

                <div className="pt-4 border-t border-slate-700">
                  <p className="text-xs font-medium text-slate-500 mb-3 uppercase tracking-wide">Szybki wybór</p>
                  <div className="flex flex-wrap gap-2">
                    {MARKET_EXAMPLES.map(ex => (
                      <button
                        key={ex.label}
                        type="button"
                        onClick={() => { setTicker(ex.ticker); setQuantity(ex.qty); }}
                        disabled={step === 'valuating'}
                        className="px-3 py-1.5 text-xs bg-slate-700 border border-slate-600 rounded-lg text-slate-400 hover:bg-indigo-500/10 hover:border-indigo-500/30 hover:text-indigo-300 transition-colors disabled:opacity-50"
                      >
                        <span className="font-mono">{ex.ticker}</span>
                        <span className="text-slate-600 ml-1">({ex.label})</span>
                      </button>
                    ))}
                  </div>
                </div>
              </form>
            )}

            {/* ── OPTION C: Cash / Currency ── */}
            {mode === 'cash' && (
              <form onSubmit={handleValuateCash} className="space-y-5">
                <div className="text-sm text-slate-400 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3">
                  Wybierz walutę i wpisz kwotę. Kurs przeliczeniowy pochodzi z <strong className="text-emerald-300">oficjalnej tabeli NBP</strong> (Narodowy Bank Polski).
                </div>

                {/* Currency grid */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Waluta</label>
                  <div className="grid grid-cols-4 gap-3">
                    {CASH_CURRENCIES.map(c => (
                      <button
                        key={c.code}
                        type="button"
                        onClick={() => setCashCurrency(c.code)}
                        disabled={step === 'valuating'}
                        className={`flex flex-col items-center gap-0.5 py-2.5 px-1 rounded-xl border text-xs font-medium transition-colors disabled:opacity-50 ${
                          cashCurrency === c.code
                            ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                            : 'bg-white text-gray-700 border-gray-200 hover:bg-emerald-50 hover:border-emerald-200'
                        }`}
                      >
                        <span className="text-base leading-none">{c.flag}</span>
                        <span className="font-bold">{c.code}</span>
                        <span className={`text-[10px] leading-tight text-center ${cashCurrency === c.code ? 'text-emerald-100' : 'text-gray-400'}`}>
                          {c.name}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Amount input */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Kwota w&nbsp;<span className="text-emerald-700 font-bold">{cashCurrency}</span>
                  </label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 font-semibold text-sm pointer-events-none select-none">
                      {CASH_CURRENCIES.find(c => c.code === cashCurrency)?.flag ?? '💵'}
                    </span>
                    <input
                      type="number"
                      min="0.01"
                      step="any"
                      value={cashAmount}
                      onChange={e => setCashAmount(e.target.value)}
                      placeholder={`np. ${cashCurrency === 'JPY' ? '50000' : cashCurrency === 'PLN' ? '5000' : '1000'}`}
                      className="w-full pl-12 pr-24 py-3.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition text-gray-900 placeholder-gray-400 font-mono text-lg"
                      disabled={step === 'valuating'}
                      autoFocus
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 font-semibold text-sm pointer-events-none">
                      {cashCurrency}
                    </span>
                  </div>
                </div>

                {error && (
                  <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600 font-medium">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={step === 'valuating' || !cashAmount || parseFloat(cashAmount) <= 0}
                  className="w-full flex items-center justify-center gap-2 py-3.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-70 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors shadow-md shadow-emerald-200"
                >
                  {step === 'valuating' ? (
                    <>
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Pobieram kurs NBP…</span>
                    </>
                  ) : (
                    <>
                      <Banknote className="w-4 h-4" />
                      <span>Przelicz według kursu NBP</span>
                    </>
                  )}
                </button>

                {step === 'valuating' && (
                  <p className="text-center text-xs text-gray-400 animate-pulse">
                    Pobieranie oficjalnego kursu z Narodowego Banku Polskiego…
                  </p>
                )}
              </form>
            )}

            {/* ── OPTION B: Description ── */}
            {mode === 'description' && (
              <form onSubmit={handleValuateDescription} className="space-y-5">
                <div className="text-sm text-slate-400 bg-violet-500/10 border border-violet-500/20 rounded-xl px-4 py-3">
                  Opisz szczegółowo swój przedmiot, nieruchomość lub kolekcję. AI oszacuje wartość rynkową na podstawie Twojego opisu (2026).
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Opis aktywa
                    <span className="ml-2 text-xs font-normal text-slate-500">im więcej szczegółów, tym dokładniejsza wycena</span>
                  </label>
                  <textarea
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    placeholder={`np. "Stara moneta 2 złote z 1995 roku, stan menniczy"\nalbo "Mieszkanie w centrum Krakowa, 45m2, wysoki standard"`}
                    rows={5}
                    className="w-full px-4 py-3.5 rounded-xl bg-slate-700 border border-slate-600 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition resize-none"
                    disabled={step === 'valuating'}
                    autoFocus
                  />
                  <p className="text-xs text-slate-500 mt-1.5">Ilość automatycznie = 1.</p>
                </div>

                {error && (
                  <div className="px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-xl text-sm text-red-400">{error}</div>
                )}

                <button
                  type="submit"
                  disabled={step === 'valuating' || description.trim().length < 10}
                  className="w-full flex items-center justify-center gap-2 py-3.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-70 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors shadow-lg shadow-violet-900/30"
                >
                  {step === 'valuating' ? (
                    <><div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /><span>AI wycenia…</span></>
                  ) : (
                    <><Sparkles className="w-4 h-4" /><span>Wycena przez AI</span></>
                  )}
                </button>

                {step === 'valuating' && (
                  <p className="text-center text-xs text-slate-500 animate-pulse">AI analizuje opis i szacuje wartość rynkową w Polsce (2026)…</p>
                )}

                <div className="pt-4 border-t border-slate-700">
                  <p className="text-xs font-medium text-slate-500 mb-3 uppercase tracking-wide">Przykłady</p>
                  <div className="space-y-2">
                    {DESC_EXAMPLES.map((ex, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setDescription(ex)}
                        disabled={step === 'valuating'}
                        className="w-full text-left px-3 py-2 text-xs bg-slate-700 border border-slate-600 rounded-lg text-slate-400 hover:bg-violet-500/10 hover:border-violet-500/30 hover:text-violet-300 transition-colors disabled:opacity-50 truncate"
                      >
                        {ex}
                      </button>
                    ))}
                  </div>
                </div>
              </form>
            )}
          </div>
        )}

        {/* ── Step: Confirm / Saving ── */}
        {(step === 'confirm' || step === 'saving') && valuation && (
          <div className="space-y-4">
            <div className="bg-slate-800 rounded-2xl border border-slate-700/60 shadow-xl overflow-hidden">

              {/* Value header */}
              <div className={`px-8 py-6 border-b border-slate-700 bg-gradient-to-br ${
                mode === 'description' ? 'from-violet-900/30 to-purple-900/20'   :
                mode === 'cash'        ? 'from-emerald-900/30 to-teal-900/20'    :
                                         'from-indigo-900/30 to-blue-900/20'
              }`}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    {showBreakdown && (
                      <p className="text-sm text-gray-400 mb-1">
                        {displayQty} × {formatPLN(valuation.unitPrice)} za szt.
                      </p>
                    )}

                    {isManual ? (
                      <>
                        <p className="text-sm text-slate-400 mb-1 flex items-center gap-1.5">
                          <PenLine className="w-3.5 h-3.5" />
                          Wprowadź wartość ręcznie
                        </p>
                        <p className="text-3xl font-bold text-violet-400">
                          {finalValue > 0 ? formatPLN(finalValue) : '— PLN'}
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-sm text-slate-400 mb-1">
                          {mode === 'description'
                            ? tieredPricing
                              ? valuation?.isRealEstate
                                ? 'Wycena AI – wybierz poziom ceny (nieruchomość)'
                                : 'Wycena AI – wybierz poziom ceny (pojazd)'
                              : 'Wycena AI (wartość rynkowa)'
                            : mode === 'cash'
                              ? `Gotówka ${cashCurrency} → PLN (kurs NBP)`
                              : 'Aktualna wartość giełdowa'}
                        </p>
                        <p className={`text-4xl font-bold ${
                          mode === 'description' ? 'text-violet-400'  :
                          mode === 'cash'        ? 'text-emerald-400' :
                                                    'text-indigo-400'
                        }`}>
                          {formatPLN(finalValue > 0 ? finalValue : valuation.estimatedValue)}
                        </p>
                      </>
                    )}
                  </div>
                  <span
                    className={`shrink-0 mt-1 px-3 py-1 rounded-full text-xs font-semibold border ${CONFIDENCE_COLOR[valuation.confidence]}`}
                  >
                    {CONFIDENCE_LABEL[valuation.confidence]}
                  </span>
                </div>
                <p className="text-sm text-slate-400 mt-3 italic">{valuation.reasoning}</p>
                <p className="text-xs text-slate-500 mt-1">Źródło: {valuation.source}</p>
              </div>

              <div className="px-8 py-6 space-y-5">

                {/* ── Real estate price variant selector ── */}
                {tieredPricing && valuation?.priceRange && (
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      {valuation.isRealEstate
                        ? 'Wybierz poziom ceny względem średniej rynkowej (nieruchomość)'
                        : 'Wybierz poziom ceny względem średniej rynkowej (pojazd)'}
                    </label>
                    {valuation.isRealEstate && valuation.pricePerM2 && (
                      <p className="text-xs text-slate-500 mb-3">
                        Średnia cena za m²:{' '}
                        <strong className="text-slate-300">
                          {valuation.pricePerM2.toLocaleString('pl-PL')} PLN/m²
                        </strong>
                        {valuation.area && (
                          <span className="ml-1">· {valuation.area} m²</span>
                        )}
                      </p>
                    )}
                    <div className="grid grid-cols-3 gap-2">
                      {(
                        [
                          { key: 'low',  label: 'Niższy',  sub: '-20%', color: 'border-blue-500/40 text-blue-300 bg-blue-500/10',   activeColor: 'border-blue-500 bg-blue-500/20 text-blue-200' },
                          { key: 'mid',  label: 'Średni',  sub: '0%',   color: 'border-slate-600 text-slate-400 bg-slate-700',       activeColor: 'border-violet-500 bg-violet-500/20 text-violet-200' },
                          { key: 'high', label: 'Wyższy',  sub: '+20%', color: 'border-amber-500/40 text-amber-300 bg-amber-500/10', activeColor: 'border-amber-500 bg-amber-500/20 text-amber-200' },
                        ] as const
                      ).map(({ key, label, sub, color, activeColor }) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setPriceVariant(key)}
                          className={`flex flex-col items-center gap-1 py-3 px-2 rounded-xl border text-xs font-medium transition-all ${
                            priceVariant === key ? activeColor : color
                          }`}
                        >
                          <span className="font-semibold text-sm">{label}</span>
                          <span className="opacity-70">{sub}</span>
                          <span className="font-bold text-base mt-0.5">
                            {formatPLN(valuation.priceRange![key])}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Asset summary */}
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5">Aktywo</label>
                  <p className="px-4 py-3 bg-slate-700 rounded-xl text-slate-100 font-medium text-sm line-clamp-2">
                    {mode === 'market' && displayQty !== 1 ? `${displayQty} × ` : ''}{displayName}
                  </p>
                </div>

                {/* Category */}
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5">
                    Kategoria
                    <span className="ml-2 text-xs font-normal text-slate-500">(możesz zmienić)</span>
                  </label>
                  <div className="relative">
                    <select
                      value={category}
                      onChange={e => setCategory(e.target.value as AssetCategory)}
                      className="w-full appearance-none px-4 py-3 rounded-xl bg-slate-700 border border-slate-600 text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition pr-10"
                    >
                      {ASSET_CATEGORIES.map(cat => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
                  </div>
                  <div className="mt-2">
                    <CategoryBadge category={category} />
                  </div>
                </div>

                {/* Value field */}
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5">
                    {isManual ? 'Twoja wycena (PLN)' : 'Wycena końcowa'}
                  </label>
                  {isManual ? (
                    <>
                      <input
                        type="number"
                        min="1"
                        step="any"
                        value={manualValue}
                        onChange={e => setManualValue(e.target.value)}
                        placeholder="Wpisz szacowaną wartość w PLN (np. 3500)"
                        className="w-full px-4 py-3 rounded-xl bg-violet-900/30 border border-violet-500/30 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition"
                        disabled={step === 'saving'}
                        autoFocus
                      />
                      <p className="text-xs text-slate-500 mt-1.5 flex items-center gap-1">
                        <PenLine className="w-3 h-3" />Sprawdź ceny np. na Allegro / OLX.
                      </p>
                    </>
                  ) : (
                    <>
                      <div className="relative">
                        <input
                          type="text"
                          readOnly
                          value={formatPLN(finalValue > 0 ? finalValue : valuation.estimatedValue)}
                          className="w-full px-4 py-3 rounded-xl border border-slate-600 bg-slate-700/50 text-slate-400 cursor-not-allowed select-none"
                        />
                        <Lock className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-600" />
                      </div>
                      <p className="text-xs text-slate-500 mt-1.5 flex items-center gap-1">
                        <Lock className="w-3 h-3" />
                        {mode === 'market' ? 'Kwota z giełdy – nie można zmienić.' :
                         mode === 'cash'   ? 'Przeliczone z kursu NBP – nie można zmienić.' :
                         tieredPricing     ? 'Wybierz wariant cenowy powyżej.' :
                                             'Wycena AI – kliknij "Od nowa" aby zmienić opis.'}
                      </p>
                    </>
                  )}
                </div>

                {error && (
                  <div className="px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-xl text-sm text-red-400">{error}</div>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <button
                onClick={handleReset}
                disabled={step === 'saving'}
                className="flex items-center gap-2 px-5 py-3 border border-slate-700 text-slate-400 rounded-xl font-medium hover:bg-slate-800 transition-colors disabled:opacity-50"
              >
                <RotateCcw className="w-4 h-4" />Od nowa
              </button>
              <button
                onClick={handleConfirm}
                disabled={
                  step === 'saving' ||
                  (isManual  && (parseFloat(manualValue) || 0) <= 0) ||
                  (!isManual && valuation.estimatedValue <= 0)
                }
                className="flex-1 flex items-center justify-center gap-2 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors shadow-lg shadow-emerald-900/30"
              >
                {step === 'saving' ? (
                  <><div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />Zapisuję…</>
                ) : (
                  <><CheckCircle className="w-5 h-5" />Potwierdź i dodaj do majątku</>
                )}
              </button>
            </div>
          </div>
        )}

        {/* ── Step: Saved ── */}
        {step === 'saved' && valuation && (
          <div className="bg-slate-800 rounded-2xl border border-slate-700/60 shadow-xl p-12 text-center">
            <div className="w-20 h-20 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto mb-6 border border-emerald-500/20">
              <CheckCircle className="w-10 h-10 text-emerald-400" />
            </div>
            <h3 className="text-2xl font-bold text-slate-100 mb-2">Dodano!</h3>
            <p className="text-slate-500 mb-1 text-sm max-w-sm mx-auto line-clamp-2">
              {mode === 'market' && displayQty !== 1 ? `${displayQty} × ` : ''}
              <strong className="text-slate-200">{displayName}</strong>
            </p>
            <p className="text-3xl font-bold text-indigo-400 my-3">
              {formatPLN(finalValue)}
            </p>
            <p className="text-sm text-slate-500 mb-8">dodane do Twojego majątku</p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={handleReset}
                className="px-6 py-2.5 border border-slate-700 text-slate-400 rounded-xl font-medium hover:bg-slate-700 transition-colors"
              >
                Dodaj kolejne
              </button>
              <button
                onClick={() => router.push('/dashboard')}
                className="px-6 py-2.5 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-500 transition-colors shadow-lg shadow-indigo-900/30"
              >
                Przejdź do panelu
              </button>
            </div>
          </div>
        )}

      </main>
    </>
  );
}
