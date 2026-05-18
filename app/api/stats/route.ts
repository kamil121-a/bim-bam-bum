/**
 * GET /api/stats
 *
 * Returns comparison data for all users:
 * - Per-user portfolio breakdown by category
 * - Assets shared by multiple users (same name), with each user's holdings
 */

import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient, createSupabaseAdminClient } from '@/lib/supabase';
import { ASSET_CATEGORIES } from '@/types';

/** Gotówka rows use `name` = kod waluty (PLN, USD, EUR, DKK). */
const KNOWN_CASH_CODES = new Set(['PLN', 'USD', 'EUR', 'DKK']);

export async function GET(request: NextRequest) {
  const supabase = createSupabaseServerClient(request);
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();

  // All profiles (for usernames)
  const { data: profiles } = await admin
    .from('profiles')
    .select('id, username, total_wealth');

  // All assets
  const { data: assets, error: fetchErr } = await admin
    .from('assets')
    .select('id, user_id, name, original_name, category, value, quantity');

  if (fetchErr) {
    return NextResponse.json({ error: 'Błąd pobierania aktywów.' }, { status: 500 });
  }

  const profileMap = Object.fromEntries(
    (profiles ?? []).map(p => [p.id, { username: p.username, total_wealth: p.total_wealth }])
  );

  // ── Category breakdown per user ────────────────────────────────────────────
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

  // ── Currency leaders (Gotówka + ISO code in name) ────────────────────────────
  type CashAgg = Record<string, Record<string, { qty: number; valuePln: number }>>;
  const cashByCurrency: CashAgg = {};

  for (const asset of assets ?? []) {
    if (asset.category !== 'Gotówka') continue;
    const code = (asset.name ?? '').trim().toUpperCase();
    if (!KNOWN_CASH_CODES.has(code)) continue;

    const uid = asset.user_id;
    if (!cashByCurrency[code]) cashByCurrency[code] = {};
    if (!cashByCurrency[code][uid]) cashByCurrency[code][uid] = { qty: 0, valuePln: 0 };

    cashByCurrency[code][uid].qty += Number(asset.quantity) || 0;
    cashByCurrency[code][uid].valuePln += Number(asset.value) || 0;
  }

  const currencyStats = Object.entries(cashByCurrency).map(([currency, byUid]) => {
    const rows = Object.entries(byUid).map(([userId, d]) => ({
      userId,
      username: profileMap[userId]?.username ?? '?',
      quantity: d.qty,
      valuePln: d.valuePln,
    }));

    let maxQty = rows[0];
    let maxVal = rows[0];
    for (const r of rows) {
      if (r.quantity > maxQty.quantity) maxQty = r;
      if (r.valuePln > maxVal.valuePln) maxVal = r;
    }

    return {
      currency,
      maxQuantity: maxQty,
      maxValuePln: maxVal,
      holders:     rows.sort((a, b) => b.valuePln - a.valuePln),
    };
  }).sort((a, b) => a.currency.localeCompare(b.currency));

  // ── Category leaders: who has the most PLN in each category ──────────────────
  const categoryLeaders = ASSET_CATEGORIES.map(cat => {
    let best: { userId: string; username: string; totalPln: number } | null = null;
    for (const p of profiles ?? []) {
      const total = categoryBreakdown[p.id]?.[cat] ?? 0;
      if (total <= 0) continue;
      if (!best || total > best.totalPln) {
        best = { userId: p.id, username: p.username, totalPln: total };
      }
    }
    return { category: cat, leader: best };
  }).filter(e => e.leader !== null);

  // ── Shared assets: same name across multiple users ─────────────────────────
  // Group by canonical name (original_name preferred, else name)
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

  // Only keep assets owned by ≥2 different users
  const sharedAssets = Object.entries(byName)
    .filter(([, holders]) => {
      const uids = new Set(holders.map(h => h.userId));
      return uids.size >= 2;
    })
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
    currencyStats,
    categoryLeaders,
    currentUserId: user.id,
  });
}
