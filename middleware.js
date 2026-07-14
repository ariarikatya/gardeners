import { NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

const SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'fallback-secret-use-env-in-prod');

export async function middleware(req) {
  const { pathname } = req.nextUrl;
  const token = req.cookies.get('token')?.value;

  // Защита роута админа
  if (pathname.startsWith('/admin')) {
    if (!token) {
      return NextResponse.redirect(new URL('/login', req.url));
    }
    try {
      const { payload } = await jwtVerify(token, SECRET);
      if (payload.role !== 'ADMIN') {
        return NextResponse.redirect(new URL('/login', req.url));
      }
    } catch (e) {
      return NextResponse.redirect(new URL('/login', req.url));
    }
  }

  // Защита роута садовника
  if (pathname.startsWith('/gardener')) {
    if (!token) {
      return NextResponse.redirect(new URL('/login', req.url));
    }
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

export const config = {
  matcher: ['/admin/:path*', '/gardener/:path*'],
};
