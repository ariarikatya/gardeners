import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';


const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: CORS_HEADERS });
}

export async function GET() {
  const services = await prisma.service.findMany({ orderBy: { name: 'asc' } });
  return NextResponse.json({ services }, { headers: CORS_HEADERS });
}
