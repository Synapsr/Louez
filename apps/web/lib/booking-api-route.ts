import type { ZodType } from "zod";
import type { NextResponse } from "next/server";

import { ApiServiceError } from "@louez/api/services";

import { env } from "@/env";
import { apiJson, statusFromServiceCode } from "@/lib/api-service-response";
import { verifyCatalogRequest } from "@/lib/catalog-auth";

const MAX_BOOKING_BODY_BYTES = 65_536;

export const bookingJson = apiJson;

export async function readBookingPost<T>(
  request: Request,
  schema: ZodType<T>,
): Promise<
  { success: true; data: T; secret: string } | { success: false; response: NextResponse }
> {
  const contentLengthHeader = request.headers.get("content-length");
  const contentLength = contentLengthHeader === null ? Number.NaN : Number(contentLengthHeader);
  if (
    !Number.isInteger(contentLength) ||
    contentLength < 0 ||
    contentLength > MAX_BOOKING_BODY_BYTES
  ) {
    return {
      success: false,
      response: bookingJson({ error: "Payload Too Large" }, 413),
    };
  }

  const rawBody = new Uint8Array(await request.arrayBuffer());
  const secret = env.MARKETPLACE_CATALOG_SECRET;
  if (
    !secret ||
    !(await verifyCatalogRequest({
      request,
      rawBody,
      secret,
    }))
  ) {
    return { success: false, response: bookingJson({ error: "Unauthorized" }, 401) };
  }

  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(rawBody);
    const parsed = schema.safeParse(decoded.length === 0 ? {} : JSON.parse(decoded));
    if (!parsed.success) {
      return {
        success: false,
        response: bookingJson({ error: "errors.invalidData" }, 400),
      };
    }
    return { success: true, data: parsed.data, secret };
  } catch {
    return {
      success: false,
      response: bookingJson({ error: "errors.invalidData" }, 400),
    };
  }
}

export async function verifyBookingGet(request: Request): Promise<boolean> {
  return verifyCatalogRequest({
    request,
    secret: env.MARKETPLACE_CATALOG_SECRET,
  });
}

export function bookingServiceError(error: ApiServiceError) {
  if (error.key === "unavailable") {
    return bookingJson({ error: "unavailable", reasons: error.details }, 409);
  }
  if (error.key === "not_cancellable") {
    const reason =
      typeof error.details === "object" &&
      error.details !== null &&
      "reason" in error.details &&
      typeof error.details.reason === "string"
        ? error.details.reason
        : "reservation_status";
    return bookingJson(
      {
        error: "not_cancellable",
        reason,
      },
      409,
    );
  }
  if (
    [
      "already_paid",
      "checkout_not_available",
      "hold_expired",
      "idempotency_conflict",
      "invalid_quote",
      "payment_unavailable",
      "quote_expired",
    ].includes(error.key)
  ) {
    return bookingJson({ error: error.key }, 409);
  }

  const status = statusFromServiceCode(error.code);
  return bookingJson({ error: status === 500 ? "errors.internalServerError" : error.key }, status);
}
