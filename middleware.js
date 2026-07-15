import { NextResponse } from 'next/server';

export function middleware(request) {
  // Самый простой и легковесный пропуск запросов, который Vercel Edge переварит без ошибок
  return NextResponse.next();
}

export const config = {
  // Указываем пути, на которых должен срабатывать middleware
  matcher: ['/api/:path*', '/admin/:path*'],
};
