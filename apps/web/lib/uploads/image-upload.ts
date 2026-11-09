import {
  IMAGE_UPLOAD_CONFIG,
  IMAGE_UPLOAD_KINDS,
  IMAGE_UPLOAD_MIME_TYPES,
  type ImageUploadKind,
} from "@louez/validations";

// Shared with the API's upload procedures (packages/api services/uploads.ts).
export { IMAGE_UPLOAD_CONFIG, IMAGE_UPLOAD_KINDS, IMAGE_UPLOAD_MIME_TYPES, type ImageUploadKind };

export type ImageUploadIssue = "invalidType" | "tooLarge";
export type ProductImageProcessingKind = "ai-enhanced" | "background-removed";
export type ProductImageProcessingOperation = "enhance" | "remove-background";

interface ImageFileLike {
  size: number;
  type: string;
}

export const getImageUploadIssue = (
  file: ImageFileLike,
  kind: ImageUploadKind,
): ImageUploadIssue | null => {
  if (!IMAGE_UPLOAD_MIME_TYPES.some((type) => type === file.type)) {
    return "invalidType";
  }

  if (file.size > IMAGE_UPLOAD_CONFIG[kind].maxSize) {
    return "tooLarge";
  }

  return null;
};

export const getImageKeyFromUrl = (url: string | null | undefined) => {
  if (!url) return null;
  if (!url.includes("://") && !url.startsWith("/")) return null;

  try {
    // The base makes site-relative asset URLs ("/files/…", standalone
    // deployments) parse like the absolute bucket URLs of platform mode.
    const pathname = new URL(url, "https://placeholder.invalid").pathname;
    const filename = pathname.split("/").filter(Boolean).at(-1);
    return filename ? decodeURIComponent(filename) : null;
  } catch {
    return null;
  }
};

export const getProductImageProcessingKind = (
  url: string | null | undefined,
): ProductImageProcessingKind | null => {
  const key = getImageKeyFromUrl(url)?.toLowerCase();
  if (key?.endsWith("-ai.webp")) return "ai-enhanced";
  if (key?.endsWith("-bg.webp")) return "background-removed";
  return null;
};

export const canApplyProductImageOperation = (
  url: string | null | undefined,
  operation: ProductImageProcessingOperation,
): boolean => {
  const processingKind = getProductImageProcessingKind(url);
  if (!processingKind) return true;

  // A background-only result may still deliberately be upgraded with GPT
  // Image. Every other repeat would only redo work already present.
  return operation === "enhance" && processingKind === "background-removed";
};
