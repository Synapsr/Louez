import { NextResponse } from "next/server";

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db, products } from "@louez/db";
import { toAbsoluteUrl } from "@louez/utils";
import { MAX_IMAGE_SIZE, isOwnedImageUrl } from "@louez/validations";

import { parseTrustedDemoProductImageUrl } from "@/lib/ai/image/product-image-source";
import { env } from "@/env";
import { useLogger, withEvlog } from "@/lib/evlog";
import { getCurrentStore } from "@/lib/store-context";
import { IMAGE_UPLOAD_MIME_TYPES } from "@/lib/uploads/image-upload";

const requestSchema = z.object({
  // Absolute bucket URL, or a site-relative "/files/…" path on standalone
  // deployments (same shapes isOwnedImageUrl accepts).
  url: z
    .string()
    .refine((value) => (value.startsWith("/") && !value.startsWith("//")) || URL.canParse(value)),
  productId: z.string().length(21).optional(),
});

const handlePost = async (request: Request) => {
  const logger = useLogger();

  try {
    const store = await getCurrentStore();
    if (!store) {
      return NextResponse.json({ error: "errors.unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "errors.invalidData" }, { status: 400 });
    }

    let sourceUrl = toAbsoluteUrl(parsed.data.url, env.NEXT_PUBLIC_APP_URL);

    if (!isOwnedImageUrl(parsed.data.url, `${store.id}/products`)) {
      const trustedDemoUrl = parseTrustedDemoProductImageUrl(sourceUrl);
      if (!trustedDemoUrl || !parsed.data.productId) {
        return NextResponse.json({ error: "errors.forbidden" }, { status: 403 });
      }

      const product = await db.query.products.findFirst({
        where: and(eq(products.id, parsed.data.productId), eq(products.storeId, store.id)),
        columns: { images: true },
      });
      if (!product?.images?.includes(parsed.data.url)) {
        return NextResponse.json({ error: "errors.forbidden" }, { status: 403 });
      }

      sourceUrl = trustedDemoUrl.toString();
    }

    const sourceResponse = await fetch(sourceUrl, {
      headers: { Accept: IMAGE_UPLOAD_MIME_TYPES.join(",") },
      cache: "no-store",
      redirect: "error",
      signal: request.signal,
    });

    if (!sourceResponse.ok) {
      return NextResponse.json({ error: "errors.notFound" }, { status: 404 });
    }

    const mimeType = sourceResponse.headers.get("content-type")?.split(";")[0];
    if (!mimeType || !IMAGE_UPLOAD_MIME_TYPES.some((allowedType) => allowedType === mimeType)) {
      return NextResponse.json({ error: "errors.invalidData" }, { status: 400 });
    }

    const buffer = Buffer.from(await sourceResponse.arrayBuffer());
    if (buffer.byteLength > MAX_IMAGE_SIZE) {
      return NextResponse.json({ error: "errors.invalidData" }, { status: 400 });
    }

    return NextResponse.json({
      dataUrl: `data:${mimeType};base64,${buffer.toString("base64")}`,
      mimeType,
      size: buffer.byteLength,
    });
  } catch (error) {
    logger.error(error instanceof Error ? error : new Error("Image source fetch failed"));
    return NextResponse.json({ error: "errors.serverError" }, { status: 500 });
  }
};

export const POST = withEvlog(handlePost);
