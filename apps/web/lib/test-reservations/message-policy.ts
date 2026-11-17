import { eq } from "drizzle-orm";

import type { ApiEffectSenders, EffectSendContext } from "@louez/api/platform/effects";
import { customers, db, reservations, stores } from "@louez/db";

import { getEmailTranslations, resolveReservationEmailLocale } from "@/lib/email/i18n";
import { log } from "@/lib/evlog";

import { runWithTestEmailMark, type TestEmailMark } from "./email-mark";
import {
  planDispatch,
  planOutboxRow,
  type DispatchPlan,
  type ReservationMessagePolicy,
} from "./util.message-policy";

/**
 * What a test reservation sends (packages/db test-reservations.ts). Its customer is
 * the member who started it (the checkout writes their account e-mail on it), so:
 *
 * - e-mails go out, the customer's and the store's, all of them to that member
 *   only, their subject prefixed with "[Test] " and a banner first in their body
 *   (email-mark.ts, applied by lib/email/client.ts);
 * - no SMS, no push, no store Discord, no platform notice (Discord, fromHello) and
 *   no analytics event, whoever sends them.
 *
 * The rule is read from the reservation (`reservations.is_test`) when a message goes
 * out, never from a payload, so an outbox row queued earlier follows it too; a
 * message whose reservation is gone (purged) is not sent. Applied in the customer
 * dispatcher, the store dispatcher, the outbox senders
 * (`withTestReservationMessagePolicy`, lib/api/effects.ts) and the direct sends of
 * a reservation's e-mail (`sendForReservation`).
 */

/** The policy of the reservation's messages (util.message-policy.ts). Throws when it cannot be read. */
export async function readReservationMessagePolicy(
  reservationId: string | null | undefined,
): Promise<ReservationMessagePolicy> {
  if (!reservationId) return { kind: "real" };
  const [row] = await db
    .select({
      isTest: reservations.isTest,
      locale: reservations.locale,
      settings: stores.settings,
      customerEmail: customers.email,
    })
    .from(reservations)
    .innerJoin(stores, eq(stores.id, reservations.storeId))
    .innerJoin(customers, eq(customers.id, reservations.customerId))
    .where(eq(reservations.id, reservationId))
    .limit(1);
  if (!row) return { kind: "missing" };
  if (!row.isTest) return { kind: "real" };
  const t = getEmailTranslations(
    resolveReservationEmailLocale(row.locale, row.settings?.country),
  ).testReservation;
  return {
    kind: "test",
    mark: { subjectPrefix: t.subjectPrefix, banner: t.banner, recipient: row.customerEmail },
  };
}

/**
 * The plan of a send made once, outside the outbox (the dispatchers): a read that
 * fails still sends the e-mail, unmarked, rather than lose a real customer's or
 * owner's message, but no other channel (`planDispatch`). The outbox's senders read
 * the policy strictly, and retry.
 */
export async function planReservationDispatch(
  reservationId: string | null | undefined,
): Promise<DispatchPlan> {
  try {
    return planDispatch(await readReservationMessagePolicy(reservationId));
  } catch (error) {
    log.error(
      "test-reservations",
      `message policy read failed for ${reservationId}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return planDispatch("unknown");
  }
}

/** Runs a send, its e-mails marked and sent to the test's member when there is a mark. */
export function sendWithTestMark<T>(
  mark: TestEmailMark | null,
  work: () => Promise<T>,
): Promise<T> {
  return mark ? runWithTestEmailMark(mark, work) : work();
}

/**
 * A direct send of one reservation's e-mail (the dashboard's "send an e-mail", its
 * access link, the modification notice): sent as it is for an ordinary reservation,
 * marked and to the test's member for a test one. Throws, sending nothing, when the
 * reservation is gone or its policy cannot be read: the caller's failure path runs.
 */
export async function sendForReservation<T>(
  reservationId: string,
  work: () => Promise<T>,
): Promise<T> {
  const policy = await readReservationMessagePolicy(reservationId);
  if (policy.kind === "missing") throw new Error("The reservation is gone.");
  return sendWithTestMark(policy.kind === "test" ? policy.mark : null, work);
}

type AnySender = (
  payload: unknown,
  context: EffectSendContext,
) => ReturnType<ApiEffectSenders[keyof ApiEffectSenders]>;

/**
 * The outbox senders, each reading the policy of its row's reservation before it
 * sends (`planOutboxRow`): a row of a reservation gone, or withheld for a test one,
 * is skipped; a test one's e-mail goes out marked, to its member. A failed read
 * throws, and the row is retried.
 */
export function withTestReservationMessagePolicy(senders: ApiEffectSenders): ApiEffectSenders {
  const wrapped: Record<string, AnySender> = {};
  for (const [type, send] of Object.entries(senders) as Array<[string, AnySender]>) {
    wrapped[type] = async (payload, context) => {
      const plan = planOutboxRow(
        await readReservationMessagePolicy(context.row.reservationId),
        type,
        payload,
      );
      if (!plan.send) return { skipped: plan.reason };
      return sendWithTestMark(plan.mark, () => send(payload, context));
    };
  }
  return wrapped as ApiEffectSenders;
}
