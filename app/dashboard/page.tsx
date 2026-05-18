'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import Navigation from '@/components/Navigation';
import AssetCard, { formatPLN } from '@/components/AssetCard';
import CategoryBadge from '@/components/CategoryBadge';
import type { Asset, AssetCategory } from '@/types';
import { FINANCE_CATEGORIES } from '@/types';
import {
  PlusCircle, TrendingUp,
  RefreshCw, ArrowUpDown, ChevronDown, ChevronRight,
  Sparkles,
} from 'lucide-react';

const FINANCE_CATS: AssetCategory[] = ['Akcje', 'Kruszce', 'Gotówka', 'Finanse'];
const OTHER_CATS:   AssetCategory[] = ['Nieruchomości', 'Pojazdy', 'Elektronika', 'Przedmioty kolekcjonerskie', 'Inne'];

function AssetSkeleton() {
  return (
    <div className="space-y-2">
      {[1, 2, 3].map(i => (
        <div key={i} className="h-16 bg-slate-800 rounded-xl animate-pulse border border-slate-700/50" />
      ))}
    </div>
  );
}

export default function DashboardPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [assets,       setAssets]       = useState<Asset[]>([]);
  const [fetchLoading, setFetchLoading] = useState(true);
  const [deletingId,   setDeletingId]   = useState<string | null>(null);

  // Finance refresh
  const [refreshing,    setRefreshing]    = useState(false);
  const [refreshMsg,    setRefreshMsg]    = useState<string | null>(null);
  const [refreshedIds,  setRefreshedIds]  = useState<Set<string>>(new Set());

  // Other-category refresh
  const [refreshingOther, setRefreshingOther] = useState(false);

  // Sort: 'value' = highest first, 'date' = newest first
  const [sortBy, setSortBy] = useState<'value' | 'date'>('value');

  // Collapsed sections (string keys: 'finanse' parent, or category name for others)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [user, loading, router]);

  const fetchAssets = useCallback(async () => {
    setFetchLoading(true);
    try {
      const res = await fetch('/api/assets', { signal: AbortSignal.timeout(12_000) });
      if (res.ok) {
        const data = await res.json();
        setAssets(data.assets ?? []);
      }
    } catch (err) {
      console.error('[dashboard] fetchAssets error:', err);
    } finally {
      setFetchLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) fetchAssets();
  }, [user, fetchAssets]);

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    const res = await fetch(`/api/assets/${id}`, { method: 'DELETE' });
    if (res.ok) setAssets(prev => prev.filter(a => a.id !== id));
    setDeletingId(null);
  };

  const handleEdit = useCallback(
    async (id: string, changes: { name: string; quantity: number; category: AssetCategory }) => {
      const res = await fetch(`/api/assets/${id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(changes),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((d as { error?: string }).error ?? `Błąd (HTTP ${res.status})`);
      const updated = (d as { asset: typeof assets[0] }).asset;
      setAssets(prev => prev.map(a => (a.id === id ? updated : a)));
    },
    [],
  );

  // ── Finance refresh ───────────────────────────────────────────────────────────
  const handleRefresh = async () => {
    setRefreshing(true);
    setRefreshMsg(null);
    try {
      const res  = await fetch('/api/assets/refresh', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setAssets(data.assets);
        if (data.updatedIds?.length) {
          setRefreshedIds(new Set(data.updatedIds));
          setTimeout(() => setRefreshedIds(new Set()), 4_500);
        }
        router.refresh();
        setRefreshMsg(
          data.failed > 0
            ? `Zaktualizowano ${data.updated} aktywów (${data.failed} nie udało się).`
            : `Zaktualizowano ${data.updated} aktywów giełdowych.`,
        );
        setTimeout(() => setRefreshMsg(null), 6000);
      } else {
        setRefreshMsg('Błąd odświeżania. Spróbuj ponownie.');
      }
    } catch {
      setRefreshMsg('Błąd połączenia.');
    } finally {
      setRefreshing(false);
    }
  };

  // ── Other-category refresh ────────────────────────────────────────────────────
  const handleRefreshOther = async () => {
    setRefreshingOther(true);
    setRefreshMsg(null);
    try {
      const res  = await fetch('/api/assets/refresh', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ type: 'other' }),
      });
      const data = await res.json();
      if (res.ok) {
        setAssets(data.assets);
        if (data.updatedIds?.length) {
          setRefreshedIds(new Set(data.updatedIds));
          setTimeout(() => setRefreshedIds(new Set()), 4_500);
        }
        router.refresh();
        setRefreshMsg(
          data.failed > 0
            ? `Zaktualizowano ${data.updated} aktywów opisowych (${data.failed} nie udało się).`
            : `Zaktualizowano ${data.updated} aktywów opisowych przez AI.`,
        );
        setTimeout(() => setRefreshMsg(null), 6000);
      } else {
        setRefreshMsg('Błąd odświeżania aktywów opisowych.');
      }
    } catch {
      setRefreshMsg('Błąd połączenia.');
    } finally {
      setRefreshingOther(false);
    }
  };

  // ── Toggle collapse ───────────────────────────────────────────────────────────
  const toggleCollapse = (key: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  // ── Derived ───────────────────────────────────────────────────────────────────
  const totalValue = assets.reduce((sum, a) => sum + a.value, 0);

  const sortedGroup = (list: Asset[]) =>
    [...list].sort((a, b) =>
      sortBy === 'value'
        ? b.value - a.value
        : new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );

  // Finance sub-groups
  const financeSubGroups = FINANCE_CATS.map(cat => {
    const list = sortedGroup(assets.filter(a => a.category === cat));
    return { category: cat, assets: list, total: list.reduce((s, a) => s + a.value, 0) };
  }).filter(g => g.assets.length > 0);
  const financeTotal = financeSubGroups.reduce((s, g) => s + g.total, 0);

  // Non-finance groups
  const otherGroups = OTHER_CATS.map(cat => {
    const list = sortedGroup(assets.filter(a => a.category === cat));
    return { category: cat, assets: list, total: list.reduce((s, a) => s + a.value, 0) };
  }).filter(g => g.assets.length > 0);

  // For refresh button visibility
  const MARKET_CATS = new Set<AssetCategory>(['Finanse', 'Akcje', 'Kruszce']);
  const hasMarket = assets.some(a => MARKET_CATS.has(a.category));
  const hasOther  = assets.some(a => !FINANCE_CATEGORIES.has(a.category));

  if (loading || !user) {
    return (
      <>
        <Navigation />
        <div className="min-h-screen flex items-center justify-center">
          <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </>
    );
  }

  return (
    <>
      <Navigation />
      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8">

        {/* ── Header ── */}
        <div className="flex items-start justify-between mb-8 gap-4 flex-wrap">
          <div>
            <h2 className="text-2xl font-bold text-slate-100">
              Witaj, <span className="text-indigo-400">{user.username}</span> 👋
            </h2>
            <p className="text-slate-500 mt-1">Oto przegląd Twojego majątku</p>
          </div>

          {/* Refresh buttons */}
          {!fetchLoading && (hasMarket || hasOther) && (
            <div className="flex gap-2 flex-wrap">
              {hasMarket && (
                <button
                  onClick={handleRefresh}
                  disabled={refreshing || refreshingOther}
                  title="Odśwież kursy giełdowe (Akcje, Kruszce)"
                  className="flex items-center gap-2 px-4 py-2.5 bg-slate-800 border border-slate-700 text-slate-300 rounded-xl text-sm font-medium hover:bg-slate-700 hover:border-indigo-500/40 hover:text-indigo-300 transition-colors disabled:opacity-50"
                >
                  <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                  {refreshing ? 'Odświeżam…' : 'Odśwież Finanse'}
                </button>
              )}
              {hasOther && (
                <button
                  onClick={handleRefreshOther}
                  disabled={refreshing || refreshingOther}
                  title="Odśwież wyceny AI (Nieruchomości, Pojazdy, Elektronika, Przedmioty kolekcjonerskie, Inne)"
                  className="flex items-center gap-2 px-4 py-2.5 bg-slate-800 border border-slate-700 text-slate-300 rounded-xl text-sm font-medium hover:bg-slate-700 hover:border-violet-500/40 hover:text-violet-300 transition-colors disabled:opacity-50"
                >
                  <Sparkles className={`w-4 h-4 ${refreshingOther ? 'animate-spin' : ''}`} />
                  {refreshingOther ? 'Wyceniam AI…' : 'Odśwież inne AI'}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Status message */}
        {refreshMsg && (
          <div className="mb-6 px-4 py-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-sm text-emerald-300">
            {refreshMsg}
          </div>
        )}

        {/* ── Summary card (tylko majątek) ── */}
        <div className="mb-8">
          <div className="bg-gradient-to-br from-indigo-600 to-indigo-800 rounded-2xl p-6 text-white shadow-xl shadow-indigo-900/30 flex items-center gap-6">
            <div className="w-12 h-12 bg-white/10 rounded-xl flex items-center justify-center shrink-0">
              <TrendingUp className="w-6 h-6" />
            </div>
            <div>
              <span className="text-sm font-medium text-indigo-200">Łączny majątek</span>
              <p className="text-3xl font-bold mt-0.5">
                {fetchLoading
                  ? <span className="inline-block w-40 h-9 bg-white/20 rounded-lg animate-pulse" />
                  : formatPLN(totalValue)}
              </p>
            </div>
          </div>
        </div>

        {/* ── Assets ── */}
        {fetchLoading ? (
          <AssetSkeleton />
        ) : assets.length === 0 ? (
          <div className="text-center py-20 bg-slate-800 rounded-2xl border border-dashed border-slate-700">
            <div className="text-5xl mb-4">💼</div>
            <h3 className="text-xl font-semibold text-slate-200 mb-2">Brak aktywów</h3>
            <p className="text-slate-500 mb-6">Zacznij śledzić majątek – dodaj pierwszy element.</p>
            <Link
              href="/add-asset"
              className="inline-flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-500 transition-colors shadow-lg shadow-indigo-900/40"
            >
              <PlusCircle className="w-4 h-4" />
              Dodaj pierwsze aktywo
            </Link>
          </div>
        ) : (
          <div className="space-y-6">

            {/* Sort toggle */}
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500 uppercase tracking-wide font-medium">Sortuj w kategorii</span>
              <button
                onClick={() => setSortBy(s => s === 'value' ? 'date' : 'value')}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 border border-slate-700 text-slate-400 rounded-lg text-xs font-medium hover:bg-slate-700 hover:text-slate-200 transition-colors"
              >
                <ArrowUpDown className="w-3.5 h-3.5" />
                {sortBy === 'value' ? 'Wartość ↓' : 'Data dodania ↓'}
              </button>
            </div>

            {/* ── Finanse (parent group) ── */}
            {financeSubGroups.length > 0 && (() => {
              const parentKey = '__finanse__';
              const isParentCollapsed = collapsed.has(parentKey);
              return (
                <section>
                  {/* Parent Finanse header */}
                  <button
                    onClick={() => toggleCollapse(parentKey)}
                    className="w-full flex items-center justify-between mb-3 group"
                  >
                    <div className="flex items-center gap-2">
                      {isParentCollapsed
                        ? <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-slate-300 transition-colors" />
                        : <ChevronDown  className="w-4 h-4 text-slate-500 group-hover:text-slate-300 transition-colors" />
                      }
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                        <span>📊</span> Finanse
                      </span>
                      <span className="text-sm text-slate-500">
                        ({financeSubGroups.reduce((s, g) => s + g.assets.length, 0)})
                      </span>
                    </div>
                    <span className="text-sm font-semibold text-slate-300">{formatPLN(financeTotal)}</span>
                  </button>

                  {/* Sub-groups */}
                  {!isParentCollapsed && (
                    <div className="pl-4 border-l-2 border-slate-700/60 space-y-4">
                      {financeSubGroups.map(({ category, assets: catAssets, total }) => {
                        const subKey = `sub_${category}`;
                        const isCollapsed = collapsed.has(subKey);
                        return (
                          <div key={category}>
                            <button
                              onClick={() => toggleCollapse(subKey)}
                              className="w-full flex items-center justify-between mb-2 group"
                            >
                              <div className="flex items-center gap-2">
                                {isCollapsed
                                  ? <ChevronRight className="w-3.5 h-3.5 text-slate-600 group-hover:text-slate-400 transition-colors" />
                                  : <ChevronDown  className="w-3.5 h-3.5 text-slate-600 group-hover:text-slate-400 transition-colors" />
                                }
                                <CategoryBadge category={category} />
                                <span className="text-xs text-slate-500">({catAssets.length})</span>
                              </div>
                              <span className="text-xs font-semibold text-slate-400">{formatPLN(total)}</span>
                            </button>
                            {!isCollapsed && (
                              <div className="space-y-2">
                                {catAssets.map(asset => (
                                  <AssetCard
                                    key={asset.id}
                                    asset={asset}
                                    onDelete={handleDelete}
                                    onEdit={handleEdit}
                                    deleting={deletingId === asset.id}
                                    refreshed={refreshedIds.has(asset.id)}
                                  />
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              );
            })()}

            {/* ── Other categories ── */}
            {otherGroups.map(({ category, assets: catAssets, total }) => {
              const key = category;
              const isCollapsed = collapsed.has(key);
              return (
                <section key={category}>
                  <button
                    onClick={() => toggleCollapse(key)}
                    className="w-full flex items-center justify-between mb-3 group"
                  >
                    <div className="flex items-center gap-2">
                      {isCollapsed
                        ? <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-slate-300 transition-colors" />
                        : <ChevronDown  className="w-4 h-4 text-slate-500 group-hover:text-slate-300 transition-colors" />
                      }
                      <CategoryBadge category={category} />
                      <span className="text-sm text-slate-500">({catAssets.length})</span>
                    </div>
                    <span className="text-sm font-semibold text-slate-300">{formatPLN(total)}</span>
                  </button>
                  {!isCollapsed && (
                    <div className="space-y-2">
                      {catAssets.map(asset => (
                        <AssetCard
                          key={asset.id}
                          asset={asset}
                          onDelete={handleDelete}
                          onEdit={handleEdit}
                          deleting={deletingId === asset.id}
                          refreshed={refreshedIds.has(asset.id)}
                        />
                      ))}
                    </div>
                  )}
                </section>
              );
            })}

            <div className="flex items-center justify-between pt-2 border-t border-slate-800">
              <div className="flex gap-2">
                {hasMarket && (
                  <button
                    onClick={handleRefresh}
                    disabled={refreshing || refreshingOther}
                    className="flex items-center gap-2 px-3 py-2 border border-slate-700 text-slate-500 rounded-xl text-xs hover:bg-slate-800 hover:text-slate-300 transition-colors disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                    {refreshing ? 'Odświeżam…' : 'Odśwież Finanse'}
                  </button>
                )}
                {hasOther && (
                  <button
                    onClick={handleRefreshOther}
                    disabled={refreshing || refreshingOther}
                    className="flex items-center gap-2 px-3 py-2 border border-slate-700 text-slate-500 rounded-xl text-xs hover:bg-slate-800 hover:text-violet-300 transition-colors disabled:opacity-50"
                  >
                    <Sparkles className={`w-3.5 h-3.5 ${refreshingOther ? 'animate-spin' : ''}`} />
                    {refreshingOther ? 'Wyceniam…' : 'Odśwież AI'}
                  </button>
                )}
              </div>

              <Link
                href="/add-asset"
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-500 transition-colors shadow-lg shadow-indigo-900/30"
              >
                <PlusCircle className="w-4 h-4" />
                Dodaj kolejne
              </Link>
            </div>
          </div>
        )}
      </main>
    </>
  );
}
