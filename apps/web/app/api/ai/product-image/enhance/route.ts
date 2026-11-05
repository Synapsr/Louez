import { NextResponse } from "next/server";

import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db, products } from "@louez/db";
import { MAX_IMAGE_SIZE, isOwnedImageUrl } from "@louez/validations";

import { maybeTriggerAutoTopup } from "@/lib/ai/advisor/auto-topup";
import { microToCredits } from "@/lib/ai/advisor/credits";
import {
  BackgroundRemovalError,
  isImageBackgroundRemovalEnabled,
} from "@/lib/ai/image/background-removal";
import {
  checkImageCredits,
  checkImageEnhanceCredits,
  isAiImageEnhanceEnabled,
  recordImageEnhanceDebit,
} from "@/lib/ai/image/credits";
import {
  isImageProcessingDebugEnabled,
  persistImageProcessingDebugRun,
} from "@/lib/ai/image/debug-artifacts";
import {
  type ProductImageMimeType,
  processProductImage,
} from "@/lib/ai/image/process-product-image";
import { ImageProviderError } from "@/lib/ai/image/provider";
import {
  getImageBgRemovalCredits,
  imageBgRemovalBillMicro,
  imageEnhanceCost,
} from "@/lib/ai/pricing";
import { auth } from "@/lib/auth";
import { log, useLogger, withEvlog } from "@/lib/evlog";
import { getStorePlan } from "@/lib/plan-limits";
import { areAiCreditsEnabled } from "@/lib/plans";
import { getImageFiles } from "@/lib/storage/files";
import { getCurrentStore, hasPermission } from "@/lib/store-context";
import { canApplyProductImageOperation } from "@/lib/uploads/image-upload";

import { parseTrustedDemoProductImageUrl } from "./util.product-image-source";

// GPT Image (up to 210s), rembg (up to 120s), storage and post-processing.
export const maxDuration = 360;

// Same shape the upload pipeline enforces on keys (lib/storage/files.ts),
// minus GIF: an animated source has no meaningful "product on transparency".
const KEY_PATTERN = /^[a-zA-Z0-9/_-]+\.(?:jpe?g|png|webp)$/;

const MIME_BY_EXTENSION: Record<string, ProductImageMimeType> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

const requestSchema = z.object({
  imageKey: z.string().min(1).max(300),
  imageUrl: z.string().min(1).max(2_048).optional(),
  productId: z.string().length(21).optional(),
  productName: z.string().trim().max(200).optional(),
  operation: z.enum(["enhance", "remove-background"]).default("enhance"),
});

/**
 * The client hung up — it cancelled, navigated away or lost the connection.
 * Nobody is listening for this body; it exists so the outcome is legible in
 * the logs. What matters is the absolute rule it enforces at every call site:
 * work that will never be delivered is never billed.
 */
const cancelled = () => NextResponse.json({ code: "cancelled" }, { status: 499 });

type ProductImageSource =
  | { kind: "stored"; key: string }
  | { kind: "trusted-demo"; key: string; url: URL };

function isSupportedImageMimeType(value: string): value is ProductImageMimeType {
  return Object.values(MIME_BY_EXTENSION).some((mimeType) => mimeType === value);
}

