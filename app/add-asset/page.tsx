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
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

type Mode = 'market' | 'description';
type Step = 'input' | 'valuating' | 'confirm' | 'saving' | 'saved';

interface ValuationResult {
  estimatedValue:     number;
  unitPrice:          number;
  currency:           string;
  confidence:         'high' | 'medium' | 'low';
  source:             string;
  suggestedCategory:  AssetCategory;
  aiCategory:         string;
  reasoning:          string;
  requiresManualPrice?: boolean;
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

const MARKET_EXAMPLES = [
  { label: 'S&P 500 ETF', name: 'S&P 500 ETF',        qty: '10'  },
  { label: 'Bitcoin',     name: 'Bitcoin',              qty: '0.5' },
  { label: 'Złoto (g)',   name: 'Złoto',                qty: '10'  },
  { label: 'Srebro (oz)', name: 'Srebro',               qty: '5'   },
  { label: 'Apple',       name: 'Apple akcje',          qty: '3'   },
  { label: 'CD Projekt',  name: 'CD Projekt',           qty: '10'  },
  { label: 'Ethereum',    name: 'Ethereum',             qty: '1'   },
  { label: 'PKO BP',      name: 'PKO BP',               qty: '20'  },
];

const DESC_EXAMPLES = [
  'Stara moneta 2 złote z 1995 roku, stan menniczy, w oryginalnym etui kolekcjonerskim',
  'Mieszkanie w centrum Krakowa, 45m2, 4 piętro, wysoki standard wykończenia, balkon, garaż',
  'Zegarek Rolex Submariner rocznik 2020, stalowy, stan bardzo dobry, kompletny zestaw',
  'iPhone 15 Pro 256GB, kolor tytanowy, używany 6 miesięcy, stan idealny, oryginalne opakowanie',
];

// ── Component ─────────────────────────────────────────────────────────────────

export default function AddAssetPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  // Mode
  const [mode, setMode] = useState<Mode>('market');

  // Shared state
  const [step,        setStep]        = useState<Step>('input');
  const [valuation,   setValuation]   = useState<ValuationResult | null>(null);
  const [category,    setCategory]    = useState<AssetCategory>('Inne');
  const [manualValue, setManualValue] = useState('');
  const [error,       setError]       = useState('');

  // Market-mode state
  const [name,     setName]     = useState('');
  const [quantity, setQuantity] = useState('1');

