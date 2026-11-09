import "server-only";

import {
  ProductImageFailure,
  type ProductImageOperation,
  type ProductImageQuote,
  type ProductImageSource,
} from "@louez/api/platform/ports";
import type { Transaction } from "@louez/db";
import { MAX_IMAGE_SIZE, getStorageRelativePath, isOwnedImageUrl } from "@louez/validations";

import { maybeTriggerAutoTopup } from "@/lib/ai/advisor/auto-topup";
import { getAiCreditsInfo, microToCredits } from "@/lib/ai/advisor/credits";
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
  type ProcessProductImageResult,
  type ProductImageMimeType,
  processProductImage,
} from "@/lib/ai/image/process-product-image";
import { parseTrustedDemoProductImageUrl } from "@/lib/ai/image/product-image-source";
import { ImageProviderError } from "@/lib/ai/image/provider";
import {
  getImageBgRemovalCredits,
  imageBgRemovalBillMicro,
  imageEnhanceBillMicro,
  imageEnhanceCost,
  type ImageEnhanceCost,
} from "@/lib/ai/pricing";
import { log } from "@/lib/evlog";
import { getStorePlan } from "@/lib/plan-limits";
import { areAiCreditsEnabled } from "@/lib/plans";
import { getImageFiles } from "@/lib/storage/files";

/**
 * One AI photo run, step by step: where the source is, what it costs, the
 * pipeline, the stored result, the debit and what follows it. The
 * dashboard's enhance route and the API's image jobs (the `productImages`
 * port, lib/api/product-images.ts) both run these, so a result, its price
 * and its debit are the same whoever asked.
 */

// Same shape the upload pipeline enforces on keys (lib/storage/files.ts),
// minus GIF: an animated source has no meaningful "product on transparency".
const KEY_PATTERN = /^[a-zA-Z0-9/_-]+\.(?:jpe?g|png|webp)$/;

const MIME_BY_EXTENSION: Record<string, ProductImageMimeType> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

function isSupportedImageMimeType(value: string): value is ProductImageMimeType {
  return Object.values(MIME_BY_EXTENSION).some((mimeType) => mimeType === value);
}

/**
 * Where a product image is read from, when the store may process it: a key
 * in the store's product folder (a bare file name gets the folder), or a
 * demo catalog's image on a trusted Louez bucket. Null otherwise. A demo
 * image is accepted only once the caller checked it is on the product.
 */
export function resolveProductImageSource(
  storeId: string,
  input: { key?: string; url?: string },
): ProductImageSource | null {
  const prefix = `${storeId}/products/`;
  if (input.url && !isOwnedImageUrl(input.url, `${storeId}/products`)) {
    const trusted = parseTrustedDemoProductImageUrl(input.url);
    return trusted
      ? { kind: "trusted-demo", key: trusted.pathname.replace(/^\/+/, ""), url: trusted.href }
      : null;
  }
  const raw = input.key ?? (input.url ? getStorageRelativePath(input.url) : null);
  if (!raw) return null;
  const key = raw.includes("/") ? raw : `${prefix}${raw}`;
  if (!key.startsWith(prefix) || !KEY_PATTERN.test(key)) return null;
  return { kind: "stored", key };
}

/** Whether an operation is billed: enhancement always, background removal only with its own tariff. */
const isBilled = (operation: ProductImageOperation) =>
  areAiCreditsEnabled() && (operation === "enhance" || imageBgRemovalBillMicro() > 0);

/** What an operation costs the store now, and whether this instance runs it. */
export async function quoteProductImage(
  storeId: string,
  operation: ProductImageOperation,
): Promise<ProductImageQuote> {
  const available =
    operation === "enhance" ? isAiImageEnhanceEnabled() : isImageBackgroundRemovalEnabled();
  if (!isBilled(operation)) return { available, priceMicro: 0, credits: null };

  const plan = await getStorePlan(storeId);
  const [check, info] = await Promise.all([
    operation === "enhance"
      ? checkImageEnhanceCredits(storeId, plan)
      : checkImageCredits(storeId, plan, getImageBgRemovalCredits()),
    getAiCreditsInfo(storeId, plan).catch(() => null),
  ]);
  return {
    available,
    priceMicro: operation === "enhance" ? imageEnhanceBillMicro() : imageBgRemovalBillMicro(),
    credits: {
      allowed: check.allowed,
      monthlyRemainingMicro: info ? info.monthlyRemainingMicro : 0,
      prepaidMicro: info?.prepaidBalanceMicro ?? 0,
    },
  };
}

