/**
 * Review Booster Automation Service
 *
 * Handles automatic sending of thank-you emails/SMS with review links
 * after rentals are completed.
 */

import { db } from "@louez/db";
import { reservations, customers, reviewRequestLogs } from "@louez/db";
import { eq, and, lte, gte, inArray, sql } from "drizzle-orm";
import { sendThankYouReviewSms } from "@/lib/sms/send";
import { isSmsConfigured } from "@/lib/sms/client";
import { logCustomerMessageSkipped } from "@/lib/reservations/log-customer-message";
import { getCustomerMessageChannel } from "@/lib/reservations/util.customer-message-channel";
import { buildReviewUrl } from "@/lib/google-places";
import { sendThankYouReviewEmail } from "@/lib/email/send";
import { getLocaleFromCountry, type EmailLocale } from "@/lib/email/i18n";
import { getStorefrontUrl } from "@/lib/storefront-url";
import type { ReviewBoosterSettings } from "@louez/types";

// Maximum window for eligible reservations (prevents mass sending on feature activation)
// Only reservations returned within the last 24 hours are eligible
const MAX_ELIGIBILITY_WINDOW_MS = 24 * 60 * 60 * 1000; // 1 day

/**
 * Build a short review URL for SMS
 * Example: https://ddm.louez.io/review
 */
function buildShortReviewUrl(storeSlug: string): string {
  return getStorefrontUrl(storeSlug, "/review");
}

interface ProcessResult {
  processed: number;
  emailsSent: number;
  smsSent: number;
  errors: string[];
}

/**
 * Process pending review requests for all stores
 * This should be called by a cron job (e.g., every hour)
 */
export async function processReviewRequests(): Promise<ProcessResult> {
  const result: ProcessResult = {
    processed: 0,
    emailsSent: 0,
    smsSent: 0,
    errors: [],
  };

  try {
    // Get all stores with review booster enabled
    const storesWithReviewBooster = await db.query.stores.findMany({
      where: sql`JSON_EXTRACT(review_booster_settings, '$.enabled') = true`,
    });

    for (const store of storesWithReviewBooster) {
      const settings = store.reviewBoosterSettings as ReviewBoosterSettings | null;
      if (!settings?.googlePlaceId) continue;

      // Full Google URL for emails (more trustworthy)
      const fullReviewUrl = buildReviewUrl(settings.googlePlaceId);
      // Short URL for SMS (saves characters)
      const shortReviewUrl = buildShortReviewUrl(store.slug);
      // Get locale from store's country (from store settings)
      const storeSettings = store.settings as { country?: string } | null;
      const locale = getLocaleFromCountry(storeSettings?.country);

      // Process email requests
      if (settings.autoSendThankYouEmail) {
        const emailResult = await processEmailRequests(
          store,
          settings,
          { email: fullReviewUrl, sms: shortReviewUrl },
          locale,
        );
        result.emailsSent += emailResult.sent;
        result.smsSent += emailResult.smsSent;
        result.errors.push(...emailResult.errors);
      }

      // Process SMS requests
      if (settings.autoSendThankYouSms) {
        const smsResult = await processSmsRequests(store, settings, shortReviewUrl, locale);
        result.smsSent += smsResult.sent;
        result.errors.push(...smsResult.errors);
      }

      result.processed++;
    }
  } catch (error) {
    result.errors.push(`Global error: ${error instanceof Error ? error.message : "Unknown error"}`);
  }

  return result;
}

/**
 * Process email review requests for a store
 */
