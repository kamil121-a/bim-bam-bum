/**
 * GET /api/stats
 *
 * Porównanie użytkowników: kategorie, gotówka (ilość w walucie pierwotnej),
 * wspólne aktywa, rankingi wg kategorii.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseUserForApiRoute, createSupabaseAdminClient } from '@/lib/supabase';
import { ASSET_CATEGORIES } from '@/types';

/** Gotówka: pole `name` = kod waluty (PLN, USD, EUR, DKK). */
const KNOWN_CASH_CODES = new Set(['PLN', 'USD', 'EUR', 'DKK']);

function normalizeNick(raw: string | null | undefined): string | null {
  const s = typeof raw === 'string' ? raw.trim() : '';
  return s.length > 0 ? s : null;
}

async function enrichMissingUsernames(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  profileMap: Record<string, { username: string; total_wealth: number }>,
  candidateIds: Iterable<string>,
): Promise<void> {
  const toResolve = [...new Set(candidateIds)].filter(id => {
    const row = profileMap[id];
    return !row || !normalizeNick(row.username);
  });

  await Promise.all(
    toResolve.map(async uid => {
      try {
        const { data, error } = await admin.auth.admin.getUserById(uid);
        if (error || !data?.user) {
          console.warn('[stats] Brak użytkownika Auth dla', uid, error?.message);
          return;
        }
        const u      = data.user;
        const meta   = u.user_metadata as Record<string, unknown> | undefined;
        const metaUser =
          typeof meta?.username === 'string' ? normalizeNick(meta.username) : null;
        const emailLocal =
          typeof u.email === 'string' && u.email.includes('@')
            ? normalizeNick(u.email.split('@')[0])
            : null;

        const resolved = metaUser ?? emailLocal ?? `użytkownik_${uid.slice(0, 8)}`;

        const prev = profileMap[uid];
        profileMap[uid] = {
          username:     resolved,
          total_wealth: prev?.total_wealth ?? 0,
        };
      } catch (e) {
        console.warn('[stats] getUserById error', uid, e);
      }
    }),
  );

  // Ostateczny fallback – żeby UI nigdy nie dostało pustego nicku
  for (const uid of toResolve) {
    const row = profileMap[uid];
    if (!row || !normalizeNick(row.username)) {
      profileMap[uid] = {
        username:     `użytkownik_${uid.slice(0, 8)}`,
        total_wealth: row?.total_wealth ?? 0,
      };
    }
  }
}

export async function GET(request: NextRequest) {
  const { user, error: authErr } = await getSupabaseUserForApiRoute(request);
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

  const assetList = assets ?? [];

  // ── Najpierw agregacja wg kategorii (potrzebna też do majątku bez profiles.total_wealth) ──
  const categoryBreakdown: Record<string, Record<string, number>> = {};
  for (const asset of assetList) {
    const uid = asset.user_id;
    if (!categoryBreakdown[uid]) categoryBreakdown[uid] = {};
    categoryBreakdown[uid][asset.category] =
      (categoryBreakdown[uid][asset.category] ?? 0) + Number(asset.value);
  }

  const sumWealthFromCategories = (uid: string) =>
    Object.values(categoryBreakdown[uid] ?? {}).reduce((s, v) => s + v, 0);

  const assetUserIds = new Set(assetList.map(a => a.user_id));

  const profileMap: Record<string, { username: string; total_wealth: number }> = {};
  for (const p of profiles ?? []) {
    const nick = normalizeNick(p.username) ?? '';
    profileMap[p.id] = {
      username:     nick,
      total_wealth: p.total_wealth ?? 0,
    };
  }

  await enrichMissingUsernames(admin, profileMap, [
    ...assetUserIds,
    ...(profiles ?? []).map(p => p.id),
  ]);

  for (const uid of assetUserIds) {
    if (!profileMap[uid]) {
      profileMap[uid] = { username: '', total_wealth: 0 };
    }
  }
  await enrichMissingUsernames(admin, profileMap, assetUserIds);

  const displayName = (uid: string) =>
    normalizeNick(profileMap[uid]?.username) ?? `użytkownik_${uid.slice(0, 8)}`;

  const allParticipantIds = new Set<string>([
    ...(profiles ?? []).map(p => p.id),
    ...assetUserIds,
  ]);

  const users = [...allParticipantIds].map(id => ({
    id,
    username:     displayName(id),
    total_wealth:
      profileMap[id]?.total_wealth && Number(profileMap[id].total_wealth) > 0
        ? Number(profileMap[id].total_wealth)
        : sumWealthFromCategories(id),
    categories: categoryBreakdown[id] ?? {},
  }));

  // ── Gotówka: jedna struktura – tylko ilość w walucie pierwotnej (bez PLN w UI) ──
  type CashAgg = Record<string, Record<string, number>>;
  const cashQtyByCurrency: CashAgg = {};

  for (const asset of assetList) {
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
          username: displayName(userId),
          quantity,
        }))
        .sort((a, b) => b.quantity - a.quantity)
        .map((row, i) => ({ ...row, rank: i + 1 }));
      return { currency, leaderboard };
    })
    .sort((a, b) => a.currency.localeCompare(b.currency));

  // ── Pełny ranking wg kategorii (wartość w PLN w danej kategorii) ──
  const categoryRankings = ASSET_CATEGORIES.map(cat => {
    const rankings = [...allParticipantIds]
      .map(id => ({
        rank:     0,
        userId:   id,
        username: displayName(id),
        totalPln: categoryBreakdown[id]?.[cat] ?? 0,
      }))
      .filter(r => r.totalPln > 0)
      .sort((a, b) => b.totalPln - a.totalPln)
      .map((r, i) => ({ ...r, rank: i + 1 }));
    return { category: cat, rankings };
  }).filter(e => e.rankings.length > 0);

  // ── Wspólne aktywa ──────────────────────────────────────────────────────────
  const byName: Record<string, { userId: string; username: string; value: number; quantity: number; category: string }[]> = {};

  for (const asset of assetList) {
    const key = ((asset.original_name ?? asset.name) || '').trim().toUpperCase();
    if (!key) continue;
    if (!byName[key]) byName[key] = [];
    byName[key].push({
      userId:   asset.user_id,
      username: displayName(asset.user_id),
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
