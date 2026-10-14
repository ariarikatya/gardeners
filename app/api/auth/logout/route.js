import { NextResponse } from 'next/server';

export async function POST() {
  const response = NextResponse.json(
    { success: true },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      },
    }
  );

  response.cookies.set('token', '', {
    expires: new Date(0),
    maxAge: 0,
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
  });

  return response;
}
