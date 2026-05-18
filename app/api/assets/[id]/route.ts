import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient, createSupabaseAdminClient } from '@/lib/supabase';

type Params = { params: Promise<{ id: string }> };

// ── DELETE ────────────────────────────────────────────────────────────────────

export async function DELETE(request: NextRequest, { params }: Params) {
  const supabase = createSupabaseServerClient(request);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  const { error } = await supabase
    .from('assets')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);

  if (error) {
    console.error('[DELETE /api/assets/:id]', error);
    return NextResponse.json({ error: 'Błąd usuwania aktywa.' }, { status: 500 });
  }

  // Recalculate total_wealth after delete
  try {
    const admin = createSupabaseAdminClient();
    const { data: allAssets } = await admin
      .from('assets')
      .select('value')
      .eq('user_id', user.id);
    if (allAssets) {
      const totalWealth = allAssets.reduce((s, a) => s + Number(a.value), 0);
      await admin.from('profiles').update({ total_wealth: totalWealth }).eq('id', user.id);
    }
  } catch (e) {
    console.warn('[DELETE /api/assets/:id] total_wealth update failed:', e);
  }

  return NextResponse.json({ success: true });
}

// ── PATCH – edit name and/or quantity ────────────────────────────────────────

export async function PATCH(request: NextRequest, { params }: Params) {
  const supabase = createSupabaseServerClient(request);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  let body: { name?: string; quantity?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Nieprawidłowe dane.' }, { status: 400 });
  }

  const { name, quantity } = body;

  if (name !== undefined && !name.trim()) {
    return NextResponse.json({ error: 'Nazwa nie może być pusta.' }, { status: 400 });
  }
  if (quantity !== undefined && (!isFinite(quantity) || quantity <= 0)) {
    return NextResponse.json({ error: 'Ilość musi być liczbą > 0.' }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();

  // Fetch current asset to derive unit price
  const { data: current, error: fetchErr } = await admin
    .from('assets')
    .select('value, quantity, name, original_name')
    .eq('id', id)
    .eq('user_id', user.id)
    .single();

  if (fetchErr || !current) {
    return NextResponse.json({ error: 'Aktywo nie znalezione.' }, { status: 404 });
  }

  const currentQty  = Number(current.quantity) || 1;
  const unitPrice   = Number(current.value) / currentQty;
  const newQty      = quantity ?? currentQty;
  const newName     = name?.trim() ?? current.name;
  const newValue    = Math.round(unitPrice * newQty);

  // original_name: set once to the very first AI-generated name, never overwritten
  const originalName = current.original_name ?? current.name;

  const { data: updated, error: updateErr } = await admin
    .from('assets')
    .update({
      name:          newName,
      original_name: originalName,
      quantity:      parseFloat(newQty.toFixed(8)),
      value:         newValue,
    })
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .single();

  if (updateErr) {
    console.error('[PATCH /api/assets/:id]', updateErr);
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  // Recalculate total_wealth
  try {
    const { data: allAssets } = await admin
      .from('assets')
      .select('value')
      .eq('user_id', user.id);
    if (allAssets) {
      const totalWealth = allAssets.reduce((s, a) => s + Number(a.value), 0);
      await admin.from('profiles').update({ total_wealth: totalWealth }).eq('id', user.id);
    }
  } catch (e) {
    console.warn('[PATCH /api/assets/:id] total_wealth update failed:', e);
  }

  return NextResponse.json({ asset: updated });
}
