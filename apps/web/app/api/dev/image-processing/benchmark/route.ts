import { NextResponse } from "next/server";

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

import { MAX_IMAGE_SIZE } from "@louez/validations";

import { BackgroundRemovalError } from "@/lib/ai/image/background-removal";
import {
  IMAGE_PROCESSING_BENCHMARK_CASES,
  IMAGE_PROCESSING_BENCHMARK_SCOPE_ID,
  IMAGE_PROCESSING_BENCHMARK_VARIANTS,
  type ImageProcessingBenchmarkCase,
  getImageProcessingBenchmarkCase,
  getImageProcessingBenchmarkVariant,
} from "@/lib/ai/image/benchmark-fixtures";
import { isAiImageEnhanceEnabled } from "@/lib/ai/image/credits";
import {
  isImageProcessingDebugEnabled,
  persistImageProcessingDebugRun,
} from "@/lib/ai/image/debug-artifacts";
import {
  type ProductImageMimeType,
  processProductImage,
} from "@/lib/ai/image/process-product-image";
import { ImageProviderError } from "@/lib/ai/image/provider";
import { imageEnhanceCost } from "@/lib/ai/pricing";
import { auth } from "@/lib/auth";
import { useLogger, withEvlog } from "@/lib/evlog";
import { isPlatformAdmin } from "@/lib/platform-admin";

export const maxDuration = 360;

const requestSchema = z.object({
  suiteId: z.uuid(),
  fixtureId: z.string().min(1).max(80),
  variantId: z.string().min(1).max(80),
  suiteSize: z
    .number()
    .int()
    .min(1)
    .max(IMAGE_PROCESSING_BENCHMARK_CASES.length * IMAGE_PROCESSING_BENCHMARK_VARIANTS.length),
});

const supportedMimeTypes = ["image/jpeg", "image/png", "image/webp"] as const;

const isSupportedMimeType = (value: string): value is ProductImageMimeType =>
  supportedMimeTypes.some((mimeType) => mimeType === value);

const readPublicFixture = async (publicPath: string) => {
  // Keep the allowlist explicit. Besides preventing path traversal, this keeps
  // Next.js output tracing scoped to these two files instead of conservatively
  // including the entire project for a dynamic filesystem glob.
  switch (publicPath) {
    case "/images/ai-image-benchmark/partybox-cropped.jpg": {
      try {
        return await readFile(
          join(process.cwd(), "public/images/ai-image-benchmark/partybox-cropped.jpg"),
        );
      } catch (workspaceError) {
        try {
          return await readFile(
            join(process.cwd(), "apps/web/public/images/ai-image-benchmark/partybox-cropped.jpg"),
          );
        } catch {
          throw workspaceError;
        }
      }
    }
    case "/images/ai-image-benchmark/partybox-detail.webp": {
      try {
        return await readFile(
          join(process.cwd(), "public/images/ai-image-benchmark/partybox-detail.webp"),
        );
      } catch (workspaceError) {
        try {
          return await readFile(
            join(process.cwd(), "apps/web/public/images/ai-image-benchmark/partybox-detail.webp"),
          );
        } catch {
          throw workspaceError;
        }
      }
    }
    default:
      throw new Error("invalid local benchmark fixture path");
  }
};

const loadBenchmarkFixture = async (
  fixture: ImageProcessingBenchmarkCase,
  signal: AbortSignal,
): Promise<{ source: Buffer; sourceKey: string; sourceMimeType: ProductImageMimeType }> => {
  if (fixture.source.kind === "public") {
    const source = await readPublicFixture(fixture.source.path);
    return {
      source,
      sourceKey: fixture.source.path.replace(/^\/+/, ""),
      sourceMimeType: fixture.source.mimeType,
    };
  }

  const response = await fetch(fixture.source.url, {
    headers: { Accept: supportedMimeTypes.join(",") },
    cache: "no-store",
    redirect: "error",
    signal,
  });
  if (!response.ok) throw new Error(`benchmark fixture returned ${response.status}`);

  const contentLength = Number(response.headers.get("content-length") ?? 0);
  const contentType = response.headers.get("content-type")?.split(";")[0] ?? "";
  if (contentLength > MAX_IMAGE_SIZE || !isSupportedMimeType(contentType)) {
    throw new Error("invalid remote benchmark fixture");
  }

  return {
    source: Buffer.from(await response.arrayBuffer()),
    sourceKey: new URL(fixture.source.url).pathname.replace(/^\/+/, ""),
    sourceMimeType: contentType,
  };
};

