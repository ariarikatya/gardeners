import { NextResponse } from 'next/server';
import { verifyToken, signToken } from '@/lib/jwt';

function isRequestSecure(req) {
  if (process.env.NODE_ENV !== 'production') return false;
  if (process.env.DISABLE_SECURE_COOKIES === 'true') return false;
  const proto = req.headers.get('x-forwarded-proto') || req.nextUrl?.protocol || '';
  return proto.includes('https');
}

/**
 * NOTE ON OFFLINE PWA MODE:
 * Middleware runs on the server for online requests only.
 * When the app is offline, the PWA Service Worker (public/sw.js) intercepts navigation requests
 * before they reach the network/server and returns cached HTML (/gardener, /admin, /leader, /login).
 * Therefore, middleware.js does not interfere with offline page delivery.
 */
export async function middleware(request) {
  const { pathname } = request.nextUrl;

  // Early return for login, root, static assets, emergency script, manifest, sw, and api routes
  if (
    pathname === '/login' ||
    pathname === '/' ||
    pathname.startsWith('/_next/static/') ||
    pathname === '/emergency.js' ||
    pathname === '/manifest.json' ||
    pathname === '/sw.js' ||
    pathname.startsWith('/api/')
  ) {
    return NextResponse.next();
  }

  const accountKey = request.headers.get('x-account-key');
  let tokenCookieName = 'token';
  if (accountKey) {
    try {
      const buf = new TextEncoder().encode(accountKey);
      const hashBuf = await crypto.subtle.digest('SHA-1', buf);
      const sha1Hex = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
      if (sha1Hex && request.cookies.has(`token_${sha1Hex}`)) {
        tokenCookieName = `token_${sha1Hex}`;
      }
    } catch (e) {}
  }

  const authHeader = request.headers.get('authorization');
  const bearerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;
  const token = request.cookies.get(tokenCookieName)?.value || request.cookies.get('token')?.value || bearerToken;

  const isAdminPage = pathname.startsWith('/admin');
  const isGardenerPage = pathname.startsWith('/gardener');
  const isLeaderPage = pathname.startsWith('/leader');

  if (!isAdminPage && !isGardenerPage && !isLeaderPage) {
    return NextResponse.next();
  }

  if (!token) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const payload = await verifyToken(token);
  if (!payload) {
    const response = NextResponse.redirect(new URL('/login', request.url));
    response.cookies.set('token', '', { expires: new Date(0), path: '/' });
    return response;
  }

  let redirectUrl = null;

  // Каждая роль имеет свою главную страницу: ADMIN -> /admin, LEADER -> /leader, GARDENER -> /gardener
  if (payload.role === 'ADMIN') {
    if (!isAdminPage) {
      redirectUrl = new URL('/admin', request.url);
    }
  } else if (payload.role === 'LEADER') {
    if (!isLeaderPage) {
      redirectUrl = new URL('/leader', request.url);
    }
  } else if (payload.role === 'GARDENER') {
    if (!isGardenerPage) {
      redirectUrl = new URL('/gardener', request.url);
    }
  } else {
    redirectUrl = new URL('/login', request.url);
  }

  const response = redirectUrl ? NextResponse.redirect(redirectUrl) : NextResponse.next();

  // Sliding session: if token remaining TTL is < 30 days, generate a fresh token
  const nowSec = Math.floor(Date.now() / 1000);
  const expSec = payload.exp || 0;
  const remainingDays = (expSec - nowSec) / (60 * 60 * 24);

  if (remainingDays < 30) {
    try {
      const freshToken = await signToken({
        userId: payload.userId,
        phone: payload.phone,
        role: payload.role,
        gardenerId: payload.gardenerId,
      });

      response.cookies.set('token', freshToken, {
        httpOnly: true,
        secure: isRequestSecure(request),
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 365, // 365 days
        path: '/',
      });
    } catch (err) {
      console.error('Failed to issue sliding token in middleware:', err);
    }
  }

  return response;
}

export const config = {
  matcher: ['/admin/:path*', '/gardener/:path*', '/leader/:path*'],
};
