import { NextResponse } from "next/server";

import { randomUUID } from "node:crypto";
import { ProductImageFailure } from "@louez/api/platform/ports";
import { db, products } from "@louez/db";
import { canApplyProductImageOperation } from "@louez/utils";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { microToCredits } from "@/lib/ai/advisor/credits";
import {
  afterProductImageRun,
  debitProductImage,
  discardProductImage,
  providerCostOf,
  quoteProductImage,
  readProductImageSource,
  resolveProductImageSource,
  runProductImagePipeline,
  storeProductImage,
  type ProductImageRunReport,
} from "@/lib/ai/image/product-image-run";
import { auth } from "@/lib/auth";
import { useLogger, withEvlog } from "@/lib/evlog";
import { getCurrentStore, hasPermission } from "@/lib/store-context";

// GPT Image (up to 210s), rembg (up to 120s), storage and post-processing.
export const maxDuration = 360;

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

/** The answer the dashboard reads for each failure of a run. */
const FAILURE_RESPONSES: Record<ProductImageFailure["code"], { code: string; status: number }> = {
  IMAGE_SOURCE_UNREADABLE: { code: "invalid_image", status: 400 },
  IMAGE_EMPTY: { code: "empty_image", status: 422 },
  PROVIDER_ERROR: { code: "provider_error", status: 502 },
  BACKGROUND_REMOVAL_ERROR: { code: "background_removal_error", status: 502 },
  STORAGE_ERROR: { code: "server_error", status: 500 },
  PROCESSING_ERROR: { code: "server_error", status: 500 },
};

const failed = (error: unknown) => {
  const response =
    error instanceof ProductImageFailure
      ? FAILURE_RESPONSES[error.code]
      : { code: "server_error", status: 500 };
  return NextResponse.json({ code: response.code }, { status: response.status });
};

/**
 * The dashboard's AI photo run: synchronous, the form keeps the result (an
 * agent starts a job instead, packages/api services/product-images.ts). The
 * steps are lib/ai/image/product-image-run.ts, the same as the job's.
 */
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
  const quote = await quoteProductImage(store.id, operation);
  if (!quote.available) {
    return NextResponse.json(
      { code: operation === "enhance" ? "ai_image_disabled" : "background_removal_disabled" },
      { status: 503 },
    );
  }

  // Uploaded images must belong to THIS store. Seeded demo products are the
  // sole exception: their catalog can reuse a public image from another Louez
  // bucket, so require both exact product membership and a trusted S3 host.
  const source = resolveProductImageSource(store.id, {
    key: parsed.data.imageKey,
    url: parsed.data.imageUrl,
  });
  if (!source) return NextResponse.json({ code: "invalid_image" }, { status: 400 });
  if (source.kind === "trusted-demo") {
    if (!parsed.data.productId || !parsed.data.imageUrl) {
      return NextResponse.json({ code: "invalid_image" }, { status: 400 });
    }
    const product = await db.query.products.findFirst({
      where: and(eq(products.id, parsed.data.productId), eq(products.storeId, store.id)),
      columns: { images: true },
    });
    if (!product?.images?.includes(parsed.data.imageUrl)) {
      return NextResponse.json({ code: "invalid_image" }, { status: 400 });
    }
  }

  if (!canApplyProductImageOperation(`/${source.key}`, operation)) {
    return NextResponse.json({ code: "already_processed" }, { status: 409 });
  }

  // AI credit gate (cloud commercial layer). Inert unless enabled; fail-closed.
  if (quote.credits && !quote.credits.allowed) {
    return NextResponse.json({ code: "credits_exhausted" }, { status: 402 });
  }

  let report: ProductImageRunReport;
  try {
    const bytes = await readProductImageSource(source, request.signal);
    // Cheapest possible exit: the client may already be gone before we spend
    // a single provider second.
    if (request.signal.aborted) return cancelled();
    report = await runProductImagePipeline({
      source: bytes,
      operation,
      productName: parsed.data.productName,
      signal: request.signal,
    });
  } catch (error) {
    // Nothing was uploaded yet, so there is nothing to undo.
    if (request.signal.aborted) return cancelled();
    return failed(error);
  }
  if (report.processed.chromaFallbackReason) {
    logger.set({ imageChromaFallback: report.processed.chromaFallbackReason });
  }

  // Always a NEW object: the original stays untouched so the merchant can
  // always fall back to it.
  const runId = randomUUID();
  const key = `${store.id}/products/${runId}-${operation === "enhance" ? "ai" : "bg"}.webp`;

  // Cancelled while the providers were working: skip the upload entirely so no
  // orphan object is minted for a result nobody will ever see.
  if (request.signal.aborted) return cancelled();

  let url: string;
  try {
    url = await storeProductImage(key, report);
  } catch (error) {
    logger.error(error instanceof Error ? error : new Error("Processed image upload failed"));
    return failed(error);
  }

  // Last and most important checkpoint. The result exists but the client is
  // gone, so it will never be delivered: drop the object and charge nothing.
  if (request.signal.aborted) {
    await discardProductImage(key).catch(() => undefined);
    return cancelled();
  }

  // Billed only once the result is stored, and keyed on the new object so a
  // retried request can never charge twice. If the ledger write fails,
  // withhold the result (delete the object) instead of delivering
  // unaccounted work.
  let debitedMicro = 0;
  try {
    // Billed at the price quoted above; nothing when the run is not billed.
    if (quote.credits) {
      debitedMicro = await debitProductImage({
        storeId: store.id,
        billMicro: quote.priceMicro,
        dedupKey: `${operation === "enhance" ? "imgenh" : "imgbg"}:${runId}`,
        imageKey: key,
        providerCostMicroUsd: providerCostOf(report),
      });
    }
  } catch {
    await discardProductImage(key).catch(() => undefined);
    return NextResponse.json({ code: "server_error" }, { status: 500 });
  }

  await afterProductImageRun({
    storeId: store.id,
    runId,
    operation,
    sourceKey: source.key,
    key,
    debitedMicro,
    report,
  });

  return NextResponse.json({
    key,
    url,
    creditsCharged: microToCredits(debitedMicro),
    framingMode: report.processed.standardized.resolvedFramingMode,
  });
};

export const POST = withEvlog(handlePost);
