import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function GET() {
  try {
    const users = await prisma.user.findMany({
      select: {
        phone: true,
        role: true,
        name: true,
      },
    });

    const formattedUsers = users.map((u) => {
      let clean = String(u.phone || '').replace(/\D/g, '');
      if (clean.length === 11 && clean.startsWith('8')) {
        clean = '7' + clean.slice(1);
      }
      return {
        phone: clean || u.phone,
        role: u.role,
        name: u.name || null,
      };
    });

    return NextResponse.json(
      { users: formattedUsers },
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