const handlePost = async (request: Request) => {
  const logger = useLogger();

  if (!isImageProcessingDebugEnabled()) {
    return new NextResponse(null, { status: 404 });
  }

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ code: "unauthorized" }, { status: 401 });
  }
  if (!isPlatformAdmin(session.user.email)) {
    return NextResponse.json({ code: "forbidden" }, { status: 403 });
  }
  if (!isAiImageEnhanceEnabled()) {
    return NextResponse.json({ code: "ai_image_disabled" }, { status: 503 });
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ code: "invalid_request" }, { status: 400 });
  }

  const fixture = getImageProcessingBenchmarkCase(parsed.data.fixtureId);
  if (!fixture) {
    return NextResponse.json({ code: "unknown_fixture" }, { status: 404 });
  }
  const variant = getImageProcessingBenchmarkVariant(parsed.data.variantId);
  if (!variant) {
    return NextResponse.json({ code: "unknown_variant" }, { status: 404 });
  }

  let source: Buffer;
  let sourceKey: string;
  let sourceMimeType: ProductImageMimeType;
  try {
    const loaded = await loadBenchmarkFixture(fixture, request.signal);
    source = loaded.source;
    sourceKey = loaded.sourceKey;
    sourceMimeType = loaded.sourceMimeType;
    if (source.byteLength === 0 || source.byteLength > MAX_IMAGE_SIZE) {
      return NextResponse.json({ code: "invalid_fixture" }, { status: 502 });
    }
  } catch (error) {
    if (request.signal.aborted) {
      return NextResponse.json({ code: "cancelled" }, { status: 499 });
    }
    logger.error(error instanceof Error ? error : new Error("Benchmark fixture read failed"));
    return NextResponse.json({ code: "fixture_unavailable" }, { status: 502 });
  }

  const runId = randomUUID();
  const createdAt = new Date();
  try {
    const processed = await processProductImage({
      source,
      sourceMimeType,
      operation: "enhance",
      productName: fixture.productName,
      imageModel: variant.model,
      nativeTransparency: variant.nativeTransparency,
      signal: request.signal,
    });
    if (processed.chromaFallbackReason) {
      logger.set({ imageChromaFallback: processed.chromaFallbackReason });
    }

    const enhanceCost = imageEnhanceCost(processed.imageUsage);
    await persistImageProcessingDebugRun({
      runId,
      storeId: IMAGE_PROCESSING_BENCHMARK_SCOPE_ID,
      operation: "enhance",
      framingMode: processed.standardized.resolvedFramingMode,
      backgroundRemovalMethod: processed.backgroundRemovalMethod,
      aiModel: processed.imageModel,
      createdAt,
      sourceKey,
      outputKey: `benchmark/${parsed.data.suiteId}/${fixture.id}-${variant.id}-ai.webp`,
      totalDurationMs: processed.totalDurationMs,
      stages: processed.stages,
      benchmark: {
        suiteId: parsed.data.suiteId,
        suiteSize: parsed.data.suiteSize,
        fixtureId: fixture.id,
        fixtureLabel: `${fixture.label} · ${variant.label}`,
      },
      economics: {
        chargedCredits: 0,
        providerCostMicroUsd: enhanceCost.microUsd,
        providerCostSource: enhanceCost.source,
        usage: processed.imageUsage,
      },
    });

    return NextResponse.json({
      runId,
      suiteId: parsed.data.suiteId,
      fixtureId: fixture.id,
      variantId: variant.id,
      framingMode: processed.standardized.resolvedFramingMode,
    });
  } catch (error) {
    if (request.signal.aborted) {
      return NextResponse.json({ code: "cancelled" }, { status: 499 });
    }
    logger.error(error instanceof Error ? error : new Error("Image benchmark failed"));
    if (error instanceof ImageProviderError) {
      return NextResponse.json({ code: "provider_error" }, { status: 502 });
    }
    if (error instanceof BackgroundRemovalError) {
      return NextResponse.json({ code: "background_removal_error" }, { status: 502 });
    }
    if (error instanceof Error && error.message === "empty_image") {
      return NextResponse.json({ code: "empty_image" }, { status: 422 });
    }
    return NextResponse.json({ code: "server_error" }, { status: 500 });
  }
};

export const POST = withEvlog(handlePost);
