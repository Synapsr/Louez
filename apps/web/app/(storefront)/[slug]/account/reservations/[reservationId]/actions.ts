"use server";

import { changeCustomerReservationStatus } from "@louez/api/services/customer-reservation-status";

import { ApiServiceError, signReservationAsCustomer } from "@louez/api/services";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db, reservations, stores, verificationCodes } from "@louez/db";
import { STORE_NOT_ACCEPTING_RESERVATIONS_ERROR } from "@louez/types";

import { runReservationEffects } from "@/lib/billing/reservation-effects";
import { logReservationGateRefusal } from "@/lib/billing/reservation-gate";
import { renterGateRefusalParams } from "@/lib/billing/reservation-gate-error";
import { dispatchCustomerNotification } from "@/lib/notifications/customer-dispatcher";
import { dispatchNotification } from "@/lib/notifications/dispatcher";
import {
  captureProductServerEvent,
  toAnalyticsAmountCents,
} from "@/lib/product-analytics/analytics";
import { productAnalyticsEvents } from "@/lib/product-analytics/analytics-events";
import { z } from "zod";

import { createReservationInstantAccessUrl } from "@/lib/customer-auth/instant-access";
import { getCustomerSession } from "@/lib/customer-auth/session";
import { reservationCurrency } from "@/lib/reservations/payment-billing-facts";
import { createReservationPaymentSessionForCustomer } from "@/lib/reservations/payment-session";
import {
  canAuthorizeDepositOnline,
  getCustomerDepositView,
} from "@/lib/reservations/util.customer-deposit";
import { getEffectiveReservationMode } from "@/lib/reservation-mode";
import { log } from "@/lib/evlog";
import { cancelTulipContractForReservation } from "@/lib/integrations/tulip/contracts";
import { generateContract } from "@/lib/pdf/generate";
import { canSignContract } from "@/lib/reservations/util.reservation-actions";
import { getStorefrontUrl } from "@/lib/storefront-url";

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const reservationActionInputSchema = z.object({
  storeSlug: z.string().trim().min(1).max(255),
  reservationId: z.string().length(21),
});

/**
 * The full store row (owner notification channels included) and the
 * customer session scoped to it. Error keys are bare (`tErrors(key)`).
 */
const resolveCustomerStore = async (storeSlug: string) => {
  const store = await db.query.stores.findFirst({
    where: eq(stores.slug, storeSlug),
  });
  if (!store) return { error: "storeNotFound" as const };

  const session = await getCustomerSession(store.id);
  if (!session) return { error: "unauthorized" as const };

  return { store, session };
};

export async function createReservationPaymentSession(storeSlug: string, reservationId: string) {
  const parsed = reservationActionInputSchema.safeParse({
    storeSlug,
    reservationId,
  });
  if (!parsed.success) return { error: "invalidData" };

  const resolved = await resolveCustomerStore(parsed.data.storeSlug);
  if ("error" in resolved) return { error: resolved.error };

  return createReservationPaymentSessionForCustomer(
    parsed.data.storeSlug,
    parsed.data.reservationId,
    resolved.session.customerId,
    "account_page",
  );
}

/** The customer signs the contract from their account: the date and their IP are recorded. */
export async function signContract(storeSlug: string, reservationId: string) {
  const parsed = reservationActionInputSchema.safeParse({
    storeSlug,
    reservationId,
  });
  if (!parsed.success) return { error: "invalidData" };

  const resolved = await resolveCustomerStore(parsed.data.storeSlug);
  if ("error" in resolved) return { error: resolved.error };
  const { store, session } = resolved;

  const reservation = await db.query.reservations.findFirst({
    where: and(
      eq(reservations.id, parsed.data.reservationId),
      eq(reservations.storeId, store.id),
      eq(reservations.customerId, session.customerId),
    ),
    columns: { status: true, signedAt: true },
  });
  if (!reservation) return { error: "reservationNotFound" };

  if (!canSignContract(reservation.status, reservation.signedAt !== null)) {
    return { error: "contractNotSignable" };
  }

  try {
    await signReservationAsCustomer({
      reservationId: parsed.data.reservationId,
      storeId: store.id,
      customerId: session.customerId,
      headers: await headers(),
      regenerateContract: async (id) => {
        await generateContract({ reservationId: id, regenerate: true });
      },
    });
  } catch (error) {
    // Cancelled or closed meanwhile.
    if (error instanceof ApiServiceError && error.key === "errors.contractNotSignable") {
      return { error: "contractNotSignable" };
    }
    // Signed meanwhile (a second tab), or signed but the PDF failed: the signature holds,
    // and the contract is rebuilt on its next download.
    const signed =
      error instanceof ApiServiceError &&
      ["errors.contractAlreadySigned", "errors.contractGenerationFailed"].includes(error.key);
    if (!signed) {
      log.error("reservation", `customer signature failed: ${describeError(error)}`);
      return { error: "generic" };
    }
  }

  revalidatePath(`/${storeSlug}/account`);
  revalidatePath(`/${storeSlug}/account/reservations/${reservationId}`);
  return { success: true };
}

