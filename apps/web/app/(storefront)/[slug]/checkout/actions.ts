"use server";

import { cookies, headers } from "next/headers";

import { eq } from "drizzle-orm";
import { z } from "zod";

import { env as authEnv } from "@louez/auth/env";
import { db, stores } from "@louez/db";
import type { TulipPublicMode } from "@louez/types";
import {
  companySearchSchema,
  createReservationCustomerSchema,
  createReservationInputSchema,
} from "@louez/validations";

import { getCustomerSession } from "@/lib/customer-auth/session";
import { log } from "@/lib/evlog";
import { getClientIp } from "@/lib/request";
import { getStorefrontTestMode } from "@/lib/test-reservations/storefront-test-mode";
import { SALES_CHANNEL_COOKIE, salesChannelFromCookie } from "@/lib/util.sales-channel";
import { PARTNER_COOKIE, readPartnerCookie } from "@/lib/partners/partner-cookie";
import { dispatchApiEffects } from "@/lib/api/effects";
import type { PartnerCodeCheck } from "@louez/api/contracts/partners";
import {
  attributeReservation,
  checkStorefrontPartnerCode,
  resolveCheckoutCredit,
  type CheckoutCredit,
} from "@louez/api/services/partners";
import { getTulipCoverageSummary } from "@/lib/integrations/tulip/contracts";
import {
  searchFrenchCompanies,
  type CompanySearchResult,
} from "@louez/api/adapters/company-registry";
import { createReservation as createReservationInternal } from "@/lib/reservations/create-reservation";
import type {
  ReservationErrorParams,
  ReservationFailureDetails,
} from "@louez/api/services/reservation-failure";
import {
  getRequestedTulipOptIn,
  getTulipCheckoutMode,
  resolveTulipInsurance,
  type TulipInsuranceResolution,
} from "@/lib/reservations/resolve-tulip-insurance";

const checkoutCompanySearchSchema = z.object({
  storeId: z.string().min(1).max(64),
  query: companySearchSchema.shape.query,
});

/**
 * Company lookup that prefills the business buyer's legal name and SIREN at
 * checkout. Public on purpose (the storefront has no session) but scoped to a
 * store, and only answered when that store operates in France — the registry
 * is French-only. Any failure returns an empty list: typing the SIREN by hand
 * must always stay possible.
 */
export async function searchCheckoutCompanyRegistry(input: {
  storeId: string;
  query: string;
}): Promise<{ results: CompanySearchResult[] }> {
  const validated = checkoutCompanySearchSchema.safeParse(input);
  if (!validated.success) {
    return { results: [] };
  }

  const store = await db.query.stores.findFirst({
    where: eq(stores.id, validated.data.storeId),
    columns: { id: true, settings: true },
  });

  if (!store || (store.settings?.country ?? "FR") !== "FR") {
    return { results: [] };
  }

  const search = await searchFrenchCompanies(validated.data.query);
  if (!search.ok) {
    log.warn("recherche-entreprises", search.reason);
    return { results: [] };
  }
  return { results: search.results };
}

const tulipQuotePreviewSchema = z.object({
  storeId: z.string().min(1).max(64),
  modeOverride: z.enum(["required", "optional", "no_public"]).optional(),
  customer: createReservationCustomerSchema
    .pick({
      customerType: true,
      companyName: true,
      firstName: true,
      lastName: true,
      phone: true,
      address: true,
      city: true,
      postalCode: true,
    })
    .extend({
      // The quote form runs before the address step; a partial identity is fine.
      email: z.string().trim().max(320),
      firstName: z.string().trim().max(255),
      lastName: z.string().trim().max(255),
    }),
  items: z
    .array(
      z.object({
        productId: z.string().min(1).max(64),
        quantity: z.number().int().min(1).max(999),
      }),
    )
    .min(1)
    .max(50),
  startDate: z.string().refine((value) => Number.isFinite(Date.parse(value))),
  endDate: z.string().refine((value) => Number.isFinite(Date.parse(value))),
  tulipInsuranceOptIn: z.boolean().optional(),
});

type TulipQuotePreviewResult = TulipInsuranceResolution & { error: string | null };

const unavailableTulipQuote = (
  mode: TulipPublicMode,
  connected: boolean,
  requestedOptIn: boolean,
  error: string,
  coverage: {
    insuredProductCount: number;
    uninsuredProductCount: number;
    insuredProductIds: string[];
  },
): TulipQuotePreviewResult => ({
  mode,
  connected,
  inclusionEnabled: false,
  quoteUnavailable: true,
  quoteError: error,
  requestedOptIn,
  appliedOptIn: false,
  amount: 0,
  ...coverage,
  error,
});

