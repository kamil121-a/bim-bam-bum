/**
 * GET /api/stats
 *
 * Returns comparison data for all users:
 * - Per-user portfolio breakdown by category
 * - Assets shared by multiple users (same name), with each user's holdings
 */

import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient, createSupabaseAdminClient } from '@/lib/supabase';

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

  return NextResponse.json({ users, sharedAssets, currentUserId: user.id });
}
