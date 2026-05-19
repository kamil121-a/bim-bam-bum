'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import Navigation from '@/components/Navigation';
import { formatPLN } from '@/components/AssetCard';
import CategoryBadge from '@/components/CategoryBadge';
import type { AssetCategory } from '@/types';
import { ASSET_CATEGORIES } from '@/types';
import { BarChart2, Users, RefreshCw, Coins, Trophy } from 'lucide-react';
import { fetchWithSupabaseAuth } from '@/lib/supabase';
import { useSupabaseBrowser } from '@/lib/use-supabase-browser';

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

interface CashLeaderboardRow {
  rank:     number;
  userId:   string;
  username: string;
  quantity: number;
}

interface CashCurrencyBlock {
  currency:    string;
  leaderboard: CashLeaderboardRow[];
}

interface CategoryRankingRow {
  rank:     number;
  userId:   string;
  username: string;
  totalPln: number;
}

interface CategoryRankingBlock {
  category: string;
  rankings: CategoryRankingRow[];
}

interface StatsData {
  users:             UserData[];
  sharedAssets:      SharedAsset[];
  cashByCurrency?:   CashCurrencyBlock[];
  categoryRankings?: CategoryRankingBlock[];
  currentUserId:     string;
}

function formatCashQuantity(qty: number, currency: string): string {
  const n = parseFloat(qty.toFixed(6));
  return `${n.toLocaleString('pl-PL', { maximumFractionDigits: 4 })} ${currency}`;
}

