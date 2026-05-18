'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import Navigation from '@/components/Navigation';
import { formatPLN } from '@/components/AssetCard';
import CategoryBadge from '@/components/CategoryBadge';
import type { AssetCategory } from '@/types';
import { BarChart2, Users, RefreshCw } from 'lucide-react';

interface UserData {
  id:           string;
  username:     string;
  total_wealth: number;
  categories:   Record<string, number>;
}

interface Holder {
  userId:   string;
  username: string;
  value:    number;
  quantity: number;
  category: string;
}

interface SharedAsset {
  name:     string;
  category: string;
  holders:  Holder[];
}

interface StatsData {
  users:          UserData[];
  sharedAssets:   SharedAsset[];
  currentUserId:  string;
}

const ALL_CATEGORIES: string[] = [
  'Akcje', 'Kruszce', 'Gotówka', 'Finanse',
  'Nieruchomości', 'Pojazdy', 'Elektronika', 'Przedmioty kolekcjonerskie', 'Inne',
];

export default function StatsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [data, setData]           = useState<StatsData | null>(null);
  const [fetchLoading, setFetchLoading] = useState(true);

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [user, loading, router]);

  const fetchStats = useCallback(async () => {
    setFetchLoading(true);
    try {
      const res = await fetch('/api/stats');
      if (res.ok) setData(await res.json());
    } catch (e) {
      console.error('[stats]', e);
    } finally {
      setFetchLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) fetchStats();
  }, [user, fetchStats]);

  if (loading || fetchLoading) {
    return (
      <>
        <Navigation />
        <div className="min-h-screen flex items-center justify-center">
          <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </>
    );
  }

  if (!data) return null;

  const { users, sharedAssets, currentUserId } = data;
  const sortedUsers = [...users].sort((a, b) => b.total_wealth - a.total_wealth);

  // Categories present across all users
  const presentCats = ALL_CATEGORIES.filter(cat =>
    users.some(u => (u.categories[cat] ?? 0) > 0)
  );

  return (
    <>
      <Navigation />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-10">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-violet-500/20 rounded-xl flex items-center justify-center">
              <BarChart2 className="w-5 h-5 text-violet-400" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-slate-100">Statystyki</h2>
              <p className="text-slate-500 text-sm">{users.length} użytkowników w systemie</p>
            </div>
          </div>
          <button
            onClick={fetchStats}
            className="p-2.5 border border-slate-700 rounded-xl text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors"
            title="Odśwież"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {/* ── Portfolio breakdown by category ── */}
        {presentCats.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-4">
              <Users className="w-5 h-5 text-slate-400" />
              <h3 className="text-lg font-semibold text-slate-200">Portfele wg kategorii</h3>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700">
                    <th className="text-left py-3 px-3 text-slate-400 font-medium w-36">Kategoria</th>
                    {sortedUsers.map(u => (
                      <th key={u.id} className={`text-right py-3 px-3 font-medium ${u.id === currentUserId ? 'text-indigo-400' : 'text-slate-400'}`}>
                        {u.username}
                        {u.id === currentUserId && <span className="ml-1 text-xs text-indigo-500">(Ty)</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {presentCats.map(cat => (
                    <tr key={cat} className="border-b border-slate-800 hover:bg-slate-800/50 transition-colors">
                      <td className="py-3 px-3">
                        <CategoryBadge category={cat as AssetCategory} />
                      </td>
                      {sortedUsers.map(u => {
                        const val = u.categories[cat] ?? 0;
                        return (
                          <td key={u.id} className={`text-right py-3 px-3 font-medium ${val > 0 ? (u.id === currentUserId ? 'text-indigo-300' : 'text-slate-200') : 'text-slate-600'}`}>
                            {val > 0 ? formatPLN(val) : '–'}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  {/* Total row */}
                  <tr className="border-t-2 border-slate-600">
                    <td className="py-3 px-3 font-semibold text-slate-300">Łącznie</td>
                    {sortedUsers.map(u => (
                      <td key={u.id} className={`text-right py-3 px-3 font-bold text-base ${u.id === currentUserId ? 'text-indigo-400' : 'text-slate-200'}`}>
                        {formatPLN(u.total_wealth)}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* ── Shared assets ── */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <span className="text-lg">🤝</span>
            <h3 className="text-lg font-semibold text-slate-200">Wspólne aktywa</h3>
            <span className="text-slate-500 text-sm">({sharedAssets.length})</span>
          </div>

          {sharedAssets.length === 0 ? (
            <div className="text-center py-12 bg-slate-800 rounded-2xl border border-dashed border-slate-700">
              <div className="text-4xl mb-3">📊</div>
              <p className="text-slate-400 text-sm">
                Żaden użytkownik nie posiada tego samego aktywa co inny.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {sharedAssets.map(asset => (
                <div key={asset.name} className="bg-slate-800 rounded-2xl border border-slate-700/60 p-5">
                  <div className="flex items-center gap-3 mb-4">
                    <CategoryBadge category={asset.category as AssetCategory} />
                    <span className="font-semibold text-slate-100 text-base">{asset.name}</span>
                  </div>

                  {/* Bar comparison */}
                  <div className="space-y-3">
                    {asset.holders.map((holder, idx) => {
                      const maxVal = asset.holders[0].value;
                      const pct    = maxVal > 0 ? (holder.value / maxVal) * 100 : 0;
                      const isMe   = holder.userId === currentUserId;
                      return (
                        <div key={holder.userId}>
                          <div className="flex items-center justify-between mb-1">
                            <span className={`text-sm font-medium ${isMe ? 'text-indigo-300' : 'text-slate-300'}`}>
                              {holder.username}
                              {isMe && <span className="ml-1.5 text-xs text-indigo-500">(Ty)</span>}
                            </span>
                            <div className="flex items-center gap-3 text-sm">
                              {holder.quantity !== 1 && (
                                <span className="text-slate-500 text-xs">
                                  {parseFloat(holder.quantity.toFixed(4))} szt.
                                </span>
                              )}
                              <span className={`font-bold ${isMe ? 'text-indigo-400' : idx === 0 ? 'text-emerald-400' : 'text-slate-300'}`}>
                                {formatPLN(holder.value)}
                              </span>
                            </div>
                          </div>
                          <div className="w-full bg-slate-700 rounded-full h-2">
                            <div
                              className={`h-2 rounded-full transition-all duration-500 ${isMe ? 'bg-indigo-500' : idx === 0 ? 'bg-emerald-500' : 'bg-slate-500'}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

      </main>
    </>
  );
}
