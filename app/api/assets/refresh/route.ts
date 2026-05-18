/**
 * POST /api/assets/refresh
 *
 * Odświeża wartości aktywów z kategorii "Finanse" (akcje, krypto, ETF-y)
 * używając Tavily Search + NBP + OpenAI (gpt-4o-mini).
 *
 * Aktywa z innych kategorii (Nieruchomości, Elektronika, Inne) są pomijane
 * – ich wartość nie zmienia się codziennie na rynku publicznym.
 *
 * Po aktualizacji rekordów asset endpoint zwraca świeżą listę aktywów
 * i aktualizuje total_wealth w tabeli profiles.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient, createSupabaseAdminClient } from '@/lib/supabase';
import { getMarketUnitPrice } from '@/lib/market-price';
import { estimateByDescription } from '@/lib/valuate';
import type { Asset } from '@/types';

export const maxDuration = 10;

export async function POST(request: NextRequest) {
  // ── Parse body (optional type: 'finance' | 'other') ─────────────────────────
  let refreshType: 'finance' | 'other' = 'finance';
  try {
    const body = await request.json() as { type?: string };
    if (body.type === 'other') refreshType = 'other';
  } catch { /* no body – default to finance */ }

  // ── Auth + fetch assets in parallel ─────────────────────────────────────────
  const supabase = createSupabaseServerClient(request);
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: allAssets, error: fetchError } = await supabase
    .from('assets')
    .select('*')
    .eq('user_id', user.id);

  if (fetchError) {
    console.error('[refresh] fetch assets error:', fetchError.message);
    return NextResponse.json({ error: 'Błąd pobierania aktywów.' }, { status: 500 });
  }
  if (!allAssets || allAssets.length === 0) {
    return NextResponse.json({ updated: 0, failed: 0, updatedIds: [], assets: [] });
  }

  const admin = createSupabaseAdminClient();
  const assets = allAssets as Asset[];

  // ── Wybierz zestaw aktywów do odświeżenia ────────────────────────────────────
  const targetAssets =
    refreshType === 'other'
      ? assets.filter(a => a.category !== 'Finanse')
      : assets.filter(a => a.category === 'Finanse');

  // Alias for backwards compat in finance path
  const financeAssets = targetAssets;

  // ── Odśwież wszystkie aktywa giełdowe równolegle (Promise.all) ────────────────
  const updatedIds: string[] = [];

  const results = await Promise.allSettled(
    financeAssets.map(async (asset): Promise<'ok' | 'fail'> => {
      const name = (asset.name ?? '').trim();
      if (!name) return 'fail';

      let newValue: number;
      let reasoning: string;

      if (refreshType === 'other') {
        // Description-based re-valuation via Tavily + OpenAI
        console.log(`[refresh/other] Odświeżam: "${name.slice(0, 60)}…"`);
        try {
          const result = await estimateByDescription(name);
          if (!result || result.estimatedValue <= 0) return 'fail';
          newValue  = result.estimatedValue;
          reasoning = result.reasoning;
        } catch (err) {
          console.warn(`[refresh/other] Błąd wyceny:`, err instanceof Error ? err.message : err);
          return 'fail';
        }
      } else {
        // Ticker-based: Tavily + NBP + OpenAI
        console.log(`[refresh] Odświeżam ticker: "${name}" (qty: ${asset.quantity})`);
        const priceData = await getMarketUnitPrice(name);
        if (!priceData || priceData.unitPricePLN <= 0) {
          console.warn(`[refresh] Brak ceny dla "${name}" – pomijam`);
          return 'fail';
        }
        const qty = asset.quantity ?? 1;
        newValue  = Math.round(priceData.unitPricePLN * qty);
        reasoning = priceData.reasoning;
        console.log(`[refresh] "${name}": ${priceData.unitPricePLN.toFixed(2)} PLN/szt. × ${qty} = ${newValue} PLN`);
      }

      const { error: updateErr } = await admin
        .from('assets')
        .update({ value: newValue, reasoning })
        .eq('id', asset.id);

      if (updateErr) {
        console.error(`[refresh] Supabase update error for "${name}":`, updateErr.message);
        return 'fail';
      }

      updatedIds.push(asset.id);
      return 'ok';
    }),
  );

  const updated = results.filter(r => r.status === 'fulfilled' && r.value === 'ok').length;
  const failed  = results.length - updated;

  // ── Przelicz i zapisz total_wealth w profiles ────────────────────────────────
  try {
    const { data: freshAssets } = await supabase
      .from('assets')
      .select('value')
      .eq('user_id', user.id);

    const totalWealth = (freshAssets ?? []).reduce(
      (sum: number, a: { value: number }) => sum + (a.value ?? 0),
      0,
    );

    await admin
      .from('profiles')
      .update({ total_wealth: totalWealth })
      .eq('id', user.id);

    console.log(`[refresh] total_wealth zaktualizowany: ${totalWealth} PLN`);
  } catch (err) {
    console.warn('[refresh] total_wealth update failed:', err instanceof Error ? err.message : err);
  }

  // ── Zwróć świeżą listę aktywów ───────────────────────────────────────────────
  const { data: refreshedAssets } = await supabase
    .from('assets')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  return NextResponse.json({
    updated,
    failed,
    updatedIds,
    assets: refreshedAssets ?? [],
  });
}
