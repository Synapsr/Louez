import { removeImageBackground } from "@/lib/ai/image/background-removal";
import {
  ChromaBackgroundError,
  removeChromaBackground,
  selectChromaKeyColor,
} from "@/lib/ai/image/chroma-background";
import type { ImageProcessingDebugStageInput } from "@/lib/ai/image/debug-artifacts";
import { type StandardizedProductImage, standardizeProductImage } from "@/lib/ai/image/postprocess";
import { enhanceProductImage } from "@/lib/ai/image/provider";
import type { ImageTokenUsage } from "@/lib/ai/pricing";

export const PRODUCT_IMAGE_OPERATIONS = ["enhance", "remove-background"] as const;

export type ProductImageOperation = (typeof PRODUCT_IMAGE_OPERATIONS)[number];
export type ProductImageMimeType = "image/jpeg" | "image/png" | "image/webp";
export type BackgroundRemovalMethod =
  | "chroma-key"
  | "semantic-fallback"
  | "semantic"
  | "native-transparent";

export interface ProcessProductImageResult {
  standardized: StandardizedProductImage;
  stages: ImageProcessingDebugStageInput[];
  imageUsage: ImageTokenUsage | null;
  /** GPT Image model that ran, null when no AI step ran. */
  imageModel: string | null;
  backgroundRemovalMethod: BackgroundRemovalMethod;
  chromaFallbackReason: string | null;
  totalDurationMs: number;
}

/**
 * Canonical product-image pipeline. Customer actions and the dev benchmark
 * both call this function so a green benchmark cannot exercise a stale copy.
 */
export const processProductImage = async (input: {
  source: Buffer;
  sourceMimeType: ProductImageMimeType;
  operation: ProductImageOperation;
  /** Name the merchant gave the item; tells the AI which object to keep. */
  productName?: string;
  /** Dev benchmark only: run another GPT Image model than the configured one. */
  imageModel?: string;
  /**
   * Dev benchmark only: let GPT Image 2.6 render the transparent background
   * itself instead of a chroma key that our own step removes.
   */
  nativeTransparency?: boolean;
  signal?: AbortSignal;
}): Promise<ProcessProductImageResult> => {
  const processingStartedAt = Date.now();
  const stages: ImageProcessingDebugStageInput[] = [
    {
      id: "original",
      label: "Original",
      buffer: input.source,
      contentType: input.sourceMimeType,
    },
  ];
  let imageUsage: ImageTokenUsage | null = null;
  let imageModel: string | null = null;
  let backgroundRemovalMethod: BackgroundRemovalMethod = "semantic";
  let chromaFallbackReason: string | null = null;
  let isolated: Buffer;
  let backgroundRemovalStartedAt: number;

  if (input.operation === "enhance" && input.nativeTransparency) {
    const aiStartedAt = Date.now();
    const enhanced = await enhanceProductImage({
      buffer: input.source,
      mimeType: input.sourceMimeType,
      backdrop: { kind: "transparent" },
      productName: input.productName,
      model: input.imageModel,
      signal: input.signal,
    });
    imageUsage = enhanced.usage;
    imageModel = enhanced.model;
    stages.push({
      id: "ai-enhanced",
      label: "Après GPT Image (fond transparent natif)",
      buffer: enhanced.buffer,
      contentType: "image/png",
      durationMs: Date.now() - aiStartedAt,
    });
    backgroundRemovalStartedAt = Date.now();
    isolated = enhanced.buffer;
    backgroundRemovalMethod = "native-transparent";
  } else if (input.operation === "enhance") {
    const chromaColor = await selectChromaKeyColor(input.source);
    const aiStartedAt = Date.now();
    const enhanced = await enhanceProductImage({
      buffer: input.source,
      mimeType: input.sourceMimeType,
      backdrop: { kind: "chroma-key", color: chromaColor },
      productName: input.productName,
      model: input.imageModel,
      signal: input.signal,
    });
    imageUsage = enhanced.usage;
    imageModel = enhanced.model;
    stages.push({
      id: "ai-enhanced",
      label: "Après GPT Image",
      buffer: enhanced.buffer,
      contentType: "image/png",
      durationMs: Date.now() - aiStartedAt,
    });

    backgroundRemovalStartedAt = Date.now();
    try {
      isolated = await removeChromaBackground(enhanced.buffer, chromaColor);
      backgroundRemovalMethod = "chroma-key";
    } catch (error) {
      backgroundRemovalMethod = "semantic-fallback";
      chromaFallbackReason =
        error instanceof ChromaBackgroundError ? error.code : "processing_failed";
      isolated = await removeImageBackground({
        buffer: enhanced.buffer,
        mimeType: "image/png",
        signal: input.signal,
      });
    }
  } else {
    backgroundRemovalStartedAt = Date.now();
    isolated = await removeImageBackground({
      buffer: input.source,
      mimeType: input.sourceMimeType,
      signal: input.signal,
    });
  }

  stages.push({
    id: "background-removed",
    label: "Après suppression du fond",
    buffer: isolated,
    contentType: "image/png",
    durationMs: Date.now() - backgroundRemovalStartedAt,
  });

  const standardizationStartedAt = Date.now();
  const standardized = await standardizeProductImage(isolated, {
    framingStrategy: input.operation === "enhance" ? "auto" : "recenter",
  });
  stages.push({
    id: "standardized",
    label: "Résultat standardisé",
    buffer: standardized.buffer,
    contentType: standardized.contentType,
    durationMs: Date.now() - standardizationStartedAt,
  });

  return {
    standardized,
    stages,
    imageUsage,
    imageModel,
    backgroundRemovalMethod,
    chromaFallbackReason,
    totalDurationMs: Date.now() - processingStartedAt,
  };
};
