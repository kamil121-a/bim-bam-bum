import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { createSupabaseServerClient } from '@/lib/supabase';
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
      code: error.code,
      details: error.details,
      hint: error.hint,
    });
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

  let body: {
    name?: string;
    category?: AssetCategory;
    value?: number;
    quantity?: number;
    reasoning?: string;
  };

  try {
    body = await request.json();
  } catch (parseErr) {
    console.error('[POST /api/assets] Failed to parse request body:', parseErr);
    return NextResponse.json({ error: 'Nieprawidłowe dane żądania.' }, { status: 400 });
  }

  const { name, category, reasoning } = body;

  // Ensure value is a finite positive number
  const value = Number(body.value);
  const quantity = Number(body.quantity) > 0 ? Number(body.quantity) : 1;

  if (!name?.trim()) {
    return NextResponse.json({ error: 'Brak nazwy aktywa.' }, { status: 400 });
  }
  if (!category) {
    return NextResponse.json({ error: 'Brak kategorii.' }, { status: 400 });
  }
  if (!isFinite(value) || value <= 0) {
    return NextResponse.json({ error: 'Wartość musi być liczbą większą od 0.' }, { status: 400 });
  }

  const payload = {
    id: uuidv4(),
    user_id: user.id,
    name: name.trim(),
    category,
    // Store as plain float – Math.round avoids floating-point noise
    value: Math.round(value),
    quantity: parseFloat(quantity.toFixed(8)), // preserve precision for crypto/metals
    reasoning: reasoning?.trim() ?? null,
  };

  console.log('[POST /api/assets] Inserting:', { ...payload, user_id: '[redacted]' });

  const { data: asset, error: insertError } = await supabase
    .from('assets')
    .insert(payload)
    .select()
    .single();

  if (insertError) {
    console.error('[POST /api/assets] Supabase insert error:', {
      message: insertError.message,
      code: insertError.code,
      details: insertError.details,
      hint: insertError.hint,
    });
    return NextResponse.json(
      { error: `Błąd zapisu aktywa: ${insertError.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ asset }, { status: 201 });
}
