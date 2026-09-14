import { env } from "@/env";
import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import type Stripe from "stripe";
import {
  db,
  payments,
  reservationActivity,
  reservationItems,
  reservations,
  stores,
  type Transaction,
} from "@louez/db";
import { stripe } from "@/lib/stripe/client";
import { toStripeCents } from "@/lib/stripe";
import { getStorefrontUrl } from "@/lib/storefront-url";
import { buildFeeMetadata, getStoreBilling, planStripeFees } from "@/lib/pay-as-you-go";
import { generateContract } from "@/lib/pdf/generate";
import { tryGenerateInvoiceForPayment } from "@/lib/invoicing/service";
import { markReservationForCalendarSync } from "@/lib/integrations/calendar/sync";
import { sendReservationModifiedEmail } from "@/lib/email/send";
import { getLocaleFromCountry } from "@/lib/email/i18n";
import { log } from "@/lib/evlog";
import { resolveDateChangeRequests } from "./date-change-request.server";
import { getExtensionAttempt, type ExtensionAttempt } from "./extension.types";
import {
  cents,
  ExtensionError,
  extensionFingerprint,
  loadExtensionReservation,
  parseExtensionEnd,
  quoteExtension,
  type ExtensionReservation,
} from "./extension-quote";

const extensionTransaction = <T>(work: (tx: Transaction) => Promise<T>) =>
  db.transaction(work, { isolationLevel: "read committed" });

const writeAttempt = (
  tx: Transaction,
  id: string,
  reservationId: string,
  attempt: ExtensionAttempt,
) =>
  tx
    .update(reservationActivity)
    .set({ metadata: attempt })
    .where(
      and(eq(reservationActivity.id, id), eq(reservationActivity.reservationId, reservationId)),
    );

const applyExtension = async (
  tx: Transaction,
  reservation: ExtensionReservation,
  id: string,
  attempt: ExtensionAttempt,
) => {
  const { items, ...totals } = attempt.plan;
  for (const item of items) {
    const { id: itemId, ...values } = item;
    await tx
      .update(reservationItems)
      .set(values)
      .where(
        and(eq(reservationItems.id, itemId), eq(reservationItems.reservationId, reservation.id)),
      );
  }
  const endDate = new Date(attempt.requestedEndMs);
  await tx
    .update(reservations)
    .set({ ...totals, endDate, updatedAt: new Date() })
    .where(and(eq(reservations.id, reservation.id), eq(reservations.storeId, reservation.storeId)));
  await resolveDateChangeRequests(
    tx,
    reservation.id,
    reservation.startDate,
    endDate,
    reservation.status,
  );
  await writeAttempt(tx, id, reservation.id, { ...attempt, status: "confirmed" });
};

