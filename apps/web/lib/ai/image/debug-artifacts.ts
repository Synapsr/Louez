import "server-only";

import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { Readable } from "node:stream";
import { z } from "zod";

import { env } from "@/env";
import { PRODUCT_IMAGE_FRAMING_MODES, type ProductImageFramingMode } from "@/lib/ai/image/framing";
import type { BackgroundRemovalMethod } from "@/lib/ai/image/process-product-image";
import {
  getImageEnhanceCredits,
  type ImageEnhanceCostSource,
  type ImageTokenUsage,
  USD_MICRO,
} from "@/lib/ai/pricing";
import { getAiCreditPackages } from "@/lib/plans";
import { getStorageClient } from "@/lib/storage/files";

const DEBUG_ROOT = "dev/image-processing";
const MANIFEST_FILENAME = "manifest.json";
const MANIFEST_VERSION = 5;
const DEFAULT_LIST_LIMIT = 25;
const MAX_LIST_LIMIT = 100;

const stageIdSchema = z.enum(["original", "ai-enhanced", "background-removed", "standardized"]);

export type ImageProcessingDebugStageId = z.infer<typeof stageIdSchema>;

const operationSchema = z.enum(["enhance", "remove-background"]);

const usageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  inputImageTokens: z.number().int().nonnegative(),
  inputTextTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
});

const moneyRangeSchema = z.object({
  min: z.number().nonnegative(),
  max: z.number().nonnegative(),
});

const signedRangeSchema = z.object({
  min: z.number(),
  max: z.number(),
});

const economicsSchema = z.object({
  tariffCredits: z.number().nonnegative(),
  chargedCredits: z.number().nonnegative(),
  providerCostSource: z.enum(["measured_usage", "configured_flat", "unavailable"]),
  providerCostUsd: z.number().nonnegative().nullable(),
  providerCostEur: z.number().nonnegative().nullable(),
  usdToEurRate: z.number().positive().nullable(),
  creditUnitPriceEur: moneyRangeSchema.nullable(),
  modeledRevenueEur: moneyRangeSchema.nullable(),
  grossMarginEur: signedRangeSchema.nullable(),
  grossMarginPercent: signedRangeSchema.nullable(),
  usage: usageSchema.nullable(),
});

const manifestSchema = z.object({
  version: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(MANIFEST_VERSION),
  ]),
  runId: z.uuid(),
  storeId: z.string().min(1),
  operation: operationSchema,
  createdAt: z.iso.datetime(),
  sourceKey: z.string().min(1),
  outputKey: z.string().min(1),
  totalDurationMs: z.number().int().nonnegative(),
  configuration: z.object({
    aiModel: z.string().nullable(),
    aiQuality: z.string().nullable(),
    framingMode: z.enum(PRODUCT_IMAGE_FRAMING_MODES).nullable().optional(),
    backgroundRemovalMethod: z
      .enum(["chroma-key", "semantic-fallback", "semantic", "native-transparent"])
      .optional(),
    backgroundRemovalModel: z.string(),
  }),
  benchmark: z
    .object({
      suiteId: z.uuid(),
      suiteSize: z.number().int().positive().optional(),
      fixtureId: z.string().min(1).max(80),
      fixtureLabel: z.string().min(1).max(160),
    })
    .nullable()
    .optional(),
  economics: economicsSchema.nullable().optional(),
  stages: z.array(
    z.object({
      id: stageIdSchema,
      label: z.string().min(1),
      key: z.string().min(1),
      contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
      byteSize: z.number().int().positive(),
      durationMs: z.number().int().nonnegative().nullable(),
    }),
  ),
});

export type ImageProcessingDebugRun = z.infer<typeof manifestSchema>;

export interface ImageProcessingDebugStageInput {
  id: ImageProcessingDebugStageId;
  label: string;
  buffer: Buffer;
  contentType: "image/jpeg" | "image/png" | "image/webp";
  durationMs?: number;
}

interface PersistImageProcessingDebugRunInput {
  runId: string;
  storeId: string;
  operation: z.infer<typeof operationSchema>;
  framingMode: ProductImageFramingMode | null;
  backgroundRemovalMethod: BackgroundRemovalMethod;
  /** GPT Image model that ran, null for a plain background removal. */
  aiModel: string | null;
  createdAt: Date;
  sourceKey: string;
  outputKey: string;
  totalDurationMs: number;
  stages: ImageProcessingDebugStageInput[];
  benchmark?: {
    suiteId: string;
    suiteSize?: number;
    fixtureId: string;
    fixtureLabel: string;
  };
  economics?: {
    chargedCredits: number;
    providerCostMicroUsd: number;
    providerCostSource: ImageEnhanceCostSource;
    usage: ImageTokenUsage | null;
  };
}

