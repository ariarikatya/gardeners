import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getUploadsDir } from '@/lib/uploads';

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    case '.svg':
      return 'image/svg+xml';
    case '.mp4':
      return 'video/mp4';
    case '.webm':
      return 'video/webm';
    case '.mov':
      return 'video/quicktime';
    case '.mkv':
      return 'video/x-matroska';
    case '.avi':
      return 'video/x-msvideo';
    case '.3gp':
      return 'video/3gpp';
    case '.ogv':
      return 'video/ogg';
    default:
      return 'application/octet-stream';
  }
}

export async function GET(req, { params }) {
  try {
    const rawSegments = params?.path || [];
    const segments = Array.isArray(rawSegments) ? rawSegments : [rawSegments];

    // Anti path-traversal validation
    if (segments.some(s => typeof s !== 'string' || s.includes('..') || s.includes('/') || s.includes('\\'))) {
      return NextResponse.json({ error: 'Доступ запрещён' }, { status: 403 });
    }

    const uploadsDir = path.resolve(getUploadsDir());
    const fullPath = path.resolve(uploadsDir, ...segments);

    if (!fullPath.startsWith(uploadsDir)) {
      return NextResponse.json({ error: 'Доступ запрещён' }, { status: 403 });
    }

    if (!fs.existsSync(fullPath)) {
      return NextResponse.json({ error: 'Файл не найден' }, { status: 404 });
    }

    const stat = fs.statSync(fullPath);
    if (!stat.isFile()) {
      return NextResponse.json({ error: 'Файл не найден' }, { status: 404 });
    }

    const mtimeMs = Math.floor(stat.mtimeMs);
    const size = stat.size;
    const etag = `"${mtimeMs.toString(16)}-${size.toString(16)}"`;
    const contentType = getMimeType(fullPath);

    // ETag / If-None-Match check for 304 Not Modified
    const ifNoneMatch = req.headers.get('if-none-match');
    if (ifNoneMatch && (ifNoneMatch === etag || ifNoneMatch.includes(etag))) {
      return new NextResponse(null, {
        status: 304,
        headers: {
          'ETag': etag,
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      });
    }

    // Range header support
    const range = req.headers.get('range');
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10) || 0;
      const end = parts[1] ? parseInt(parts[1], 10) : size - 1;

      if (start >= size || end >= size) {
        return new NextResponse(null, {
          status: 416,
          headers: { 'Content-Range': `bytes */${size}` },
        });
      }

      const chunkSize = end - start + 1;
      const buffer = Buffer.alloc(chunkSize);
      const fd = fs.openSync(fullPath, 'r');
      fs.readSync(fd, buffer, 0, chunkSize, start);
      fs.closeSync(fd);

      return new NextResponse(buffer, {
        status: 206,
        headers: {
          'Content-Range': `bytes ${start}-${end}/${size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': String(chunkSize),
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=31536000, immutable',
          'ETag': etag,
        },
      });
    }

    const fileBuffer = fs.readFileSync(fullPath);
    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(size),
        'Cache-Control': 'public, max-age=31536000, immutable',
        'ETag': etag,
      },
    });
  } catch (err) {
    console.error('File serve error:', err);
    return NextResponse.json({ error: 'Ошибка при чтении файла' }, { status: 500 });
  }
}