async function processEmailRequests(
  store: {
    id: string;
    name: string;
    logoUrl: string | null;
    email: string | null;
    phone: string | null;
    address: string | null;
    theme: { primaryColor?: string } | null;
  },
  settings: ReviewBoosterSettings,
  reviewUrls: { email: string; sms: string },
  locale: EmailLocale,
): Promise<{ sent: number; smsSent: number; errors: string[] }> {
  const result = { sent: 0, smsSent: 0, errors: [] as string[] };
  const delayMs = settings.emailDelayHours * 60 * 60 * 1000;
  const cutoffDate = new Date(Date.now() - delayMs);
  const maxAgeDate = new Date(Date.now() - MAX_ELIGIBILITY_WINDOW_MS);

  // Find completed reservations that need email review request
  // - returnedAt is before cutoff (delay has passed)
  // - returnedAt is within the eligibility window (prevents mass sending on activation)
  // - no email review request has been sent yet
  const eligibleReservations = await db
    .select({
      reservation: reservations,
      customer: customers,
    })
    .from(reservations)
    .innerJoin(customers, eq(customers.id, reservations.customerId))
    .where(
      and(
        eq(reservations.storeId, store.id),
        eq(reservations.status, "completed"),
        lte(reservations.returnedAt, cutoffDate),
        gte(reservations.returnedAt, maxAgeDate),
      ),
    )
    .limit(50); // Process in batches

  // Filter out reservations that already have an email sent
  const reservationIds = eligibleReservations.map((r) => r.reservation.id);
  if (reservationIds.length === 0) return result;

  const existingLogs = await db.query.reviewRequestLogs.findMany({
    where: inArray(reviewRequestLogs.reservationId, reservationIds),
  });
  const sentReservationIds = new Set(
    existingLogs.filter((l) => l.channel === "email").map((l) => l.reservationId),
  );
  const smsSentReservationIds = new Set(
    existingLogs.filter((l) => l.channel === "sms").map((l) => l.reservationId),
  );

  for (const { reservation, customer } of eligibleReservations) {
    if (sentReservationIds.has(reservation.id)) continue;

    const customerEmail = customer.email;
    if (!customerEmail) {
      // The SMS pass reaches this customer when the store runs it; otherwise
      // the SMS version stands in for the e-mail, once.
      if (settings.autoSendThankYouSms || smsSentReservationIds.has(reservation.id)) continue;
      const channel = getCustomerMessageChannel("review_request", customer, {
        smsConfigured: isSmsConfigured(),
      });
      if (channel !== "sms" || !customer.phone) {
        logCustomerMessageSkipped({
          message: "review_request",
          storeId: store.id,
          reservationId: reservation.id,
          customerId: customer.id,
        });
        continue;
      }
      const smsResult = await sendThankYouReviewSms({
        store: { id: store.id, name: store.name },
        customer: {
          id: customer.id,
          firstName: customer.firstName,
          lastName: customer.lastName,
          phone: customer.phone,
        },
        reservation: { id: reservation.id, number: reservation.number },
        reviewUrl: reviewUrls.sms,
        locale,
      });
      if (smsResult.success) {
        await db.insert(reviewRequestLogs).values({
          reservationId: reservation.id,
          storeId: store.id,
          customerId: customer.id,
          channel: "sms",
        });
        result.smsSent++;
      } else {
        result.errors.push(
          `SMS error for reservation ${reservation.number}: ${smsResult.error ?? "Unknown"}`,
        );
      }
      continue;
    }

    try {
      await sendThankYouReviewEmail({
        to: customerEmail,
        store: {
          id: store.id,
          name: store.name,
          logoUrl: store.logoUrl,
          darkLogoUrl: (store as unknown as { darkLogoUrl: string | null }).darkLogoUrl,
          email: store.email,
          phone: store.phone,
          address: store.address,
          theme: store.theme as { mode?: "light" | "dark"; primaryColor?: string } | null,
        },
        customer: { firstName: customer.firstName },
        reservation: {
          id: reservation.id,
          number: reservation.number,
          startDate: reservation.startDate,
          endDate: reservation.endDate,
        },
        reviewUrl: reviewUrls.email,
        locale,
      });

      // Log the sent request
      await db.insert(reviewRequestLogs).values({
        reservationId: reservation.id,
        storeId: store.id,
        customerId: customer.id,
        channel: "email",
      });

      result.sent++;
    } catch (error) {
      result.errors.push(
        `Email error for reservation ${reservation.number}: ${error instanceof Error ? error.message : "Unknown"}`,
      );
    }
  }

  return result;
}

/**
 * Process SMS review requests for a store
 */
