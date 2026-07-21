import { NextResponse } from 'next/server';
import { verifyToken } from '@/lib/jwt';

export async function middleware(request) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get('token')?.value;

  const isAdminPage = pathname.startsWith('/admin');
  const isGardenerPage = pathname.startsWith('/gardener');

  if (!isAdminPage && !isGardenerPage) {
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

  if (isAdminPage && payload.role !== 'ADMIN') {
    return NextResponse.redirect(new URL('/gardener', request.url));
  }
  if (isGardenerPage && payload.role !== 'GARDENER') {
    return NextResponse.redirect(new URL('/admin', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*', '/gardener/:path*'],
};
