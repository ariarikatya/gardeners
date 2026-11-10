import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import prisma from '@/lib/prisma';
import { requireChatUser } from '@/lib/chatAuth';
import { getUploadsDir } from '@/lib/uploads';

const MEDIA_TYPES_BY_EXTENSION = {
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.gif': 'image/gif',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.webp': 'image/webp',
  '.3gp': 'video/3gpp',
  '.avi': 'video/x-msvideo',
  '.m4v': 'video/x-m4v',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.mp4': 'video/mp4',
  '.ogv': 'video/ogg',
  '.webm': 'video/webm',
};

function getAttachmentMimeType(attachment) {
  if (attachment.mimeType?.startsWith('image/') || attachment.mimeType?.startsWith('video/')) {
    return attachment.mimeType;
  }
  return MEDIA_TYPES_BY_EXTENSION[path.extname(attachment.filename).toLowerCase()] || 'application/octet-stream';
}

export async function GET(req, { params }) {
  const auth = await requireChatUser(req);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const attachment = await prisma.chatAttachment.findFirst({
      where: {
        id: params.attachmentId,
        message: {
          isDeleted: false,
          chat: { participants: { some: { userId: auth.user.id, hiddenAt: null } } },
        },
      },
      select: {
        id: true,
        filename: true,
        mimeType: true,
        storagePath: true,
        messageId: true,
        message: { select: { chatId: true, createdAt: true } },
      },
    });
    if (!attachment) return NextResponse.json({ error: 'Файл не найден' }, { status: 404 });
    const membership = await prisma.chatParticipant.findUnique({
      where: { chatId_userId: { chatId: attachment.message.chatId, userId: auth.user.id } },
      select: { historyClearedAt: true },
    });
    if (
      !membership
      || (membership.historyClearedAt && attachment.message.createdAt <= membership.historyClearedAt)
    ) {
      return NextResponse.json({ error: 'Файл не найден' }, { status: 404 });
    }

    if (typeof attachment.storagePath !== 'string') {
      return NextResponse.json({ error: 'Файл недоступен' }, { status: 404 });
    }

    const uploadsDir = path.resolve(getUploadsDir());
    const normalizedStoragePath = attachment.storagePath.replace(/\\/g, '/').trim();
    const segments = normalizedStoragePath.split('/').filter(Boolean);
    if (segments.some((segment) => segment === '.' || segment === '..')) {
      return NextResponse.json({ error: 'Файл недоступен' }, { status: 404 });
    }

    const filePath = path.isAbsolute(normalizedStoragePath)
      ? path.resolve(normalizedStoragePath)
      : path.resolve(uploadsDir, normalizedStoragePath);

    if (!filePath.startsWith(`${uploadsDir}${path.sep}`) && filePath !== uploadsDir) {
      return NextResponse.json({ error: 'Файл недоступен' }, { status: 404 });
    }
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: 'Файл не найден' }, { status: 404 });
    }

    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return NextResponse.json({ error: 'Файл не найден' }, { status: 404 });

    const mimeType = getAttachmentMimeType(attachment);
    const isMedia = mimeType.startsWith('image/') || mimeType.startsWith('video/');
    const fallbackName = String(attachment.filename || 'download').replace(/[\r\n"]/g, '_').replace(/[^\x20-\x7E]/g, '_');
    const headers = {
      'Content-Type': mimeType,
      'Content-Disposition': `${isMedia ? 'inline' : 'attachment'}; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(attachment.filename || 'download')}`,
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
