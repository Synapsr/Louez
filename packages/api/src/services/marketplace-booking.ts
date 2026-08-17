import { and, asc, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import {
  customers,
  db,
  marketplaceBookingAttempts,
  reservationActivity,
  reservationItems,
  reservations,
  storeMarketplaceChannels,
  stores,
} from "@louez/db";
import type { Rate, StoreSettings } from "@louez/types";
import { calculateSeasonalAwarePrice, type PricingMode } from "@louez/utils";
import type { BookingCheckoutInput, BookingHoldInput, BookingQuoteInput } from "@louez/validations";

import { getStorefrontAvailability } from "./availability";
import { resolveStorefrontCart } from "./cart";
import { ApiServiceError } from "./errors";

const QUOTE_TTL_MS = 10 * 60 * 1000;
const HOLD_TTL_MS = 15 * 60 * 1000;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const QUOTE_TOKEN_HMAC_PREFIX = "louez.quote-token.v1.";
const encoder = new TextEncoder();

const quoteTokenPayloadSchema = z.object({
  version: z.literal(1),
  storeId: z.string().length(21),
  startAt: z.iso.datetime({ offset: true }),
  endAt: z.iso.datetime({ offset: true }),
  locale: z.enum(["fr", "en", "de", "es", "it", "nl", "pl", "pt"]),
  expiresAt: z.iso.datetime({ offset: true }),
  currency: z.string().length(3),
  lines: z.array(
    z.object({
      productId: z.string().length(21),
      name: z.string(),
      imageUrl: z.string().nullable(),
      quantity: z.number().int().positive(),
      attributes: z.record(z.string(), z.string()),
      unitPrice: z.number().nonnegative(),
      lineTotal: z.number().nonnegative(),
      depositPerUnit: z.number().nonnegative(),
    }),
  ),
  subtotal: z.number().nonnegative(),
  deposit: z.number().nonnegative(),
  total: z.number().nonnegative(),
});

type QuoteTokenPayload = z.infer<typeof quoteTokenPayloadSchema>;

type BookingStatus = "pending_payment" | "confirmed" | "cancelled" | "completed" | "expired";

interface BookingCursor {
  id: string;
  updatedAt: Date;
}

interface MarketplaceUnavailableReason {
  productId: string;
  code: string;
}

interface MarketplaceReservationInput {
  reservationId: string;
  storeId: string;
  customer: BookingHoldInput["customer"];
  locale: QuoteTokenPayload["locale"];
  startAt: string;
  endAt: string;
  items: QuoteTokenPayload["lines"];
  subtotal: number;
  deposit: number;
  total: number;
}

type MarketplaceReservationResult =
  | {
      success: true;
      reservationId: string;
      customerId: string;
    }
  | {
      success: false;
      error: string;
    };

export interface MarketplaceHoldAdapter {
  createReservation: (input: MarketplaceReservationInput) => Promise<MarketplaceReservationResult>;
  auditIdentityConflict?: (conflict: {
    bookingAttemptId: string;
    customerId: string;
    existingMarketplaceUserId: string;
    receivedMarketplaceUserId: string;
    storeId: string;
  }) => void;
}

export interface MarketplaceCheckoutAdapter {
  createCheckout: (input: {
    cancelUrl: string;
    customerId: string;
    reservationId: string;
    storeSlug: string;
    successUrl: string;
  }) => Promise<
    | {
        success: true;
        checkoutUrl: string;
        expiresAt: Date;
        sessionId: string;
      }
    | { success: false; error: string }
  >;
  getCheckout: (
    stripeAccountId: string,
    sessionId: string,
  ) => Promise<{
    expiresAt: Date;
    paymentStatus: string;
    status: string | null;
    url: string | null;
  }>;
}

export interface MarketplaceCancellationAdapter {
  releasePendingPayments: (params: {
    reservationId: string;
    stripeAccountId: string | null;
  }) => Promise<void>;
  runCancellationSideEffects: (reservationId: string) => Promise<void>;
}

export interface BookingSnapshot {
  id: string;
  bookingAttemptId: string;
  storeId: string;
  status: BookingStatus;
  bookingNumber: string;
  startAt: string;
  endAt: string;
  currency: string;
  totalAmount: string;
  depositAmount: string;
  customerEmail: string;
  marketplaceUserId: string | null;
  items: Array<{
    productId: string;
    name: string;
    imageUrl: string | null;
    quantity: number;
    unitPrice: string;
  }>;
  manageUrl: string;
  updatedAt: string;
}

type BookingUrlBuilder = (storeSlug: string, path: string) => string;

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new ApiServiceError("BAD_REQUEST", "errors.invalidData");
  }
  return limit;
}

