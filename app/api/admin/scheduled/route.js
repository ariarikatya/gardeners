import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { verifyToken } from '@/lib/jwt';
import { runFineChecks } from '@/lib/fines';

async function checkAdmin(req) {
  const token = req.cookies.get('token')?.value;
  if (!token) return false;
  const payload = await verifyToken(token);
  return payload && payload.role === 'ADMIN';
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

  try {
    const result = await runFineChecks(prisma);
    return NextResponse.json(result);
  } catch (e) {
    console.error('Scheduled task failed', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
