import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import prisma from '@/lib/prisma';
import { requireChatUser } from '@/lib/chatAuth';
import { getUploadsDir } from '@/lib/uploads';

export async function GET(req, { params }) {
  const auth = await requireChatUser(req);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const attachment = await prisma.chatAttachment.findFirst({
      where: {
        id: params.attachmentId,
        message: { chat: { participants: { some: { userId: auth.user.id } } } },
      },
      select: { filename: true, mimeType: true, storagePath: true },
    });
    if (!attachment) return NextResponse.json({ error: 'Файл не найден' }, { status: 404 });

    const segments = attachment.storagePath.split('/');
    if (segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.includes('\\'))) {
      return NextResponse.json({ error: 'Файл недоступен' }, { status: 404 });
    }

    const uploadsDir = path.resolve(getUploadsDir());
    const filePath = path.resolve(uploadsDir, ...segments);
    if (!filePath.startsWith(`${uploadsDir}${path.sep}`) || !fs.existsSync(filePath)) {
      return NextResponse.json({ error: 'Файл не найден' }, { status: 404 });
    }

    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return NextResponse.json({ error: 'Файл не найден' }, { status: 404 });

    const isMedia = attachment.mimeType.startsWith('image/') || attachment.mimeType.startsWith('video/');
    const safeName = attachment.filename.replace(/[\r\n"]/g, '_');
    const headers = {
      'Content-Type': isMedia ? attachment.mimeType : 'application/octet-stream',
      'Content-Disposition': `${isMedia ? 'inline' : 'attachment'}; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`,
      'X-Content-Type-Options': 'nosniff',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, no-store',
    };
    const range = req.headers.get('range');
    if (range) {
      const match = range.match(/^bytes=(\d*)-(\d*)$/);
      if (!match) return new NextResponse(null, { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } });
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Number(match[2]) : stat.size - 1;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= stat.size || end < start || end >= stat.size) {
        return new NextResponse(null, { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } });
      }
      const buffer = Buffer.alloc(end - start + 1);
      const fd = fs.openSync(filePath, 'r');
      try {
        fs.readSync(fd, buffer, 0, buffer.length, start);
      } finally {
        fs.closeSync(fd);
      }
      return new NextResponse(buffer, {
        status: 206,
        headers: {
          ...headers,
          'Content-Length': String(buffer.length),
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        },
      });
    }

    const buffer = fs.readFileSync(filePath);
    return new NextResponse(buffer, {
      status: 200,
      headers: { ...headers, 'Content-Length': String(buffer.length) },
    });
  } catch (error) {
    console.error('Ошибка GET /api/chats/attachments/[attachmentId]:', error);
    return NextResponse.json({ error: 'Не удалось открыть файл' }, { status: 500 });
  }
}
