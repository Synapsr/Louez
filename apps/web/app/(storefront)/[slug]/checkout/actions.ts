"use server";

import { cookies, headers } from "next/headers";

import { eq } from "drizzle-orm";
import { z } from "zod";

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
import { PARTNER_COOKIE, partnerCodeFromCookie } from "@/lib/partners/partner-cookie";
import { attributeReservationFromLink } from "@louez/api/services/partners";
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

/**
 * Credits the partner the customer agreed to on its link (the storefront's
 * partner cookie, docs/product/liens-partenaires.md). Never fails the
 * checkout: a reservation is worth more than its attribution, which the
 * store can still set by hand.
 */
const creditPartner = async (
  storeId: string,
  reservationId: string,
  cookieValue: string | undefined | null,
): Promise<void> => {
  const code = partnerCodeFromCookie(cookieValue ?? undefined, storeId);
  if (!code) return;
  try {
    await attributeReservationFromLink({ storeId, reservationId, code });
  } catch (error) {
    log.warn({
      partner: {
        event: "attribution_failed",
        storeId,
        reservationId,
        error: error instanceof Error ? error.message : String(error),
      },
    });
  }
};

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
  const result = await createReservationInternal({
    ...parsed.data,
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

  await creditPartner(
    parsed.data.storeId,
    result.reservationId,
    testMode ? null : cookieStore.get(PARTNER_COOKIE)?.value,
  );

  return {
    success: true,
    reservationId: result.reservationId,
    reservationNumber: result.reservationNumber,
    paymentUrl: result.paymentUrl,
    customerId: result.customerId,
    instantAccessUrl: result.instantAccessUrl,
  };
}
