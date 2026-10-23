import { NextResponse } from 'next/server';
import { verifyToken } from '@/lib/jwt';
import { syncOrdersToSheet } from '@/lib/syncSheets';

// Эндпоинт для ручного запуска и диагностики синхронизации Google Таблиц.
// Защищён заголовком x-cron-secret или сессией администратора/руководителя (ADMIN/LEADER).
async function checkAdmin(req) {
  const token = req.cookies.get('token')?.value;
  if (!token) return false;
  const payload = await verifyToken(token);
  return payload && (payload.role === 'ADMIN' || payload.role === 'LEADER');
}

async function checkAuth(req) {
  const cronSecretHeader = req.headers.get('x-cron-secret');
  const cronSecretEnv = process.env.CRON_SECRET;
  if (cronSecretEnv && cronSecretHeader === cronSecretEnv) {
    return true;
  }
  return await checkAdmin(req);
}

export async function POST(req) {
  if (!(await checkAuth(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await syncOrdersToSheet();
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: result.status || 500 });
  }

  return NextResponse.json({ success: true, count: result.count });
}
