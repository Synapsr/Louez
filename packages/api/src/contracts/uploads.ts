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