export const startExtension = async (input: {
  storeId: string;
  customerId: string;
  reservationId: string;
  endDate: string;
  expectedSupplement: number;
}) => {
  const result = await extensionTransaction(async (tx) => {
    const reservation = await loadExtensionReservation(
      tx,
      input.storeId,
      input.reservationId,
      input.customerId,
    );
    const end = parseExtensionEnd(input.endDate, reservation.store.settings?.timezone ?? "UTC");
    if (reservation.endDate.getTime() === end.getTime()) {
      const completed = reservation.activity.flatMap((row) => {
        const attempt = getExtensionAttempt(row.metadata);
        return attempt?.status === "confirmed" &&
          attempt.requestedEndMs === end.getTime() &&
          cents(attempt.supplement) === cents(input.expectedSupplement)
          ? [{ reservation, id: row.id, attempt }]
          : [];
      })[0];
      if (completed) return completed;
    }

    const existing = reservation.activity.flatMap((row) => {
      const attempt = getExtensionAttempt(row.metadata);
      return attempt?.status === "checkout" && attempt.expiresMs > Date.now()
        ? [{ id: row.id, attempt }]
        : [];
    })[0];
    if (existing) {
      if (
        existing.attempt.requestedEndMs !== end.getTime() ||
        cents(existing.attempt.supplement) !== cents(input.expectedSupplement)
      )
        throw new ExtensionError("pending");
      if (extensionFingerprint(reservation) !== existing.attempt.fingerprint)
        throw new ExtensionError("priceChanged");
      const refreshed = await quoteExtension(tx, reservation, end, existing.id);
      if (
        refreshed.preview.mode !== "automatic" ||
        cents(refreshed.preview.supplement) !== cents(existing.attempt.supplement)
      )
        throw new ExtensionError("priceChanged");
      return { reservation, ...existing };
    }
    const recentAttempts = reservation.activity.filter(
      (row) =>
        getExtensionAttempt(row.metadata) &&
        (row.createdAt?.getTime() ?? 0) > Date.now() - 15 * 60_000,
    );
    if (recentAttempts.length >= 5) throw new ExtensionError("tooManyAttempts");
    const { preview, plan } = await quoteExtension(tx, reservation, end);
    if (preview.mode !== "automatic" || !plan) throw new ExtensionError("manualRequired");
    if (cents(preview.supplement) !== cents(input.expectedSupplement))
      throw new ExtensionError("priceChanged");
    const id = nanoid();
    const attempt: ExtensionAttempt = {
      kind: "rental_extension",
      status: "checkout",
      requestedEndMs: end.getTime(),
      expiresMs: Date.now() + 35 * 60_000,
      fingerprint: extensionFingerprint(reservation),
      originalEndDate: reservation.endDate.toISOString(),
      supplement: preview.supplement,
      currency: preview.currency,
      plan,
    };
    await tx
      .insert(reservationActivity)
      .values({ id, reservationId: reservation.id, activityType: "modified", metadata: attempt });
    if (!attempt.supplement) await applyExtension(tx, reservation, id, attempt);
    return { id, attempt, reservation };
  });
  const { id, attempt, reservation } = result;
  if (!attempt.supplement || attempt.status === "confirmed") {
    await finishExtensionEffects(reservation.storeId, reservation.id, id).catch((error: unknown) =>
      log.error("reservation.extension.effects", String(error)),
    );
    return { status: "confirmed" as const };
  }
  const stripeAccount = reservation.store.stripeAccountId;
  if (!stripeAccount) throw new ExtensionError("paymentUnavailable");
  if (attempt.sessionId) {
    const session = await stripe.checkout.sessions.retrieve(attempt.sessionId, { stripeAccount });
    if (session.status === "complete") {
      const status = await completeExtensionPayment(session, stripeAccount);
      return { status };
    }
    if (session.url && session.status === "open")
      return { status: "checkout" as const, url: session.url };
    throw new ExtensionError("expired");
  }
  const billing = await getStoreBilling(reservation.storeId);
  const fee = await planStripeFees({
    storeId: reservation.storeId,
    reservationId: reservation.id,
    chargeCents: toStripeCents(attempt.supplement, attempt.currency),
    billing,
  });
  const url = getStorefrontUrl(reservation.store.slug, `/account/reservations/${reservation.id}`);
  const metadata = { reservationId: reservation.id, extensionId: id, type: "rental_extension" };
  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: reservation.customer.email,
      expires_at: Math.floor(attempt.expiresMs / 1000),
      success_url: `${url}/extension-return?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: url,
      metadata,
      payment_intent_data: {
        metadata: { ...metadata, ...buildFeeMetadata(fee) },
        ...(fee.applicationFeeCents > 0 ? { application_fee_amount: fee.applicationFeeCents } : {}),
      },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: attempt.currency.toLowerCase(),
            unit_amount: toStripeCents(attempt.supplement, attempt.currency),
            product_data: {
              name: `${reservation.store.name} · #${reservation.number}`,
              description: `${attempt.originalEndDate} → ${new Date(attempt.requestedEndMs).toISOString()}`,
            },
          },
        },
      ],
    },
    { stripeAccount, idempotencyKey: `rental-extension:${id}` },
  );
  const sessionState = await extensionTransaction(async (tx) => {
    const current = await loadExtensionReservation(tx, reservation.storeId, reservation.id);
    const value = getExtensionAttempt(current.activity.find((row) => row.id === id)?.metadata);
    if (value?.status === "checkout")
      await writeAttempt(tx, id, reservation.id, { ...value, sessionId: session.id });
    return value?.status;
  });
  if (sessionState === "cancelled") {
    await stripe.checkout.sessions.expire(session.id, { stripeAccount });
    throw new ExtensionError("expired");
  }

  if (!session.url) throw new ExtensionError("paymentUnavailable");
  return { status: "checkout" as const, url: session.url };
};

