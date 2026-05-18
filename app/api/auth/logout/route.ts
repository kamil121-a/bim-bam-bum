import { NextRequest, NextResponse } from 'next/server';
import { getTokenFromRequest, deleteSession, clearCookieHeader } from '@/lib/auth';

export async function POST(request: NextRequest) {
  const token = getTokenFromRequest(request);
  if (token) deleteSession(token);

  const response = NextResponse.json({ success: true });
  response.headers.set('Set-Cookie', clearCookieHeader());
  return response;
}
