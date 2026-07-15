import { NextResponse } from 'next/server';
// Импортируем строго jwtVerify напрямую из jose — это работает в Edge!
import { jwtVerify } from 'jose';

// Этот секрет будет использоваться для проверки токенов
const SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'fallback-secret-key-123'
);

export async function middleware(req) {
  const { pathname } = req.nextUrl;
  
  // Вытаскиваем токен авторизации из кук браузера
  const token = req.cookies.get('token')?.value;

  // Если пользователь пытается зайти в админку диспетчера
  if (pathname.startsWith('/admin')) {
    if (!token) return NextResponse.redirect(new URL('/login', req.url));
    try {
      const { payload } = await jwtVerify(token, SECRET);
      if (payload.role !== 'ADMIN') {
        return NextResponse.redirect(new URL('/login', req.url));
      }
    } catch (e) {
      return NextResponse.redirect(new URL('/login', req.url));
    }
  }

  // Если садовник пытается зайти в свой личный кабинет
  if (pathname.startsWith('/gardener')) {
    if (!token) return NextResponse.redirect(new URL('/login', req.url));
    try {
      const { payload } = await jwtVerify(token, SECRET);
      if (payload.role !== 'GARDENER') {
        return NextResponse.redirect(new URL('/login', req.url));
      }
    } catch (e) {
      return NextResponse.redirect(new URL('/login', req.url));
    }
  }

  return NextResponse.next();
}

// Защищаем только эти пути, чтобы middleware не срабатывал на картинки и шрифты
export const config = {
  matcher: ['/admin/:path*', '/gardener/:path*'],
};
