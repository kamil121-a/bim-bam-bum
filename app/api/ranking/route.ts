import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseUserForApiRoute, createSupabaseAdminClient } from '@/lib/supabase';
import type { RankingEntry } from '@/types';

export async function GET(request: NextRequest) {
  // 1. Validate that the caller is authenticated (cookies lub Bearer JWT).
  const { user, error: authError } = await getSupabaseUserForApiRoute(request);

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 2. Fetch ranking via admin client (bypasses RLS so we can read all users' data).
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc('get_ranking');

  if (error) {
    console.error('[GET /api/ranking]', error);
    return NextResponse.json({ error: 'Błąd pobierania rankingu.' }, { status: 500 });
  }

  const ranking: RankingEntry[] = (data ?? []).map(
    (row: { id: string; username: string; total_value: number; asset_count: number }) => ({
      id: row.id,
      username: row.username,
      totalValue: Number(row.total_value),
      assetCount: Number(row.asset_count),
    })
  );

  return NextResponse.json({ ranking, currentUserId: user.id });
}