export async function acceptQuote(storeSlug: string, reservationId: string) {
  const parsed = reservationActionInputSchema.safeParse({
    storeSlug,
    reservationId,
  });
  if (!parsed.success) return { error: "invalidData" };

  const resolved = await resolveCustomerStore(parsed.data.storeSlug);
  if ("error" in resolved) return { error: resolved.error };
  const { store, session } = resolved;

  let paymentUrl: string | null = null;
  // The fee comes after the payment session: the session takes the fee at source
  // only while no fee row exists. The entry attempts the fee after `beforeFee`,
  // even when the session throws. Once paid, the webhook turns this manual fee
  // into a collected one.
  const result = await changeCustomerReservationStatus(
    { storeId: store.id, customerId: session.customerId, runReservationEffects },
    { action: "accept_quote", reservationId },
    {
      beforeFee: async (reservation) => {
        await captureProductServerEvent({
          distinctId: session.customerId,
          event: productAnalyticsEvents.quoteAccepted,
          properties: {
            feature: "customer_account",
            surface: "storefront",
            store_id: store.id,
            reservation_id: reservationId,
            customer_id: session.customerId,
            source: "customer_account",
            reservation_mode: getEffectiveReservationMode(store),
            catalog_line_count: reservation.items.length,
            total_amount_cents: toAnalyticsAmountCents(reservation.totalAmount),
            deposit_amount_cents: toAnalyticsAmountCents(reservation.depositAmount),
            currency: reservationCurrency(reservation.currency, store.settings),
          },
        });

        if (getEffectiveReservationMode(store) === "payment") {
          const paymentSession = await createReservationPaymentSessionForCustomer(
            storeSlug,
            reservationId,
            session.customerId,
            "quote_acceptance",
          );
          if (paymentSession.success) {
            paymentUrl = paymentSession.paymentUrl;
          } else if (paymentSession.error !== "errors.alreadyPaid") {
            log.error(
              "reservation",
              `quote payment session failed (${reservationId}): ${paymentSession.error}`,
            );
          }
        }
      },
    },
  );
  if (!result.ok) {
    // The card gate (README §8.4): the renter sees the generic text and the store's
    // contact, no reason.
    if ("gate" in result) {
      logReservationGateRefusal(result.gate, "quote_acceptance");
      return {
        error: STORE_NOT_ACCEPTING_RESERVATIONS_ERROR,
        errorParams: renterGateRefusalParams(store),
      };
    }
    return { error: result.error };
  }
  const { reservation } = result;

  // Notify the store owner
  dispatchNotification("reservation_confirmed", {
    actor: "customer",
    store: {
      id: store.id,
      name: store.name,
      email: store.email,
      discordWebhookUrl: store.discordWebhookUrl,
      ownerPhone: store.ownerPhone,
      notificationSettings: store.notificationSettings,
      settings: store.settings,
    },
    reservation: {
      id: reservationId,
      number: reservation.number,
      startDate: reservation.startDate,
      endDate: reservation.endDate,
      totalAmount: parseFloat(reservation.totalAmount),
      currency: reservation.currency,
    },
    customer: {
      firstName: reservation.customer.firstName,
      lastName: reservation.customer.lastName,
      email: reservation.customer.email,
      phone: reservation.customer.phone,
    },
  }).catch((error) => {
    log.error("reservation", `quote accepted notification failed: ${describeError(error)}`);
  });

  // Notify the customer with confirmation email
  const reservationUrl = getStorefrontUrl(storeSlug, `/account/reservations/${reservationId}`);

  const emailItems = reservation.items.map((item) => ({
    name: item.productSnapshot?.name || "Product",
    quantity: item.quantity,
    unitPrice: parseFloat(item.unitPrice),
    totalPrice: parseFloat(item.totalPrice),
  }));

  try {
    const contractUrl = await createReservationInstantAccessUrl({
      storeId: store.id,
      storeSlug,
      customerEmail: reservation.customer.email,
      reservationId,
      redirectPath: `/account/reservations/${reservationId}/contract`,
    });
    const termsUrl = store.cgv?.trim() ? getStorefrontUrl(storeSlug, "/terms") : null;

    dispatchCustomerNotification("customer_quote_accepted", {
      store: {
        id: store.id,
        name: store.name,
        email: store.email,
        logoUrl: store.logoUrl,
        darkLogoUrl: store.darkLogoUrl,
        address: store.address,
        phone: store.phone,
        theme: store.theme,
        settings: store.settings,
        emailSettings: store.emailSettings,
        customerNotificationSettings: store.customerNotificationSettings,
      },
      customer: {
        id: reservation.customer.id,
        firstName: reservation.customer.firstName,
        lastName: reservation.customer.lastName,
        email: reservation.customer.email,
        phone: reservation.customer.phone,
      },
      reservation: {
        id: reservationId,
        number: reservation.number,
        startDate: reservation.startDate,
        endDate: reservation.endDate,
        totalAmount: parseFloat(reservation.totalAmount),
        subtotalAmount: parseFloat(reservation.subtotalAmount),
        depositAmount: parseFloat(reservation.depositAmount),
        currency: reservation.currency,
      },
      items: emailItems,
      reservationUrl,
      contractUrl,
      termsUrl,
      paymentUrl,
    }).catch((error) => {
      log.error("reservation", `quote accepted customer email failed: ${describeError(error)}`);
    });
  } catch (error) {
    log.error("reservation", `quote accepted customer email failed: ${describeError(error)}`);
  }

  revalidatePath(`/${storeSlug}/account`);
  revalidatePath(`/${storeSlug}/account/reservations/${reservationId}`);
  return { success: true, paymentUrl };
}

