import { IMAGE_UPLOAD_MIME_TYPES } from "@louez/validations";
import { z } from "zod";

import { apiError } from "../platform/errors";

/**
 * Image uploads through the API: a procedure hands out where to send the
 * bytes, the caller sends them, a second procedure checks what arrived and
 * returns its public URL. Shared by every domain that takes images.
 */

export const createImageUploadInput = z.object({
  contentType: z
    .enum(IMAGE_UPLOAD_MIME_TYPES)
    .describe("The image's type. Send the bytes with exactly this Content-Type."),
  size: z.number().int().min(1).describe("The file's size in bytes."),
});

export const uploadTargetSchema = z.discriminatedUnion("method", [
  z.object({
    method: z.literal("PUT"),
    url: z.string(),
    /** Send them as they are, the Content-Type included. */
    headers: z.record(z.string(), z.string()),
  }),
  z.object({
    method: z.literal("POST"),
    url: z.string(),
    /** multipart/form-data: these fields first, then the file as `file`. */
    fields: z.record(z.string(), z.string()),
  }),
]);

export const createImageUploadOutput = z.object({
  /** Storage key of the upload; pass it to the matching complete procedure. */
  key: z.string(),
  /** One HTTP request that sends the bytes; no Authorization header needed. */
  upload: uploadTargetSchema,
  maxSize: z.number().int(),
  expiresAt: z.date(),
});

export const completeImageUploadInput = z.object({
  key: z.string().min(1).max(256).describe("The key the create-upload call returned."),
});

/**
 * Largest image sent in the call, base64: the request must carry it (a third
 * more as base64), so it stays under the bodies the transports take. A larger
 * image goes up by URL, or through the upload URL.
 */
export const INLINE_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;

/** Base64 characters of the largest inline image, with a data URL's prefix. */
export const INLINE_UPLOAD_MAX_CHARS = Math.ceil(INLINE_UPLOAD_MAX_BYTES / 3) * 4 + 64;

/**
 * An image in the call: its bytes as base64, or a public URL Louez downloads.
 * Exactly one of `contentBase64` and `imageUrl`.
 */
export const uploadImageInput = z.object({
  contentBase64: z
    .string()
    .min(1)
    .max(INLINE_UPLOAD_MAX_CHARS)
    .optional()
    .describe(
      "The file's bytes, base64 (or a data:image/…;base64, URL), 5 MB at most once decoded. Use it when you cannot reach an upload URL, e.g. for an image you made in your own workspace.",
    ),
  contentType: z
    .enum(IMAGE_UPLOAD_MIME_TYPES)
    .optional()
    .describe("The type of the bytes in contentBase64, when you know it; the bytes must match it."),
  imageUrl: z
    .string()
    .url()
    .max(2048)
    .optional()
    .describe(
      "A public HTTPS URL of the image instead of its bytes. Louez downloads it; private or local addresses are refused.",
    ),
});

export const completeImageUploadOutput = z.object({
  key: z.string(),
  /** Public URL of the image, to set as an image URL. */
  url: z.string(),
  contentType: z.string(),
  size: z.number().int(),
});

export const uploadErrors = {
  kindNotAllowed: (kind: string) =>
    apiError("BAD_REQUEST", "UPLOAD_KIND_NOT_ALLOWED", {
      message: `Images of kind "${kind}" cannot be uploaded through the API.`,
      i18nKey: "errors.invalidData",
      details: { kind },
    }),
  typeNotAllowed: (contentType: string) =>
    apiError("BAD_REQUEST", "UPLOAD_TYPE_NOT_ALLOWED", {
      message: `Images must be one of ${IMAGE_UPLOAD_MIME_TYPES.join(", ")}; got ${contentType}.`,
      i18nKey: "errors.invalidData",
      details: { contentType, allowed: [...IMAGE_UPLOAD_MIME_TYPES] },
    }),
  tooLarge: (size: number | null, maxSize: number) =>
    apiError("BAD_REQUEST", "UPLOAD_TOO_LARGE", {
      message: `The image is ${size === null ? "too large" : `${size} bytes`}; at most ${maxSize} bytes are allowed.`,
      i18nKey: "errors.invalidData",
      details: { size, maxSize },
    }),
  notOwned: () =>
    apiError("FORBIDDEN", "UPLOAD_NOT_OWNED", {
      message: "This key is not an upload of this store for this kind of image.",
      i18nKey: "errors.invalidData",
    }),
  notFound: (key: string) =>
    apiError("NOT_FOUND", "UPLOAD_NOT_FOUND", {
      message:
        "Nothing was uploaded at this key. Send the file as the create-upload call said, then complete it.",
      i18nKey: "errors.invalidData",
      details: { key },
    }),
  contentInvalid: (declared: string, found: string | null) =>
    apiError("BAD_REQUEST", "UPLOAD_CONTENT_INVALID", {
      message: `The uploaded bytes are not a ${declared} image. Nothing was kept; upload the file again.`,
      i18nKey: "errors.invalidData",
      details: { declared, found },
    }),
  inlineTooLarge: (size: number, maxSize: number) =>
    apiError("BAD_REQUEST", "UPLOAD_TOO_LARGE", {
      message: `The image is ${size} bytes; at most ${maxSize} bytes can be sent in the call. Send a public imageUrl instead, or use the create-upload tool.`,
      i18nKey: "errors.invalidData",
      details: { size, maxSize },
    }),
  base64Invalid: () =>
    apiError("BAD_REQUEST", "UPLOAD_BASE64_INVALID", {
      message: "contentBase64 is not base64. Send the file's bytes base64-encoded, nothing else.",
      i18nKey: "errors.invalidData",
    }),
  sourceInvalid: () =>
    apiError("BAD_REQUEST", "UPLOAD_SOURCE_INVALID", {
      message: "Send exactly one of contentBase64 (the file's bytes) and imageUrl.",
      i18nKey: "errors.invalidData",
    }),
  urlUnreachable: (reason: string, status: number | null) =>
    apiError("BAD_REQUEST", "UPLOAD_URL_UNREACHABLE", {
      message:
        "Louez could not download an image at this URL. It must be a public HTTPS address that answers 200 with the image within 10 seconds; private and local addresses, plain HTTP and more than 3 redirects are refused. If the image is only in your workspace, send its bytes as contentBase64.",
      i18nKey: "errors.invalidData",
      retryable: reason === "timeout",
      details: { reason, status },
    }),
  importBusy: () =>
    apiError("TOO_MANY_REQUESTS", "UPLOAD_IMPORT_BUSY", {
      message: "Too many images are being downloaded right now. Try again in a few seconds.",
      i18nKey: "errors.invalidData",
      retryable: true,
    }),
  tokenInvalid: () =>
    apiError("UNAUTHORIZED", "UPLOAD_TOKEN_INVALID", {
      message: "This upload URL is invalid or expired. Ask for a new one.",
    }),
  typeMismatch: (expected: string, received: string | null) =>
    apiError("BAD_REQUEST", "UPLOAD_TYPE_MISMATCH", {
      message: `Send the bytes with Content-Type ${expected}, as the upload was created.`,
      details: { expected, received },
    }),
} as const;
