import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, before, beforeEach, describe, test } from "node:test";

import { eq, sql } from "drizzle-orm";

import type { ApiEffect, ApiEffectSenders } from "@louez/api/platform/effects";
import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import { closeNetworkForSuite } from "@/lib/testing/network-guard";

import type { ReservationMessageEffectDeps } from "./reservation-message-effects";

// The messages a reservation write promises, through the outbox, end to end on
// the database: each row is added in a transaction as a producer adds it, then
// claimed, sent and recorded by the outbox, and retried by its cron. The e-mail
// transport is a fake that notes what it takes and fails when told to; the
// platform's channels are a fake too. No session is open, and none can be.
//
// - Each kind is delivered once.
// - A failed send is retried, then delivered once; a quote's retry mints no
//   second link.
// - A run after a success the outbox did not record sends no second e-mail.
//   The platform's channels (Discord, fromHello) take no key: a run after a
//   lost outcome posts again there.
// - A payload written wrong is given up at once, kept, never retried.

/** The SMTP transport: what it took, and how many sends it fails next. */
const transport = {
  configured: true,
  failNext: 0,
  sent: [] as Array<{ to: string; subject: string; html: string }>,
};
const TRANSPORT_KEY = "__louezMessageOutboxTransport";
Reflect.set(globalThis, TRANSPORT_KEY, transport);

const directory = mkdtempSync(join(tmpdir(), "louez-message-outbox-"));
const fakes: Record<string, string> = {
  // The transport @louez/email gives every sender.
  "@louez/email": [
    `const transport = globalThis[${JSON.stringify(TRANSPORT_KEY)}];`,
    "module.exports = {",
    "  isEmailConfigured: () => transport.configured,",
    "  sendEmail: async (options) => {",
    "    if (transport.failNext > 0) {",
    "      transport.failNext -= 1;",
    "      throw new Error('SMTP refused the message');",
    "    }",
    "    transport.sent.push({ to: options.to, subject: options.subject, html: options.html });",
    "    return { messageId: `smtp_${transport.sent.length}`, success: true };",
    "  },",
    "};",
  ].join("\n"),
  // A sender that reached for a session would find none: the outbox runs with no request.
  "@/lib/auth":
    "module.exports = { auth: () => { throw new Error('An outbox sender has no session'); } };",
  "@/lib/store-context":
    "module.exports = { getCurrentStore: () => { throw new Error('An outbox sender has no session'); } };",
};
const fakeUrls = Object.fromEntries(
  Object.entries(fakes).map(([specifier, source], index) => {
    const path = join(directory, `fake-${index}.cjs`);
    writeFileSync(path, source);
    return [specifier, pathToFileURL(path).href];
  }),
);
after(() => rmSync(directory, { recursive: true }));

Reflect.get(
  nodeModule,
  "registerHooks",
)({
  resolve(
    specifier: string,
    context: unknown,
    next: (specifier: string, context: unknown) => unknown,
  ) {
    // Modules that import "server-only", which throws outside Next.
    if (specifier === "server-only") return { url: "node:module", shortCircuit: true };
    const fake = fakeUrls[specifier];
    return fake ? { url: fake, shortCircuit: true } : next(specifier, context);
  },
});

const USER = "user_msg_outbox";
const STORE = "store_msg_outbox_001";
const CUSTOMER = "cus_msg_outbox_00001";
const QUOTE = "res_msg_outbox_quote";
const CONFIRMED = "res_msg_outbox_conf1";
const TO = "ada@outbox.test";