/** Live insurance quote shown on the checkout before the reservation exists. */
export async function getTulipQuotePreview(input: unknown): Promise<TulipQuotePreviewResult> {
  const parsed = tulipQuotePreviewSchema.safeParse(input);
  if (!parsed.success) {
    return unavailableTulipQuote("no_public", false, false, "errors.invalidData", {
      insuredProductCount: 0,
      uninsuredProductCount: 0,
      insuredProductIds: [],
    });
  }
  const data = parsed.data;

  const store = await db.query.stores.findFirst({
    where: eq(stores.id, data.storeId),
    columns: { id: true, settings: true },
  });
  if (!store) {
    return unavailableTulipQuote("no_public", false, false, "errors.storeNotFound", {
      insuredProductCount: 0,
      uninsuredProductCount: 0,
      insuredProductIds: [],
    });
  }

  // A test checkout (lib/test-reservations), read from the signed cookie: never
  // insured, and Tulip never asked.
  const testMode = await getStorefrontTestMode(store.id);

  try {
    const quote = await resolveTulipInsurance({
      storeId: store.id,
      testReservation: testMode !== null,
      modeOverride: data.modeOverride,
      customer: data.customer,
      items: data.items,
      startDate: new Date(data.startDate),
      endDate: new Date(data.endDate),
      tulipInsuranceOptIn: data.tulipInsuranceOptIn,
      fallbackCountry: store.settings?.country || "FR",
    });
    return { ...quote, error: null };
  } catch (error) {
    const modeInfo = await getTulipCheckoutMode(store.id, data.modeOverride);
    const coverage = await getTulipCoverageSummary(data.items);
    const errorKey =
      error instanceof Error && error.message.startsWith("errors.")
        ? error.message
        : "errors.tulipQuoteFailed";

    log.warn({
      tulip: {
        event: "checkout_preview_fallback",
        storeId: store.id,
        mode: modeInfo.mode,
        error: errorKey,
      },
    });

    return unavailableTulipQuote(
      modeInfo.mode,
      modeInfo.connected,
      getRequestedTulipOptIn(modeInfo.mode, data.tulipInsuranceOptIn),
      errorKey,
      coverage,
    );
  }
}

/**
 * Result shape the current checkout client reads (`result.error` and
 * `result.reservationId` on the same union). The `?: undefined` members keep
 * that access legal until WS-11 switches the client to the discriminated
 * `ok` result of the internal function.
 */
export type CreateReservationActionResult =
  | {
      success?: undefined;
      error: string;
      errorParams?: ReservationErrorParams;
      details?: ReservationFailureDetails;
      reservationId?: undefined;
      reservationNumber?: undefined;
      paymentUrl?: undefined;
      customerId?: undefined;
      instantAccessUrl?: undefined;
    }
  | {
      success: true;
      reservationId: string;
      reservationNumber: string;
      paymentUrl: string | null;
      customerId: string;
      /** Token URL to /r/{id}: a test request lands its owner on it signed in. */
      instantAccessUrl: string | null;
      error?: undefined;
      errorParams?: undefined;
      details?: undefined;
    };

/**
 * True when the buyer is signed in to this store's customer account under
 * the checkout's e-mail. Read from the session cookie only: a client flag
 * could let anyone overwrite another customer's custom field values.
 */
const isSignedInAs = async (storeId: string, email: string): Promise<boolean> => {
  const session = await getCustomerSession(storeId);
  return session?.customer.email.trim().toLowerCase() === email.trim().toLowerCase();
};

const checkPartnerCodeSchema = z.object({
  storeId: z.string().min(1).max(64),
  code: z.string().min(1).max(60),
});

/**
 * A partner's code typed at checkout (Liens partenaires): the partner's name
 * and what the customer sees of its perk, never the perk's promo code. Public,
 * so rate limited per IP and per store (`PARTNER_CODE_CHECK_LIMITS`); an
 * unknown store answers as an unknown code does.
 */
export async function checkPartnerCode(input: unknown): Promise<PartnerCodeCheck> {
  const parsed = checkPartnerCodeSchema.safeParse(input);
  if (!parsed.success) return { status: "not_found" };
  return checkStorefrontPartnerCode({ ...parsed.data, ip: getClientIp(await headers()) });
}

