import { NextResponse } from "next/server";

import { z } from "zod";

import { toAbsoluteUrl } from "@louez/utils";
import { MAX_IMAGE_SIZE, isOwnedImageUrl } from "@louez/validations";

import { env } from "@/env";
import { useLogger, withEvlog } from "@/lib/evlog";
import { getCurrentStore } from "@/lib/store-context";
import { IMAGE_UPLOAD_MIME_TYPES } from "@/lib/uploads/image-upload";

const requestSchema = z.object({
  // Absolute bucket URL, or a site-relative "/files/…" path on standalone
  // deployments (same shapes isOwnedImageUrl accepts).
  url: z
    .string()
    .refine(
      (value) =>
        (value.startsWith("/") && !value.startsWith("//")) ||
        URL.canParse(value),
    ),
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

    if (!isOwnedImageUrl(parsed.data.url, `${store.id}/products`)) {
      return NextResponse.json({ error: "errors.forbidden" }, { status: 403 });
    }

    const sourceResponse = await fetch(
      toAbsoluteUrl(parsed.data.url, env.NEXT_PUBLIC_APP_URL),
      {
        headers: { Accept: IMAGE_UPLOAD_MIME_TYPES.join(",") },
        cache: "no-store",
      },
    );

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
