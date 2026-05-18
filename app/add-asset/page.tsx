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
} from 'lucide-react';

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

const CONFIDENCE_LABEL: Record<string, string> = {
  high:   'Wysoka (giełdowa)',
  medium: 'Średnia',
  low:    'Manualna',
};

const CONFIDENCE_COLOR: Record<string, string> = {
  high:   'text-emerald-600 bg-emerald-50 border-emerald-200',
  medium: 'text-amber-600 bg-amber-50 border-amber-200',
  low:    'text-violet-600 bg-violet-50 border-violet-200',
};

const EXAMPLES: Array<{ label: string; name: string; qty: string }> = [
  { label: 'S&P 500 ETF',  name: 'S&P 500 ETF',          qty: '10'   },
  { label: 'Bitcoin',      name: 'Bitcoin',               qty: '0.5'  },
  { label: 'Złoto (oz)',   name: 'Złoto',                 qty: '1'    },
  { label: 'Srebro (oz)',  name: 'Srebro',                qty: '5'    },
  { label: 'Apple',        name: 'Apple akcje',           qty: '3'    },
  { label: 'CD Projekt',   name: 'CD Projekt',            qty: '10'   },
  { label: 'iPhone 15',   name: 'iPhone 15 używany',     qty: '1'    },
  { label: 'MacBook Pro',  name: 'MacBook Pro M4',        qty: '1'    },
  { label: 'Mieszkanie',   name: 'Mieszkanie 50m² Warszawa', qty: '1' },
];

export default function AddAssetPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [step,        setStep]        = useState<Step>('input');
  const [name,        setName]        = useState('');
  const [quantity,    setQuantity]    = useState('1');
  const [valuation,   setValuation]   = useState<ValuationResult | null>(null);
  const [category,    setCategory]    = useState<AssetCategory>('Inne');
  const [manualValue, setManualValue] = useState('');   // only for physical items
  const [error,       setError]       = useState('');

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [user, loading, router]);

  // ── Valuate ─────────────────────────────────────────────────────────────────

  const handleValuate = async (e: React.FormEvent) => {
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

      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error ?? `Błąd HTTP ${res.status}`);
      }

      const data: ValuationResult = await res.json();
      setValuation(data);
      setCategory(data.suggestedCategory);
      setManualValue('');   // reset manual input on each new valuation
      setStep('confirm');
    } catch (err) {
      console.error('[add-asset] valuate error:', err);
      setError(
        err instanceof Error
          ? err.message
          : 'Błąd połączenia z serwerem. Sprawdź internet i spróbuj ponownie.',
      );
      setStep('input');
    }
  };

  // ── Save ────────────────────────────────────────────────────────────────────

  const handleConfirm = async () => {
    if (!valuation || step === 'saving') return;

    // Resolve final value: market price (locked) OR user's manual entry
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

    setError('');
    setStep('saving');

    try {
      const res = await fetch('/api/assets', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          name:      name.trim(),
          category,
          value:     Math.round(finalValue),
          quantity:  parseFloat(quantity),
          reasoning: valuation.reasoning,
        }),
      });

      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = (d as { error?: string }).error ?? `Błąd zapisu (HTTP ${res.status}).`;
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
    setValuation(null);
    setManualValue('');
    setError('');
  };

  // ── Derived ──────────────────────────────────────────────────────────────────

  const qty            = parseFloat(quantity) || 1;
  const isManual       = valuation?.requiresManualPrice === true;
  const finalValue     = isManual
                           ? (parseFloat(manualValue) || 0)
                           : (valuation?.estimatedValue ?? 0);
  const showBreakdown  = !isManual && valuation && valuation.unitPrice > 0 && qty !== 1;

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

        <div className="mb-8">
          <h2 className="text-2xl font-bold text-gray-900">Dodaj nowe aktywo</h2>
          <p className="text-gray-500 mt-1">
            Akcje i kryptowaluty wyceniamy giełdowo (Yahoo Finance).
            Przedmioty fizyczne – wpisujesz cenę sam.
          </p>
        </div>

        {/* ── Step: Input / Valuating ── */}
        {(step === 'input' || step === 'valuating') && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8">
            <form onSubmit={handleValuate} className="space-y-5">

              {/* Name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Nazwa aktywa / przedmiotu
                </label>
                <div className="relative">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder='np. "Bitcoin", "S&P 500 ETF", "iPhone 15"'
                    className="w-full pl-12 pr-4 py-3.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition text-gray-900 placeholder-gray-400"
                    disabled={step === 'valuating'}
                    autoFocus
                  />
                </div>
              </div>

              {/* Quantity */}
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
                  Akcje / crypto: liczba sztuk. Metale szlachetne: <strong>uncje trojańskie (oz)</strong>.
                  Przedmioty fizyczne: 1.
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
                    <span>Klasyfikuję i pobieram kurs…</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    <span>Wycena</span>
                  </>
                )}
              </button>

              {step === 'valuating' && (
                <p className="text-center text-xs text-gray-400 animate-pulse">
                  AI klasyfikuje aktywo, następnie kod pobiera aktualny kurs giełdowy…
                </p>
              )}
            </form>

            {/* Quick-fill examples */}
            <div className="mt-6 pt-6 border-t border-gray-100">
              <p className="text-xs font-medium text-gray-400 mb-3 uppercase tracking-wide">
                Szybki wybór
              </p>
              <div className="flex flex-wrap gap-2">
                {EXAMPLES.map(ex => (
                  <button
                    key={ex.label}
                    type="button"
                    onClick={() => { setName(ex.name); setQuantity(ex.qty); }}
                    disabled={step === 'valuating'}
                    className="px-3 py-1.5 text-xs bg-gray-50 border border-gray-200 rounded-lg text-gray-600 hover:bg-indigo-50 hover:border-indigo-200 hover:text-indigo-700 transition-colors"
                  >
                    {ex.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Step: Confirm / Saving ── */}
        {(step === 'confirm' || step === 'saving') && valuation && (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">

              {/* Value header */}
              <div className="bg-gradient-to-br from-indigo-50 to-purple-50 px-8 py-6 border-b border-gray-100">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    {showBreakdown && (
                      <p className="text-sm text-gray-400 mb-1">
                        {qty} × {formatPLN(valuation.unitPrice)} za szt.
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
                        <p className="text-sm text-gray-500 mb-1">Aktualna wartość giełdowa</p>
                        <p className="text-4xl font-bold text-indigo-700">
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
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Aktywo
                  </label>
                  <p className="px-4 py-3 bg-gray-50 rounded-xl text-gray-900 font-medium">
                    {qty !== 1 ? `${qty} × ` : ''}{name}
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
                  <div className="mt-2 flex items-center gap-2 flex-wrap">
                    <CategoryBadge category={category} />
                    {valuation.aiCategory && valuation.aiCategory !== category && (
                      <span className="text-xs text-indigo-500 bg-indigo-50 px-2 py-0.5 rounded-md">
                        AI: {valuation.aiCategory}
                      </span>
                    )}
                  </div>
                </div>

                {/* Value field – LOCKED for market, EDITABLE for physical */}
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
                        Wycena manualna – sprawdź aktualne ceny np. na Allegro / OLX.
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
                        Kwota pochodzi z giełdy – nie można jej zmienić ręcznie.
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
                  (isManual && (parseFloat(manualValue) || 0) <= 0) ||
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
            <p className="text-gray-500 mb-1">
              {qty !== 1 ? `${qty} × ` : ''}
              <strong className="text-gray-800">{name}</strong>
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
