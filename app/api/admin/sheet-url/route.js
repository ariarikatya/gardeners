import { NextResponse } from 'next/server';
import { verifyToken } from '@/lib/jwt';

async function checkAdmin(req) {
  const token = req.cookies.get('token')?.value;
  if (!token) return false;
  const payload = await verifyToken(token);
  return payload && (payload.role === 'ADMIN' || payload.role === 'LEADER');
}

export async function GET(req) {
  if (!(await checkAdmin(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!sheetId) {
    return NextResponse.json({ error: 'GOOGLE_SHEET_ID не настроен на сервере' }, { status: 500 });
  }

  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;
  return NextResponse.json({ url });
}