const handlePost = async (request: Request) => {
  const logger = useLogger();

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ code: "unauthorized" }, { status: 401 });
  }

  // Writes a new object into the store's product folder and can spend the
  // store's credits, so it needs the same 'write' grant as editing a product.
  const store = await getCurrentStore();
  if (!store || !hasPermission(store.role, "write")) {
    return NextResponse.json({ code: "forbidden" }, { status: 403 });
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ code: "invalid_image" }, { status: 400 });
  }

  const { operation } = parsed.data;
  if (operation === "enhance" && !isAiImageEnhanceEnabled()) {
    return NextResponse.json({ code: "ai_image_disabled" }, { status: 503 });
  }
  if (operation === "remove-background" && !isImageBackgroundRemovalEnabled()) {
    return NextResponse.json({ code: "background_removal_disabled" }, { status: 503 });
  }

  // Uploaded images must belong to THIS store. Seeded demo products are the
  // sole exception: their catalog can reuse a public image from another Louez
  // bucket, so require both exact product membership and a trusted S3 host.
  const prefix = `${store.id}/products/`;
  const imageKey = parsed.data.imageKey.includes("/")
    ? parsed.data.imageKey
    : `${prefix}${parsed.data.imageKey}`;
  let imageSource: ProductImageSource;

  if (parsed.data.imageUrl && !isOwnedImageUrl(parsed.data.imageUrl, `${store.id}/products`)) {
    const trustedUrl = parseTrustedDemoProductImageUrl(parsed.data.imageUrl);
    if (!trustedUrl || !parsed.data.productId) {
      return NextResponse.json({ code: "invalid_image" }, { status: 400 });
    }

    const product = await db.query.products.findFirst({
      where: and(eq(products.id, parsed.data.productId), eq(products.storeId, store.id)),
      columns: { images: true },
    });
    if (!product?.images?.includes(parsed.data.imageUrl)) {
      return NextResponse.json({ code: "invalid_image" }, { status: 400 });
    }

    imageSource = {
      kind: "trusted-demo",
      key: trustedUrl.pathname.replace(/^\/+/, ""),
      url: trustedUrl,
    };
  } else {
    if (!imageKey.startsWith(prefix) || !KEY_PATTERN.test(imageKey)) {
      return NextResponse.json({ code: "invalid_image" }, { status: 400 });
    }
    imageSource = { kind: "stored", key: imageKey };
  }

  if (!canApplyProductImageOperation(`/${imageSource.key}`, operation)) {
    return NextResponse.json({ code: "already_processed" }, { status: 409 });
  }

  // AI credit gate (cloud commercial layer). Inert unless enabled; fail-closed.
  // Standalone background removal is only metered when its own flat tariff is
  // configured — free by default.
  const bgBillMicro = imageBgRemovalBillMicro();
  const operationBilled = operation === "enhance" || bgBillMicro > 0;
  const plan = operationBilled && areAiCreditsEnabled() ? await getStorePlan(store.id) : null;
  if (plan) {
    const creditCheck =
      operation === "enhance"
        ? await checkImageEnhanceCredits(store.id, plan)
        : await checkImageCredits(store.id, plan, getImageBgRemovalCredits());
    if (!creditCheck.allowed) {
      return NextResponse.json({ code: "credits_exhausted" }, { status: 402 });
    }
  }

  const files = getImageFiles();

  // Read regular uploads through the storage adapter. Demo catalog images can
  // live in another Louez bucket, so their already-authorized URL is fetched.
  let source: Buffer;
  let sourceMimeType: ProductImageMimeType;
  try {
    if (imageSource.kind === "stored") {
      const stored = await files.download(imageSource.key);
      source = Buffer.from(await stored.arrayBuffer());
      const extension = imageSource.key.split(".").pop()?.toLowerCase() ?? "";
      sourceMimeType = MIME_BY_EXTENSION[extension] ?? "image/png";
    } else {
      const response = await fetch(imageSource.url, {
        headers: { Accept: Object.values(MIME_BY_EXTENSION).join(",") },
        cache: "no-store",
        redirect: "error",
        signal: request.signal,
      });
      if (!response.ok) throw new Error("Demo product image fetch failed");

      const contentLength = Number(response.headers.get("content-length") ?? 0);
      if (contentLength > MAX_IMAGE_SIZE) {
        return NextResponse.json({ code: "invalid_image" }, { status: 400 });
      }

      const mimeType = response.headers.get("content-type")?.split(";")[0] ?? "";
      if (!isSupportedImageMimeType(mimeType)) {
        return NextResponse.json({ code: "invalid_image" }, { status: 400 });
      }

      source = Buffer.from(await response.arrayBuffer());
      sourceMimeType = mimeType;
    }
  } catch (error) {
    if (request.signal.aborted) return cancelled();
    logger.error(error instanceof Error ? error : new Error("Product image read failed"));
    return NextResponse.json({ code: "invalid_image" }, { status: 400 });
  }

  if (source.byteLength === 0 || source.byteLength > MAX_IMAGE_SIZE) {
    return NextResponse.json({ code: "invalid_image" }, { status: 400 });
  }

  const runId = randomUUID();
  const processingStartedAt = Date.now();
  // Cheapest possible exit: the client may already be gone before we spend a
  // single provider second.
  if (request.signal.aborted) return cancelled();

  let processed: Awaited<ReturnType<typeof processProductImage>>;
  try {
    processed = await processProductImage({
      source,
      sourceMimeType,
      operation,
      productName: parsed.data.productName,
      signal: request.signal,
    });
    if (processed.chromaFallbackReason) {
      logger.set({ imageChromaFallback: processed.chromaFallbackReason });
    }
  } catch (error) {
    // Checked before any classification: a cancelled run surfaces as an aborted
    // fetch inside the provider wrappers, and must not be logged or reported as
    // a provider outage. Nothing was uploaded yet, so there is nothing to undo.
    if (request.signal.aborted) return cancelled();

    // Provider messages can carry request details — logged, never returned.
    logger.error(error instanceof Error ? error : new Error("Product image processing failed"));
    if (error instanceof Error && error.message === "empty_image") {
      return NextResponse.json({ code: "empty_image" }, { status: 422 });
    }
    if (error instanceof ImageProviderError) {
      return NextResponse.json({ code: "provider_error" }, { status: 502 });
    }
    if (error instanceof BackgroundRemovalError) {
      return NextResponse.json({ code: "background_removal_error" }, { status: 502 });
    }
    // Anything else (e.g. an unreadable source the decoder chokes on) is ours.
    return NextResponse.json({ code: "server_error" }, { status: 500 });
  }
  const processingDurationMs = Date.now() - processingStartedAt;
  const enhanceCost = operation === "enhance" ? imageEnhanceCost(processed.imageUsage) : null;

  // Always a NEW object (same id shape the upload router mints) — the original
  // stays untouched so the merchant can always fall back to it.
  const objectId = runId;
  const suffix = operation === "enhance" ? "ai" : "bg";
  const key = `${prefix}${objectId}-${suffix}.webp`;

  // Cancelled while the providers were working: skip the upload entirely so no
  // orphan object is minted for a result nobody will ever see.
  if (request.signal.aborted) return cancelled();

  let url: string;
  try {
    await files.upload(key, processed.standardized.buffer, {
      contentType: processed.standardized.contentType,
    });
    url = await files.url(key);
  } catch (error) {
    logger.error(error instanceof Error ? error : new Error("Processed image upload failed"));
    return NextResponse.json({ code: "server_error" }, { status: 500 });
  }

  // Last and most important checkpoint. The result exists but the client is
  // gone, so it will never be delivered: drop the object and charge nothing.
  // Deliberately NOT the ledger-failure path below — that one is a 500 because
  // something went wrong; this one is the merchant's own decision.
  if (request.signal.aborted) {
    await files.delete(key).catch(() => undefined);
    return cancelled();
  }

  // Billed only once the result is stored, and keyed on the new object so a
  // retried request can never charge twice. If the ledger write fails for any
  // reason other than a dedup replay, withhold the result (delete the object)
  // instead of delivering unaccounted work.
  let creditsCharged = 0;
  if (plan) {
    try {
      const debitedMicro = await recordImageEnhanceDebit(store.id, {
        dedupKey: `${operation === "enhance" ? "imgenh" : "imgbg"}:${objectId}`,
        imageKey: key,
        plan,
        costMicroUsd: enhanceCost?.microUsd ?? 0,
        billMicro: operation === "enhance" ? undefined : bgBillMicro,
      });
      creditsCharged = microToCredits(debitedMicro);
    } catch {
      await files.delete(key).catch(() => undefined);
      return NextResponse.json({ code: "server_error" }, { status: 500 });
    }

    // Off the critical path (result already stored): recharge the merchant's
    // balance off-session if it dropped below their threshold.
    await maybeTriggerAutoTopup(store.id);
  }

  const imageDebugEnabled = isImageProcessingDebugEnabled();
  try {
    const imageDebugCaptured = await persistImageProcessingDebugRun({
      runId,
      storeId: store.id,
      operation,
      framingMode: operation === "enhance" ? processed.standardized.resolvedFramingMode : null,
      backgroundRemovalMethod: processed.backgroundRemovalMethod,
      aiModel: processed.imageModel,
      createdAt: new Date(processingStartedAt),
      sourceKey: imageSource.key,
      outputKey: key,
      totalDurationMs: processingDurationMs,
      stages: processed.stages,
      economics: enhanceCost
        ? {
            chargedCredits: creditsCharged,
            providerCostMicroUsd: enhanceCost.microUsd,
            providerCostSource: enhanceCost.source,
            usage: processed.imageUsage,
          }
        : undefined,
    });
    logger.set({
      imageDebug: {
        captured: imageDebugCaptured,
        enabled: imageDebugEnabled,
        runId,
      },
      imageProviderCost: {
        microUsd: enhanceCost?.microUsd ?? null,
        source: enhanceCost?.source ?? null,
        usageCaptured: processed.imageUsage !== null,
      },
    });
    // The standalone Next.js runtime currently does not execute evlog's
    // deferred filesystem drain. Emit this critical diagnostic immediately so
    // container stdout still proves whether the private artifacts were saved.
    log.info({
      imageDebug: {
        captured: imageDebugCaptured,
        enabled: imageDebugEnabled,
        runId,
      },
      imageProviderCost: {
        microUsd: enhanceCost?.microUsd ?? null,
        source: enhanceCost?.source ?? null,
        usageCaptured: processed.imageUsage !== null,
      },
    });
  } catch (error) {
    // Diagnostics must never withhold a valid customer-facing result.
    logger.error(
      error instanceof Error ? error : new Error("Image processing debug persistence failed"),
      {
        imageDebug: {
          captured: false,
          enabled: imageDebugEnabled,
          runId,
        },
      },
    );
    log.error({
      imageDebug: {
        captured: false,
        enabled: imageDebugEnabled,
        runId,
      },
      error: {
        message: error instanceof Error ? error.message : String(error),
        name: error instanceof Error ? error.name : "UnknownError",
      },
    });
  }

  return NextResponse.json({
    key,
    url,
    creditsCharged,
    framingMode: processed.standardized.resolvedFramingMode,
  });
};

export const POST = withEvlog(handlePost);
