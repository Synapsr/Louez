import { NextResponse } from "next/server";

import { GetObjectCommand } from "@aws-sdk/client-s3";
import { Readable } from "node:stream";

import { env } from "@/env";
import { isStandaloneMode } from "@/lib/deployment";
import { getStorageClient } from "@/lib/storage/files";

export const runtime = "nodejs";

// Same shape the upload pipeline enforces on keys (lib/storage/files.ts):
// alphanumeric path segments ending in an image extension. Rejecting anything
// else keeps this from becoming a generic bucket browser.
const KEY_PATTERN = /^[a-zA-Z0-9/_-]+\.(?:jpe?g|png|gif|webp)$/;

interface RouteContext {
  params: Promise<{ key: string[] }>;
}

/**
 * Public, same-origin delivery of stored images.
 *
 * Standalone instances run their object store (bundled MinIO) privately
 * inside the compose network and set S3_PUBLIC_URL to the path "/files", so
 * stored image URLs resolve here and stream from the bucket. Objects are
 * public product/logo assets by design — the ACL is set at upload time.
 */
export async function GET(_request: Request, context: RouteContext) {
  // Platform deployments serve assets straight from their public bucket URL;
  // this credentialed proxy exists only for the standalone private store and
  // must not add a bucket-read surface to the multi-tenant cloud.
  if (!isStandaloneMode()) {
    return new NextResponse(null, { status: 404 });
  }

  const { key: segments } = await context.params;
  const key = segments.map((segment) => decodeURIComponent(segment)).join("/");

  if (!KEY_PATTERN.test(key)) {
    return new NextResponse(null, { status: 404 });
  }

  try {
    const object = await getStorageClient().send(
      new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }),
    );

    if (!object.Body) {
      return new NextResponse(null, { status: 404 });
    }

    const stream = Readable.toWeb(
      object.Body as Readable,
    ) as ReadableStream<Uint8Array>;

    return new NextResponse(stream, {
      headers: {
        "Content-Type": object.ContentType ?? "application/octet-stream",
        ...(object.ContentLength !== undefined
          ? { "Content-Length": String(object.ContentLength) }
          : {}),
        // Keys are content-addressed by the upload pipeline (unique per
        // upload), so aggressive immutable caching is safe.
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
