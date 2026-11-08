import { eq } from "drizzle-orm";

import { db, reservations } from "@louez/db";

import { log } from "@/lib/evlog";
import {
  type NotificationContext,
  type NotificationResult,
  dispatchNotification,
} from "@/lib/notifications/dispatcher";

/**
 * Waits before the second and third attempts. The dispute row is the only trace
 * of the dispute and has no column to remember the alert by, so a redelivered
 * event cannot tell whether the owner was told: the alert is retried here, in
 * the same request, and lost if all attempts fail or the process dies after the
 * dispute is recorded. The durable outbox of the agent-ready API will take it
 * over.
 */
const RETRY_DELAYS_MS: readonly number[] = [1_000, 3_000];
/**
 * The time the attempts may take in all, after the webhook answered: an attempt
 * that would start later is not made.
 */
const BUDGET_MS = 20_000;

export interface DisputeNotificationInput {
  readonly reservationId: string;
  /** The disputed amount, in the currency's main unit. */
  readonly amount: number;
  /** The dispute's currency, upper case. */
  readonly currency: string;
}

export interface DisputeNotificationDeps {
  loadContext: (input: DisputeNotificationInput) => Promise<NotificationContext | null>;
  dispatch: (ctx: NotificationContext) => Promise<NotificationResult>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  retryDelaysMs: readonly number[];
  budgetMs: number;
}

const loadContext = async (input: DisputeNotificationInput) => {
  const reservation = await db.query.reservations.findFirst({
    where: eq(reservations.id, input.reservationId),
    columns: {
      id: true,
      number: true,
      startDate: true,
      endDate: true,
      totalAmount: true,
      currency: true,
    },
    with: {
      store: {
        columns: {
          id: true,
          name: true,
          email: true,
          discordWebhookUrl: true,
          ownerPhone: true,
          notificationSettings: true,
          settings: true,
        },
      },
      customer: {
        columns: { firstName: true, lastName: true, email: true, phone: true },
      },
    },
  });
  if (!reservation) return null;
  return {
    store: reservation.store,
    reservation: {
      id: reservation.id,
      number: reservation.number,
      startDate: reservation.startDate,
      endDate: reservation.endDate,
      totalAmount: Number(reservation.totalAmount),
      currency: reservation.currency,
    },
    customer: reservation.customer ?? undefined,
    payment: { amount: input.amount, currency: input.currency },
  };
};

const defaultDeps: DisputeNotificationDeps = {
  loadContext,
  dispatch: (ctx) => dispatchNotification("payment_disputed", ctx),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
  retryDelaysMs: RETRY_DELAYS_MS,
  budgetMs: BUDGET_MS,
};

const channelErrors = (result: NotificationResult): Record<string, string> =>
  Object.fromEntries(
    Object.entries(result).flatMap(([channel, outcome]) =>
      outcome.error ? [[channel, outcome.error]] : [],
    ),
  );

/**
 * Tells the store owner a customer disputed a payment, on the channels the store
 * keeps on for `payment_disputed`. The dispatcher answers for each channel, so a
 * channel that worked is never sent again: a partial failure is logged, and only
 * an attempt where no channel reached the owner, although one tried, is retried,
 * at most twice and within the budget. Never throws: the dispute is already
 * recorded. The webhook runs it after its answer.
 */
export async function notifyPaymentDisputed(
  input: DisputeNotificationInput,
  deps: DisputeNotificationDeps = defaultDeps,
): Promise<{ notified: boolean; attempts: number }> {
  const event = { event: "payment_disputed", reservationId: input.reservationId };
  let lastErrors: Record<string, string> = {};
  const startedAt = deps.now();
  let attempts = 0;

  for (let attempt = 1; attempt <= deps.retryDelaysMs.length + 1; attempt += 1) {
    attempts = attempt;
    try {
      const ctx = await deps.loadContext(input);
      if (!ctx) return { notified: false, attempts: attempt };
      const result = await deps.dispatch(ctx);
      const errors = channelErrors(result);
      const sent = Object.values(result).some((outcome) => outcome.sent);
      if (sent || Object.keys(errors).length === 0) {
        if (sent && Object.keys(errors).length > 0) {
          log.warn({ ownerNotification: { ...event, issue: "some_channels_failed", errors } });
        }
        return { notified: sent, attempts: attempt };
      }
      lastErrors = errors;
    } catch (error) {
      lastErrors = { dispatch: error instanceof Error ? error.message : String(error) };
    }
    const delay = deps.retryDelaysMs[attempt - 1];
    if (delay === undefined || deps.now() - startedAt + delay > deps.budgetMs) break;
    await deps.sleep(delay);
  }

  log.error({
    ownerNotification: { ...event, issue: "not_delivered", attempts, errors: lastErrors },
  });
  return { notified: false, attempts };
}