function encodeCursor(cursor: BookingCursor): string {
  return Buffer.from(`${cursor.updatedAt.toISOString()}|${cursor.id}`, "utf8").toString(
    "base64url",
  );
}

function decodeCursor(value: string | undefined): BookingCursor | null {
  if (!value) return null;

  try {
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    const separatorIndex = decoded.lastIndexOf("|");
    if (separatorIndex < 1) throw new Error("Invalid cursor");

    const updatedAt = new Date(decoded.slice(0, separatorIndex));
    const id = decoded.slice(separatorIndex + 1);
    if (Number.isNaN(updatedAt.getTime()) || id.length !== 21) {
      throw new Error("Invalid cursor");
    }

    return { id, updatedAt };
  } catch {
    throw new ApiServiceError("BAD_REQUEST", "errors.invalidData");
  }
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return bytesToHex(new Uint8Array(digest));
}

async function hmacHex(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return bytesToHex(new Uint8Array(signature));
}

async function timingSafeEqual(left: string, right: string): Promise<boolean> {
  const [leftDigest, rightDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const leftBytes = new Uint8Array(leftDigest);
  const rightBytes = new Uint8Array(rightDigest);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

async function createQuoteToken(payload: QuoteTokenPayload, secret: string): Promise<string> {
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = await hmacHex(`${QUOTE_TOKEN_HMAC_PREFIX}${encodedPayload}`, secret);
  return `${encodedPayload}.${signature}`;
}

async function readQuoteToken(
  quoteToken: string,
  secret: string,
  options?: { allowExpired?: boolean },
): Promise<QuoteTokenPayload> {
  const separatorIndex = quoteToken.lastIndexOf(".");
  if (separatorIndex < 1) {
    throw new ApiServiceError("BAD_REQUEST", "invalid_quote");
  }

  const encodedPayload = quoteToken.slice(0, separatorIndex);
  const providedSignature = quoteToken.slice(separatorIndex + 1).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(providedSignature)) {
    throw new ApiServiceError("BAD_REQUEST", "invalid_quote");
  }

  const expectedSignature = await hmacHex(`${QUOTE_TOKEN_HMAC_PREFIX}${encodedPayload}`, secret);
  if (!(await timingSafeEqual(expectedSignature, providedSignature))) {
    throw new ApiServiceError("BAD_REQUEST", "invalid_quote");
  }

  try {
    const parsed = quoteTokenPayloadSchema.safeParse(
      JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")),
    );
    if (!parsed.success) {
      throw new Error("Invalid quote payload");
    }
    if (!options?.allowExpired && new Date(parsed.data.expiresAt) <= new Date()) {
      throw new ApiServiceError("BAD_REQUEST", "quote_expired");
    }
    return parsed.data;
  } catch (error) {
    if (error instanceof ApiServiceError) throw error;
    throw new ApiServiceError("BAD_REQUEST", "invalid_quote");
  }
}

function unavailable(reasons: MarketplaceUnavailableReason[]): never {
  throw new ApiServiceError("BAD_REQUEST", "unavailable", reasons);
}

function uniqueReasons(reasons: MarketplaceUnavailableReason[]): MarketplaceUnavailableReason[] {
  return [
    ...new Map(reasons.map((reason) => [`${reason.productId}:${reason.code}`, reason])).values(),
  ];
}

function getDurationReasons(params: {
  endAt: string;
  productIds: string[];
  settings: StoreSettings | null;
  startAt: string;
}): MarketplaceUnavailableReason[] {
  const durationMinutes =
    (new Date(params.endAt).getTime() - new Date(params.startAt).getTime()) / 60_000;
  const minMinutes = params.settings?.minRentalMinutes ?? 60;
  const maxMinutes = params.settings?.maxRentalMinutes;
  const reasons: MarketplaceUnavailableReason[] = [];

  if (minMinutes > 0 && durationMinutes < minMinutes) {
    reasons.push(
      ...params.productIds.map((productId) => ({
        productId,
        code: "min_duration",
      })),
    );
  }
  if (maxMinutes != null && durationMinutes > maxMinutes) {
    reasons.push(
      ...params.productIds.map((productId) => ({
        productId,
        code: "max_duration",
      })),
    );
  }

  return reasons;
}

export async function quoteMarketplaceBooking(params: {
  input: BookingQuoteInput;
  secret: string;
}): Promise<{
  quoteToken: string;
  expiresAt: string;
  currency: string;
  lines: Array<{
    productId: string;
    name: string;
    quantity: number;
    unitPrice: string;
    lineTotal: string;
  }>;
  subtotal: string;
  deposit: string;
  total: string;
}> {
  await expireMarketplaceBookingAttempts({ storeId: params.input.storeId });

  const store = await db
    .select({
      id: stores.id,
      slug: stores.slug,
      settings: stores.settings,
      channelStatus: storeMarketplaceChannels.status,
    })
    .from(stores)
    .leftJoin(storeMarketplaceChannels, eq(storeMarketplaceChannels.storeId, stores.id))
    .where(eq(stores.id, params.input.storeId))
    .limit(1)
    .then((rows) => rows[0]);

  if (!store) throw new ApiServiceError("NOT_FOUND", "errors.storeNotFound");

  const productIds = params.input.items.map((item) => item.productId);
  if (store.channelStatus !== "published") {
    unavailable(
      productIds.map((productId) => ({
        productId,
        code: "channel_unpublished",
      })),
    );
  }

  const availability = await getStorefrontAvailability({
    storeSlug: store.slug,
    startDate: params.input.startAt,
    endDate: params.input.endAt,
    productIds: [...new Set(productIds)],
  });
  const reasons = getDurationReasons({
    startAt: params.input.startAt,
    endAt: params.input.endAt,
    productIds,
    settings: store.settings,
  });
  if (availability.businessHoursValidation?.valid === false) {
    reasons.push(...productIds.map((productId) => ({ productId, code: "closed" })));
  }
  if (availability.advanceNoticeValidation?.valid === false) {
    reasons.push(
      ...productIds.map((productId) => ({
        productId,
        code: "advance_notice",
      })),
    );
  }

  const requestedQuantityByProduct = new Map<string, number>();
  for (const item of params.input.items) {
    requestedQuantityByProduct.set(
      item.productId,
      (requestedQuantityByProduct.get(item.productId) ?? 0) + item.quantity,
    );
  }
  for (const [productId, requestedQuantity] of requestedQuantityByProduct) {
    const productAvailability = availability.products.find(
      (product) => product.productId === productId,
    );
    if (productAvailability && requestedQuantity > productAvailability.availableQuantity) {
      reasons.push({ productId, code: "out_of_stock" });
    }
  }

  const cart = await resolveStorefrontCart({
    storeSlug: store.slug,
    lines: params.input.items.map((item, index) => ({
      lineId: index.toString(),
      productId: item.productId,
      quantity: item.quantity,
      startDate: params.input.startAt,
      endDate: params.input.endAt,
      ...(item.attributes ? { selectedAttributes: item.attributes } : {}),
    })),
  });

  for (const line of cart.lines) {
    if (line.status === "unavailable") {
      reasons.push({
        productId: line.productId,
        code: line.reason === "insufficient_stock" ? "out_of_stock" : "product_inactive",
      });
    }
  }

  if (reasons.length > 0) unavailable(uniqueReasons(reasons));

  const resolvedLines = cart.lines.filter(
    (line): line is Extract<typeof line, { status: "resolved" }> => line.status === "resolved",
  );
  const tokenLines: QuoteTokenPayload["lines"] = resolvedLines.map((line) => {
    const sourceItem = params.input.items[Number(line.lineId)];
    if (!sourceItem) {
      throw new ApiServiceError("INTERNAL_SERVER_ERROR", "errors.internalServerError");
    }
    const baseTiers = line.pricingTiers.map((tier) => ({
      id: tier.id,
      minDuration: tier.minDuration,
      discountPercent: tier.discountPercent,
      displayOrder: 0,
    }));
    const baseRates: Rate[] = line.pricingTiers.flatMap((tier, index) =>
      tier.period !== null && tier.price !== null
        ? [
            {
              id: tier.id,
              period: tier.period,
              price: tier.price,
              displayOrder: index,
            },
          ]
        : [],
    );
    const priced = calculateSeasonalAwarePrice(
      {
        basePrice: line.price,
        basePeriodMinutes: line.basePeriodMinutes,
        deposit: line.deposit,
        pricingMode: line.productPricingMode as PricingMode,
        enforceStrictTiers: line.enforceStrictTiers,
        tiers: baseTiers,
        rates: baseRates,
      },
      line.seasonalPricings ?? [],
      params.input.startAt,
      params.input.endAt,
      sourceItem.quantity,
    );

    return {
      productId: line.productId,
      name: line.productName,
      imageUrl: line.productImage,
      quantity: sourceItem.quantity,
      attributes: sourceItem.attributes ?? {},
      unitPrice: priced.subtotal / sourceItem.quantity,
      lineTotal: priced.subtotal,
      depositPerUnit: priced.deposit / sourceItem.quantity,
    };
  });
  const subtotal = tokenLines.reduce((sum, line) => sum + line.lineTotal, 0);
  const deposit = tokenLines.reduce((sum, line) => sum + line.depositPerUnit * line.quantity, 0);
  const total = subtotal;
  const currency = store.settings?.currency ?? "EUR";
  const expiresAt = new Date(Date.now() + QUOTE_TTL_MS).toISOString();
  const payload: QuoteTokenPayload = {
    version: 1,
    storeId: store.id,
    startAt: params.input.startAt,
    endAt: params.input.endAt,
    locale: params.input.locale,
    expiresAt,
    currency,
    lines: tokenLines,
    subtotal,
    deposit,
    total,
  };

  return {
    quoteToken: await createQuoteToken(payload, params.secret),
    expiresAt,
    currency,
    lines: tokenLines.map((line) => ({
      productId: line.productId,
      name: line.name,
      quantity: line.quantity,
      unitPrice: line.unitPrice.toFixed(2),
      lineTotal: line.lineTotal.toFixed(2),
    })),
    subtotal: subtotal.toFixed(2),
    deposit: deposit.toFixed(2),
    total: total.toFixed(2),
  };
}

function reasonFromReservationError(error: string): string {
  switch (error) {
    case "errors.businessHoursViolation":
      return "closed";
    case "errors.advanceNoticeViolation":
      return "advance_notice";
    case "errors.minRentalDurationViolation":
      return "min_duration";
    case "errors.maxRentalDurationViolation":
      return "max_duration";
    case "errors.productUnavailable":
      return "product_inactive";
    case "errors.priceChanged":
      return "price_changed";
    case "errors.insufficientStock":
    case "errors.productNoLongerAvailable":
      return "out_of_stock";
    default:
      return "reservation_failed";
  }
}

async function bridgeMarketplaceCustomer(params: {
  adapter: MarketplaceHoldAdapter;
  bookingAttemptId: string;
  holdId: string;
  marketplaceUserId: string | undefined;
  storeId: string;
}): Promise<void> {
  if (!params.marketplaceUserId) return;

  const reservation = await db.query.reservations.findFirst({
    where: and(
      eq(reservations.id, params.holdId),
      eq(reservations.storeId, params.storeId),
      eq(reservations.source, "marketplace"),
    ),
    columns: { customerId: true },
  });
  if (!reservation?.customerId) {
    throw new ApiServiceError("INTERNAL_SERVER_ERROR", "errors.internalServerError");
  }

  await db
    .update(customers)
    .set({ marketplaceUserId: params.marketplaceUserId, updatedAt: new Date() })
    .where(
      and(
        eq(customers.id, reservation.customerId),
        eq(customers.storeId, params.storeId),
        isNull(customers.marketplaceUserId),
      ),
    );
  const customer = await db.query.customers.findFirst({
    where: and(eq(customers.id, reservation.customerId), eq(customers.storeId, params.storeId)),
    columns: { marketplaceUserId: true },
  });
  if (customer?.marketplaceUserId === params.marketplaceUserId) return;
  if (!customer?.marketplaceUserId) {
    throw new ApiServiceError("INTERNAL_SERVER_ERROR", "errors.internalServerError");
  }

  params.adapter.auditIdentityConflict?.({
    bookingAttemptId: params.bookingAttemptId,
    customerId: reservation.customerId,
    existingMarketplaceUserId: customer.marketplaceUserId,
    receivedMarketplaceUserId: params.marketplaceUserId,
    storeId: params.storeId,
  });
}

export async function holdMarketplaceBooking(params: {
  adapter: MarketplaceHoldAdapter;
  input: BookingHoldInput;
  secret: string;
}): Promise<{ holdId: string; expiresAt: string }> {
  const quote = await readQuoteToken(params.input.quoteToken, params.secret, {
    allowExpired: true,
  });
  const quoteTokenHash = await sha256Hex(params.input.quoteToken);
  const replay = await db.query.marketplaceBookingAttempts.findFirst({
    where: eq(marketplaceBookingAttempts.bookingAttemptId, params.input.bookingAttemptId),
    columns: {
      expiresAt: true,
      holdId: true,
      quoteTokenHash: true,
      status: true,
      storeId: true,
    },
  });
  if (replay) {
    if (replay.storeId !== quote.storeId || replay.quoteTokenHash !== quoteTokenHash) {
      throw new ApiServiceError("BAD_REQUEST", "idempotency_conflict");
    }
    if (
      replay.holdId &&
      (replay.status === "confirmed" ||
        (["holding", "checkout_pending"].includes(replay.status) && replay.expiresAt > new Date()))
    ) {
      await bridgeMarketplaceCustomer({
        adapter: params.adapter,
        bookingAttemptId: params.input.bookingAttemptId,
        holdId: replay.holdId,
        marketplaceUserId: params.input.customer.marketplaceUserId,
        storeId: quote.storeId,
      });
      return { holdId: replay.holdId, expiresAt: replay.expiresAt.toISOString() };
    }
    if (replay.expiresAt <= new Date()) {
      if (replay.holdId) {
        const expiredHoldId = replay.holdId;
        await db.transaction((tx) => expireAttempt(tx, expiredHoldId));
      }
      throw new ApiServiceError("BAD_REQUEST", "hold_expired");
    }
  }
  if (new Date(quote.expiresAt) <= new Date()) {
    throw new ApiServiceError("BAD_REQUEST", "quote_expired");
  }
  const generatedId = nanoid();
  const expiresAt = new Date(Date.now() + HOLD_TTL_MS);

  await db
    .insert(marketplaceBookingAttempts)
    .values({
      id: generatedId,
      bookingAttemptId: params.input.bookingAttemptId,
      storeId: quote.storeId,
      quoteTokenHash,
      holdId: generatedId,
      reservationId: generatedId,
      status: "creating_hold",
      expiresAt,
      updatedAt: new Date(),
    })
    .onDuplicateKeyUpdate({
      set: {
        bookingAttemptId: sql`${marketplaceBookingAttempts.bookingAttemptId}`,
      },
    });

  const hold = await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT id FROM ${marketplaceBookingAttempts} WHERE ${marketplaceBookingAttempts.bookingAttemptId} = ${params.input.bookingAttemptId} FOR UPDATE`,
    );
    const attempt = await tx.query.marketplaceBookingAttempts.findFirst({
      where: eq(marketplaceBookingAttempts.bookingAttemptId, params.input.bookingAttemptId),
    });
    if (!attempt?.holdId || !attempt.reservationId) {
      throw new ApiServiceError("INTERNAL_SERVER_ERROR", "errors.internalServerError");
    }
    if (attempt.storeId !== quote.storeId || attempt.quoteTokenHash !== quoteTokenHash) {
      throw new ApiServiceError("BAD_REQUEST", "idempotency_conflict");
    }

    if (["holding", "checkout_pending", "confirmed"].includes(attempt.status)) {
      return {
        holdId: attempt.holdId,
        expiresAt: attempt.expiresAt.toISOString(),
      };
    }
    if (attempt.expiresAt <= new Date()) {
      await expireAttempt(tx, attempt.reservationId);
      throw new ApiServiceError("BAD_REQUEST", "hold_expired");
    }

    const result = await params.adapter.createReservation({
      reservationId: attempt.reservationId,
      storeId: quote.storeId,
      customer: params.input.customer,
      locale: quote.locale,
      startAt: quote.startAt,
      endAt: quote.endAt,
      items: quote.lines,
      subtotal: quote.subtotal,
      deposit: quote.deposit,
      total: quote.total,
    });

    if (!result.success) {
      await tx
        .update(marketplaceBookingAttempts)
        .set({ status: "failed", updatedAt: new Date() })
        .where(eq(marketplaceBookingAttempts.id, attempt.id));
      unavailable(
        quote.lines.map((line) => ({
          productId: line.productId,
          code: reasonFromReservationError(result.error),
        })),
      );
    }

    if (result.reservationId !== attempt.reservationId) {
      throw new ApiServiceError("INTERNAL_SERVER_ERROR", "errors.internalServerError");
    }

    await tx
      .update(marketplaceBookingAttempts)
      .set({ status: "holding", updatedAt: new Date() })
      .where(eq(marketplaceBookingAttempts.id, attempt.id));

    return {
      holdId: attempt.holdId,
      expiresAt: attempt.expiresAt.toISOString(),
    };
  });

  await bridgeMarketplaceCustomer({
    adapter: params.adapter,
    bookingAttemptId: params.input.bookingAttemptId,
    holdId: hold.holdId,
    marketplaceUserId: params.input.customer.marketplaceUserId,
    storeId: quote.storeId,
  });

  return hold;
}

export async function checkoutMarketplaceBooking(params: {
  adapter: MarketplaceCheckoutAdapter;
  input: BookingCheckoutInput;
}): Promise<{ checkoutUrl: string; reservationId: string }> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT id FROM ${marketplaceBookingAttempts} WHERE ${marketplaceBookingAttempts.bookingAttemptId} = ${params.input.bookingAttemptId} FOR UPDATE`,
    );
    const attempt = await tx.query.marketplaceBookingAttempts.findFirst({
      where: and(
        eq(marketplaceBookingAttempts.bookingAttemptId, params.input.bookingAttemptId),
        eq(marketplaceBookingAttempts.holdId, params.input.holdId),
      ),
    });
    if (!attempt?.reservationId) {
      throw new ApiServiceError("NOT_FOUND", "hold_not_found");
    }
    if (attempt.expiresAt <= new Date()) {
      await expireAttempt(tx, attempt.reservationId);
      throw new ApiServiceError("BAD_REQUEST", "hold_expired");
    }

    const reservation = await tx.query.reservations.findFirst({
      where: and(
        eq(reservations.id, attempt.reservationId),
        eq(reservations.storeId, attempt.storeId),
        eq(reservations.source, "marketplace"),
      ),
      columns: {
        id: true,
        customerId: true,
        status: true,
      },
      with: {
        store: {
          columns: {
            slug: true,
            stripeAccountId: true,
            stripeChargesEnabled: true,
          },
        },
        payments: {
          columns: {
            id: true,
            method: true,
            status: true,
            stripeCheckoutSessionId: true,
            type: true,
          },
        },
      },
    });
    if (!reservation) {
      throw new ApiServiceError("NOT_FOUND", "errors.reservationNotFound");
    }
    if (reservation.status !== "pending") {
      throw new ApiServiceError("BAD_REQUEST", "checkout_not_available");
    }
    if (!reservation.store.stripeAccountId || !reservation.store.stripeChargesEnabled) {
      throw new ApiServiceError("BAD_REQUEST", "payment_unavailable");
    }

    const pendingPayment = reservation.payments.find(
      (payment) =>
        payment.type === "rental" &&
        payment.method === "stripe" &&
        payment.status === "pending" &&
        payment.stripeCheckoutSessionId,
    );
    if (
      reservation.payments.some(
        (payment) => payment.type === "rental" && payment.status === "completed",
      )
    ) {
      await tx
        .update(marketplaceBookingAttempts)
        .set({ status: "confirmed", updatedAt: new Date() })
        .where(eq(marketplaceBookingAttempts.id, attempt.id));
      throw new ApiServiceError("BAD_REQUEST", "already_paid");
    }
    if (pendingPayment?.stripeCheckoutSessionId) {
      const session = await params.adapter.getCheckout(
        reservation.store.stripeAccountId,
        pendingPayment.stripeCheckoutSessionId,
      );
      if (session.status === "open" && session.url && session.expiresAt > new Date()) {
        await tx
          .update(marketplaceBookingAttempts)
          .set({
            status: "checkout_pending",
            expiresAt: session.expiresAt,
            updatedAt: new Date(),
          })
          .where(eq(marketplaceBookingAttempts.id, attempt.id));
        return {
          checkoutUrl: session.url,
          reservationId: reservation.id,
        };
      }
      if (session.paymentStatus === "paid") {
        await tx
          .update(marketplaceBookingAttempts)
          .set({ status: "confirmed", updatedAt: new Date() })
          .where(eq(marketplaceBookingAttempts.id, attempt.id));
        throw new ApiServiceError("BAD_REQUEST", "already_paid");
      }
    }

    const checkout = await params.adapter.createCheckout({
      reservationId: reservation.id,
      customerId: reservation.customerId,
      storeSlug: reservation.store.slug,
      successUrl: params.input.successUrl,
      cancelUrl: params.input.cancelUrl,
    });
    if (!checkout.success) {
      throw new ApiServiceError("BAD_REQUEST", checkout.error);
    }

    await tx
      .update(marketplaceBookingAttempts)
      .set({
        status: "checkout_pending",
        expiresAt: checkout.expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(marketplaceBookingAttempts.id, attempt.id));

    return {
      checkoutUrl: checkout.checkoutUrl,
      reservationId: reservation.id,
    };
  });
}