const logPartnerFailure = (
  event: "credit_unresolved" | "attribution_failed",
  storeId: string,
  error: unknown,
  reservationId?: string,
) =>
  log.warn({
    partner: {
      event,
      storeId,
      ...(reservationId ? { reservationId } : {}),
      error: error instanceof Error ? error.message : String(error),
    },
  });

/**
 * The partner a storefront booking credits (docs/product/liens-partenaires.md):
 * the code the customer typed, else the partner link the storefront's cookie
 * remembers, with its perk's promo code. Null when there is none, or when it
 * cannot be read: a reservation is worth more than its attribution.
 */
const resolvePartnerCredit = async (input: {
  storeId: string;
  typedCode: string | undefined;
  cookieValue: string | undefined;
}) => {
  try {
    let link: { code: string; clickedAt: Date } | null = null;
    if (input.cookieValue) {
      const store = await db.query.stores.findFirst({
        where: eq(stores.id, input.storeId),
        columns: { slug: true },
      });
      link = store ? readPartnerCookie(input.cookieValue, store.slug, authEnv.AUTH_SECRET) : null;
    }
    return await resolveCheckoutCredit({
      storeId: input.storeId,
      typedCode: input.typedCode,
      link,
    });
  } catch (error) {
    logPartnerFailure("credit_unresolved", input.storeId, error);
    return null;
  }
};

/**
 * Credits the partner with the reservation, within the store's window for a
 * link. Never fails the checkout: the store can still set it by hand.
 */
const creditPartner = async (storeId: string, reservationId: string, credit: CheckoutCredit) => {
  try {
    const { effectIds } = await attributeReservation({ storeId, reservationId, ...credit });
    dispatchApiEffects(effectIds);
  } catch (error) {
    logPartnerFailure("attribution_failed", storeId, error, reservationId);
  }
};

/** The partner's perk was kept at checkout but can no longer be used. */
const PARTNER_PERK_UNAVAILABLE = "errors.partnerPerkUnavailable";

/**
 * Public checkout submission. The payload is validated with Zod, the source
 * is always "online" (trusted callers use the internal function), and the
 * result keeps the shape the current client reads: `error`/`errorParams`/
 * `details` on failure, `success` plus ids and URLs otherwise. A renter who
 * came from reeent books as "online" too; the storefront's channel cookie
 * only records the sales channel, never the fee.
 */
export async function createReservation(input: unknown): Promise<CreateReservationActionResult> {
  const parsed = createReservationInputSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "errors.invalidData" };
  }

  // Test mode is read from its signed cookie only (lib/test-reservations).
  const testMode = await getStorefrontTestMode(parsed.data.storeId);
  const cookieStore = await cookies();
  const { partnerCode, partnerPerk, ...reservationInput } = parsed.data;

  // A test checkout credits no partner. The perk the customer kept is the
  // partner's promo code, applied here: the storefront never sees it.
  const partner = testMode
    ? null
    : await resolvePartnerCredit({
        storeId: parsed.data.storeId,
        typedCode: partnerCode,
        cookieValue: cookieStore.get(PARTNER_COOKIE)?.value,
      });
  let promoCode = reservationInput.promoCode;
  if (partnerPerk && !promoCode) {
    if (!partner?.perkPromoCode) return { error: PARTNER_PERK_UNAVAILABLE };
    promoCode = partner.perkPromoCode;
  }

  const result = await createReservationInternal({
    ...reservationInput,
    promoCode,
    source: "online",
    salesChannel: salesChannelFromCookie(cookieStore.get(SALES_CHANNEL_COOKIE)?.value),
    customerSignedIn: testMode
      ? false
      : await isSignedInAs(parsed.data.storeId, parsed.data.customer.email),
    termsAcceptedFromIp: getClientIp(await headers()),
    ...(testMode ? { testMode: { userId: testMode.userId, ownerEmail: testMode.ownerEmail } } : {}),
  });

  if (!result.ok) {
    return {
      error: result.error,
      ...(result.params ? { errorParams: result.params } : {}),
      ...(result.details ? { details: result.details } : {}),
    };
  }

  if (partner) await creditPartner(parsed.data.storeId, result.reservationId, partner.credit);

  return {
    success: true,
    reservationId: result.reservationId,
    reservationNumber: result.reservationNumber,
    paymentUrl: result.paymentUrl,
    customerId: result.customerId,
    instantAccessUrl: result.instantAccessUrl,
  };
}
