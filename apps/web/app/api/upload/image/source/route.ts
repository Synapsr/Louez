import { NextRequest, NextResponse } from 'next/server';

import { z } from 'zod';

import { MAX_IMAGE_SIZE } from '@louez/validations';

import { auth } from '@/lib/auth';

const requestSchema = z.object({
  url: z.string().url(),
});

function getAllowedOrigins(request: NextRequest): Set<string> {
  const origins = new Set<string>();

  const s3PublicUrl = process.env.S3_PUBLIC_URL;
  if (s3PublicUrl) {
    try {
      origins.add(new URL(s3PublicUrl).origin);
    } catch {
      // ignore invalid env value
    }
  }

  if (process.env.NODE_ENV === 'development') {
    const appOrigin = request.nextUrl.origin;
    origins.add(appOrigin);
    origins.add('http://localhost:3000');
    origins.add('http://127.0.0.1:3000');
  }

  return origins;
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'errors.unauthorized' },
        { status: 401 },
      );
    }

    const body = await request.json().catch(() => null);
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'errors.invalidData' },
        { status: 400 },
      );
    }

    const sourceUrl = new URL(parsed.data.url);
    const allowedOrigins = getAllowedOrigins(request);

    if (!allowedOrigins.has(sourceUrl.origin)) {
      return NextResponse.json({ error: 'errors.forbidden' }, { status: 403 });
    }

    const sourceResponse = await fetch(sourceUrl.toString(), {
      headers: { Accept: 'image/*' },
      cache: 'no-store',
    });

    if (!sourceResponse.ok) {
      return NextResponse.json({ error: 'errors.notFound' }, { status: 404 });
    }

    const mimeType = sourceResponse.headers.get('content-type') || 'image/jpeg';
    if (!mimeType.startsWith('image/')) {
      return NextResponse.json(
        { error: 'errors.invalidData' },
        { status: 400 },
      );
    }

    const buffer = Buffer.from(await sourceResponse.arrayBuffer());
    if (buffer.byteLength > MAX_IMAGE_SIZE) {
      return NextResponse.json(
        { error: 'errors.invalidData' },
        { status: 400 },
      );
    }

    const dataUrl = `data:${mimeType};base64,${buffer.toString('base64')}`;

    return NextResponse.json({
      dataUrl,
      mimeType,
      size: buffer.byteLength,
    });
  } catch (error) {
    console.error('[Upload] Source image fetch error:', error);
    return NextResponse.json({ error: 'errors.serverError' }, { status: 500 });
  }
}