const extensionByContentType = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

export function isImageProcessingDebugEnabled(): boolean {
  return env.NODE_ENV === "development" || env.AI_IMAGE_DEBUG_ENABLED === "true";
}

function getRunPrefix(storeId: string, runId: string): string {
  return `${storeId}/${DEBUG_ROOT}/${runId}/`;
}

function getManifestKey(storeId: string, runId: string): string {
  return `${getRunPrefix(storeId, runId)}${MANIFEST_FILENAME}`;
}

function isRunId(value: string): boolean {
  return z.uuid().safeParse(value).success;
}

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function createEconomicsSnapshot(
  input: NonNullable<PersistImageProcessingDebugRunInput["economics"]>,
): z.infer<typeof economicsSchema> {
  const tariffCredits = getImageEnhanceCredits();
  const packages = getAiCreditPackages();
  const unitPrices = packages.map(({ credits, priceCents }) => priceCents / 100 / credits);
  const creditUnitPriceEur =
    unitPrices.length > 0
      ? {
          min: round(Math.min(...unitPrices)),
          max: round(Math.max(...unitPrices)),
        }
      : null;
  const modeledRevenueEur = creditUnitPriceEur
    ? {
        min: round(creditUnitPriceEur.min * tariffCredits),
        max: round(creditUnitPriceEur.max * tariffCredits),
      }
    : null;

  const providerCostUsd =
    input.providerCostSource === "unavailable"
      ? null
      : round(input.providerCostMicroUsd / USD_MICRO);
  // Runtime env values can still be raw strings when an operator explicitly
  // disables validation. Normalize again at this persisted-data boundary so a
  // valid Docker value such as "0.92" cannot invalidate the whole manifest.
  const rawUsdToEurRate = Number(env.AI_IMAGE_USD_TO_EUR_RATE);
  const usdToEurRate =
    Number.isFinite(rawUsdToEurRate) && rawUsdToEurRate > 0 ? rawUsdToEurRate : null;
  const providerCostEur =
    providerCostUsd !== null && usdToEurRate !== null
      ? round(providerCostUsd * usdToEurRate)
      : null;
  const grossMarginEur =
    modeledRevenueEur && providerCostEur !== null
      ? {
          min: round(modeledRevenueEur.min - providerCostEur),
          max: round(modeledRevenueEur.max - providerCostEur),
        }
      : null;
  const grossMarginPercent =
    grossMarginEur && modeledRevenueEur && modeledRevenueEur.min > 0
      ? {
          min: round((grossMarginEur.min / modeledRevenueEur.min) * 100, 2),
          max: round((grossMarginEur.max / modeledRevenueEur.max) * 100, 2),
        }
      : null;

  return {
    tariffCredits,
    chargedCredits: Math.max(0, input.chargedCredits),
    providerCostSource: input.providerCostSource,
    providerCostUsd,
    providerCostEur,
    usdToEurRate,
    creditUnitPriceEur,
    modeledRevenueEur,
    grossMarginEur,
    grossMarginPercent,
    usage: input.usage,
  };
}

async function readManifest(
  storeId: string,
  runId: string,
): Promise<ImageProcessingDebugRun | null> {
  if (!isRunId(runId)) return null;

  try {
    const object = await getStorageClient().send(
      new GetObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: getManifestKey(storeId, runId),
      }),
    );
    const body = await object.Body?.transformToString();
    if (!body) return null;

    const parsed = manifestSchema.safeParse(JSON.parse(body));
    if (!parsed.success || parsed.data.storeId !== storeId || parsed.data.runId !== runId) {
      return null;
    }

    return parsed.data;
  } catch {
    return null;
  }
}

/**
 * Store one successful processing run as private S3 objects.
 *
 * This intentionally bypasses the public-image files adapter: product assets
 * receive a public-read ACL, while diagnostic originals and intermediate
 * outputs must only be served through the authenticated dev API.
 */
