import { z } from "zod";
import { env } from "./env";

// ===== IMAGE VALIDATION =====
// Validates image URLs and data URIs to prevent malicious uploads

/**
 * Maximum image size in bytes (15MB)
 */
export const MAX_IMAGE_SIZE = 15 * 1024 * 1024;

/**
 * Maximum logo size in bytes (2MB - logos should be smaller)
 */
export const MAX_LOGO_SIZE = 2 * 1024 * 1024;

/**
 * Maximum hero image size in bytes (5MB)
 */
export const MAX_HERO_SIZE = 5 * 1024 * 1024;

/**
 * Client-safe image URL validation for use in browser-side Zod schemas.
 * Does NOT depend on server-only env variables (S3_PUBLIC_URL).
 *
 * Accepts:
 * - Empty string (optional field)
 * - Any valid HTTP(S) URL (the upload API already ensures S3 URLs)
 *
 * Rejects:
 * - Data URIs (base64) — images must be uploaded to S3
 * - Invalid URLs
 *
 * NOTE: This is a UX-level check. The server action re-validates with
 * isValidImageUrl() which enforces the strict S3 origin check.
 */
export function isValidImageUrlClient(url: string): boolean {
  if (!url || url === "") return true;

  // SECURITY: Reject data URIs — must be uploaded to S3
  if (url.startsWith("data:")) return false;

  // Same-origin path (standalone deployments serve assets under /files).
  // "//host/..." is protocol-relative, i.e. an external URL — not a path.
  if (url.startsWith("/") && !url.startsWith("//")) return true;

  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Validates that a URL is a secure image URL stored in S3
 * SECURITY: Base64 data URIs are NOT allowed - images must be uploaded to S3
 * Accepts:
 * - URLs from our S3 bucket (S3_PUBLIC_URL)
 * - Empty string (optional field)
 */
export function isValidImageUrl(url: string): boolean {
  // Empty is valid (optional)
  if (!url || url === "") return true;

  // SECURITY: Reject data URIs (base64) - must be uploaded to S3
  if (url.startsWith("data:")) {
    return false;
  }

  const storagePath = getStorageRelativePath(url);
  if (storagePath !== null) {
    return /\.(jpg|jpeg|png|gif|webp)$/i.test(storagePath);
  }

  // For development, also allow localhost URLs
  if (env.NODE_ENV === "development") {
    try {
      const parsed = new URL(url);
      if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
        return true;
      }
    } catch {
      // Invalid URL
    }
  }

  // Reject all other URLs
  return false;
}

function getStorageRelativePath(url: string): string | null {
  const publicBase = env.S3_PUBLIC_URL ?? "";

  // Path-based public base ("/files"): stored URLs are same-origin paths.
  if (publicBase.startsWith("/")) {
    if (!url.startsWith("/") || url.startsWith("//")) return null;

    const pathPrefix = `${publicBase.replace(/\/+$/, "")}/`;
    if (!url.startsWith(pathPrefix)) return null;

    return url.slice(pathPrefix.length);
  }

  try {
    const publicUrl = new URL(publicBase);
    const parsed = new URL(url);
    if (parsed.origin !== publicUrl.origin) return null;

    const publicPath = publicUrl.pathname.replace(/\/+$/, "");
    const pathPrefix = publicPath ? `${publicPath}/` : "/";
    if (!parsed.pathname.startsWith(pathPrefix)) return null;

    return parsed.pathname.slice(pathPrefix.length);
  } catch {
    return null;
  }
}

export function isOwnedImageUrl(url: string, ownerPrefix: string): boolean {
  const storagePath = getStorageRelativePath(url);
  if (storagePath === null) return false;

  const normalizedPrefix = ownerPrefix.replace(/^\/+|\/+$/g, "");
  return storagePath.startsWith(`${normalizedPrefix}/`) && isValidImageUrl(url);
}

/**
 * Validates and sanitizes an image URL
 * Returns the URL if valid, empty string otherwise
 */
export function sanitizeImageUrl(url: string | undefined | null): string {
  if (!url) return "";
  if (isValidImageUrl(url)) return url;
  return "";
}

// ===== ZOD SCHEMAS =====

/**
 * Zod schema for validating image URLs (logo, product images)
 * SECURITY: Only accepts S3 URLs - base64 data URIs are rejected
 * Accepts empty string or S3 URLs only
 */
export const imageUrlSchema = z
  .string()
  .refine(
    (val) => {
      if (!val || val === "") return true;
      return isValidImageUrl(val);
    },
    {
      message: "Invalid image URL. Base64 images are not allowed. Please upload to S3.",
    },
  )
  .transform((val) => sanitizeImageUrl(val));

/**
 * Zod schema for validating an array of image URLs
 */
export const imageUrlArraySchema = z
  .array(z.string())
  .transform((urls) => urls.filter((url) => isValidImageUrl(url)))
  .refine((urls) => urls.length <= 10, {
    message: "Maximum 10 images allowed",
  });

/**
 * Validates image data before storage
 * SECURITY: Only S3 URLs are allowed for storage - base64 data URIs are rejected
 * Use this on the server side before saving to DB
 */
export function validateImageForStorage(url: string): {
  valid: boolean;
  error?: string;
  sanitized: string;
} {
  if (!url || url === "") {
    return { valid: true, sanitized: "" };
  }

  // SECURITY: Reject data URIs (base64) - must be uploaded to S3
  if (url.startsWith("data:")) {
    return {
      valid: false,
      error: "Base64 images are not allowed. Please upload images to S3.",
      sanitized: "",
    };
  }

  // S3 URL validation
  if (isValidImageUrl(url)) {
    return { valid: true, sanitized: url };
  }

  return {
    valid: false,
    error: "Invalid image URL. Images must be uploaded through our system.",
    sanitized: "",
  };
}