export const completeExtensionPayment = async (
  session: Stripe.Checkout.Session,
  connectedAccountId?: string,
): Promise<"confirmed" | "refunded" | "processing"> => {
  const id = session.metadata?.extensionId;
  const reservationId = session.metadata?.reservationId;
  if (!id || !reservationId || !connectedAccountId) throw new ExtensionError("notFound");
  if (session.payment_status !== "paid") return "processing";
  const store = await db.query.stores.findFirst({
    where: (stores, { eq }) => eq(stores.stripeAccountId, connectedAccountId),
  });
  if (!store) throw new ExtensionError("notFound");
  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id;
  if (!paymentIntentId) throw new ExtensionError("paymentUnavailable");
  const intent = await stripe.paymentIntents.retrieve(paymentIntentId, {
    stripeAccount: connectedAccountId,
  });
  const result = await extensionTransaction(async (tx) => {
    const reservation = await loadExtensionReservation(tx, store.id, reservationId);
    const attempt = getExtensionAttempt(
      reservation.activity.find((row) => row.id === id)?.metadata,
    );
    if (!attempt || (attempt.sessionId && attempt.sessionId !== session.id))
      throw new ExtensionError("notFound");
    if (
      attempt.currency.toLowerCase() !== session.currency ||
      toStripeCents(attempt.supplement, attempt.currency) !== session.amount_total
    )
      throw new ExtensionError("paymentMismatch");
    if (["confirmed", "refunded", "refund_pending"].includes(attempt.status)) return attempt;
    const paymentId = nanoid();
    let valid =
      attempt.status === "checkout" && extensionFingerprint(reservation) === attempt.fingerprint;
    if (valid) {
      try {
        const quote = await quoteExtension(tx, reservation, new Date(attempt.requestedEndMs), id);
        valid =
          quote.preview.mode === "automatic" &&
          cents(quote.preview.supplement) === cents(attempt.supplement) &&
          quote.preview.currency === attempt.currency &&
          JSON.stringify(quote.plan) === JSON.stringify(attempt.plan);
      } catch (error) {
        if (!(error instanceof ExtensionError)) throw error;
        valid = false;
      }
    }
    await tx.insert(payments).values({
      id: paymentId,
      reservationId,
      amount: attempt.supplement.toFixed(2),
      currency: attempt.currency,
      type: "rental",
      method: "stripe",
      status: "completed",
      stripeCheckoutSessionId: session.id,
      stripePaymentIntentId: paymentIntentId,
      stripeChargeId:
        typeof intent.latest_charge === "string" ? intent.latest_charge : intent.latest_charge?.id,
      paidAt: new Date(),
    });
    const next: ExtensionAttempt = {
      ...attempt,
      sessionId: session.id,
      paymentId,
      status: valid ? "confirmed" : "refund_pending",
    };
    if (valid) await applyExtension(tx, reservation, id, next);
    else await writeAttempt(tx, id, reservationId, next);
    return next;
  });
  if (result.status === "refunded") return "refunded";
  if (result.status === "refund_pending") {
    let refund = await stripe.refunds.create(
      {
        payment_intent: paymentIntentId,
        ...(intent.application_fee_amount ? { refund_application_fee: true } : {}),
      },
      { stripeAccount: connectedAccountId, idempotencyKey: `rental-extension-refund:${id}` },
    );
    if (refund.status !== "succeeded")
      refund = await stripe.refunds.retrieve(refund.id, { stripeAccount: connectedAccountId });
    if (refund.status !== "succeeded") return "processing";
    await extensionTransaction(async (tx) => {
      const reservation = await loadExtensionReservation(tx, store.id, reservationId);
      const current = getExtensionAttempt(
        reservation.activity.find((row) => row.id === id)?.metadata,
      );
      if (!current || current.status === "refunded") return;
      // The Connect refund webhook also records the refund ledger, keyed by Stripe refund id.
      await tx
        .update(payments)
        .set({ status: "refunded", updatedAt: new Date() })
        .where(
          and(
            eq(payments.reservationId, reservationId),
            eq(payments.stripeCheckoutSessionId, session.id),
          ),
        );
      await writeAttempt(tx, id, reservationId, { ...current, status: "refunded" });
    });
    return "refunded";
  }
  await finishExtensionEffects(store.id, reservationId, id);
  return "confirmed";
};

