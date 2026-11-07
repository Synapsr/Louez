import { createHmac, timingSafeEqual } from "node:crypto";

import { env as authEnv } from "@louez/auth/env";
import {
  IMAGE_UPLOAD_CONFIG,
  IMAGE_UPLOAD_MIME_TYPES,
  type ImageUploadKind,
  type ImageUploadMimeType,
} from "@louez/validations";
import { nanoid } from "nanoid";

import { uploadErrors } from "../contracts/uploads";
import type { StoragePort, UploadTarget } from "../platform/ports";

/**
 * Image uploads through the API, for any store-owned kind of image.
 *
 * 1. `createImageUpload` mints a key in the store's folder for the kind and
 *    says where to send the bytes: a presigned upload straight to the bucket
 *    when the storage allows it, else the app's upload endpoint
 *    (`/api/v1/uploads/<token>`, platform/uploads.ts) with a signed token.
 * 2. The caller sends the bytes there, without its API key.
 * 3. `completeImageUpload` checks what arrived (owner, size, type, the bytes
 *    themselves), deletes it when it is wrong, and returns the public URL to
 *    set on the record.
 */

/** Kinds the API takes. The avatar is the user's, not the store's: never here. */
export const API_UPLOAD_KINDS = [
  "category",
  "product",
] as const satisfies readonly ImageUploadKind[];
export type ApiUploadKind = (typeof API_UPLOAD_KINDS)[number];

/** How long an upload URL works. */
export const UPLOAD_TTL_SECONDS = 600;

const EXTENSIONS: Record<ImageUploadMimeType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

/** Bytes the type detection reads. */
export const SNIFF_LENGTH = 12;

/** The image type the first bytes show, or null when they show none we take. */
export function detectImageType(bytes: Uint8Array): ImageUploadMimeType | null {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => bytes[index] === byte)
  ) {
    return "image/png";
  }
  if (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a") return "image/gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}

const isAllowedType = (value: string): value is ImageUploadMimeType =>
  (IMAGE_UPLOAD_MIME_TYPES as readonly string[]).includes(value);

/** `image/png; charset=…` → `image/png`. */
export const baseContentType = (value: string | null | undefined) =>
  (value ?? "").split(";")[0].trim().toLowerCase();

function assertKind(kind: string): asserts kind is ApiUploadKind {
  if (!(API_UPLOAD_KINDS as readonly string[]).includes(kind)) {
    throw uploadErrors.kindNotAllowed(kind);
  }
}

const folderOf = (storeId: string, kind: ApiUploadKind) =>
  `${storeId}/${IMAGE_UPLOAD_CONFIG[kind].folder}/`;

// --- Upload tokens -----------------------------------------------------------

/** What an upload token lets its bearer do: put these bytes at this key, until then. */
export interface UploadGrant {
  storeId: string;
  key: string;
  contentType: ImageUploadMimeType;
  maxSize: number;
  expiresAt: number;
}

const signature = (payload: string) =>
  createHmac("sha256", `louez-api-upload:${authEnv.AUTH_SECRET}`)
    .update(payload)
    .digest("base64url");

export function signUploadGrant(grant: UploadGrant): string {
  const payload = Buffer.from(JSON.stringify(grant)).toString("base64url");
  return `${payload}.${signature(payload)}`;
}

/** The grant a token carries, or null when it is forged, malformed or expired. */
export function verifyUploadGrant(token: string, now = Date.now()): UploadGrant | null {
  const [payload, mac, extra] = token.split(".");
  if (!payload || !mac || extra !== undefined) return null;
  const expected = Buffer.from(signature(payload));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const grant = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as UploadGrant;
    return grant.expiresAt > now ? grant : null;
  } catch {
    return null;
  }
}

// --- Procedures' logic ------------------------------------------------------

export async function createImageUpload(
  storage: StoragePort,
  input: {
    storeId: string;
    kind: ApiUploadKind;
    contentType: string;
    size: number;
    now?: Date;
  },
): Promise<{ key: string; upload: UploadTarget; maxSize: number; expiresAt: Date }> {
  assertKind(input.kind);
  const contentType = baseContentType(input.contentType);
  if (!isAllowedType(contentType)) throw uploadErrors.typeNotAllowed(input.contentType);
  const { maxSize } = IMAGE_UPLOAD_CONFIG[input.kind];
  if (input.size > maxSize) throw uploadErrors.tooLarge(input.size, maxSize);

  const key = `${folderOf(input.storeId, input.kind)}${nanoid()}.${EXTENSIONS[contentType]}`;
  const expiresAt = new Date((input.now ?? new Date()).getTime() + UPLOAD_TTL_SECONDS * 1000);

  // The bound is the kind's limit, not the declared size: a size off by a few
  // bytes must not make the upload fail at the bucket.
  const direct = await storage.signUpload(key, {
    contentType,
    maxSize,
    expiresIn: UPLOAD_TTL_SECONDS,
  });
  const upload: UploadTarget = direct ?? {
    method: "PUT",
    url: storage.uploadUrl(
      signUploadGrant({
        storeId: input.storeId,
        key,
        contentType,
        maxSize,
        expiresAt: expiresAt.getTime(),
      }),
    ),
    headers: { "content-type": contentType },
  };
  return { key, upload, maxSize, expiresAt };
}

/**
 * Checks an upload and makes it public. Only a key this store minted for this
 * kind passes; a wrong size, type or content is deleted and refused. Running
 * it again on a good upload returns the same answer.
 */
export async function completeImageUpload(
  storage: StoragePort,
  input: { storeId: string; kind: ApiUploadKind; key: string },
): Promise<{ key: string; url: string; contentType: string; size: number }> {
  assertKind(input.kind);
  const folder = folderOf(input.storeId, input.kind);
  const name = input.key.startsWith(folder) ? input.key.slice(folder.length) : null;
  const match = name ? /^[A-Za-z0-9_-]{21}\.(jpg|png|gif|webp)$/.exec(name) : null;
  if (!match) throw uploadErrors.notOwned();

  const stored = await storage.head(input.key);
  if (!stored) throw uploadErrors.notFound(input.key);

  const { maxSize } = IMAGE_UPLOAD_CONFIG[input.kind];
  const declared = Object.entries(EXTENSIONS).find(([, ext]) => ext === match[1])?.[0] as
    | ImageUploadMimeType
    | undefined;
  const contentType = baseContentType(stored.contentType);
  let refusal: Error | null = null;
  if (stored.size > maxSize) refusal = uploadErrors.tooLarge(stored.size, maxSize);
  else if (!isAllowedType(contentType)) refusal = uploadErrors.typeNotAllowed(contentType);
  else {
    const found = detectImageType(await storage.readStart(input.key, SNIFF_LENGTH));
    if (found !== contentType || found !== declared) {
      refusal = uploadErrors.contentInvalid(declared ?? contentType, found);
    }
  }
  if (refusal) {
    await storage.delete(input.key);
    throw refusal;
  }

  const url = await storage.publish(input.key);
  return { key: input.key, url, contentType, size: stored.size };
}
