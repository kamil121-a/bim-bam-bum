/**
 * POST /api/ranking/refresh-all
 *
 * Refreshes market-price assets (Finanse, Akcje, Kruszce) for ALL users.
 * Uses the admin client so it can bypass RLS and write to any user's assets.
 * Called from the Ranking page "Aktualizuj ceny" button.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient, createSupabaseAdminClient } from '@/lib/supabase';
import { getMarketUnitPrice } from '@/lib/market-price';
import type { Asset } from '@/types';

export const maxDuration = 10;

export async function POST(request: NextRequest) {
  // Auth – only logged-in users can trigger this
  const supabase = createSupabaseServerClient(request);
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  const MARKET_CATS = new Set(['Finanse', 'Akcje', 'Kruszce']);

  // Fetch all market assets across all users
  const { data: allAssets, error: fetchErr } = await admin
    .from('assets')
    .select('*')
    .in('category', [...MARKET_CATS]);

  if (fetchErr) {
    console.error('[ranking/refresh-all] fetch error:', fetchErr.message);
    return NextResponse.json({ error: 'Błąd pobierania aktywów.' }, { status: 500 });
  }
  if (!allAssets || allAssets.length === 0) {
    return NextResponse.json({ updated: 0, failed: 0, users: 0 });
  }

  const assets = allAssets as Asset[];
  let updated = 0;
  let failed  = 0;

  // Refresh each asset in parallel
  const results = await Promise.allSettled(
    assets.map(async (asset) => {
      const name = (asset.original_name ?? asset.name ?? '').trim();
      if (!name) { failed++; return; }

      const priceData = await getMarketUnitPrice(name);
      if (!priceData || priceData.unitPricePLN <= 0) {
        console.warn(`[refresh-all] no price for "${name}"`);
        return 'fail';
      }

      const qty      = asset.quantity ?? 1;
      const newValue = Math.round(priceData.unitPricePLN * qty);

      const { error: upErr } = await admin
        .from('assets')
        .update({ value: newValue, reasoning: priceData.reasoning })
        .eq('id', asset.id);

      if (upErr) {
        console.error(`[refresh-all] update error for "${name}":`, upErr.message);
        return 'fail';
      }
      return 'ok';
    }),
  );

  for (const r of results) {
    if (r.status === 'fulfilled' && r.value === 'ok') updated++;
    else failed++;
  }

  // Recalculate total_wealth for each affected user
  const affectedUserIds = [...new Set(assets.map(a => a.user_id))];
  await Promise.allSettled(
    affectedUserIds.map(async (uid) => {
      const { data: userAssets } = await admin
        .from('assets')
        .select('value')
        .eq('user_id', uid);
      if (!userAssets) return;
      const total = userAssets.reduce((s, a) => s + Number(a.value), 0);
      await admin.from('profiles').update({ total_wealth: total }).eq('id', uid);
    }),
  );

  return NextResponse.json({
    updated,
    failed,
    users: affectedUserIds.length,
  });
}