async function processSmsRequests(
  store: {
    id: string;
    name: string;
  },
  settings: ReviewBoosterSettings,
  reviewUrl: string,
  locale: EmailLocale,
): Promise<{ sent: number; errors: string[] }> {
  const result = { sent: 0, errors: [] as string[] };
  const delayMs = settings.smsDelayHours * 60 * 60 * 1000;
  const cutoffDate = new Date(Date.now() - delayMs);
  const maxAgeDate = new Date(Date.now() - MAX_ELIGIBILITY_WINDOW_MS);

  // Find completed reservations that need SMS review request
  // - returnedAt is before cutoff (delay has passed)
  // - returnedAt is within the eligibility window (prevents mass sending on activation)
  const eligibleReservations = await db
    .select({
      reservation: reservations,
      customer: customers,
    })
    .from(reservations)
    .innerJoin(customers, eq(customers.id, reservations.customerId))
    .where(
      and(
        eq(reservations.storeId, store.id),
        eq(reservations.status, "completed"),
        lte(reservations.returnedAt, cutoffDate),
        gte(reservations.returnedAt, maxAgeDate),
      ),
    )
    .limit(50);

  // Filter out reservations that already have SMS sent
  const reservationIds = eligibleReservations.map((r) => r.reservation.id);
  if (reservationIds.length === 0) return result;

  const existingLogs = await db.query.reviewRequestLogs.findMany({
    where: and(
      inArray(reviewRequestLogs.reservationId, reservationIds),
      eq(reviewRequestLogs.channel, "sms"),
    ),
  });
  const sentReservationIds = new Set(existingLogs.map((l) => l.reservationId));

  for (const { reservation, customer } of eligibleReservations) {
    if (sentReservationIds.has(reservation.id)) continue;
    if (!customer.phone) continue; // Skip if no phone

    try {
      const smsResult = await sendThankYouReviewSms({
        store: { id: store.id, name: store.name },
        customer: {
          id: customer.id,
          firstName: customer.firstName,
          lastName: customer.lastName,
          phone: customer.phone,
        },
        reservation: { id: reservation.id, number: reservation.number },
        reviewUrl,
        locale,
      });

      if (smsResult.success) {
        // Log the sent request
        await db.insert(reviewRequestLogs).values({
          reservationId: reservation.id,
          storeId: store.id,
          customerId: customer.id,
          channel: "sms",
        });

        result.sent++;
      } else if (smsResult.limitReached) {
        // Stop processing SMS if limit reached
        result.errors.push(`SMS limit reached for store ${store.id}`);
        break;
      }
    } catch (error) {
      result.errors.push(
        `SMS error for reservation ${reservation.number}: ${error instanceof Error ? error.message : "Unknown"}`,
      );
    }
  }

  return result;
}

/**
 * Manually trigger a review request for a specific reservation
 */
export async function sendManualReviewRequest(
  reservationId: string,
  channel: "email" | "sms",
): Promise<{ success: boolean; error?: string }> {
  const reservation = await db.query.reservations.findFirst({
    where: eq(reservations.id, reservationId),
    with: {
      store: true,
      customer: true,
    },
  });

  if (!reservation) {
    return { success: false, error: "Reservation not found" };
  }

  const store = reservation.store;
  const customer = reservation.customer;
  const settings = store.reviewBoosterSettings as ReviewBoosterSettings | null;

  if (!settings?.googlePlaceId) {
    return { success: false, error: "Review Booster not configured" };
  }

  // Use short URL for both email and SMS
  const reviewUrl = buildShortReviewUrl(store.slug);
  // Get locale from store's country (from store settings)
  const storeSettings = store.settings as { country?: string } | null;
  const locale = getLocaleFromCountry(storeSettings?.country);

  // An e-mail request to a customer without e-mail goes out as its SMS version.
  const customerEmail = customer.email;
  const sentChannel = channel === "email" && customerEmail ? "email" : "sms";

  try {
    if (sentChannel === "email" && customerEmail) {
      await sendThankYouReviewEmail({
        to: customerEmail,
        store: {
          id: store.id,
          name: store.name,
          logoUrl: store.logoUrl,
          darkLogoUrl: (store as unknown as { darkLogoUrl: string | null }).darkLogoUrl,
          email: store.email,
          phone: store.phone,
          address: store.address,
          theme: store.theme as { mode?: "light" | "dark"; primaryColor?: string } | null,
        },
        customer: { firstName: customer.firstName },
        reservation: {
          id: reservation.id,
          number: reservation.number,
          startDate: reservation.startDate,
          endDate: reservation.endDate,
        },
        reviewUrl,
        locale,
      });
    } else {
      if (!customer.phone) {
        return {
          success: false,
          error: channel === "sms" ? "Customer has no phone number" : "errors.customerUnreachable",
        };
      }

      const smsResult = await sendThankYouReviewSms({
        store: { id: store.id, name: store.name },
        customer: {
          id: customer.id,
          firstName: customer.firstName,
          lastName: customer.lastName,
          phone: customer.phone,
        },
        reservation: { id: reservation.id, number: reservation.number },
        reviewUrl,
        locale,
      });

      if (!smsResult.success) {
        return { success: false, error: smsResult.error };
      }
    }

    // Log the sent request
    await db.insert(reviewRequestLogs).values({
      reservationId: reservation.id,
      storeId: store.id,
      customerId: customer.id,
      channel: sentChannel,
    });

    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}
