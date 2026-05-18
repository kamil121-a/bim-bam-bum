import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = createSupabaseServerClient(request);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  // The RLS policy ensures the user can only delete their own assets,
  // so we don't need a manual ownership check – an empty result means not found or not owned.
  const { error } = await supabase
    .from('assets')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);

  if (error) {
    console.error('[DELETE /api/assets/:id]', error);
    return NextResponse.json({ error: 'Błąd usuwania aktywa.' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
