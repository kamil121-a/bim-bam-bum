import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient, createSupabaseAdminClient } from '@/lib/supabase';
import type { AssetCategory } from '@/types';

export const maxDuration = 10;

export async function GET(request: NextRequest) {
  const supabase = createSupabaseServerClient(request);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: assets, error } = await supabase
    .from('assets')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[GET /api/assets] Supabase error:', {
      message: error.message,
      code:    error.code,
      details: error.details,
      hint:    error.hint,
    });
    return NextResponse.json({ error: 'Błąd pobierania aktywów.' }, { status: 500 });
  }

  return NextResponse.json({ assets: assets ?? [] });
}

export async function POST(request: NextRequest) {
  // ── 1. Validate session ──────────────────────────────────────────────────────
  const supabase = createSupabaseServerClient(request);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    console.warn('[POST /api/assets] Auth failed:', authError?.message ?? 'no user');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── 2. Parse body ────────────────────────────────────────────────────────────
  let body: {
    name?:      string;
    category?:  AssetCategory;
    value?:     number;
    quantity?:  number;
    reasoning?: string;
  };

  try {
    body = await request.json();
  } catch (parseErr) {
    console.error('[POST /api/assets] Failed to parse request body:', parseErr);
    return NextResponse.json({ error: 'Nieprawidłowe dane żądania.' }, { status: 400 });
  }

  const { name, category, reasoning } = body;
  const value    = Number(body.value);
  const quantity = Number(body.quantity) > 0 ? Number(body.quantity) : 1;

  if (!name?.trim()) {
    return NextResponse.json({ error: 'Brak nazwy aktywa.' }, { status: 400 });
  }
  if (!category) {
    return NextResponse.json({ error: 'Brak kategorii.' }, { status: 400 });
  }
  if (!isFinite(value) || value <= 0) {
    return NextResponse.json(
      { error: 'Wartość musi być liczbą większą od 0.' },
      { status: 400 },
    );
  }

  // ── 3. Insert asset ──────────────────────────────────────────────────────────
  const admin = createSupabaseAdminClient();

  const payload = {
    id:        crypto.randomUUID(),
    user_id:   user.id,
    name:      name.trim(),
    category,
    value:     Math.round(value),
    quantity:  parseFloat(quantity.toFixed(8)),
    reasoning: reasoning?.trim() ?? null,
  };

  console.log('[POST /api/assets] Inserting:', { ...payload, user_id: '[redacted]' });

  const { data: asset, error: insertError } = await admin
    .from('assets')
    .insert(payload)
    .select()
    .single();

  if (insertError) {
    console.error('[POST /api/assets] Supabase insert error:', {
      message: insertError.message,
      code:    insertError.code,
      details: insertError.details,
      hint:    insertError.hint,
    });
    return NextResponse.json(
      { error: `Błąd zapisu aktywa: ${insertError.message}` },
      { status: 500 },
    );
  }

  // ── 4. Recalculate total_wealth (fallback if DB trigger not applied) ──────────
  try {
    const { data: allAssets } = await admin
      .from('assets')
      .select('value')
      .eq('user_id', user.id);

    if (allAssets) {
      const totalWealth = allAssets.reduce((sum, a) => sum + (Number(a.value) || 0), 0);
      const { error: profileErr } = await admin
        .from('profiles')
        .update({ total_wealth: totalWealth })
        .eq('id', user.id);

      if (profileErr) {
        console.warn('[POST /api/assets] total_wealth update failed:', profileErr.message);
      } else {
        console.log('[POST /api/assets] total_wealth updated to', totalWealth);
      }
    }
  } catch (twErr) {
    // Non-fatal – the asset was saved, only total_wealth update failed
    console.warn('[POST /api/assets] total_wealth recalc error:', twErr);
  }

  return NextResponse.json({ asset }, { status: 201 });
}
