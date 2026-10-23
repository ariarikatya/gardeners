import { NextResponse } from 'next/server';
import { verifyToken } from '@/lib/jwt';
import { syncOrdersToSheet } from '@/lib/syncSheets';

async function checkAdmin(req) {
  const token = req.cookies.get('token')?.value;
  if (!token) return false;
  const payload = await verifyToken(token);
  return payload && (payload.role === 'ADMIN' || payload.role === 'LEADER');
}

export async function POST(req) {
  if (!(await checkAdmin(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const result = await syncOrdersToSheet();
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: result.status || 500 });
  }

  return NextResponse.json({ success: true, count: result.count });
}
