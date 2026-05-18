import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { createSupabaseServerClient } from '@/lib/supabase';
import type { AssetCategory } from '@/types';

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
    console.error('[GET /api/assets]', error);
    return NextResponse.json({ error: 'Błąd pobierania aktywów.' }, { status: 500 });
  }

  return NextResponse.json({ assets: assets ?? [] });
}

export async function POST(request: NextRequest) {
  const supabase = createSupabaseServerClient(request);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json() as {
      name?: string;
      category?: AssetCategory;
      value?: number;
      quantity?: number;
      reasoning?: string;
    };

    const { name, category, value, reasoning } = body;
    const quantity = typeof body.quantity === 'number' && body.quantity > 0
      ? body.quantity
      : 1;

    if (!name?.trim() || !category || value == null || isNaN(value) || value <= 0) {
      return NextResponse.json(
        { error: 'Nieprawidłowe dane aktywa.' },
        { status: 400 }
      );
    }

    const { data: asset, error } = await supabase
      .from('assets')
      .insert({
        id: uuidv4(),
        user_id: user.id,
        name: name.trim(),
        category,
        value: Math.round(value),
        quantity,
        reasoning: reasoning ?? null,
      })
      .select()
      .single();

    if (error) {
      console.error('[POST /api/assets]', error);
      return NextResponse.json({ error: 'Błąd zapisu aktywa.' }, { status: 500 });
    }

    return NextResponse.json({ asset }, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Błąd serwera.' }, { status: 500 });
  }
}