function bookingStatus(params: {
  attemptStatus: string;
  expiresAt: Date;
  reservationStatus: string;
}): BookingStatus {
  if (["expired", "failed"].includes(params.attemptStatus)) {
    return "expired";
  }
  if (["cancelled", "rejected", "declined"].includes(params.reservationStatus)) {
    return "cancelled";
  }
  if (params.reservationStatus === "completed") return "completed";
  if (["confirmed", "ongoing"].includes(params.reservationStatus)) {
    return "confirmed";
  }
  if (params.expiresAt <= new Date() && params.attemptStatus !== "confirmed") {
    return "expired";
  }
  return "pending_payment";
}

type BookingRow = {
  id: string;
  attemptStatus: string;
  bookingAttemptId: string;
  bookingNumber: string;
  customerEmail: string;
  depositAmount: string;
  endAt: Date;
  expiresAt: Date;
  marketplaceUserId: string | null;
  reservationStatus: string;
  startAt: Date;
  storeId: string;
  storeSettings: StoreSettings | null;
  storeSlug: string;
  totalAmount: string;
  updatedAt: Date;
};

async function snapshotsFromRows(
  rows: BookingRow[],
  getCanonicalUrl: BookingUrlBuilder,
): Promise<BookingSnapshot[]> {
  if (rows.length === 0) return [];
  const itemRows = await db
    .select({
      reservationId: reservationItems.reservationId,
      productId: reservationItems.productId,
      productSnapshot: reservationItems.productSnapshot,
      quantity: reservationItems.quantity,
      unitPrice: reservationItems.unitPrice,
    })
    .from(reservationItems)
    .where(
      inArray(
        reservationItems.reservationId,
        rows.map((row) => row.id),
      ),
    );
  const itemsByReservation = new Map<string, BookingSnapshot["items"]>();
  for (const item of itemRows) {
    if (!item.productId) continue;
    const current = itemsByReservation.get(item.reservationId) ?? [];
    current.push({
      productId: item.productId,
      name: item.productSnapshot.name,
      imageUrl: item.productSnapshot.images[0] ?? null,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
    });
    itemsByReservation.set(item.reservationId, current);
  }

  return rows.map((row) => ({
    id: row.id,
    bookingAttemptId: row.bookingAttemptId,
    storeId: row.storeId,
    status: bookingStatus({
      attemptStatus: row.attemptStatus,
      expiresAt: row.expiresAt,
      reservationStatus: row.reservationStatus,
    }),
    bookingNumber: row.bookingNumber,
    startAt: row.startAt.toISOString(),
    endAt: row.endAt.toISOString(),
    currency: row.storeSettings?.currency ?? "EUR",
    totalAmount: row.totalAmount,
    depositAmount: row.depositAmount,
    customerEmail: row.customerEmail,
    marketplaceUserId: row.marketplaceUserId,
    items: itemsByReservation.get(row.id) ?? [],
    manageUrl: getCanonicalUrl(
      row.storeSlug,
      `/account/reservations/${row.id}?channel=marketplace`,
    ),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

const bookingUpdatedAt =
  sql<Date>`greatest(${reservations.updatedAt}, ${marketplaceBookingAttempts.updatedAt})`.mapWith(
    reservations.updatedAt,
  );

function bookingSelection() {
  return {
    id: reservations.id,
    attemptStatus: marketplaceBookingAttempts.status,
    bookingAttemptId: marketplaceBookingAttempts.bookingAttemptId,
    bookingNumber: reservations.number,
    customerEmail: customers.email,
    depositAmount: reservations.depositAmount,
    endAt: reservations.endDate,
    expiresAt: marketplaceBookingAttempts.expiresAt,
    marketplaceUserId: customers.marketplaceUserId,
    reservationStatus: reservations.status,
    startAt: reservations.startDate,
    storeId: reservations.storeId,
    storeSettings: stores.settings,
    storeSlug: stores.slug,
    totalAmount: reservations.totalAmount,
    updatedAt: bookingUpdatedAt,
  };
}

export async function getMarketplaceBooking(params: {
  getCanonicalUrl: BookingUrlBuilder;
  reservationId: string;
}): Promise<BookingSnapshot> {
  await expireMarketplaceBookingAttempts({ reservationId: params.reservationId });
  const row = await db
    .select(bookingSelection())
    .from(reservations)
    .innerJoin(
      marketplaceBookingAttempts,
      eq(marketplaceBookingAttempts.reservationId, reservations.id),
    )
    .innerJoin(customers, eq(customers.id, reservations.customerId))
    .innerJoin(stores, eq(stores.id, reservations.storeId))
    .where(and(eq(reservations.id, params.reservationId), eq(reservations.source, "marketplace")))
    .limit(1)
    .then((rows) => rows[0]);
  if (!row) {
    throw new ApiServiceError("NOT_FOUND", "errors.reservationNotFound");
  }

  const [snapshot] = await snapshotsFromRows([row], params.getCanonicalUrl);
  if (!snapshot) {
    throw new ApiServiceError("INTERNAL_SERVER_ERROR", "errors.internalServerError");
  }
  return snapshot;
}

export async function listMarketplaceBookings(params: {
  cursor?: string;
  getCanonicalUrl: BookingUrlBuilder;
  limit?: number;
}): Promise<{ data: BookingSnapshot[]; nextCursor: string | null }> {
  await expireMarketplaceBookingAttempts({});
  const limit = normalizeLimit(params.limit);
  const cursor = decodeCursor(params.cursor);
  const cursorCondition = cursor
    ? or(
        gt(bookingUpdatedAt, cursor.updatedAt),
        and(eq(bookingUpdatedAt, cursor.updatedAt), gt(reservations.id, cursor.id)),
      )
    : undefined;
  const rows = await db
    .select(bookingSelection())
    .from(reservations)
    .innerJoin(
      marketplaceBookingAttempts,
      eq(marketplaceBookingAttempts.reservationId, reservations.id),
    )
    .innerJoin(customers, eq(customers.id, reservations.customerId))
    .innerJoin(stores, eq(stores.id, reservations.storeId))
    .where(and(eq(reservations.source, "marketplace"), cursorCondition))
    .orderBy(asc(bookingUpdatedAt), asc(reservations.id))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const last = pageRows.at(-1);

  return {
    data: await snapshotsFromRows(pageRows, params.getCanonicalUrl),
    nextCursor: hasMore && last ? encodeCursor({ id: last.id, updatedAt: last.updatedAt }) : null,
  };
}

export async function cancelMarketplaceBooking(params: {
  adapter: MarketplaceCancellationAdapter;
  getCanonicalUrl: BookingUrlBuilder;
  reservationId: string;
}): Promise<BookingSnapshot> {
  const reservation = await db.query.reservations.findFirst({
    where: and(eq(reservations.id, params.reservationId), eq(reservations.source, "marketplace")),
    columns: {
      id: true,
      status: true,
    },
    with: {
      store: { columns: { stripeAccountId: true } },
    },
  });
  if (!reservation) {
    throw new ApiServiceError("NOT_FOUND", "errors.reservationNotFound");
  }
  if (["cancelled", "completed", "rejected", "declined"].includes(reservation.status)) {
    throw new ApiServiceError("BAD_REQUEST", "not_cancellable", {
      reason: "reservation_status",
    });
  }

  await db.transaction(async (tx) => {
    await tx
      .update(reservations)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(and(eq(reservations.id, reservation.id), eq(reservations.source, "marketplace")));
    await tx
      .update(marketplaceBookingAttempts)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(eq(marketplaceBookingAttempts.reservationId, reservation.id));
    await tx.insert(reservationActivity).values({
      reservationId: reservation.id,
      activityType: "cancelled",
      metadata: {
        previousStatus: reservation.status,
        source: "marketplace",
      },
      createdAt: new Date(),
    });
  });

  await params.adapter.releasePendingPayments({
    reservationId: reservation.id,
    stripeAccountId: reservation.store.stripeAccountId,
  });
  await params.adapter.runCancellationSideEffects(reservation.id);

  return getMarketplaceBooking({
    reservationId: reservation.id,
    getCanonicalUrl: params.getCanonicalUrl,
  });
}

type MarketplaceAttemptTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function expireAttempt(
  tx: MarketplaceAttemptTransaction,
  reservationId: string,
): Promise<void> {
  const now = new Date();
  await tx
    .update(marketplaceBookingAttempts)
    .set({ status: "expired", expiresAt: now, updatedAt: now })
    .where(eq(marketplaceBookingAttempts.reservationId, reservationId));
  await tx
    .update(reservations)
    .set({ status: "cancelled", updatedAt: now })
    .where(
      and(
        eq(reservations.id, reservationId),
        eq(reservations.source, "marketplace"),
        eq(reservations.status, "pending"),
      ),
    );
}

export async function expireMarketplaceBookingAttempts(params: {
  reservationId?: string;
  storeId?: string;
}): Promise<void> {
  const conditions = [
    inArray(marketplaceBookingAttempts.status, ["creating_hold", "holding", "checkout_pending"]),
    lte(marketplaceBookingAttempts.expiresAt, new Date()),
  ];
  if (params.reservationId) {
    conditions.push(eq(marketplaceBookingAttempts.reservationId, params.reservationId));
  }
  if (params.storeId) {
    conditions.push(eq(marketplaceBookingAttempts.storeId, params.storeId));
  }
  const expired = await db
    .select({ reservationId: marketplaceBookingAttempts.reservationId })
    .from(marketplaceBookingAttempts)
    .where(and(...conditions));

  for (const attempt of expired) {
    if (!attempt.reservationId) continue;
    const reservationId = attempt.reservationId;
    await db.transaction((tx) => expireAttempt(tx, reservationId));
  }
}

export async function confirmMarketplaceBookingAttempt(reservationId: string): Promise<void> {
  await db
    .update(marketplaceBookingAttempts)
    .set({ status: "confirmed", updatedAt: new Date() })
    .where(eq(marketplaceBookingAttempts.reservationId, reservationId));
}

export async function failMarketplaceBookingAttempt(reservationId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const attempt = await tx.query.marketplaceBookingAttempts.findFirst({
      where: eq(marketplaceBookingAttempts.reservationId, reservationId),
      columns: { reservationId: true, status: true },
    });
    const reservation = await tx.query.reservations.findFirst({
      where: and(
        eq(reservations.id, reservationId),
        eq(reservations.source, "marketplace"),
        eq(reservations.status, "pending"),
      ),
      columns: { id: true },
    });
    if (attempt?.reservationId && attempt.status === "checkout_pending" && reservation) {
      await expireAttempt(tx, attempt.reservationId);
    }
  });
}