  // Description-mode state
  const [description, setDescription] = useState('');

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [user, loading, router]);

  // ── Switch mode ──────────────────────────────────────────────────────────────

  const handleSwitchMode = (m: Mode) => {
    setMode(m);
    setStep('input');
    setError('');
  };

  // ── Valuate helpers ──────────────────────────────────────────────────────────

  const applyValuationResult = (data: ValuationResult) => {
    setValuation(data);
    setCategory(data.suggestedCategory);
    setManualValue('');
    setStep('confirm');
  };

  const handleValuateError = (err: unknown) => {
    console.error('[add-asset] valuate error:', err);
    const msg =
      err instanceof Error ? err.message : 'Błąd połączenia. Sprawdź internet i spróbuj ponownie.';
    setError(msg);
    setStep('input');
  };

  // ── Valuate: Market (Option A) ───────────────────────────────────────────────

  const handleValuateMarket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (step === 'valuating') return;

    if (!name.trim() || name.trim().length < 2) {
      setError('Wpisz co najmniej 2 znaki nazwy aktywa.');
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
      const res = await fetch('/api/valuate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name: name.trim(), quantity: qty }),
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
      const res = await fetch('/api/valuate', {
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

  // ── Save ─────────────────────────────────────────────────────────────────────

  const handleConfirm = async () => {
    if (!valuation || step === 'saving') return;

    let finalValue: number;
    if (valuation.requiresManualPrice) {
      finalValue = parseFloat(manualValue);
      if (isNaN(finalValue) || finalValue <= 0) {
        setError('Podaj szacowaną wartość przedmiotu (musi być > 0 PLN).');
        return;
      }
    } else {
      finalValue = valuation.estimatedValue;
      if (finalValue <= 0) {
        setError('Brak wyceny do zatwierdzenia.');
        return;
      }
    }

    // Asset name: market → name input; description → first 200 chars of description
    const assetName = mode === 'market'
      ? name.trim()
      : description.trim().slice(0, 200);

    // Quantity: description mode always 1
    const assetQty = mode === 'market' ? (parseFloat(quantity) || 1) : 1;

    setError('');
    setStep('saving');

    try {
      const res = await fetch('/api/assets', {
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
    setName('');
    setQuantity('1');
    setDescription('');
    setValuation(null);
    setManualValue('');
    setError('');
  };

  // ── Derived values ────────────────────────────────────────────────────────────

  const displayQty    = mode === 'market' ? (parseFloat(quantity) || 1) : 1;
  const displayName   = mode === 'market'
                          ? name
                          : (description.slice(0, 70) + (description.length > 70 ? '…' : ''));
  const isManual      = valuation?.requiresManualPrice === true;
  const finalValue    = isManual
                          ? (parseFloat(manualValue) || 0)
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
          <h2 className="text-2xl font-bold text-gray-900">Dodaj nowe aktywo</h2>
          <p className="text-gray-500 mt-1">Wybierz sposób wyceny odpowiedni dla swojego aktywa.</p>
        </div>

        {/* ── Mode tabs (only on input / valuating) ── */}
        {(step === 'input' || step === 'valuating') && (
          <div className="flex gap-3 mb-6">
            <button
              type="button"
              onClick={() => handleSwitchMode('market')}
              className={`flex-1 flex items-center justify-center gap-2.5 py-3 px-4 rounded-xl border font-medium text-sm transition-colors ${
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
              onClick={() => handleSwitchMode('description')}
              className={`flex-1 flex items-center justify-center gap-2.5 py-3 px-4 rounded-xl border font-medium text-sm transition-colors ${
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
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8">

            {/* ── OPTION A: Market ── */}
            {mode === 'market' && (
              <form onSubmit={handleValuateMarket} className="space-y-5">
                <div className="text-sm text-gray-500 bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-3">
                  Wpisz nazwę akcji, ETF, kryptowaluty, metalu lub gotówki.
                  AI rozpozna ticker i pobierze aktualny kurs giełdowy.
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Nazwa aktywa
                  </label>
                  <div className="relative">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <input
                      type="text"
                      value={name}
                      onChange={e => setName(e.target.value)}
                      placeholder='np. "Bitcoin", "S&P 500 ETF", "Złoto", "Apple"'
                      className="w-full pl-12 pr-4 py-3.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition text-gray-900 placeholder-gray-400"
                      disabled={step === 'valuating'}
                      autoFocus
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Ilość / liczba jednostek
                  </label>
                  <div className="relative">
                    <Hash className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <input
                      type="number"
                      min="0.0001"
                      step="any"
                      value={quantity}
                      onChange={e => setQuantity(e.target.value)}
                      placeholder="np. 1, 2.5, 0.5"
                      className="w-full pl-12 pr-4 py-3.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition text-gray-900 placeholder-gray-400"
                      disabled={step === 'valuating'}
                    />
                  </div>
                  <p className="text-xs text-gray-400 mt-1.5">
                    Akcje / crypto: liczba sztuk. Metale: <strong>uncje trojańskie (oz)</strong> lub gramy (złoto). Gotówka: kwota w PLN.
                  </p>
                </div>

                {error && (
                  <div className="px-4 py-3 bg-red-50 border border-red-100 rounded-xl text-sm text-red-600">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={step === 'valuating' || !name.trim()}
                  className="w-full flex items-center justify-center gap-2 py-3.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-70 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors shadow-md shadow-indigo-200"
                >
                  {step === 'valuating' ? (
                    <>
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Pobieram kurs giełdowy…</span>
                    </>
                  ) : (
                    <>
                      <TrendingUp className="w-4 h-4" />
                      <span>Pobierz kurs giełdowy</span>
                    </>
                  )}
                </button>

                {step === 'valuating' && (
                  <p className="text-center text-xs text-gray-400 animate-pulse">
                    AI rozpoznaje ticker, następnie pobierany jest aktualny kurs rynkowy…
                  </p>
                )}

                <div className="pt-4 border-t border-gray-100">
                  <p className="text-xs font-medium text-gray-400 mb-3 uppercase tracking-wide">
                    Szybki wybór
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {MARKET_EXAMPLES.map(ex => (
                      <button
                        key={ex.label}
                        type="button"
                        onClick={() => { setName(ex.name); setQuantity(ex.qty); }}
                        disabled={step === 'valuating'}
                        className="px-3 py-1.5 text-xs bg-gray-50 border border-gray-200 rounded-lg text-gray-600 hover:bg-indigo-50 hover:border-indigo-200 hover:text-indigo-700 transition-colors disabled:opacity-50"
                      >
                        {ex.label}
                      </button>
                    ))}
                  </div>
                </div>
              </form>
            )}

            {/* ── OPTION B: Description ── */}
            {mode === 'description' && (
              <form onSubmit={handleValuateDescription} className="space-y-5">
                <div className="text-sm text-gray-500 bg-violet-50 border border-violet-100 rounded-xl px-4 py-3">
                  Opisz szczegółowo swój przedmiot, nieruchomość lub kolekcję.
                  AI oszacuje wartość rynkową na podstawie Twojego opisu (2026).
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Opis aktywa
                    <span className="ml-2 text-xs font-normal text-gray-400">
                      im więcej szczegółów, tym dokładniejsza wycena
                    </span>
                  </label>
                  <textarea
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    placeholder={`np. "Stara moneta 2 złote z 1995 roku, stan menniczy, w oryginalnym etui kolekcjonerskim"\nalbo "Mieszkanie w centrum Krakowa, 45m2, 4 piętro, wysoki standard, balkon, garaż w cenie"`}
                    rows={5}
                    className="w-full px-4 py-3.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition text-gray-900 placeholder-gray-400 resize-none"
                    disabled={step === 'valuating'}
                    autoFocus
                  />
                  <p className="text-xs text-gray-400 mt-1.5">
                    Ilość jest automatycznie ustawiana na <strong>1</strong> dla tej opcji.
                  </p>
                </div>

                {error && (
                  <div className="px-4 py-3 bg-red-50 border border-red-100 rounded-xl text-sm text-red-600">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={step === 'valuating' || description.trim().length < 10}
                  className="w-full flex items-center justify-center gap-2 py-3.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-70 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors shadow-md shadow-violet-200"
                >
                  {step === 'valuating' ? (
                    <>
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>AI wycenia…</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      <span>Wycena przez AI</span>
                    </>
                  )}
                </button>

                {step === 'valuating' && (
                  <p className="text-center text-xs text-gray-400 animate-pulse">
                    AI analizuje opis i szacuje wartość rynkową w Polsce (2026)…
                  </p>
                )}

                <div className="pt-4 border-t border-gray-100">
                  <p className="text-xs font-medium text-gray-400 mb-3 uppercase tracking-wide">
                    Przykłady opisów
                  </p>
                  <div className="space-y-2">
                    {DESC_EXAMPLES.map((ex, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setDescription(ex)}
                        disabled={step === 'valuating'}
                        className="w-full text-left px-3 py-2 text-xs bg-gray-50 border border-gray-200 rounded-lg text-gray-600 hover:bg-violet-50 hover:border-violet-200 hover:text-violet-700 transition-colors disabled:opacity-50 truncate"
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
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">

              {/* Value header */}
              <div className={`px-8 py-6 border-b border-gray-100 bg-gradient-to-br ${
                mode === 'description'
                  ? 'from-violet-50 to-purple-50'
                  : 'from-indigo-50 to-blue-50'
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
                        <p className="text-sm text-gray-500 mb-1 flex items-center gap-1.5">
                          <PenLine className="w-3.5 h-3.5" />
                          Wprowadź wartość ręcznie
                        </p>
                        <p className="text-3xl font-bold text-violet-700">
                          {finalValue > 0 ? formatPLN(finalValue) : '— PLN'}
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-sm text-gray-500 mb-1">
                          {mode === 'description'
                            ? 'Wycena AI (wartość rynkowa)'
                            : 'Aktualna wartość giełdowa'}
                        </p>
                        <p className={`text-4xl font-bold ${
                          mode === 'description' ? 'text-violet-700' : 'text-indigo-700'
                        }`}>
                          {formatPLN(valuation.estimatedValue)}
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
                <p className="text-sm text-gray-500 mt-3 italic">{valuation.reasoning}</p>
                <p className="text-xs text-gray-400 mt-1">Źródło: {valuation.source}</p>
              </div>

              <div className="px-8 py-6 space-y-5">

                {/* Asset summary */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Aktywo</label>
                  <p className="px-4 py-3 bg-gray-50 rounded-xl text-gray-900 font-medium text-sm line-clamp-2">
                    {mode === 'market' && displayQty !== 1 ? `${displayQty} × ` : ''}{displayName}
                  </p>
                </div>

                {/* Category */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Kategoria
                    <span className="ml-2 text-xs font-normal text-gray-400">(możesz zmienić)</span>
                  </label>
                  <div className="relative">
                    <select
                      value={category}
                      onChange={e => setCategory(e.target.value as AssetCategory)}
                      className="w-full appearance-none px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition text-gray-900 bg-white pr-10"
                    >
                      {ASSET_CATEGORIES.map(cat => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                  </div>
                  <div className="mt-2">
                    <CategoryBadge category={category} />
                  </div>
                </div>

                {/* Value field – LOCKED for market/AI estimate, EDITABLE for manual */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
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
                        className="w-full px-4 py-3 rounded-xl border border-violet-200 bg-violet-50 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition text-gray-900 placeholder-gray-400"
                        disabled={step === 'saving'}
                        autoFocus
                      />
                      <p className="text-xs text-gray-400 mt-1.5 flex items-center gap-1">
                        <PenLine className="w-3 h-3" />
                        Sprawdź aktualne ceny np. na Allegro / OLX.
                      </p>
                    </>
                  ) : (
                    <>
                      <div className="relative">
                        <input
                          type="text"
                          readOnly
                          value={formatPLN(valuation.estimatedValue)}
                          className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-gray-50 text-gray-500 cursor-not-allowed select-none"
                        />
                        <Lock className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300" />
                      </div>
                      <p className="text-xs text-gray-400 mt-1.5 flex items-center gap-1">
                        <Lock className="w-3 h-3" />
                        {mode === 'market'
                          ? 'Kwota pochodzi z giełdy – nie można jej zmienić ręcznie.'
                          : 'Wycena AI – możesz kliknąć "Od nowa" i wpisać inny opis, by uzyskać inną wycenę.'}
                      </p>
                    </>
                  )}
                </div>

                {error && (
                  <div className="px-4 py-3 bg-red-50 border border-red-100 rounded-xl text-sm text-red-600">
                    {error}
                  </div>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <button
                onClick={handleReset}
                disabled={step === 'saving'}
                className="flex items-center gap-2 px-5 py-3 border border-gray-200 text-gray-600 rounded-xl font-medium hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                <RotateCcw className="w-4 h-4" />
                Od nowa
              </button>
              <button
                onClick={handleConfirm}
                disabled={
                  step === 'saving' ||
                  (isManual  && (parseFloat(manualValue) || 0) <= 0) ||
                  (!isManual && valuation.estimatedValue <= 0)
                }
                className="flex-1 flex items-center justify-center gap-2 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors shadow-md shadow-emerald-200"
              >
                {step === 'saving' ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Zapisuję…
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-5 h-5" />
                    Potwierdź i dodaj do majątku
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* ── Step: Saved ── */}
        {step === 'saved' && valuation && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center">
            <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <CheckCircle className="w-10 h-10 text-emerald-600" />
            </div>
            <h3 className="text-2xl font-bold text-gray-900 mb-2">Dodano!</h3>
            <p className="text-gray-500 mb-1 text-sm max-w-sm mx-auto line-clamp-2">
              {mode === 'market' && displayQty !== 1 ? `${displayQty} × ` : ''}
              <strong className="text-gray-800">{displayName}</strong>
            </p>
            <p className="text-3xl font-bold text-indigo-700 my-3">
              {formatPLN(finalValue)}
            </p>
            <p className="text-sm text-gray-400 mb-8">dodane do Twojego majątku</p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={handleReset}
                className="px-6 py-2.5 border border-gray-200 text-gray-600 rounded-xl font-medium hover:bg-gray-50 transition-colors"
              >
                Dodaj kolejne
              </button>
              <button
                onClick={() => router.push('/dashboard')}
                className="px-6 py-2.5 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 transition-colors shadow-md shadow-indigo-200"
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
