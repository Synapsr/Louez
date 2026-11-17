import { eq } from "drizzle-orm";

import type { ApiEffectSenders, EffectSendContext } from "@louez/api/platform/effects";
import { db, reservations, stores } from "@louez/db";

import { getEmailTranslations, resolveReservationEmailLocale } from "@/lib/email/i18n";
import { log } from "@/lib/evlog";

import { runWithTestEmailMark, type TestEmailMark } from "./email-mark";
import { isWithheldForTestReservation } from "./util.message-policy";

/**
 * What a test reservation sends (packages/db test-reservations.ts). Its customer is
 * the owner who made it (the checkout writes the owner's e-mail on it), so:
 *
 * - e-mails go out, the customer's and the owner's, their subject prefixed with
 *   "[Test] " and a banner first in their body (email-mark.ts, applied by
 *   lib/email/client.ts);
 * - no SMS, no push, no store Discord, no platform notice (Discord, fromHello) and
 *   no analytics event, whoever sends them.
 *
 * The rule is read from the reservation (`reservations.is_test`) when a message goes
 * out, never from a payload, so an outbox row queued earlier follows it too. Applied
 * in three places: the customer dispatcher, the store dispatcher, and the outbox
 * senders (`withTestReservationMessagePolicy`, lib/api/effects.ts).
 */
export interface TestReservationMessages {
  mark: TestEmailMark;
}

/** The policy of the reservation's messages, or null when it is not a test reservation. */
export async function readTestReservationMessages(
  reservationId: string | null | undefined,
): Promise<TestReservationMessages | null> {
  if (!reservationId) return null;
  const [row] = await db
    .select({
      isTest: reservations.isTest,
      locale: reservations.locale,
      settings: stores.settings,
    })
    .from(reservations)
    .innerJoin(stores, eq(stores.id, reservations.storeId))
    .where(eq(reservations.id, reservationId))
    .limit(1);
  if (!row?.isTest) return null;
  const t = getEmailTranslations(
    resolveReservationEmailLocale(row.locale, row.settings?.country),
  ).testReservation;
  return { mark: { subjectPrefix: t.subjectPrefix, banner: t.banner } };
}

/**
 * `readTestReservationMessages` for a send made once, outside the outbox (the
 * dispatchers): a read that fails sends as for any reservation, rather than lose a
 * real customer's or owner's message. The outbox's senders read it strictly, and
 * retry.
 */
export async function readTestReservationMessagesForDispatch(
  reservationId: string | null | undefined,
): Promise<TestReservationMessages | null> {
  try {
    return await readTestReservationMessages(reservationId);
  } catch (error) {
    log.error(
      "test-reservations",
      `message policy read failed for ${reservationId}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

/** Runs a send, its e-mails marked when the reservation is a test one. */
export function sendAsTestReservation<T>(
  policy: TestReservationMessages | null,
  work: () => Promise<T>,
): Promise<T> {
  return policy ? runWithTestEmailMark(policy.mark, work) : work();
}

type AnySender = (
  payload: unknown,
  context: EffectSendContext,
) => ReturnType<ApiEffectSenders[keyof ApiEffectSenders]>;

/**
 * The outbox senders, each reading the policy of its row's reservation before it
 * sends: a withheld row is skipped (`isWithheldForTestReservation`), an e-mail goes
 * out marked.
 */
export function withTestReservationMessagePolicy(senders: ApiEffectSenders): ApiEffectSenders {
  const wrapped: Record<string, AnySender> = {};
  for (const [type, send] of Object.entries(senders) as Array<[string, AnySender]>) {
    wrapped[type] = async (payload, context) => {
      const policy = await readTestReservationMessages(context.row.reservationId);
      if (!policy) return send(payload, context);
      if (isWithheldForTestReservation(type, payload)) {
        return { skipped: "a test reservation sends e-mails only" };
      }
      return sendAsTestReservation(policy, () => send(payload, context));
    };
  }
  return wrapped as ApiEffectSenders;
}
