import { NextRequest, NextResponse } from 'next/server';
import { readDb } from '@/lib/db';
import { hashPassword, createSession, sessionCookieHeader } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password } = body as { email: string; password: string };

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email i hasło są wymagane.' },
        { status: 400 }
      );
    }

    const db = readDb();
    const user = db.users.find(u => u.email === email);

    if (!user || user.passwordHash !== hashPassword(password)) {
      return NextResponse.json(
        { error: 'Nieprawidłowy email lub hasło.' },
        { status: 401 }
      );
    }

    const token = createSession(user.id);

    const response = NextResponse.json({
      user: { id: user.id, username: user.username, email: user.email },
    });
    response.headers.set('Set-Cookie', sessionCookieHeader(token));
    return response;
  } catch {
    return NextResponse.json({ error: 'Błąd serwera.' }, { status: 500 });
  }
}
