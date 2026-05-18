'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import Navigation from '@/components/Navigation';
import CategoryBadge from '@/components/CategoryBadge';
import { formatPLN } from '@/components/AssetCard';
import type { AssetCategory } from '@/types';
import { ASSET_CATEGORIES } from '@/types';
import { Search, Sparkles, CheckCircle, RotateCcw, ChevronDown } from 'lucide-react';

type Step = 'input' | 'valuating' | 'confirm' | 'saving' | 'saved';

interface ValuationResult {
  estimatedValue: number;
  currency: string;
  confidence: 'high' | 'medium' | 'low';
  source: string;
  suggestedCategory: AssetCategory;
  reasoning: string;
}

const CONFIDENCE_LABEL: Record<string, string> = {
  high: 'Wysoka',
  medium: 'Średnia',
  low: 'Niska',
};

const CONFIDENCE_COLOR: Record<string, string> = {
  high: 'text-emerald-600 bg-emerald-50',
  medium: 'text-amber-600 bg-amber-50',
  low: 'text-red-600 bg-red-50',
};

export default function AddAssetPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [step, setStep] = useState<Step>('input');
  const [name, setName] = useState('');
  const [valuation, setValuation] = useState<ValuationResult | null>(null);
  const [category, setCategory] = useState<AssetCategory>('Inne');
  const [customValue, setCustomValue] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [user, loading, router]);

  const handleValuate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || name.trim().length < 2) {
      setError('Wpisz co najmniej 2 znaki nazwy aktywa.');
      return;
    }
    setError('');
    setStep('valuating');

    try {
      const res = await fetch('/api/valuate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error ?? 'Błąd wyceny');
      }
      const data: ValuationResult = await res.json();
      setValuation(data);
      setCategory(data.suggestedCategory);
      setCustomValue(String(data.estimatedValue));
      setStep('confirm');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Błąd wyceny. Spróbuj ponownie.');
      setStep('input');
    }
  };

  const handleConfirm = async () => {
    const finalValue = parseFloat(customValue);
    if (isNaN(finalValue) || finalValue <= 0) {
      setError('Wprowadź poprawną wartość.');
      return;
    }
    setError('');
    setStep('saving');

    const res = await fetch('/api/assets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), category, value: finalValue }),
    });

    if (!res.ok) {
      const d = await res.json();
      setError(d.error ?? 'Błąd zapisu.');
      setStep('confirm');
      return;
    }

    setStep('saved');
  };

  const handleReset = () => {
    setStep('input');
    setName('');
    setValuation(null);
    setCustomValue('');
    setError('');
  };

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
            AI wyceni Twój przedmiot – Ty potwierdzasz wartość przed zapisem.
          </p>
        </div>

        {/* Step: Input */}
        {(step === 'input' || step === 'valuating') && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8">
            <form onSubmit={handleValuate} className="space-y-6">
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
                    placeholder='np. "S&P 500 ETF", "iPhone 15", "Srebro 1 uncja"'
                    className="w-full pl-12 pr-4 py-3.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition text-gray-900 placeholder-gray-400"
                    disabled={step === 'valuating'}
                    autoFocus
                  />
                </div>
                <p className="text-xs text-gray-400 mt-2">
                  Im dokładniejsza nazwa, tym precyzyjniejsza wycena. Możesz wpisać markę, model, stan.
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
                className="w-full flex items-center justify-center gap-2 py-3.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-semibold rounded-xl transition-colors shadow-md shadow-indigo-200"
              >
                {step === 'valuating' ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Wyceniam...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    Wycena AI
                  </>
                )}
              </button>
            </form>

            {/* Examples */}
            <div className="mt-6 pt-6 border-t border-gray-100">
              <p className="text-xs font-medium text-gray-400 mb-3 uppercase tracking-wide">
                Przykłady obsługiwanych aktywów
              </p>
              <div className="flex flex-wrap gap-2">
                {[
                  'S&P 500 ETF',
                  'Bitcoin',
                  'Złoto 1 gram',
                  'Srebro 1 uncja',
                  'iPhone 15',
                  'MacBook Pro',
                  'PS5',
                  'Mieszkanie',
                  'Samochód',
                ].map(ex => (
                  <button
                    key={ex}
                    type="button"
                    onClick={() => setName(ex)}
                    disabled={step === 'valuating'}
                    className="px-3 py-1.5 text-xs bg-gray-50 border border-gray-200 rounded-lg text-gray-600 hover:bg-indigo-50 hover:border-indigo-200 hover:text-indigo-700 transition-colors"
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Step: Confirm */}
        {(step === 'confirm' || step === 'saving') && valuation && (
          <div className="space-y-4">
            {/* Valuation result card */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="bg-gradient-to-br from-indigo-50 to-purple-50 px-8 py-6 border-b border-gray-100">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm text-gray-500 mb-1">Szacowana wartość</p>
                    <p className="text-4xl font-bold text-indigo-700">
                      {formatPLN(valuation.estimatedValue)}
                    </p>
                  </div>
                  <span className={`px-3 py-1 rounded-full text-xs font-semibold ${CONFIDENCE_COLOR[valuation.confidence]}`}>
                    Pewność: {CONFIDENCE_LABEL[valuation.confidence]}
                  </span>
                </div>
                <p className="text-sm text-gray-500 mt-3 italic">{valuation.reasoning}</p>
                <p className="text-xs text-gray-400 mt-1">Źródło: {valuation.source}</p>
              </div>

              <div className="px-8 py-6 space-y-5">
                {/* Asset name */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Nazwa aktywa
                  </label>
                  <p className="px-4 py-3 bg-gray-50 rounded-xl text-gray-900 font-medium">
                    {name}
                  </p>
                </div>

                {/* Category */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Kategoria
                  </label>
                  <div className="relative">
                    <select
                      value={category}
                      onChange={e => setCategory(e.target.value as AssetCategory)}
                      className="w-full appearance-none px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition text-gray-900 bg-white pr-10"
                    >
                      {ASSET_CATEGORIES.map(cat => (
                        <option key={cat} value={cat}>
                          {cat}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                  </div>
                  <div className="mt-2">
                    <CategoryBadge category={category} />
                    <span className="text-xs text-gray-400 ml-2">AI zasugerowało tę kategorię</span>
                  </div>
                </div>

                {/* Custom value */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Wartość (PLN) – możesz zmienić
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={customValue}
                      onChange={e => setCustomValue(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition text-gray-900 pr-16"
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-gray-400 font-medium">
                      PLN
                    </span>
                  </div>
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
                disabled={step === 'saving'}
                className="flex-1 flex items-center justify-center gap-2 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-semibold rounded-xl transition-colors shadow-md shadow-emerald-200"
              >
                {step === 'saving' ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Zapisuję...
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-5 h-5" />
                    Potwierdź i zapisz
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Step: Saved */}
        {step === 'saved' && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center">
            <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <CheckCircle className="w-10 h-10 text-emerald-600" />
            </div>
            <h3 className="text-2xl font-bold text-gray-900 mb-2">Zapisano!</h3>
            <p className="text-gray-500 mb-2">
              <strong className="text-gray-800">{name}</strong> zostało dodane do Twojego majątku.
            </p>
            <p className="text-sm text-gray-400 mb-8">
              Wartość: <strong className="text-indigo-700">{formatPLN(parseFloat(customValue))}</strong>
            </p>
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
