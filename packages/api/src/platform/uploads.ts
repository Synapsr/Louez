import type { ORPCError } from "@orpc/server";

import { uploadErrors } from "../contracts/uploads";
import {
  baseContentType,
  detectImageType,
  SNIFF_LENGTH,
  verifyUploadGrant,
} from "../services/uploads";
import type { ApiErrorData } from "./errors";
import type { ApiPorts } from "./ports";

/** Where the app mounts the upload endpoint; the token follows. */
export const UPLOAD_PATH_PREFIX = "/api/v1/uploads/";

function errorResponse(error: ORPCError<string, ApiErrorData>, status = error.status): Response {
  return Response.json(error.toJSON(), { status });
}

/** The body, read up to `maxSize` bytes; null past it. */
async function readLimited(
  body: ReadableStream<Uint8Array>,
  maxSize: number,
): Promise<Uint8Array | null> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxSize) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * The upload endpoint for storage that takes no presigned upload (a private
 * bucket served through the app). `createImageUpload` hands out its URL with
 * a signed token: the token is the credential, as a presigned URL is, so the
 * request carries no API key. It accepts one PUT of the declared type, within
 * the size limit, whose bytes are that type; the caller then completes the
 * upload as with a direct one.
 */
export async function handleUploadRequest(
  request: Request,
  token: string,
  ports: ApiPorts,
): Promise<Response> {
  if (request.method !== "PUT") {
    return new Response(null, { status: 405, headers: { allow: "PUT" } });
  }
  const grant = verifyUploadGrant(token);
  if (!grant) return errorResponse(uploadErrors.tokenInvalid());

  const received = request.headers.get("content-type");
  if (baseContentType(received) !== grant.contentType) {
    return errorResponse(uploadErrors.typeMismatch(grant.contentType, received), 415);
  }
  const declaredLength = Number(request.headers.get("content-length") ?? Number.NaN);
  if (declaredLength > grant.maxSize) {
    return errorResponse(uploadErrors.tooLarge(declaredLength, grant.maxSize), 413);
  }
  const bytes = request.body ? await readLimited(request.body, grant.maxSize) : new Uint8Array();
  if (!bytes) return errorResponse(uploadErrors.tooLarge(null, grant.maxSize), 413);
  const found = detectImageType(bytes.subarray(0, SNIFF_LENGTH));
  if (found !== grant.contentType) {
    return errorResponse(uploadErrors.contentInvalid(grant.contentType, found), 422);
  }

  await ports.storage.put(grant.key, bytes, grant.contentType);
  return Response.json({ key: grant.key, size: bytes.byteLength });
}