/** The source's bytes. Throws `ProductImageFailure` (`IMAGE_SOURCE_UNREADABLE`). */
export async function readProductImageSource(
  source: ProductImageSource,
  signal: AbortSignal,
): Promise<{ bytes: Buffer; mimeType: ProductImageMimeType }> {
  const unreadable = (retryable: boolean) =>
    new ProductImageFailure("IMAGE_SOURCE_UNREADABLE", "The source image could not be read.", retryable);
  let bytes: Buffer;
  let mimeType: ProductImageMimeType;
  try {
    if (source.kind === "stored") {
      // Regular uploads go through the storage adapter.
      const stored = await getImageFiles().download(source.key);
      bytes = Buffer.from(await stored.arrayBuffer());
      const extension = source.key.split(".").pop()?.toLowerCase() ?? "";
      mimeType = MIME_BY_EXTENSION[extension] ?? "image/png";
    } else {
      // Demo catalog images can live in another Louez bucket: their already
      // authorized URL is fetched.
      const response = await fetch(source.url, {
        headers: { Accept: Object.values(MIME_BY_EXTENSION).join(",") },
        cache: "no-store",
        redirect: "error",
        signal,
      });
      if (!response.ok) throw new Error("Demo product image fetch failed");
      const contentLength = Number(response.headers.get("content-length") ?? 0);
      if (contentLength > MAX_IMAGE_SIZE) throw unreadable(false);
      const contentType = response.headers.get("content-type")?.split(";")[0] ?? "";
      if (!isSupportedImageMimeType(contentType)) throw unreadable(false);
      bytes = Buffer.from(await response.arrayBuffer());
      mimeType = contentType;
    }
  } catch (error) {
    if (signal.aborted || error instanceof ProductImageFailure) throw error;
    // A storage or network blip may pass.
    throw unreadable(true);
  }
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_SIZE) throw unreadable(false);
  return { bytes, mimeType };
}

/** What a run keeps for its diagnostics, until its debit committed. */
export interface ProductImageRunReport {
  kind: "product-image-run";
  startedAt: Date;
  durationMs: number;
  processed: ProcessProductImageResult;
  enhanceCost: ImageEnhanceCost | null;
}

export const isProductImageRunReport = (value: unknown): value is ProductImageRunReport =>
  typeof value === "object" &&
  value !== null &&
  "kind" in value &&
  value.kind === "product-image-run";

/**
 * Runs the pipeline. Throws `ProductImageFailure` for an empty result or a
 * provider that failed, and the abort's reason once `signal` aborted.
 */
export async function runProductImagePipeline(input: {
  source: { bytes: Buffer; mimeType: ProductImageMimeType };
  operation: ProductImageOperation;
  productName?: string;
  signal: AbortSignal;
}): Promise<ProductImageRunReport> {
  const startedAt = new Date();
  try {
    const processed = await processProductImage({
      source: input.source.bytes,
      sourceMimeType: input.source.mimeType,
      operation: input.operation,
      productName: input.productName,
      signal: input.signal,
    });
    return {
      kind: "product-image-run",
      startedAt,
      durationMs: Date.now() - startedAt.getTime(),
      processed,
      enhanceCost: input.operation === "enhance" ? imageEnhanceCost(processed.imageUsage) : null,
    };
  } catch (error) {
    // A cancelled run surfaces as an aborted fetch inside the provider
    // wrappers: never a provider outage.
    if (input.signal.aborted) throw error;
    // Provider messages can carry request details: logged, never returned.
    log.error({
      productImage: { event: "processing_failed", operation: input.operation },
      error: {
        name: error instanceof Error ? error.name : "UnknownError",
        message: error instanceof Error ? error.message : String(error),
      },
    });
    if (error instanceof Error && error.message === "empty_image") {
      throw new ProductImageFailure("IMAGE_EMPTY", "The AI returned an empty image.", false);
    }
    if (error instanceof ImageProviderError) {
      throw new ProductImageFailure("PROVIDER_ERROR", "The image provider failed.", true);
    }
    if (error instanceof BackgroundRemovalError) {
      throw new ProductImageFailure(
        "BACKGROUND_REMOVAL_ERROR",
        "The background removal failed.",
        true,
      );
    }
    // Anything else (an unreadable source the decoder chokes on) is ours.
    throw new ProductImageFailure("PROCESSING_ERROR", "The image could not be processed.", false);
  }
}

