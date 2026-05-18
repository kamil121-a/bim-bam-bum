import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient, createSupabaseAdminClient } from '@/lib/supabase';
import { estimateValue } from '@/lib/valuate';
import type { Asset } from '@/types';

export async function POST(request: NextRequest) {
  const supabase = createSupabaseServerClient(request);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Fetch user's assets
  const { data: assets, error: fetchError } = await supabase
    .from('assets')
    .select('*')
    .eq('user_id', user.id);

  if (fetchError) {
    console.error('[POST /api/assets/refresh] fetch:', fetchError);
    return NextResponse.json({ error: 'Błąd pobierania aktywów.' }, { status: 500 });
  }

  if (!assets || assets.length === 0) {
    return NextResponse.json({ updated: 0, assets: [] });
  }

  const admin = createSupabaseAdminClient();

  // Re-valuate all assets in parallel, skip failed ones
  const results = await Promise.allSettled(
    (assets as Asset[]).map(async (asset) => {
      const qty = asset.quantity ?? 1;
      const valuation = await estimateValue(asset.name, qty);

      if (valuation.estimatedValue > 0) {
        const { error: updateError } = await admin
          .from('assets')
          .update({
            value: valuation.estimatedValue,
            reasoning: valuation.reasoning,
          })
          .eq('id', asset.id);

        if (updateError) {
          console.error(`[refresh] update asset ${asset.id}:`, updateError);
          throw updateError;
        }
      }

      return { id: asset.id, newValue: valuation.estimatedValue };
    })
  );

  const updated = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results.length - updated;

  // Fetch the refreshed list to return to client
  const { data: refreshedAssets } = await supabase
    .from('assets')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  return NextResponse.json({
    updated,
    failed,
    assets: refreshedAssets ?? [],
  });
}
