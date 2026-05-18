'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import Navigation from '@/components/Navigation';
import AssetCard, { formatPLN } from '@/components/AssetCard';
import CategoryBadge from '@/components/CategoryBadge';
import type { Asset, AssetCategory } from '@/types';
import { PlusCircle, TrendingUp, Package, Layers } from 'lucide-react';

const CATEGORY_ORDER: AssetCategory[] = ['Finanse', 'Nieruchomości', 'Elektronika', 'Inne'];

export default function DashboardPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [fetchLoading, setFetchLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [user, loading, router]);

  const fetchAssets = useCallback(async () => {
    setFetchLoading(true);
    const res = await fetch('/api/assets');
    if (res.ok) {
      const data = await res.json();
      setAssets(data.assets);
    }
    setFetchLoading(false);
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

  const totalValue = assets.reduce((sum, a) => sum + a.value, 0);

  const byCategory = CATEGORY_ORDER.map(cat => ({
    category: cat,
    assets: assets.filter(a => a.category === cat),
    total: assets.filter(a => a.category === cat).reduce((s, a) => s + a.value, 0),
  })).filter(g => g.assets.length > 0);

  if (loading || fetchLoading) {
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
        {/* Welcome */}
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-gray-900">
            Witaj, <span className="text-indigo-600">{user?.username}</span> 👋
          </h2>
          <p className="text-gray-500 mt-1">Oto przegląd Twojego majątku</p>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <div className="bg-gradient-to-br from-indigo-600 to-indigo-700 rounded-2xl p-6 text-white shadow-lg shadow-indigo-200">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                <TrendingUp className="w-5 h-5" />
              </div>
              <span className="text-sm font-medium opacity-80">Łączny majątek</span>
            </div>
            <p className="text-3xl font-bold">{formatPLN(totalValue)}</p>
          </div>

          <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center">
                <Package className="w-5 h-5 text-emerald-600" />
              </div>
              <span className="text-sm font-medium text-gray-500">Liczba aktywów</span>
            </div>
            <p className="text-3xl font-bold text-gray-900">{assets.length}</p>
          </div>

          <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center">
                <Layers className="w-5 h-5 text-amber-600" />
              </div>
              <span className="text-sm font-medium text-gray-500">Kategorie</span>
            </div>
            <p className="text-3xl font-bold text-gray-900">{byCategory.length}</p>
          </div>
        </div>

        {/* Assets */}
        {assets.length === 0 ? (
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
                      deleting={deletingId === asset.id}
                    />
                  ))}
                </div>
              </section>
            ))}

            <div className="flex justify-end">
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