export const cancelExtension = async (
  storeId: string,
  reservationId: string,
  customerId: string,
  id: string,
) => {
  const data = await extensionTransaction(async (tx) => {
    const reservation = await loadExtensionReservation(tx, storeId, reservationId, customerId);
    const attempt = getExtensionAttempt(
      reservation.activity.find((row) => row.id === id)?.metadata,
    );
    if (!attempt || attempt.status !== "checkout") return null;
    return { attempt, stripeAccount: reservation.store.stripeAccountId };
  });
  if (!data) return;
  // Expire Stripe first. A paid session must be completed/refunded, never simply released.
  if (data.attempt.sessionId && data.stripeAccount) {
    const session = await stripe.checkout.sessions.retrieve(data.attempt.sessionId, {
      stripeAccount: data.stripeAccount,
    });
    if (session.status === "complete") {
      await completeExtensionPayment(session, data.stripeAccount);
      return;
    }
    if (session.status === "open")
      await stripe.checkout.sessions.expire(session.id, { stripeAccount: data.stripeAccount });
  }
  await extensionTransaction(async (tx) => {
    const reservation = await loadExtensionReservation(tx, storeId, reservationId, customerId);
    const attempt = getExtensionAttempt(
      reservation.activity.find((row) => row.id === id)?.metadata,
    );
    if (attempt?.status === "checkout")
      await writeAttempt(tx, id, reservationId, { ...attempt, status: "cancelled" });
  });
};

export const finishExtensionEffects = async (
  storeId: string,
  reservationId: string,
  id: string,
) => {
  const data = await extensionTransaction(async (tx) => {
    const reservation = await loadExtensionReservation(tx, storeId, reservationId);
    const attempt = getExtensionAttempt(
      reservation.activity.find((row) => row.id === id)?.metadata,
    );
    if (
      !attempt ||
      attempt.status !== "confirmed" ||
      attempt.effectsDone ||
      (attempt.effectsClaimUntil ?? 0) > Date.now()
    )
      return null;
    await writeAttempt(tx, id, reservationId, {
      ...attempt,
      effectsClaimUntil: Date.now() + 120_000,
    });
    return { reservation, attempt };
  });
  if (!data) return;
  const { reservation, attempt } = data;
  await generateContract({ reservationId, regenerate: true });
  if (attempt.paymentId) {
    const invoice = await tryGenerateInvoiceForPayment(attempt.paymentId, "customer_extension");
    if (invoice.status === "skipped" && invoice.reason === "generation_failed")
      throw new Error("Extension invoice generation failed");
  }
  await markReservationForCalendarSync(storeId, reservationId);
  const email = {
    store: reservation.store,
    customer: reservation.customer,
    reservation,
    previousPeriod: {
      startDate: reservation.startDate,
      endDate: new Date(attempt.originalEndDate),
    },
    locale: getLocaleFromCountry(reservation.store.settings?.country),
  };
  const deliveries = await Promise.allSettled([
    sendReservationModifiedEmail({
      ...email,
      to: reservation.customer.email,
      reservationUrl: getStorefrontUrl(
        reservation.store.slug,
        `/account/reservations/${reservationId}`,
      ),
    }),
    ...(reservation.store.email
      ? [
          sendReservationModifiedEmail({
            ...email,
            to: reservation.store.email,
            reservationUrl: `${env.NEXT_PUBLIC_APP_URL}/dashboard/reservations/${reservationId}`,
          }),
        ]
      : []),
  ]);
  for (const delivery of deliveries) {
    if (delivery.status === "rejected") throw delivery.reason;
  }
  await extensionTransaction(async (tx) => {
    const current = await loadExtensionReservation(tx, storeId, reservationId);
    const value = getExtensionAttempt(current.activity.find((row) => row.id === id)?.metadata);
    if (value?.status === "confirmed")
      await writeAttempt(tx, id, reservationId, { ...value, effectsDone: true });
  });
};

