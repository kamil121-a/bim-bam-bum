import { NextRequest, NextResponse } from 'next/server';
import { getTokenFromRequest, validateSession } from '@/lib/auth';

export async function GET(request: NextRequest) {
  const token = getTokenFromRequest(request);
  if (!token) {
    return NextResponse.json({ error: 'Brak sesji.' }, { status: 401 });
  }

  const user = validateSession(token);
  if (!user) {
    return NextResponse.json({ error: 'Sesja wygasła.' }, { status: 401 });
  }

  return NextResponse.json({
    user: { id: user.id, username: user.username, email: user.email },
  });
}
