/**
 * GET /api/stats
 *
 * Porównanie użytkowników: kategorie, gotówka (ilość w walucie pierwotnej),
 * wspólne aktywa, rankingi wg kategorii.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient, createSupabaseAdminClient } from '@/lib/supabase';
import { ASSET_CATEGORIES } from '@/types';

/** Gotówka: pole `name` = kod waluty (PLN, USD, EUR, DKK). */
const KNOWN_CASH_CODES = new Set(['PLN', 'USD', 'EUR', 'DKK']);

export async function GET(request: NextRequest) {
  const supabase = createSupabaseServerClient(request);
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();

  const { data: profiles } = await admin
    .from('profiles')
    .select('id, username, total_wealth');

  const { data: assets, error: fetchErr } = await admin
    .from('assets')
    .select('id, user_id, name, original_name, category, value, quantity');

  if (fetchErr) {
    return NextResponse.json({ error: 'Błąd pobierania aktywów.' }, { status: 500 });
  }

  const profileMap = Object.fromEntries(
    (profiles ?? []).map(p => [p.id, { username: p.username, total_wealth: p.total_wealth }]),
  );

  // ── Category breakdown per user (wartości w PLN – do rankingu kategorii i tabeli) ──
  const categoryBreakdown: Record<string, Record<string, number>> = {};
  for (const asset of assets ?? []) {
    const uid = asset.user_id;
    if (!categoryBreakdown[uid]) categoryBreakdown[uid] = {};
    categoryBreakdown[uid][asset.category] =
      (categoryBreakdown[uid][asset.category] ?? 0) + Number(asset.value);
  }

  const users = (profiles ?? []).map(p => ({
    id:           p.id,
    username:     p.username,
    total_wealth: p.total_wealth ?? 0,
    categories:   categoryBreakdown[p.id] ?? {},
  }));

  // ── Gotówka: jedna struktura – tylko ilość w walucie pierwotnej (bez PLN w UI) ──
  type CashAgg = Record<string, Record<string, number>>;
  const cashQtyByCurrency: CashAgg = {};

  for (const asset of assets ?? []) {
    if (asset.category !== 'Gotówka') continue;
    const code = (asset.name ?? '').trim().toUpperCase();
    if (!KNOWN_CASH_CODES.has(code)) continue;

    const uid = asset.user_id;
    if (!cashQtyByCurrency[code]) cashQtyByCurrency[code] = {};
    cashQtyByCurrency[code][uid] = (cashQtyByCurrency[code][uid] ?? 0) + (Number(asset.quantity) || 0);
  }

  /** Lista walut z rankingiem użytkowników po ilości (waluta pierwotna). */
  const cashByCurrency = Object.entries(cashQtyByCurrency)
    .map(([currency, byUid]) => {
      const leaderboard = Object.entries(byUid)
        .map(([userId, quantity]) => ({
          rank:     0,
          userId,
          username: profileMap[userId]?.username ?? '?',
          quantity,
        }))
        .sort((a, b) => b.quantity - a.quantity)
        .map((row, i) => ({ ...row, rank: i + 1 }));
      return { currency, leaderboard };
    })
    .sort((a, b) => a.currency.localeCompare(b.currency));

  // ── Pełny ranking wg kategorii (wartość w PLN w danej kategorii) ──
  const categoryRankings = ASSET_CATEGORIES.map(cat => {
    const rankings = (profiles ?? [])
      .map(p => ({
        rank:     0,
        userId:   p.id,
        username: p.username,
        totalPln: categoryBreakdown[p.id]?.[cat] ?? 0,
      }))
      .filter(r => r.totalPln > 0)
      .sort((a, b) => b.totalPln - a.totalPln)
      .map((r, i) => ({ ...r, rank: i + 1 }));
    return { category: cat, rankings };
  }).filter(e => e.rankings.length > 0);

  // ── Wspólne aktywa ──────────────────────────────────────────────────────────
  const byName: Record<string, { userId: string; username: string; value: number; quantity: number; category: string }[]> = {};

  for (const asset of assets ?? []) {
    const key = ((asset.original_name ?? asset.name) || '').trim().toUpperCase();
    if (!key) continue;
    if (!byName[key]) byName[key] = [];
    byName[key].push({
      userId:   asset.user_id,
      username: profileMap[asset.user_id]?.username ?? '?',
      value:    Number(asset.value),
      quantity: Number(asset.quantity) || 1,
      category: asset.category,
    });
  }

  const sharedAssets = Object.entries(byName)
    .filter(([, holders]) => new Set(holders.map(h => h.userId)).size >= 2)
    .map(([name, holders]) => ({
      name,
      category: holders[0].category,
      holders:  holders.sort((a, b) => b.value - a.value),
    }))
    .sort((a, b) => {
      const aMax = Math.max(...a.holders.map(h => h.value));
      const bMax = Math.max(...b.holders.map(h => h.value));
      return bMax - aMax;
    });

  return NextResponse.json({
    users,
    sharedAssets,
    cashByCurrency,
    categoryRankings,
    currentUserId: user.id,
  });
}
