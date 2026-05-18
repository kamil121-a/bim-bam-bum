import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { readDb, writeDb } from '@/lib/db';
import { hashPassword, createSession, sessionCookieHeader } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { username, email, password } = body as {
      username: string;
      email: string;
      password: string;
    };

    if (!username || !email || !password) {
      return NextResponse.json(
        { error: 'Wszystkie pola są wymagane.' },
        { status: 400 }
      );
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: 'Hasło musi mieć co najmniej 6 znaków.' },
        { status: 400 }
      );
    }

    const db = readDb();

    if (db.users.find(u => u.email === email)) {
      return NextResponse.json(
        { error: 'Konto z tym adresem email już istnieje.' },
        { status: 409 }
      );
    }

    if (db.users.find(u => u.username === username)) {
      return NextResponse.json(
        { error: 'Nazwa użytkownika jest już zajęta.' },
        { status: 409 }
      );
    }

    const newUser = {
      id: uuidv4(),
      username,
      email,
      passwordHash: hashPassword(password),
      createdAt: new Date().toISOString(),
    };

    db.users.push(newUser);
    writeDb(db);

    const token = createSession(newUser.id);

    const response = NextResponse.json(
      { user: { id: newUser.id, username: newUser.username, email: newUser.email } },
      { status: 201 }
    );
    response.headers.set('Set-Cookie', sessionCookieHeader(token));
    return response;
  } catch {
    return NextResponse.json({ error: 'Błąd serwera.' }, { status: 500 });
  }
}