export async function persistImageProcessingDebugRun(
  input: PersistImageProcessingDebugRunInput,
): Promise<boolean> {
  if (!isImageProcessingDebugEnabled()) return false;
  if (!isRunId(input.runId)) throw new Error("invalid image processing debug run id");

  const client = getStorageClient();
  const prefix = getRunPrefix(input.storeId, input.runId);
  const stages = input.stages.map((stage) => ({
    ...stage,
    key: `${prefix}${stage.id}.${extensionByContentType[stage.contentType]}`,
  }));
  const uploadedKeys = stages.map((stage) => stage.key);

  try {
    await Promise.all(
      stages.map((stage) =>
        client.send(
          new PutObjectCommand({
            Bucket: env.S3_BUCKET,
            Key: stage.key,
            Body: stage.buffer,
            ContentType: stage.contentType,
            CacheControl: "private, no-store",
          }),
        ),
      ),
    );

    const manifest = manifestSchema.parse({
      version: MANIFEST_VERSION,
      runId: input.runId,
      storeId: input.storeId,
      operation: input.operation,
      createdAt: input.createdAt.toISOString(),
      sourceKey: input.sourceKey,
      outputKey: input.outputKey,
      totalDurationMs: Math.max(0, Math.round(input.totalDurationMs)),
      configuration: {
        aiModel: input.aiModel,
        aiQuality: input.operation === "enhance" ? (env.AI_IMAGE_QUALITY ?? "medium") : null,
        framingMode: input.operation === "enhance" ? input.framingMode : null,
        backgroundRemovalMethod: input.backgroundRemovalMethod,
        backgroundRemovalModel: "worker-managed",
      },
      benchmark: input.benchmark ?? null,
      economics:
        input.operation === "enhance" && input.economics
          ? createEconomicsSnapshot(input.economics)
          : null,
      stages: stages.map((stage) => ({
        id: stage.id,
        label: stage.label,
        key: stage.key,
        contentType: stage.contentType,
        byteSize: stage.buffer.byteLength,
        durationMs:
          stage.durationMs === undefined ? null : Math.max(0, Math.round(stage.durationMs)),
      })),
    });

    await client.send(
      new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: getManifestKey(input.storeId, input.runId),
        Body: JSON.stringify(manifest),
        ContentType: "application/json",
        CacheControl: "private, no-store",
      }),
    );
    return true;
  } catch (error) {
    if (uploadedKeys.length > 0) {
      await client
        .send(
          new DeleteObjectsCommand({
            Bucket: env.S3_BUCKET,
            Delete: {
              Objects: uploadedKeys.map((key) => ({ Key: key })),
              Quiet: true,
            },
          }),
        )
        .catch(() => undefined);
    }
    throw error;
  }
}

export async function listImageProcessingDebugRuns(
  storeId: string,
  limit = DEFAULT_LIST_LIMIT,
): Promise<ImageProcessingDebugRun[]> {
  if (!isImageProcessingDebugEnabled()) return [];

  const client = getStorageClient();
  const prefix = `${storeId}/${DEBUG_ROOT}/`;
  const manifestCandidates: { runId: string; lastModified: number }[] = [];
  let continuationToken: string | undefined;

  do {
    const result = await client.send(
      new ListObjectsV2Command({
        Bucket: env.S3_BUCKET,
        Prefix: prefix,
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      }),
    );

    for (const object of result.Contents ?? []) {
      if (!object.Key?.endsWith(`/${MANIFEST_FILENAME}`)) continue;

      const runId = object.Key.slice(prefix.length, -`/${MANIFEST_FILENAME}`.length);
      if (!isRunId(runId)) continue;

      manifestCandidates.push({
        runId,
        lastModified: object.LastModified?.getTime() ?? 0,
      });
    }

    continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
  } while (continuationToken);

  const boundedLimit = Math.min(Math.max(Math.floor(limit), 1), MAX_LIST_LIMIT);
  const manifests = await Promise.all(
    manifestCandidates
      .sort((left, right) => right.lastModified - left.lastModified)
      .slice(0, boundedLimit)
      .map(({ runId }) => readManifest(storeId, runId)),
  );

  return manifests.filter((manifest): manifest is ImageProcessingDebugRun => manifest !== null);
}

export async function getImageProcessingDebugStage(
  storeId: string,
  runId: string,
  stageId: string,
): Promise<{ body: Readable; contentType: string; byteSize: number } | null> {
  const parsedStageId = stageIdSchema.safeParse(stageId);
  if (!parsedStageId.success) return null;

  const manifest = await readManifest(storeId, runId);
  const stage = manifest?.stages.find((candidate) => candidate.id === parsedStageId.data);
  if (!stage || !stage.key.startsWith(getRunPrefix(storeId, runId))) return null;

  try {
    const object = await getStorageClient().send(
      new GetObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: stage.key,
      }),
    );
    if (!(object.Body instanceof Readable)) return null;

    return {
      body: object.Body,
      contentType: stage.contentType,
      byteSize: stage.byteSize,
    };
  } catch {
    return null;
  }
}