/** Stores a run's result under `key`, replacing what is there; its URL. */
export async function storeProductImage(key: string, report: ProductImageRunReport) {
  try {
    const files = getImageFiles();
    await files.upload(key, report.processed.standardized.buffer, {
      contentType: report.processed.standardized.contentType,
    });
    return await files.url(key);
  } catch {
    throw new ProductImageFailure("STORAGE_ERROR", "The result could not be stored.", true);
  }
}

export async function discardProductImage(key: string) {
  await getImageFiles().delete(key);
}

/** What a run's provider cost Louez, in micro-USD. */
export const providerCostOf = (report: ProductImageRunReport) => report.enhanceCost?.microUsd ?? 0;

/**
 * Debits one run, once per `dedupKey`: in `executor` when given (a job, in
 * the transaction that writes its result), else on its own. The micro-credits
 * debited; 0 when the operation is not billed. Throws when the debit could
 * not be written.
 */
export async function debitProductImage(
  input: {
    storeId: string;
    operation: ProductImageOperation;
    dedupKey: string;
    imageKey: string;
    providerCostMicroUsd: number;
  },
  executor?: Transaction,
): Promise<number> {
  if (!isBilled(input.operation)) return 0;
  const plan = await getStorePlan(input.storeId, executor);
  return recordImageEnhanceDebit(
    input.storeId,
    {
      dedupKey: input.dedupKey,
      imageKey: input.imageKey,
      plan,
      costMicroUsd: input.providerCostMicroUsd,
      billMicro: input.operation === "enhance" ? undefined : imageBgRemovalBillMicro(),
    },
    executor,
  );
}

/**
 * Once a run's debit committed: recharges the store off-session when its
 * balance dropped below its threshold, and keeps the run's diagnostics when
 * they are on. Never throws: the result is already the store's.
 */
export async function afterProductImageRun(input: {
  storeId: string;
  runId: string;
  operation: ProductImageOperation;
  sourceKey: string;
  key: string;
  debitedMicro: number;
  report: ProductImageRunReport;
}) {
  if (isBilled(input.operation)) {
    await maybeTriggerAutoTopup(input.storeId).catch(() => {});
  }

  const { report } = input;
  const debug = { enabled: isImageProcessingDebugEnabled(), runId: input.runId };
  const providerCost = {
    microUsd: report.enhanceCost?.microUsd ?? null,
    source: report.enhanceCost?.source ?? null,
    usageCaptured: report.processed.imageUsage !== null,
  };
  try {
    const captured = await persistImageProcessingDebugRun({
      runId: input.runId,
      storeId: input.storeId,
      operation: input.operation,
      framingMode:
        input.operation === "enhance" ? report.processed.standardized.resolvedFramingMode : null,
      backgroundRemovalMethod: report.processed.backgroundRemovalMethod,
      aiModel: report.processed.imageModel,
      createdAt: report.startedAt,
      sourceKey: input.sourceKey,
      outputKey: input.key,
      totalDurationMs: report.durationMs,
      stages: report.processed.stages,
      economics: report.enhanceCost
        ? {
            chargedCredits: microToCredits(input.debitedMicro),
            providerCostMicroUsd: report.enhanceCost.microUsd,
            providerCostSource: report.enhanceCost.source,
            usage: report.processed.imageUsage,
          }
        : undefined,
    });
    // The standalone Next.js runtime does not run evlog's deferred drain:
    // emitted now, so container stdout proves whether the artifacts were saved.
    log.info({ imageDebug: { ...debug, captured }, imageProviderCost: providerCost });
  } catch (error) {
    // Diagnostics must never withhold a valid customer-facing result.
    log.error({
      imageDebug: { ...debug, captured: false },
      error: {
        message: error instanceof Error ? error.message : String(error),
        name: error instanceof Error ? error.name : "UnknownError",
      },
    });
  }
}
