import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function GET() {
  try {
    const [dbUsers, dbGardeners] = await Promise.all([
      prisma.user.findMany({
        select: {
          phone: true,
          role: true,
          name: true,
        },
      }),
      prisma.gardener.findMany({
        select: {
          phone: true,
          name: true,
        },
      }),
    ]);

    const formattedList = [];

    dbUsers.forEach((u) => {
      if (!u.phone) return;
      const digits = String(u.phone).replace(/\D/g, '');
      formattedList.push({
        phone: digits || u.phone,
        role: u.role,
        name: u.name || null,
      });
    });

    dbGardeners.forEach((g) => {
      if (!g.phone) return;
      const digits = String(g.phone).replace(/\D/g, '');
      const phoneVal = digits || g.phone;
      const exists = formattedList.some(item => item.phone === phoneVal && item.role === 'GARDENER');
      if (!exists) {
        formattedList.push({
          phone: phoneVal,
          role: 'GARDENER',
          name: g.name || null,
        });
      }
    });

    return NextResponse.json(
      { users: formattedList },
      {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=300, stale-while-revalidate=86400',
        },
      }
    );
  } catch (error) {
    console.error('Error in /api/public/offline-users:', error);
    return NextResponse.json({ users: [] }, { status: 200 });
  }
}