describe(
  "reservation messages through the outbox (database)",
  { skip: skipWithoutTestDatabase() },
  () => {
    closeNetworkForSuite();

    let database: TestDatabase;
    let louezDb: typeof import("@louez/db");
    let outbox: typeof import("@louez/api/platform/effects");
    let senders: ApiEffectSenders;
    const platform: Array<{ channel: string; store: unknown; reservation: unknown }> = [];
    let platformFailNext = 0;

    before(async () => {
      database = await createTestDatabase("reservation_message_outbox");
      louezDb = await import("@louez/db");
      outbox = await import("@louez/api/platform/effects");
      const { createReservationMessageEffectSenders } =
        await import("./reservation-message-effects");
      const deps: ReservationMessageEffectDeps = {
        sendPlatformReservationCreated: async (channel, store, reservation, beforeSend) => {
          await beforeSend();
          if (platformFailNext > 0) {
            platformFailNext -= 1;
            throw new Error("Discord returned 502");
          }
          platform.push({ channel, store, reservation });
          return undefined;
        },
      };
      // Only the effect types this test queues.
      senders = createReservationMessageEffectSenders(deps) as ApiEffectSenders;

      await louezDb.db.insert(louezDb.users).values({ id: USER, email: "owner@outbox.test" });
      await louezDb.db.insert(louezDb.stores).values({
        id: STORE,
        userId: USER,
        name: "Kayaks",
        slug: "msg-outbox",
        settings: { country: "GB", currency: "GBP" } as never,
      });
      await louezDb.db.insert(louezDb.customers).values({
        id: CUSTOMER,
        storeId: STORE,
        email: TO,
        firstName: "Ada",
        lastName: "Lovelace",
      });
      for (const [id, number, status] of [
        [QUOTE, "2030-0001", "quote"],
        [CONFIRMED, "2030-0002", "confirmed"],
      ] as const) {
        await louezDb.db.insert(louezDb.reservations).values({
          id,
          storeId: STORE,
          customerId: CUSTOMER,
          number,
          status,
          startDate: new Date("2030-06-04T12:00:00Z"),
          endDate: new Date("2030-06-06T12:00:00Z"),
          subtotalAmount: "20.00",
          depositAmount: "50.00",
          totalAmount: "70.00",
          currency: "GBP",
          source: "manual",
        });
        await louezDb.db.insert(louezDb.reservationItems).values({
          reservationId: id,
          isCustomItem: true,
          quantity: 2,
          unitPrice: "10.00",
          depositPerUnit: "25.00",
          totalPrice: "20.00",
          productSnapshot: { name: "Sea kayak" } as never,
        });
      }
    });

    after(async () => {
      await louezDb?.db.$client.end();
      await database?.drop();
    });

    beforeEach(async () => {
      await louezDb.db.delete(louezDb.apiEffects);
      await louezDb.db.delete(louezDb.emailLogs);
      await louezDb.db.delete(louezDb.verificationCodes);
      await louezDb.db.delete(louezDb.reservationActivity);
      await louezDb.db
        .update(louezDb.stores)
        .set({ customerNotificationSettings: null })
        .where(eq(louezDb.stores.id, STORE));
      await louezDb.db
        .update(louezDb.reservations)
        .set({ status: "quote" })
        .where(eq(louezDb.reservations.id, QUOTE));
      transport.configured = true;
      transport.failNext = 0;
      transport.sent.length = 0;
      platform.length = 0;
      platformFailNext = 0;
    });

    /** Adds the rows in a transaction, as a reservation write adds them. */
    const enqueue = (...effects: ApiEffect[]) =>
      louezDb.db.transaction((tx) => outbox.enqueueEffects(tx, STORE, effects));

    const modified = (): ApiEffect => ({
      type: "reservation.modifiedEmail",
      orderingKey: `reservation:${CONFIRMED}:customer:email`,
      reservationId: CONFIRMED,
      customerId: CUSTOMER,
      payload: {
        storeId: STORE,
        reservationId: CONFIRMED,
        to: TO,
        previousPeriod: {
          startDate: "2030-06-01T12:00:00.000Z",
          endDate: "2030-06-03T12:00:00.000Z",
        },
        userId: USER,
      },
    });
    const quote = (): ApiEffect => ({
      type: "reservation.quoteEmail",
      orderingKey: `reservation:${QUOTE}:customer:email`,
      reservationId: QUOTE,
      customerId: CUSTOMER,
      payload: { storeId: STORE, reservationId: QUOTE, to: TO },
    });
    const confirmation = (): ApiEffect => ({
      type: "reservation.confirmationEmail",
      orderingKey: `reservation:${CONFIRMED}:customer:email`,
      reservationId: CONFIRMED,
      customerId: CUSTOMER,
      payload: { storeId: STORE, reservationId: CONFIRMED, to: TO },
    });
    const created = (): ApiEffect => ({
      type: "reservation.createdPlatformNotification",
      orderingKey: `reservation:${CONFIRMED}:platform:discord`,
      reservationId: CONFIRMED,
      payload: {
        channel: "discord",
        storeId: STORE,
        reservationId: CONFIRMED,
        totalAmount: "70.00",
      },
    });

    const row = async (id: string) => {
      const [effect] = await outbox.readEffects([id]);
      assert.ok(effect, `row ${id}`);
      return effect;
    };
    /** The cron's next pass, with the failed row's retry due now. */
    const retryNow = async (id: string) => {
      await louezDb.db
        .update(louezDb.apiEffects)
        .set({ nextAttemptAt: sql`NOW(3) - INTERVAL 1 SECOND` })
        .where(eq(louezDb.apiEffects.id, id));
      return outbox.retryDueEffects(senders);
    };
    /** A sender sent, then its outcome was lost: the row is due again, as after a lease ran out. */
    const loseOutcome = (id: string) =>
      louezDb.db
        .update(louezDb.apiEffects)
        .set({ status: "failed", sentAt: null, nextAttemptAt: sql`NOW(3) - INTERVAL 1 SECOND` })
        .where(eq(louezDb.apiEffects.id, id));
    const tokens = (reservationId: string) =>
      louezDb.db
        .select({ id: louezDb.verificationCodes.id, token: louezDb.verificationCodes.token })
        .from(louezDb.verificationCodes)
        .where(eq(louezDb.verificationCodes.reservationId, reservationId));
    const activity = () =>
      louezDb.db
        .select({
          id: louezDb.reservationActivity.id,
          userId: louezDb.reservationActivity.userId,
          activityType: louezDb.reservationActivity.activityType,
          metadata: louezDb.reservationActivity.metadata,
        })
        .from(louezDb.reservationActivity)
        .where(eq(louezDb.reservationActivity.reservationId, CONFIRMED));

    describe("the modification e-mail", () => {
      test("goes out once, with both periods, to the address the write announced, and adds its activity row", async () => {
        const [id] = await enqueue(modified());
        assert.ok(id);
        assert.deepEqual(await outbox.dispatchEffects([id], senders), {
          sent: 1,
          failed: 0,
          skipped: 0,
        });
        assert.equal((await row(id)).status, "sent");
        assert.equal(transport.sent.length, 1);
        const [email] = transport.sent;
        assert.equal(email?.to, TO);
        assert.match(email?.subject ?? "", /2030-0002/);
        // The previous period, from the payload, and the new one, from the reservation.
        assert.match(email?.html ?? "", /1 June 2030|June 1, 2030|01\/06\/2030/);
        assert.match(email?.html ?? "", /4 June 2030|June 4, 2030|04\/06\/2030/);
        assert.deepEqual(await activity(), [
          {
            id,
            userId: USER,
            activityType: "note_updated",
            metadata: {
              templateId: "reservation_modified",
              to: TO,
              customerEmailNotification: "sent",
            },
          },
        ]);
      });

      test("a failed send is retried, then delivered once, with one activity row", async () => {
        transport.failNext = 1;
        const [id] = await enqueue(modified());
        assert.ok(id);
        await outbox.dispatchEffects([id], senders);
        const failed = await row(id);
        assert.equal(failed.status, "failed");
        assert.match(failed.lastError ?? "", /SMTP refused/);
        assert.equal(transport.sent.length, 0);
        // The dashboard records a failed send; the outbox only gives up in the inbox.
        assert.deepEqual(await activity(), []);

        await retryNow(id);
        assert.equal((await row(id)).status, "sent");
        assert.equal(transport.sent.length, 1);
        assert.equal((await activity()).length, 1);
      });

      test("a run after a success the outbox did not record sends nothing again", async () => {
        const [id] = await enqueue(modified());
        assert.ok(id);
        await outbox.dispatchEffects([id], senders);
        await loseOutcome(id);

        await outbox.retryDueEffects(senders);
        assert.equal((await row(id)).status, "sent");
        assert.equal(transport.sent.length, 1);
        assert.equal((await activity()).length, 1);
      });

      test("without SMTP, nothing is sent and the row says why", async () => {
        transport.configured = false;
        const [id] = await enqueue(modified());
        assert.ok(id);
        await outbox.dispatchEffects([id], senders);
        const skipped = await row(id);
        assert.equal(skipped.status, "cancelled");
        assert.equal(skipped.lastError, "Skipped: email_not_configured");
        assert.equal(transport.sent.length, 0);
      });

      test("the dashboard's send, with no outbox row, records a failure on the timeline", async () => {
        const { sendReservationModificationEmailForStore } = await import("./modification-email");
        const store = await louezDb.db.query.stores.findFirst({
          where: eq(louezDb.stores.id, STORE),
        });
        assert.ok(store);
        transport.failNext = 1;
        const failed = await sendReservationModificationEmailForStore({
          store,
          reservationId: CONFIRMED,
          userId: USER,
        });
        assert.equal(failed.status, "failed");
        const sent = await sendReservationModificationEmailForStore({
          store,
          reservationId: CONFIRMED,
          userId: USER,
        });
        assert.deepEqual(sent, { status: "sent", to: TO });
        const outcomes = (await activity()).map((entry) => [
          entry.userId,
          (entry.metadata as { customerEmailNotification?: string }).customerEmailNotification,
        ]);
        assert.deepEqual(outcomes.sort(), [
          [USER, "failed"],
          [USER, "sent"],
        ]);
      });
    });

    describe("the quote e-mail", () => {
      test("goes out once, with a link that signs the customer in to the quote", async () => {
        const [id] = await enqueue(quote());
        assert.ok(id);
        await outbox.dispatchEffects([id], senders);
        assert.equal((await row(id)).status, "sent");
        assert.equal(transport.sent.length, 1);
        const minted = await tokens(QUOTE);
        assert.deepEqual(
          minted.map((entry) => entry.id),
          [id],
        );
        assert.ok(transport.sent[0]?.html.includes(`/r/${QUOTE}?token=${minted[0]?.token}`));
        assert.match(transport.sent[0]?.html ?? "", /Sea kayak/);
      });

      test("a failed send is retried with the same link, then delivered once", async () => {
        transport.failNext = 1;
        const [id] = await enqueue(quote());
        assert.ok(id);
        await outbox.dispatchEffects([id], senders);
        assert.equal((await row(id)).status, "failed");
        const first = await tokens(QUOTE);
        assert.equal(first.length, 1);

        await retryNow(id);
        assert.equal((await row(id)).status, "sent");
        assert.equal(transport.sent.length, 1);
        assert.deepEqual(await tokens(QUOTE), first);
        assert.ok(transport.sent[0]?.html.includes(`token=${first[0]?.token}`));
      });

      test("a run after a success the outbox did not record sends nothing again", async () => {
        const [id] = await enqueue(quote());
        assert.ok(id);
        await outbox.dispatchEffects([id], senders);
        await loseOutcome(id);

        await outbox.retryDueEffects(senders);
        assert.equal((await row(id)).status, "sent");
        assert.equal(transport.sent.length, 1);
        assert.equal((await tokens(QUOTE)).length, 1);
      });

      test("nothing goes out once the store turned quote e-mails off, or the quote was answered", async () => {
        await louezDb.db
          .update(louezDb.stores)
          .set({
            customerNotificationSettings: {
              customer_quote_sent: { enabled: false, email: true, sms: false },
            } as never,
          })
          .where(eq(louezDb.stores.id, STORE));
        const [off] = await enqueue(quote());
        assert.ok(off);
        await outbox.dispatchEffects([off], senders);
        assert.equal(
          (await row(off)).lastError,
          "Skipped: the store turned off customer_quote_sent e-mails",
        );

        await louezDb.db
          .update(louezDb.stores)
          .set({ customerNotificationSettings: null })
          .where(eq(louezDb.stores.id, STORE));
        await louezDb.db
          .update(louezDb.reservations)
          .set({ status: "declined" })
          .where(eq(louezDb.reservations.id, QUOTE));
        const [answered] = await enqueue(quote());
        assert.ok(answered);
        await outbox.dispatchEffects([answered], senders);
        assert.equal((await row(answered)).lastError, "Skipped: the reservation is declined now");
        assert.equal(transport.sent.length, 0);
        assert.equal((await tokens(QUOTE)).length, 0);
      });
    });

    describe("the confirmation e-mail of a booking created confirmed", () => {
      test("goes out once, with a link that signs the customer in to sign", async () => {
        const [id] = await enqueue(confirmation());
        assert.ok(id);
        await outbox.dispatchEffects([id], senders);
        assert.equal((await row(id)).status, "sent");
        assert.equal(transport.sent.length, 1);
        const minted = await tokens(CONFIRMED);
        assert.deepEqual(
          minted.map((entry) => entry.id),
          [id],
        );
        assert.ok(transport.sent[0]?.html.includes(`token=${minted[0]?.token}`));
        // In the reservation's currency.
        assert.match(transport.sent[0]?.html ?? "", /£/);
      });

      test("a failed send is retried, then delivered once", async () => {
        transport.failNext = 1;
        const [id] = await enqueue(confirmation());
        assert.ok(id);
        await outbox.dispatchEffects([id], senders);
        assert.equal((await row(id)).status, "failed");

        await retryNow(id);
        assert.equal((await row(id)).status, "sent");
        assert.equal(transport.sent.length, 1);
        assert.equal((await tokens(CONFIRMED)).length, 1);
      });

      test("a run after a success the outbox did not record sends nothing again", async () => {
        const [id] = await enqueue(confirmation());
        assert.ok(id);
        await outbox.dispatchEffects([id], senders);
        await loseOutcome(id);

        await outbox.retryDueEffects(senders);
        assert.equal((await row(id)).status, "sent");
        assert.equal(transport.sent.length, 1);
      });
    });

    describe("the platform's notice of a new reservation", () => {
      test("goes out once, with the total of its creation", async () => {
        const [id] = await enqueue(created());
        assert.ok(id);
        await outbox.dispatchEffects([id], senders);
        assert.equal((await row(id)).status, "sent");
        assert.deepEqual(platform, [
          {
            channel: "discord",
            store: { id: STORE, name: "Kayaks", slug: "msg-outbox" },
            reservation: {
              number: "2030-0002",
              customerName: "Ada Lovelace",
              totalAmount: 70,
              currency: "GBP",
            },
          },
        ]);
      });

      test("a failed post is retried, then delivered once", async () => {
        platformFailNext = 1;
        const [id] = await enqueue(created());
        assert.ok(id);
        await outbox.dispatchEffects([id], senders);
        assert.equal((await row(id)).status, "failed");
        assert.equal(platform.length, 0);

        await retryNow(id);
        assert.equal((await row(id)).status, "sent");
        assert.equal(platform.length, 1);
      });
    });

    test("a payload written wrong is given up at once, kept, and never retried", async () => {
      const broken = (effect: ApiEffect): ApiEffect =>
        ({ ...effect, payload: { ...effect.payload, reservationId: undefined } }) as never;
      const ids = await enqueue(
        broken(modified()),
        broken(quote()),
        broken(confirmation()),
        broken(created()),
      );
      assert.deepEqual(await outbox.dispatchEffects(ids, senders), {
        sent: 0,
        failed: 4,
        skipped: 0,
      });
      const rows = await outbox.readEffects(ids);
      for (const effect of rows) {
        assert.equal(effect.status, "abandoned", effect.type);
        assert.equal(effect.attempts, 1, effect.type);
        assert.match(effect.lastError ?? "", /^Abandoned: not a reservation\./, effect.type);
        assert.equal(effect.payload.storeId, STORE, effect.type);
      }
      assert.deepEqual(await outbox.retryDueEffects(senders), { sent: 0, failed: 0, skipped: 0 });
      assert.equal(transport.sent.length, 0);
      assert.equal(platform.length, 0);
    });
  },
);