export async function declineQuote(storeSlug: string, reservationId: string) {
  const parsed = reservationActionInputSchema.safeParse({
    storeSlug,
    reservationId,
  });
  if (!parsed.success) return { error: "invalidData" };

  const resolved = await resolveCustomerStore(parsed.data.storeSlug);
  if ("error" in resolved) return { error: resolved.error };
  const { store, session } = resolved;

  // The entry voids the fee once the quote is declined, before anything below.
  const result = await changeCustomerReservationStatus(
    { storeId: store.id, customerId: session.customerId, runReservationEffects },
    { action: "decline_quote", reservationId },
  );
  if (!result.ok) return { error: result.error };
  const { reservation } = result;

  await captureProductServerEvent({
    distinctId: session.customerId,
    event: productAnalyticsEvents.quoteDeclined,
    properties: {
      feature: "customer_account",
      surface: "storefront",
      store_id: store.id,
      reservation_id: reservationId,
      customer_id: session.customerId,
      source: "customer_account",
      total_amount_cents: toAnalyticsAmountCents(reservation.totalAmount),
      currency: reservationCurrency(reservation.currency, store.settings),
    },
  });

  // Notify the store owner
  dispatchNotification("reservation_cancelled", {
    actor: "customer",
    quoteDeclined: true,
    store: {
      id: store.id,
      name: store.name,
      email: store.email,
      discordWebhookUrl: store.discordWebhookUrl,
      ownerPhone: store.ownerPhone,
      notificationSettings: store.notificationSettings,
      settings: store.settings,
    },
    reservation: {
      id: reservationId,
      number: reservation.number,
      startDate: reservation.startDate,
      endDate: reservation.endDate,
      totalAmount: parseFloat(reservation.totalAmount),
      currency: reservation.currency,
    },
    customer: {
      firstName: reservation.customer.firstName,
      lastName: reservation.customer.lastName,
      email: reservation.customer.email,
      phone: reservation.customer.phone,
    },
  }).catch((error) => {
    log.error("reservation", `quote declined notification failed: ${describeError(error)}`);
  });

  revalidatePath(`/${storeSlug}/account`);
  revalidatePath(`/${storeSlug}/account/reservations/${reservationId}`);
  return { success: true };
}

