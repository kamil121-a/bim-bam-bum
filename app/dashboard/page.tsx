'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import Navigation from '@/components/Navigation';
import AssetCard, { formatPLN } from '@/components/AssetCard';
import CategoryBadge from '@/components/CategoryBadge';
import type { Asset, AssetCategory } from '@/types';
import { PlusCircle, TrendingUp, Package, Layers, RefreshCw } from 'lucide-react';

const CATEGORY_ORDER: AssetCategory[] = ['Finanse', 'Nieruchomości', 'Elektronika', 'Inne'];

// Skeleton placeholder while assets are loading
function AssetSkeleton() {
  return (
    <div className="space-y-2">
      {[1, 2, 3].map(i => (
        <div key={i} className="h-16 bg-gray-100 rounded-xl animate-pulse" />
      ))}
    </div>
  );
}

export default function DashboardPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [fetchLoading, setFetchLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null);
  // IDs of assets that were just refreshed — drives green checkmark in AssetCard
  const [refreshedIds, setRefreshedIds] = useState<Set<string>>(new Set());

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
    if (res.ok) {
      setAssets(prev => prev.filter(a => a.id !== id));
    }
    setDeletingId(null);
  };

  const handleEdit = useCallback(
    async (id: string, changes: { name: string; quantity: number }) => {
      const res = await fetch(`/api/assets/${id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(changes),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((d as { error?: string }).error ?? `Błąd aktualizacji (HTTP ${res.status})`);
      }
      const updated = (d as { asset: typeof assets[0] }).asset;
      setAssets(prev => prev.map(a => (a.id === id ? updated : a)));
    },
    [],
  );

  const handleRefresh = async () => {
    setRefreshing(true);
    setRefreshMsg(null);
    try {
      const res = await fetch('/api/assets/refresh', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setAssets(data.assets);
        // Highlight successfully refreshed assets with green checkmarks
        if (data.updatedIds?.length) {
          setRefreshedIds(new Set(data.updatedIds));
          setTimeout(() => setRefreshedIds(new Set()), 4_500);
        }
        router.refresh();
        const msg =
          data.failed > 0
            ? `Zaktualizowano ${data.updated} aktywów (${data.failed} nie udało się wycenić).`
            : `Zaktualizowano ${data.updated} aktywów według aktualnych cen rynkowych.`;
        setRefreshMsg(msg);
        setTimeout(() => setRefreshMsg(null), 6000);
      } else {
        setRefreshMsg('Błąd odświeżania. Spróbuj ponownie.');
      }
    } catch {
      setRefreshMsg('Błąd połączenia. Spróbuj ponownie.');
    } finally {
      setRefreshing(false);
    }
  };

  const totalValue = assets.reduce((sum, a) => sum + a.value, 0);

  const byCategory = CATEGORY_ORDER.map(cat => ({
    category: cat,
    assets: assets.filter(a => a.category === cat),
    total: assets.filter(a => a.category === cat).reduce((s, a) => s + a.value, 0),
  })).filter(g => g.assets.length > 0);

  // Only block the WHOLE page during auth check (very fast with getSession fast-path).
  // Assets load in the background without blocking the full page render.
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
      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8">

        {/* Welcome + refresh button */}
        <div className="flex items-start justify-between mb-8 gap-4">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">
              Witaj, <span className="text-indigo-600">{user?.username}</span> 👋
            </h2>
            <p className="text-gray-500 mt-1">Oto przegląd Twojego majątku</p>
          </div>

          {!fetchLoading && assets.length > 0 && (
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              title="Ponownie wycenia wszystkie aktywa przez AI i aktualizuje ceny"
              className="shrink-0 flex items-center gap-2 px-4 py-2.5 bg-white border border-gray-200 text-gray-600 rounded-xl text-sm font-medium hover:bg-indigo-50 hover:border-indigo-200 hover:text-indigo-700 transition-colors shadow-sm disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
              {refreshing ? 'Odświeżam…' : 'Odśwież wartość majątku'}
            </button>
          )}
        </div>

        {/* Refresh status message */}
        {refreshMsg && (
          <div className="mb-6 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-700">
            {refreshMsg}
          </div>
        )}

        {/* Summary cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <div className="bg-gradient-to-br from-indigo-600 to-indigo-700 rounded-2xl p-6 text-white shadow-lg shadow-indigo-200">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                <TrendingUp className="w-5 h-5" />
              </div>
              <span className="text-sm font-medium opacity-80">Łączny majątek</span>
            </div>
            <p className="text-3xl font-bold">
              {fetchLoading ? (
                <span className="inline-block w-32 h-8 bg-white/20 rounded-lg animate-pulse" />
              ) : (
                formatPLN(totalValue)
              )}
            </p>
          </div>

          <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center">
                <Package className="w-5 h-5 text-emerald-600" />
              </div>
              <span className="text-sm font-medium text-gray-500">Liczba aktywów</span>
            </div>
            <p className="text-3xl font-bold text-gray-900">
              {fetchLoading ? (
                <span className="inline-block w-10 h-8 bg-gray-100 rounded-lg animate-pulse" />
              ) : (
                assets.length
              )}
            </p>
          </div>

          <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center">
                <Layers className="w-5 h-5 text-amber-600" />
              </div>
              <span className="text-sm font-medium text-gray-500">Kategorie</span>
            </div>
            <p className="text-3xl font-bold text-gray-900">
              {fetchLoading ? (
                <span className="inline-block w-10 h-8 bg-gray-100 rounded-lg animate-pulse" />
              ) : (
                byCategory.length
              )}
            </p>
          </div>
        </div>

        {/* Assets list — skeleton while loading, then real content */}
        {fetchLoading ? (
          <AssetSkeleton />
        ) : assets.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-2xl border border-dashed border-gray-200">
            <div className="text-5xl mb-4">💼</div>
            <h3 className="text-xl font-semibold text-gray-700 mb-2">Brak aktywów</h3>
            <p className="text-gray-400 mb-6">Zacznij śledzić swój majątek – dodaj pierwszy element.</p>
            <Link
              href="/add-asset"
              className="inline-flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 transition-colors shadow-md shadow-indigo-200"
            >
              <PlusCircle className="w-4 h-4" />
              Dodaj pierwsze aktywo
            </Link>
          </div>
        ) : (
          <div className="space-y-8">
            {byCategory.map(({ category, assets: catAssets, total }) => (
              <section key={category}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <CategoryBadge category={category} />
                    <span className="text-sm text-gray-400">({catAssets.length})</span>
                  </div>
                  <span className="text-sm font-semibold text-gray-700">{formatPLN(total)}</span>
                </div>
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
              </section>
            ))}

            <div className="flex items-center justify-between pt-2">
              <button
                onClick={handleRefresh}
                disabled={refreshing}
                className="flex items-center gap-2 px-4 py-2 border border-gray-200 text-gray-500 rounded-xl text-sm hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                {refreshing ? 'Odświeżam ceny…' : 'Odśwież wyceny AI'}
              </button>

              <Link
                href="/add-asset"
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 transition-colors shadow-md shadow-indigo-200"
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
