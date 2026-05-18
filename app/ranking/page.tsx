'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import Navigation from '@/components/Navigation';
import { formatPLN } from '@/components/AssetCard';
import type { RankingEntry } from '@/types';
import { Trophy, Crown, RefreshCw } from 'lucide-react';

const MEDAL: Record<number, { icon: string; color: string; bg: string }> = {
  0: { icon: '🥇', color: 'text-yellow-600', bg: 'bg-yellow-50 border-yellow-200' },
  1: { icon: '🥈', color: 'text-slate-500', bg: 'bg-slate-50 border-slate-200' },
  2: { icon: '🥉', color: 'text-amber-700', bg: 'bg-amber-50 border-amber-200' },
};

export default function RankingPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [ranking, setRanking] = useState<RankingEntry[]>([]);
  const [currentUserId, setCurrentUserId] = useState('');
  const [fetchLoading, setFetchLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [user, loading, router]);

  const fetchRanking = useCallback(async () => {
    const res = await fetch('/api/ranking');
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

  const topThree = ranking.slice(0, 3);
  const rest = ranking.slice(3);
  const userRank = ranking.findIndex(e => e.id === currentUserId);

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
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center">
                <Trophy className="w-5 h-5 text-indigo-600" />
              </div>
              <h2 className="text-2xl font-bold text-gray-900">Ranking majątku</h2>
            </div>
            <p className="text-gray-500 text-sm ml-13">
              {ranking.length} {ranking.length === 1 ? 'użytkownik' : 'użytkowników'} · łączny majątek{' '}
              <strong className="text-indigo-700">
                {formatPLN(ranking.reduce((s, e) => s + e.totalValue, 0))}
              </strong>
            </p>
          </div>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="p-2.5 border border-gray-200 rounded-xl text-gray-500 hover:bg-gray-50 transition-colors disabled:opacity-50"
            title="Odśwież"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {ranking.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-2xl border border-dashed border-gray-200">
            <div className="text-5xl mb-4">🏆</div>
            <h3 className="text-xl font-semibold text-gray-700 mb-2">Ranking jest pusty</h3>
            <p className="text-gray-400">Zaproś znajomych i zacznijcie rywalizację!</p>
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
                          ? 'border-indigo-300 bg-indigo-50 shadow-md shadow-indigo-100'
                          : `${medal.bg} shadow-sm`
                      }`}
                    >
                      {/* Rank */}
                      <div className="flex-shrink-0 w-12 text-center">
                        <span className="text-3xl">{medal.icon}</span>
                      </div>

                      {/* User info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className={`font-bold text-lg ${isMe ? 'text-indigo-800' : 'text-gray-900'}`}>
                            {entry.username}
                          </p>
                          {isMe && (
                            <span className="px-2 py-0.5 bg-indigo-600 text-white text-xs font-semibold rounded-full">
                              Ty
                            </span>
                          )}
                          {idx === 0 && (
                            <Crown className="w-4 h-4 text-yellow-500" />
                          )}
                        </div>
                        <p className="text-sm text-gray-500">
                          {entry.assetCount} {entry.assetCount === 1 ? 'aktywo' : entry.assetCount < 5 ? 'aktywa' : 'aktywów'}
                        </p>
                      </div>

                      {/* Value */}
                      <div className="text-right flex-shrink-0">
                        <p className={`text-2xl font-bold ${isMe ? 'text-indigo-700' : medal.color}`}>
                          {formatPLN(entry.totalValue)}
                        </p>
                        {idx > 0 && topThree[0].totalValue > 0 && (
                          <p className="text-xs text-gray-400 mt-0.5">
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
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                {rest.map((entry, idx) => {
                  const rank = idx + 4;
                  const isMe = entry.id === currentUserId;
                  return (
                    <div
                      key={entry.id}
                      className={`flex items-center gap-4 px-6 py-4 border-b last:border-b-0 border-gray-50 transition-colors ${
                        isMe ? 'bg-indigo-50' : 'hover:bg-gray-50'
                      }`}
                    >
                      <div className="w-8 text-center text-lg font-bold text-gray-400">
                        {rank}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className={`font-semibold ${isMe ? 'text-indigo-800' : 'text-gray-800'}`}>
                            {entry.username}
                          </p>
                          {isMe && (
                            <span className="px-2 py-0.5 bg-indigo-600 text-white text-xs font-semibold rounded-full">
                              Ty
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-400">
                          {entry.assetCount} {entry.assetCount === 1 ? 'aktywo' : entry.assetCount < 5 ? 'aktywa' : 'aktywów'}
                        </p>
                      </div>
                      <p className={`font-bold text-lg ${isMe ? 'text-indigo-700' : 'text-gray-700'}`}>
                        {formatPLN(entry.totalValue)}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Your position summary */}
            {userRank >= 0 && (
              <div className="mt-4 p-4 bg-indigo-50 rounded-xl border border-indigo-100 text-center">
                <p className="text-sm text-indigo-700">
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