/** Recover interrupted checkouts, refunds and document delivery from the existing minute cron. */
export const reconcileRentalExtensions = async () => {
  const rows = await db
    .select({
      id: reservationActivity.id,
      reservationId: reservations.id,
      storeId: reservations.storeId,
      customerId: reservations.customerId,
      stripeAccountId: stores.stripeAccountId,
      metadata: reservationActivity.metadata,
    })
    .from(reservationActivity)
    .innerJoin(reservations, eq(reservations.id, reservationActivity.reservationId))
    .innerJoin(stores, eq(stores.id, reservations.storeId))
    .where(
      and(
        eq(reservationActivity.activityType, "modified"),
        sql`JSON_UNQUOTE(JSON_EXTRACT(${reservationActivity.metadata}, '$.kind')) = 'rental_extension'`,
        sql`(JSON_UNQUOTE(JSON_EXTRACT(${reservationActivity.metadata}, '$.status')) IN ('checkout', 'refund_pending') OR (JSON_UNQUOTE(JSON_EXTRACT(${reservationActivity.metadata}, '$.status')) = 'confirmed' AND COALESCE(JSON_EXTRACT(${reservationActivity.metadata}, '$.effectsDone'), false) != true))`,
      ),
    )
    .orderBy(
      sql`COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(${reservationActivity.metadata}, '$.nextReconcileMs')) AS UNSIGNED), 0)`,
      reservationActivity.createdAt,
    )
    .limit(25);
  let completed = 0;
  for (const row of rows) {
    const attempt = getExtensionAttempt(row.metadata);
    if (!attempt) continue;
    try {
      if (attempt.status === "confirmed")
        await finishExtensionEffects(row.storeId, row.reservationId, row.id);
      else if (attempt.sessionId && row.stripeAccountId) {
        const session = await stripe.checkout.sessions.retrieve(attempt.sessionId, {
          stripeAccount: row.stripeAccountId,
        });
        if (session.payment_status === "paid")
          await completeExtensionPayment(session, row.stripeAccountId);
        else if (session.status === "expired")
          await cancelExtension(row.storeId, row.reservationId, row.customerId, row.id);
      } else if (attempt.expiresMs < Date.now())
        await cancelExtension(row.storeId, row.reservationId, row.customerId, row.id);
      completed++;
    } catch (error) {
      log.error("reservation.extension.reconcile", `${row.id}: ${String(error)}`);
    } finally {
      await extensionTransaction(async (tx) => {
        const reservation = await loadExtensionReservation(tx, row.storeId, row.reservationId);
        const current = getExtensionAttempt(
          reservation.activity.find((activity) => activity.id === row.id)?.metadata,
        );
        if (current)
          await writeAttempt(tx, row.id, row.reservationId, {
            ...current,
            nextReconcileMs: Date.now(),
          });
      }).catch((error: unknown) => log.error("reservation.extension.reconcile", String(error)));
    }
  }
  return { checked: rows.length, completed };
};
