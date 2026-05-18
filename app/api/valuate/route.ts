import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase';
import { estimateValue } from '@/lib/valuate';

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
    const { name } = (await request.json()) as { name?: string };

    if (!name || name.trim().length < 2) {
      return NextResponse.json(
        { error: 'Nazwa aktywa jest za krótka (minimum 2 znaki).' },
        { status: 400 }
      );
    }

    const result = await estimateValue(name.trim());
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: 'Błąd wyceny.' }, { status: 500 });
  }
}
