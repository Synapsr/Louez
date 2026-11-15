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
// - Each kind is delivered once; a failed send is retried, then delivered
//   once; a run after a success the outbox did not record sends no second
//   e-mail and mints no second link. The platform's channels (Discord,
//   fromHello) take no key: a run after a lost outcome posts again there.
// - A row sends only about its own store, reservation and customer.
// - A payload is one recipient, bounded ids, a plain amount, or it is given up.
// - A modification e-mail states its own write: two changes sent late say
//   each its own step, and nothing goes out once the booking is cancelled.
// - An e-mail goes only to the address announced, while still the customer's.
// - Undeliverable ends `abandoned` (the inbox shows it); no longer applicable
//   ends `cancelled` (no one is alerted).

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
const OTHER_CUSTOMER = "cus_msg_outbox_00003";
const QUOTE = "res_msg_outbox_quote";
const CONFIRMED = "res_msg_outbox_conf1";
const TO = "ada@outbox.test";
// Another store's booking, which a row of the first store must never send about.
const OTHER_STORE = "store_msg_outbox_002";
const OTHER_STORE_CUSTOMER = "cus_msg_outbox_00002";
const OTHER_RESERVATION = "res_msg_outbox_other";

/** Three periods of one booking: A, B (its dates when seeded), C. */
const A = { startDate: "2030-06-01T12:00:00.000Z", endDate: "2030-06-03T12:00:00.000Z" };
const B = { startDate: "2030-06-04T12:00:00.000Z", endDate: "2030-06-06T12:00:00.000Z" };
const C = { startDate: "2030-06-10T12:00:00.000Z", endDate: "2030-06-12T12:00:00.000Z" };
/** Whether an e-mail names this day of June 2030, as the store's English dates write it. */
const names = (html: string | undefined, day: number) =>
  new RegExp(`\\b${day} June 2030|June ${day}, 2030`).test(html ?? "");

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
      await louezDb.db.insert(louezDb.stores).values([
        {
          id: STORE,
          userId: USER,
          name: "Kayaks",
          slug: "msg-outbox",
          settings: { country: "GB", currency: "GBP" } as never,
        },
        {
          id: OTHER_STORE,
          userId: USER,
          name: "Canoes",
          slug: "msg-outbox-other",
          settings: { country: "GB", currency: "GBP" } as never,
        },
      ]);
      await louezDb.db.insert(louezDb.customers).values([
        { id: CUSTOMER, storeId: STORE, email: TO, firstName: "Ada", lastName: "Lovelace" },
        {
          id: OTHER_CUSTOMER,
          storeId: STORE,
          email: "grace@outbox.test",
          firstName: "Grace",
          lastName: "Hopper",
        },
        {
          id: OTHER_STORE_CUSTOMER,
          storeId: OTHER_STORE,
          email: "bob@other.test",
          firstName: "Bob",
          lastName: "Other",
        },
      ]);
      for (const [id, storeId, customerId, number, status] of [
        [QUOTE, STORE, CUSTOMER, "2030-0001", "quote"],
        [CONFIRMED, STORE, CUSTOMER, "2030-0002", "confirmed"],
        [OTHER_RESERVATION, OTHER_STORE, OTHER_STORE_CUSTOMER, "2030-0900", "confirmed"],
      ] as const) {
        await louezDb.db.insert(louezDb.reservations).values({
          id,
          storeId,
          customerId,
          number,
          status,
          startDate: new Date(B.startDate),
          endDate: new Date(B.endDate),
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
        .update(louezDb.customers)
        .set({ email: TO })
        .where(eq(louezDb.customers.id, CUSTOMER));
      for (const [id, status] of [
        [QUOTE, "quote"],
        [CONFIRMED, "confirmed"],
      ] as const) {
        await louezDb.db
          .update(louezDb.reservations)
          .set({ status, startDate: new Date(B.startDate), endDate: new Date(B.endDate) })
          .where(eq(louezDb.reservations.id, id));
      }
      transport.configured = true;
      transport.failNext = 0;
      transport.sent.length = 0;
      platform.length = 0;
      platformFailNext = 0;
    });

    /** Adds the rows in a transaction, as a reservation write adds them. */
    const enqueue = (...effects: ApiEffect[]) =>
      louezDb.db.transaction((tx) => outbox.enqueueEffects(tx, STORE, effects));

    /** The modification e-mail of a change from one period to another (A → B by default). */
    const modified = (previousPeriod = A, period = B): ApiEffect => ({
      type: "reservation.modifiedEmail",
      orderingKey: `reservation:${CONFIRMED}:customer:email`,
      reservationId: CONFIRMED,
      customerId: CUSTOMER,
      payload: {
        storeId: STORE,
        reservationId: CONFIRMED,
        to: TO,
        previousPeriod,
        period,
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
    const EMAILS = [
      ["modification", modified],
      ["quote", quote],
      ["confirmation", confirmation],
    ] as const;
    /** The same row with some of its payload's fields replaced. */
    const withPayload = (effect: ApiEffect, fields: Record<string, unknown>): ApiEffect =>
      ({ ...effect, payload: { ...effect.payload, ...fields } }) as never;

    const row = async (id: string) => {
      const [effect] = await outbox.readEffects([id]);
      assert.ok(effect, `row ${id}`);
      return effect;
    };
    /** Dispatches one row, as the write's commit hands it over, and reads it back. */
    const dispatchOne = async (effect: ApiEffect) => {
      const [id] = await enqueue(effect);
      assert.ok(id);
      await outbox.dispatchEffects([id], senders);
      return row(id);
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
    const allTokens = () =>
      louezDb.db.select({ id: louezDb.verificationCodes.id }).from(louezDb.verificationCodes);
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
    /** A row given up at once, kept, for its reason: nothing sent, nothing minted. */
    const assertAbandoned = async (
      effect: Awaited<ReturnType<typeof row>>,
      code: string,
      label: string,
    ) => {
      assert.equal(effect.status, "abandoned", label);
      assert.equal(effect.attempts, 1, label);
      assert.match(effect.lastError ?? "", new RegExp(`^Abandoned: ${code}:`), label);
      assert.notDeepEqual(effect.payload, {}, label);
      assert.equal(transport.sent.length, 0, label);
      assert.equal(platform.length, 0, label);
      assert.deepEqual(await allTokens(), [], label);
    };
    /** A row that no longer applies: cancelled with its reason, nothing sent. */
    const assertNoLongerApplies = (
      effect: Awaited<ReturnType<typeof row>>,
      code: string,
      label: string,
    ) => {
      assert.equal(effect.status, "cancelled", label);
      assert.match(effect.lastError ?? "", new RegExp(`^Skipped: ${code}:`), label);
      assert.equal(transport.sent.length, 0, label);
    };

    describe("the modification e-mail", () => {
      test("goes out once, with both periods of its write, to the address announced, and adds its activity row", async () => {
        const effect = await dispatchOne(modified());
        assert.equal(effect.status, "sent");
        assert.equal(transport.sent.length, 1);
        const [email] = transport.sent;
        assert.equal(email?.to, TO);
        assert.match(email?.subject ?? "", /2030-0002/);
        assert.ok(names(email?.html, 1) && names(email?.html, 4));
        assert.deepEqual(await activity(), [
          {
            id: effect.id,
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

      test("two changes sent late say each its own step, in order", async () => {
        const ids = await enqueue(modified(A, B), modified(B, C));
        // The booking has its last dates when the rows go out.
        await louezDb.db
          .update(louezDb.reservations)
          .set({ startDate: new Date(C.startDate), endDate: new Date(C.endDate) })
          .where(eq(louezDb.reservations.id, CONFIRMED));
        await outbox.dispatchEffects(ids, senders);
        assert.deepEqual(
          transport.sent.map((email) => [1, 4, 10].filter((day) => names(email.html, day))),
          [
            [1, 4],
            [4, 10],
          ],
        );
      });

      test("nothing goes out once the booking is cancelled", async () => {
        const [id] = await enqueue(modified());
        assert.ok(id);
        await louezDb.db
          .update(louezDb.reservations)
          .set({ status: "cancelled" })
          .where(eq(louezDb.reservations.id, CONFIRMED));
        await outbox.dispatchEffects([id], senders);
        assertNoLongerApplies(await row(id), "obsolete", "cancelled");
        assert.deepEqual(await activity(), []);
      });

      test("a failed send is retried, then delivered once, with one activity row", async () => {
        transport.failNext = 1;
        const failed = await dispatchOne(modified());
        assert.equal(failed.status, "failed");
        assert.match(failed.lastError ?? "", /SMTP refused/);
        assert.equal(transport.sent.length, 0);
        // The dashboard records a failed send; the outbox only gives up in the inbox.
        assert.deepEqual(await activity(), []);

        await retryNow(failed.id);
        assert.equal((await row(failed.id)).status, "sent");
        assert.equal(transport.sent.length, 1);
        assert.equal((await activity()).length, 1);
      });

      test("a run after a success the outbox did not record sends nothing again", async () => {
        const { id } = await dispatchOne(modified());
        await loseOutcome(id);

        await outbox.retryDueEffects(senders);
        assert.equal((await row(id)).status, "sent");
        assert.equal(transport.sent.length, 1);
        assert.equal((await activity()).length, 1);
      });

      test("the dashboard's send, with no outbox row, records a failure on the timeline", async () => {
        const { sendReservationModificationEmailForStore } = await import("./modification-email");
        const store = await louezDb.db.query.stores.findFirst({
          where: eq(louezDb.stores.id, STORE),
        });
        assert.ok(store);
        const dates = { startDate: new Date(B.startDate), endDate: new Date(B.endDate) };
        transport.failNext = 1;
        const failed = await sendReservationModificationEmailForStore({
          store,
          reservationId: CONFIRMED,
          period: dates,
          userId: USER,
        });
        assert.equal(failed.status, "failed");
        const sent = await sendReservationModificationEmailForStore({
          store,
          reservationId: CONFIRMED,
          period: dates,
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
        const effect = await dispatchOne(quote());
        assert.equal(effect.status, "sent");
        assert.equal(transport.sent.length, 1);
        const minted = await tokens(QUOTE);
        assert.deepEqual(
          minted.map((entry) => entry.id),
          [effect.id],
        );
        assert.ok(transport.sent[0]?.html.includes(`/r/${QUOTE}?token=${minted[0]?.token}`));
        assert.match(transport.sent[0]?.html ?? "", /Sea kayak/);
      });

      test("a failed send is retried with the same link, then delivered once", async () => {
        transport.failNext = 1;
        const failed = await dispatchOne(quote());
        assert.equal(failed.status, "failed");
        const first = await tokens(QUOTE);
        assert.equal(first.length, 1);

        await retryNow(failed.id);
        assert.equal((await row(failed.id)).status, "sent");
        assert.equal(transport.sent.length, 1);
        assert.deepEqual(await tokens(QUOTE), first);
        assert.ok(transport.sent[0]?.html.includes(`token=${first[0]?.token}`));
      });

      test("a run after a success the outbox did not record sends nothing again", async () => {
        const { id } = await dispatchOne(quote());
        await loseOutcome(id);

        await outbox.retryDueEffects(senders);
        assert.equal((await row(id)).status, "sent");
        assert.equal(transport.sent.length, 1);
        assert.equal((await tokens(QUOTE)).length, 1);
      });
    });

    describe("the confirmation e-mail of a booking created confirmed", () => {
      test("goes out once, with a link that signs the customer in to sign", async () => {
        const effect = await dispatchOne(confirmation());
        assert.equal(effect.status, "sent");
        assert.equal(transport.sent.length, 1);
        const minted = await tokens(CONFIRMED);
        assert.deepEqual(
          minted.map((entry) => entry.id),
          [effect.id],
        );
        assert.ok(transport.sent[0]?.html.includes(`token=${minted[0]?.token}`));
        // In the reservation's currency.
        assert.match(transport.sent[0]?.html ?? "", /£/);
      });

      test("a failed send is retried, then delivered once", async () => {
        transport.failNext = 1;
        const failed = await dispatchOne(confirmation());
        assert.equal(failed.status, "failed");

        await retryNow(failed.id);
        assert.equal((await row(failed.id)).status, "sent");
        assert.equal(transport.sent.length, 1);
        assert.equal((await tokens(CONFIRMED)).length, 1);
      });

      test("a run after a success the outbox did not record sends nothing again", async () => {
        const { id } = await dispatchOne(confirmation());
        await loseOutcome(id);

        await outbox.retryDueEffects(senders);
        assert.equal((await row(id)).status, "sent");
        assert.equal(transport.sent.length, 1);
      });
    });

    describe("the platform's notice of a new reservation", () => {
      test("goes out once, with the total of its creation", async () => {
        const effect = await dispatchOne(created());
        assert.equal(effect.status, "sent");
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
        const failed = await dispatchOne(created());
        assert.equal(failed.status, "failed");
        assert.equal(platform.length, 0);

        await retryNow(failed.id);
        assert.equal((await row(failed.id)).status, "sent");
        assert.equal(platform.length, 1);
      });
    });

    describe("a row sends only about its own store, reservation and customer", () => {
      test("a row of one store naming another store's booking is given up, never sent", async () => {
        const kinds = [...EMAILS, ["platform notice", created]] as const;
        for (const [label, make] of kinds) {
          const effect = await dispatchOne(
            withPayload(make(), { storeId: OTHER_STORE, reservationId: OTHER_RESERVATION }),
          );
          await assertAbandoned(effect, "row_mismatch", label);
        }
      });
    });

    describe("a payload holds one recipient and bounded fields", () => {
      test("a list, a line break, an over-long id or an endless amount is given up", async () => {
        const cases: Array<[string, ApiEffect]> = [
          ["two recipients", withPayload(quote(), { to: `${TO}, grace@outbox.test` })],
          [
            "a header after a line break",
            withPayload(confirmation(), { to: `${TO}\r\nBcc: x@y.test` }),
          ],
          ["a display name", withPayload(quote(), { to: `Ada <${TO}>` })],
          ["an id past the id shape", withPayload(modified(), { userId: "u".repeat(22) })],
          [
            "a period that is no date",
            withPayload(modified(), { period: { startDate: "soon", endDate: B.endDate } }),
          ],
          ["an amount of 400 digits", withPayload(created(), { totalAmount: "9".repeat(400) })],
          ["a negative amount", withPayload(created(), { totalAmount: "-70.00" })],
        ];
        for (const [label, effect] of cases) {
          await assertAbandoned(await dispatchOne(effect), "invalid_payload", label);
        }
      });
    });

    describe("an e-mail goes only to the address announced, while still the customer's", () => {
      test("an address corrected after the write: nothing minted or sent", async () => {
        for (const [label, make] of EMAILS) {
          const [id] = await enqueue(make());
          assert.ok(id);
          await louezDb.db
            .update(louezDb.customers)
            .set({ email: "ada.new@outbox.test" })
            .where(eq(louezDb.customers.id, CUSTOMER));
          await outbox.dispatchEffects([id], senders);
          await assertAbandoned(await row(id), "recipient_changed", label);
          await louezDb.db
            .update(louezDb.customers)
            .set({ email: TO })
            .where(eq(louezDb.customers.id, CUSTOMER));
        }
      });

      test("the same address written otherwise still goes out", async () => {
        await louezDb.db
          .update(louezDb.customers)
          .set({ email: "Ada@Outbox.test" })
          .where(eq(louezDb.customers.id, CUSTOMER));
        assert.equal((await dispatchOne(quote())).status, "sent");
        assert.equal(transport.sent[0]?.to, TO);
      });

      test("a row announced for another customer: nothing minted or sent", async () => {
        for (const [label, make] of EMAILS) {
          await assertAbandoned(
            await dispatchOne({ ...make(), customerId: OTHER_CUSTOMER }),
            "recipient_changed",
            label,
          );
        }
      });
    });

    describe("each end lands in its class", () => {
      test("no e-mail service: undeliverable, given up where the inbox shows it", async () => {
        transport.configured = false;
        for (const [label, make] of EMAILS) {
          await assertAbandoned(await dispatchOne(make()), "email_not_configured", label);
        }
      });

      test("a quote answered, or turned off by the store: no longer applies", async () => {
        await louezDb.db
          .update(louezDb.reservations)
          .set({ status: "declined" })
          .where(eq(louezDb.reservations.id, QUOTE));
        assertNoLongerApplies(await dispatchOne(quote()), "obsolete", "answered");

        await louezDb.db
          .update(louezDb.reservations)
          .set({ status: "quote" })
          .where(eq(louezDb.reservations.id, QUOTE));
        await louezDb.db
          .update(louezDb.stores)
          .set({
            customerNotificationSettings: {
              customer_quote_sent: { enabled: false, email: true, sms: false },
            } as never,
          })
          .where(eq(louezDb.stores.id, STORE));
        assertNoLongerApplies(await dispatchOne(quote()), "turned_off", "turned off");
        assert.deepEqual(await allTokens(), []);
      });

      test("a confirmation of a booking cancelled since, or turned off: no longer applies", async () => {
        await louezDb.db
          .update(louezDb.stores)
          .set({
            customerNotificationSettings: {
              customer_reservation_confirmed: { enabled: true, email: false, sms: false },
            } as never,
          })
          .where(eq(louezDb.stores.id, STORE));
        assertNoLongerApplies(await dispatchOne(confirmation()), "turned_off", "turned off");

        await louezDb.db
          .update(louezDb.stores)
          .set({ customerNotificationSettings: null })
          .where(eq(louezDb.stores.id, STORE));
        await louezDb.db
          .update(louezDb.reservations)
          .set({ status: "cancelled" })
          .where(eq(louezDb.reservations.id, CONFIRMED));
        assertNoLongerApplies(await dispatchOne(confirmation()), "obsolete", "cancelled");
        assert.deepEqual(await allTokens(), []);
      });

      test("a payload written wrong is never retried", async () => {
        const ids = await enqueue(
          ...[modified(), quote(), confirmation(), created()].map((effect) =>
            withPayload(effect, { reservationId: undefined }),
          ),
        );
        assert.deepEqual(await outbox.dispatchEffects(ids, senders), {
          sent: 0,
          failed: 4,
          skipped: 0,
        });
        for (const effect of await outbox.readEffects(ids)) {
          await assertAbandoned(effect, "invalid_payload", effect.type);
        }
        assert.deepEqual(await outbox.retryDueEffects(senders), { sent: 0, failed: 0, skipped: 0 });
      });
    });
  },
);