export async function cancelReservationRequest(
  storeSlug: string,
  reservationId: string,
  acknowledgePayment = false,
) {
  const parsed = reservationActionInputSchema
    .extend({ acknowledgePayment: z.boolean() })
    .safeParse({ storeSlug, reservationId, acknowledgePayment });
  if (!parsed.success) return { error: "invalidData" };
  const resolved = await resolveCustomerStore(parsed.data.storeSlug);
  if ("error" in resolved) return { error: resolved.error };
  const { store, session } = resolved;
  const { reservationId: id } = parsed.data;

  // The entry voids the fee once the request is cancelled, before anything below.
  const result = await changeCustomerReservationStatus(
    { storeId: store.id, customerId: session.customerId, runReservationEffects },
    {
      action: "cancel_request",
      reservationId: id,
      acknowledgePayment: parsed.data.acknowledgePayment,
    },
  );
  if (!result.ok) return { error: result.error };

  if (result.changed) {
    const { reservation } = result;
    if (reservation.tulipContractId) {
      try {
        await cancelTulipContractForReservation({
          reservationId: reservation.id,
        });
      } catch (error) {
        log.error("reservation", `request insurance cancellation failed: ${describeError(error)}`);
      }
    }
    try {
      await dispatchNotification("reservation_cancelled", {
        actor: "customer",
        store,
        reservation: {
          id: reservation.id,
          number: reservation.number,
          startDate: reservation.startDate,
          endDate: reservation.endDate,
          totalAmount: Number(reservation.totalAmount),
          currency: reservation.currency,
        },
        customer: reservation.customer,
      });
    } catch (error) {
      log.error("reservation", `request cancellation notification failed: ${describeError(error)}`);
    }
  }
  revalidatePath(`/${store.slug}/account`);
  revalidatePath(`/${store.slug}/account/reservations/${id}`);
  revalidatePath("/dashboard/reservations");
  revalidatePath(`/dashboard/reservations/${id}`);
  return { success: true };
}

/** The authorisation link stays valid long enough for a 3DS round trip. */
const DEPOSIT_AUTHORIZATION_LINK_TTL_MS = 60 * 60 * 1000;

/**
 * Mints a one-hour access token and returns the deposit authorisation page
 * URL for the customer's own reservation, under the same window the page
 * applies: card payments on, reservation confirmed or under way, no live
 * hold, pickup within the hold's lifetime.
 */
export async function createDepositAuthorizationLink(
  storeSlug: string,
  reservationId: string,
): Promise<{ url: string } | { error: string }> {
  const parsed = reservationActionInputSchema.safeParse({ storeSlug, reservationId });
  if (!parsed.success) return { error: "invalidData" as const };

  const resolved = await resolveCustomerStore(parsed.data.storeSlug);
  if (resolved.error !== undefined) return { error: resolved.error };
  const { store, session } = resolved;

  const reservation = await db.query.reservations.findFirst({
    columns: {
      id: true,
      status: true,
      startDate: true,
      depositAmount: true,
      depositStatus: true,
      depositAuthorizationExpiresAt: true,
    },
    where: and(
      eq(reservations.id, parsed.data.reservationId),
      eq(reservations.storeId, store.id),
      eq(reservations.customerId, session.customerId),
    ),
    with: {
      payments: {
        columns: {
          type: true,
          status: true,
          method: true,
          amount: true,
          notes: true,
          paidAt: true,
          createdAt: true,
        },
      },
    },
  });
  if (!reservation) return { error: "reservationNotFound" as const };

  const allowed = canAuthorizeDepositOnline({
    view: getCustomerDepositView(reservation),
    status: reservation.status,
    startDate: reservation.startDate,
    stripeActive: Boolean(store.stripeAccountId) && store.stripeChargesEnabled === true,
  });
  if (!allowed) return { error: "depositAuthorizationUnavailable" as const };

  const token = nanoid(64);
  const now = new Date();
  await db.insert(verificationCodes).values({
    id: nanoid(),
    email: session.customer.email,
    storeId: store.id,
    code: "",
    type: "instant_access",
    token,
    reservationId: reservation.id,
    expiresAt: new Date(now.getTime() + DEPOSIT_AUTHORIZATION_LINK_TTL_MS),
    createdAt: now,
  });

  return {
    url: getStorefrontUrl(
      store.slug,
      `/authorize-deposit/${reservation.id}?token=${encodeURIComponent(token)}`,
    ),
  };
}
