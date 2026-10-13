import { NextResponse } from 'next/server';
import { verifyTokenDetailed, signToken } from '@/lib/jwt';

export async function middleware(request) {
  const { pathname } = request.nextUrl;
  const authHeader = request.headers.get('authorization');
  const bearerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;
  const cookieToken = request.cookies.get('token')?.value;
  const token = cookieToken || bearerToken;

  const isAdminPage = pathname.startsWith('/admin');
  const isGardenerPage = pathname.startsWith('/gardener');
  const isLeaderPage = pathname.startsWith('/leader');

  // API-роуты сами проверяют роль внутри каждого обработчика —
  // здесь защищаем только сами страницы, чтобы чужой раздел не открывался в браузере.
  if (!isAdminPage && !isGardenerPage && !isLeaderPage) {
    return NextResponse.next();
  }

  const userAgent = request.headers.get('user-agent') || '';
  const rawCookieHeader = request.headers.get('cookie');
  const cookieState = rawCookieHeader === null ? 'ABSENT' : (rawCookieHeader === '' ? 'EMPTY' : (cookieToken ? 'HAS_TOKEN_COOKIE' : 'NO_TOKEN_COOKIE'));
  const remoteIp = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || request.ip || 'unknown';
  const referer = request.headers.get('referer') || '';

  if (!token) {
    console.warn(`[Middleware Canary] Access denied to ${pathname} (no token). IP=${remoteIp}, CookieState=${cookieState}, UA=${userAgent.slice(0, 100)}, Referer=${referer}`);
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const { payload, error: tokenError, message: tokenErrorMsg } = await verifyTokenDetailed(token);

  if (!payload) {
    console.warn(`[Middleware Canary] Access denied to ${pathname} (token invalid: code=${tokenError}, msg=${tokenErrorMsg}). IP=${remoteIp}, CookieState=${cookieState}, UA=${userAgent.slice(0, 100)}, Referer=${referer}`);
    const response = NextResponse.redirect(new URL('/login', request.url));
    // Не стирать cookie, если отказ произошёл из-за ложной причины (например, смены секрета при деплое).
    // Стираем cookie только при явном протухании токена (ERR_JWT_EXPIRED).
    if (tokenError === 'ERR_JWT_EXPIRED') {
      response.cookies.set('token', '', { expires: new Date(0), path: '/' });
    }
    return response;
  }

  // LEADER разрешено посещать /admin (и /admin/users) и /leader
  let response = NextResponse.next();

  if (payload.role === 'LEADER') {
    if (isGardenerPage) {
      response = NextResponse.redirect(new URL('/leader', request.url));
    }
  } else if (isAdminPage && payload.role !== 'ADMIN') {
    response = NextResponse.redirect(new URL('/gardener', request.url));
  } else if (isGardenerPage && payload.role !== 'GARDENER') {
    response = NextResponse.redirect(new URL('/admin', request.url));
  } else if (isLeaderPage && payload.role !== 'LEADER') {
    response = NextResponse.redirect(new URL('/login', request.url));
  }

  // Скользящая сессия (sliding session):
  // Если токен валиден и до его истечения осталось < 2 суток (из 7) — обновляем токен.
  try {
    if (payload.exp) {
      const nowSec = Math.floor(Date.now() / 1000);
      const remainingSec = payload.exp - nowSec;
      const TWO_DAYS_SEC = 2 * 24 * 60 * 60;
      if (remainingSec > 0 && remainingSec < TWO_DAYS_SEC) {
        const newToken = await signToken({
          userId: payload.userId,
          phone: payload.phone,
          role: payload.role,
          gardenerId: payload.gardenerId,
        });
        response.cookies.set('token', newToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: 60 * 60 * 24 * 365, // 365 дней
          path: '/',
        });
        console.log(`[Middleware SlidingSession] Refreshed token for userId=${payload.userId}, role=${payload.role}`);
      }
    }
  } catch (slideErr) {
    console.error('[Middleware SlidingSession] Failed to refresh token:', slideErr);
  }

  return response;
}

export const config = {
  matcher: ['/admin/:path*', '/gardener/:path*', '/leader/:path*'],
};
