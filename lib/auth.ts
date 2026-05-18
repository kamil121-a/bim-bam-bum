import crypto from 'crypto';
import { readDb, writeDb } from './db';
import type { Session, User } from '@/types';

const SALT = 'wealthtracker_v1_salt';
const SESSION_COOKIE = 'wt_session';
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password + SALT).digest('hex');
}

export function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function createSession(userId: string): string {
  const db = readDb();
  // Remove old sessions for this user
  db.sessions = db.sessions.filter(s => s.userId !== userId);

  const token = generateToken();
  const session: Session = {
    token,
    userId,
    expiresAt: new Date(Date.now() + SESSION_DURATION_MS).toISOString(),
  };
  db.sessions.push(session);
  writeDb(db);
  return token;
}

export function validateSession(token: string): User | null {
  if (!token) return null;
  const db = readDb();
  const session = db.sessions.find(
    s => s.token === token && new Date(s.expiresAt) > new Date()
  );
  if (!session) return null;
  return db.users.find(u => u.id === session.userId) ?? null;
}

export function deleteSession(token: string): void {
  const db = readDb();
  db.sessions = db.sessions.filter(s => s.token !== token);
  writeDb(db);
}

export function getTokenFromRequest(request: Request): string | null {
  const cookieHeader = request.headers.get('cookie') ?? '';
  const pairs = cookieHeader.split(';').map(c => c.trim());
  for (const pair of pairs) {
    const eqIdx = pair.indexOf('=');
    if (eqIdx === -1) continue;
    const key = pair.slice(0, eqIdx).trim();
    if (key === SESSION_COOKIE) {
      return pair.slice(eqIdx + 1).trim();
    }
  }
  return null;
}

export function sessionCookieHeader(token: string): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_DURATION_MS / 1000}`;
}

export function clearCookieHeader(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`;
}