export default function StatsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const supabase = useSupabaseBrowser();
  const [data, setData]           = useState<StatsData | null>(null);
  const [fetchLoading, setFetchLoading] = useState(true);

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [user, loading, router]);

  const fetchStats = useCallback(async () => {
    setFetchLoading(true);
    try {
      const res = await fetchWithSupabaseAuth(supabase, '/api/stats');
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

  const { users, sharedAssets, cashByCurrency = [], categoryRankings = [], currentUserId } = data;
  const sortedUsers = [...users].sort((a, b) => b.total_wealth - a.total_wealth);
  const nickList    = [...users].sort((a, b) => a.username.localeCompare(b.username, 'pl'));

  const presentCats = ASSET_CATEGORIES.filter(cat =>
    users.some(u => (u.categories[cat] ?? 0) > 0),
  );

  const hasCash = cashByCurrency.some(c => c.leaderboard.length > 0);

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

        {/* Uczestnicy – nicki */}
        {nickList.length > 0 && (
          <div className="rounded-2xl border border-slate-700/60 bg-slate-800/80 px-4 py-3">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
              Nicki w zestawieniach
            </p>
            <div className="flex flex-wrap gap-2">
              {nickList.map(u => (
                <span
                  key={u.id}
                  className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold border ${
                    u.id === currentUserId
                      ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40'
                      : 'bg-slate-700/80 text-slate-200 border-slate-600'
                  }`}
                >
                  @{u.username}
                  {u.id === currentUserId && <span className="ml-1 text-[10px] text-indigo-400 font-normal">(Ty)</span>}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* ── 1. Wspólne aktywa (na górze) ── */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Trophy className="w-5 h-5 text-amber-400" />
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
                  <div className="flex items-center gap-3 mb-4 flex-wrap">
                    <CategoryBadge category={asset.category as AssetCategory} />
                    <span className="font-semibold text-slate-100 text-base">{asset.name}</span>
                  </div>

                  <div className="space-y-3">
                    {asset.holders.map((holder, idx) => {
                      const maxVal = asset.holders[0].value;
                      const pct    = maxVal > 0 ? (holder.value / maxVal) * 100 : 0;
                      const isMe   = holder.userId === currentUserId;
                      return (
                        <div key={holder.userId}>
                          <div className="flex items-center justify-between mb-1 gap-2 flex-wrap">
                            <span className={`text-sm font-semibold ${isMe ? 'text-indigo-300' : 'text-slate-200'}`}>
                              Nick:{' '}
                              <span className="font-mono text-slate-100">@{holder.username}</span>
                              {isMe && <span className="ml-1 text-xs text-indigo-500 font-normal">(Ty)</span>}
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

        {/* ── 2. Gotówka – jeden kafelek, wyłącznie waluta pierwotna ── */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Coins className="w-5 h-5 text-emerald-400" />
            <h3 className="text-lg font-semibold text-slate-200">Gotówka</h3>
          </div>
          <p className="text-sm text-slate-500 mb-4">
            Ilość w <strong className="text-slate-400">walucie pierwotnej</strong> (bez przeliczania na PLN).
          </p>

          {!hasCash ? (
            <div className="text-center py-10 bg-slate-800 rounded-2xl border border-dashed border-slate-700 text-slate-500 text-sm">
              Brak zapisanej gotówki w kategorii „Gotówka”.
            </div>
          ) : (
            <div className="bg-slate-800 rounded-2xl border border-emerald-500/20 p-6 space-y-8 shadow-lg shadow-black/20">
              {cashByCurrency.filter(c => c.leaderboard.length > 0).map(block => (
                <div key={block.currency}>
                  <h4 className="text-sm font-bold text-emerald-400 mb-3 flex items-center gap-2">
                    <span className="text-lg">{block.currency}</span>
                    <span className="text-slate-500 font-normal text-xs">ranking po ilości</span>
                  </h4>
                  <ul className="space-y-2">
                    {block.leaderboard.map(row => {
                      const isMe = row.userId === currentUserId;
                      return (
                        <li
                          key={row.userId}
                          className={`flex items-center justify-between gap-3 rounded-xl px-3 py-2 border ${
                            isMe ? 'bg-indigo-500/10 border-indigo-500/30' : 'bg-slate-900/40 border-slate-700/50'
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <span className="text-slate-500 font-mono text-xs w-8 shrink-0">#{row.rank}</span>
                            <span className={`truncate font-semibold ${isMe ? 'text-indigo-300' : 'text-slate-200'}`}>
                              Nick: <span className="font-mono">@{row.username}</span>
                              {isMe && <span className="text-xs text-indigo-500 ml-1 font-normal">(Ty)</span>}
                            </span>
                          </div>
                          <span className="font-mono text-sm text-emerald-300 shrink-0">
                            {formatCashQuantity(row.quantity, block.currency)}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── 3. Ranking wg kategorii (wartość w PLN w kategorii) ── */}
        {categoryRankings.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-4">
              <Trophy className="w-5 h-5 text-violet-400" />
              <h3 className="text-lg font-semibold text-slate-200">Ranking wg kategorii</h3>
            </div>
            <p className="text-sm text-slate-500 mb-6">
              Kolejność od najwyższej sumy wartości w PLN w danej kategorii – z nickami użytkowników.
            </p>
            <div className="space-y-6">
              {categoryRankings.map(({ category, rankings }) => (
                <div
                  key={category}
                  className="bg-slate-800 rounded-2xl border border-slate-700/60 overflow-hidden"
                >
                  <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-700 bg-slate-900/40">
                    <CategoryBadge category={category as AssetCategory} />
                    <span className="text-xs text-slate-500">{rankings.length} użytkowników</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-700 text-left text-slate-500">
                          <th className="py-2 px-4 font-medium w-14">#</th>
                          <th className="py-2 px-4 font-medium">Nick</th>
                          <th className="py-2 px-4 font-medium text-right">Wartość (PLN)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rankings.map(row => {
                          const isMe = row.userId === currentUserId;
                          return (
                            <tr
                              key={row.userId}
                              className={`border-b border-slate-800 last:border-0 ${
                                isMe ? 'bg-indigo-500/5' : 'hover:bg-slate-800/80'
                              }`}
                            >
                              <td className="py-2.5 px-4 text-slate-500 font-mono">{row.rank}</td>
                              <td className={`py-2.5 px-4 font-semibold ${isMe ? 'text-indigo-300' : 'text-slate-200'}`}>
                                <span className="font-mono">@{row.username}</span>
                                {isMe && <span className="text-xs text-indigo-500 ml-1 font-normal">(Ty)</span>}
                              </td>
                              <td className="py-2.5 px-4 text-right font-bold text-emerald-400">
                                {formatPLN(row.totalPln)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── 4. Portfele wg kategorii (macierz) ── */}
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
                        <span className="font-mono text-xs">@{u.username}</span>
                        {u.id === currentUserId && <span className="ml-1 text-[10px] text-indigo-500">(Ty)</span>}
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

      </main>
    </>
  );
}
