'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import Navigation from '@/components/Navigation';
import { formatPLN } from '@/components/AssetCard';
import type { RankingEntry } from '@/types';
import { Trophy, Crown, RefreshCw, Zap } from 'lucide-react';
import { fetchWithSupabaseAuth } from '@/lib/supabase';
import { useSupabaseBrowser } from '@/lib/use-supabase-browser';

const MEDAL: Record<number, { icon: string; color: string; bg: string }> = {
  0: { icon: '🥇', color: 'text-yellow-400', bg: 'bg-yellow-500/10 border-yellow-500/30' },
  1: { icon: '🥈', color: 'text-slate-400',  bg: 'bg-slate-700/60 border-slate-600/50' },
  2: { icon: '🥉', color: 'text-amber-500',  bg: 'bg-amber-500/10 border-amber-500/30' },
};

export default function RankingPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const supabase = useSupabaseBrowser();
  const [ranking, setRanking]         = useState<RankingEntry[]>([]);
  const [currentUserId, setCurrentUserId] = useState('');
  const [fetchLoading, setFetchLoading]   = useState(true);
  const [refreshing, setRefreshing]       = useState(false);
  const [refreshAllMsg, setRefreshAllMsg] = useState<string | null>(null);
  const [refreshingAll, setRefreshingAll] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [user, loading, router]);

  const fetchRanking = useCallback(async () => {
    const res = await fetchWithSupabaseAuth(supabase, '/api/ranking');
    if (res.ok) {
      const data = await res.json();
      setRanking(data.ranking);
      setCurrentUserId(data.currentUserId);
    }
    setFetchLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    if (user) fetchRanking();
  }, [user, fetchRanking]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchRanking();
  };

  // Refresh market prices for ALL users' assets
  const handleRefreshAll = async () => {
    setRefreshingAll(true);
    setRefreshAllMsg(null);
    try {
      const res  = await fetchWithSupabaseAuth(supabase, '/api/ranking/refresh-all', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setRefreshAllMsg(`Zaktualizowano ${data.updated} aktywów u ${data.users} użytkowników.`);
        fetchRanking();
      } else {
        setRefreshAllMsg(data.error ?? 'Błąd odświeżania.');
      }
    } catch {
      setRefreshAllMsg('Błąd połączenia.');
    } finally {
      setRefreshingAll(false);
      setTimeout(() => setRefreshAllMsg(null), 8000);
    }
  };

  const topThree = ranking.slice(0, 3);
  const rest = ranking.slice(3);
  const userRank = ranking.findIndex(e => e.id === currentUserId);

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

  return (
    <>
      <Navigation />
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-10 h-10 bg-indigo-500/20 rounded-xl flex items-center justify-center">
                <Trophy className="w-5 h-5 text-indigo-400" />
              </div>
              <h2 className="text-2xl font-bold text-slate-100">Ranking majątku</h2>
            </div>
            <p className="text-slate-500 text-sm ml-13">
              {ranking.length} {ranking.length === 1 ? 'użytkownik' : 'użytkowników'} · łączny majątek{' '}
              <strong className="text-indigo-400">
                {formatPLN(ranking.reduce((s, e) => s + e.totalValue, 0))}
              </strong>
            </p>
          </div>

          <div className="flex items-center gap-2">
            {/* Refresh rankings (re-fetch data) */}
            <button
              onClick={handleRefresh}
              disabled={refreshing || refreshingAll}
              className="p-2.5 border border-slate-700 rounded-xl text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors disabled:opacity-50"
              title="Odśwież ranking"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            </button>

            {/* Refresh all users' asset prices */}
            <button
              onClick={handleRefreshAll}
              disabled={refreshing || refreshingAll}
              className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-xl transition-colors disabled:opacity-50"
              title="Zaktualizuj kursy giełdowe wszystkich użytkowników"
            >
              <Zap className={`w-4 h-4 ${refreshingAll ? 'animate-spin' : ''}`} />
              {refreshingAll ? 'Aktualizuję…' : 'Aktualizuj ceny'}
            </button>
          </div>
        </div>

        {/* Status message */}
        {refreshAllMsg && (
          <div className="mb-6 px-4 py-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-sm text-emerald-300">
            {refreshAllMsg}
          </div>
        )}

        {ranking.length === 0 ? (
          <div className="text-center py-20 bg-slate-800 rounded-2xl border border-dashed border-slate-700">
            <div className="text-5xl mb-4">🏆</div>
            <h3 className="text-xl font-semibold text-slate-200 mb-2">Ranking jest pusty</h3>
            <p className="text-slate-500">Zaproś znajomych i zacznijcie rywalizację!</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Top 3 podium */}
            {topThree.length > 0 && (
              <div className="grid grid-cols-1 gap-3 mb-2">
                {topThree.map((entry, idx) => {
                  const medal = MEDAL[idx];
                  const isMe = entry.id === currentUserId;
                  return (
                    <div
                      key={entry.id}
                      className={`flex items-center gap-4 p-5 rounded-2xl border-2 transition-all ${
                        isMe
                          ? 'border-indigo-500/50 bg-indigo-500/10 shadow-md shadow-indigo-900/30'
                          : `${medal.bg} shadow-sm`
                      }`}
                    >
                      <div className="flex-shrink-0 w-12 text-center">
                        <span className="text-3xl">{medal.icon}</span>
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className={`font-bold text-lg ${isMe ? 'text-indigo-300' : 'text-slate-100'}`}>
                            {entry.username}
                          </p>
                          {isMe && (
                            <span className="px-2 py-0.5 bg-indigo-600 text-white text-xs font-semibold rounded-full">
                              Ty
                            </span>
                          )}
                          {idx === 0 && <Crown className="w-4 h-4 text-yellow-400" />}
                        </div>
                        <p className="text-sm text-slate-500">
                          {entry.assetCount} {entry.assetCount === 1 ? 'aktywo' : entry.assetCount < 5 ? 'aktywa' : 'aktywów'}
                        </p>
                      </div>

                      <div className="text-right flex-shrink-0">
                        <p className={`text-2xl font-bold ${isMe ? 'text-indigo-400' : medal.color}`}>
                          {formatPLN(entry.totalValue)}
                        </p>
                        {idx > 0 && topThree[0].totalValue > 0 && (
                          <p className="text-xs text-slate-500 mt-0.5">
                            {Math.round((entry.totalValue / topThree[0].totalValue) * 100)}% lidera
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Rest */}
            {rest.length > 0 && (
              <div className="bg-slate-800 rounded-2xl border border-slate-700/60 shadow-sm overflow-hidden">
                {rest.map((entry, idx) => {
                  const rank = idx + 4;
                  const isMe = entry.id === currentUserId;
                  return (
                    <div
                      key={entry.id}
                      className={`flex items-center gap-4 px-6 py-4 border-b last:border-b-0 border-slate-700/50 transition-colors ${
                        isMe ? 'bg-indigo-500/10' : 'hover:bg-slate-700/40'
                      }`}
                    >
                      <div className="w-8 text-center text-lg font-bold text-slate-500">{rank}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className={`font-semibold ${isMe ? 'text-indigo-300' : 'text-slate-200'}`}>
                            {entry.username}
                          </p>
                          {isMe && (
                            <span className="px-2 py-0.5 bg-indigo-600 text-white text-xs font-semibold rounded-full">
                              Ty
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500">
                          {entry.assetCount} {entry.assetCount === 1 ? 'aktywo' : entry.assetCount < 5 ? 'aktywa' : 'aktywów'}
                        </p>
                      </div>
                      <p className={`font-bold text-lg ${isMe ? 'text-indigo-400' : 'text-slate-300'}`}>
                        {formatPLN(entry.totalValue)}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}

            {userRank >= 0 && (
              <div className="mt-4 p-4 bg-indigo-500/10 rounded-xl border border-indigo-500/20 text-center">
                <p className="text-sm text-indigo-300">
                  Twoje miejsce:{' '}
                  <strong>#{userRank + 1}</strong> z {ranking.length} ·{' '}
                  Twój majątek:{' '}
                  <strong>{formatPLN(ranking[userRank].totalValue)}</strong>
                </p>
              </div>
            )}
          </div>
        )}
      </main>
    </>
  );
}
