import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, before, beforeEach, describe, test } from "node:test";

import { and, eq } from "drizzle-orm";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import { encodePartnerCookie, PARTNER_COOKIE } from "@/lib/partners/partner-cookie";

// Liens partenaires at the storefront's checkout, through its public server
// actions. The partner code check never hands out the perk's promo code: the
// customer sees the discount, and the booking gets the perk from the server,
// for the partner it credits (a typed code, else the link's cookie). A perk
// the customer kept that can no longer be used refuses the booking, which the
// customer makes again without it. The link's cookie counts only when the
// server signed it: a forged or older unsigned one gives no perk and credits
// no one.

/** The server's secret, which signs the partner cookie (read by the actions on import). */
const SECRET = "a-server-secret-for-the-checkout-partner-test";
process.env.AUTH_SECRET = SECRET;

/** The visitor's cookies and address, as `next/headers` reads them. */
const jar = new Map<string, string>();
let visitorIp = "198.51.100.10";
Reflect.set(globalThis, "__louezCheckoutPartnerHeaders", {
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
  }),
  headers: async () => new Headers({ "x-forwarded-for": visitorIp }),
});
const directory = mkdtempSync(join(tmpdir(), "louez-checkout-partner-"));
const headersStub = join(directory, "headers.cjs");
writeFileSync(headersStub, "module.exports = globalThis.__louezCheckoutPartnerHeaders;");
after(() => rmSync(directory, { recursive: true }));

// The checkout modules import Next.js-only guards, the request's headers and
// the file storage SDK.
Reflect.get(
  nodeModule,
  "registerHooks",
)({
  resolve(
    specifier: string,
    context: unknown,
    next: (specifier: string, context: unknown) => unknown,
  ) {
    if (specifier === "server-only" || specifier === "@/lib/storage/files") {
      return { url: "node:module", shortCircuit: true };
    }
    if (specifier === "next/headers") {
      return { url: pathToFileURL(headersStub).href, shortCircuit: true };
    }
    return next(specifier, context);
  },
});

const STORE = "pa_store_00000000001";
const SLUG = "partner-checkout";
const PRODUCT = "pa_product_000000001";
const PERK = "pa_promo_00000000001";
const START = "2030-06-01T09:00:00.000Z";
const END = "2030-06-03T09:00:00.000Z";

describe("partner perks at the checkout (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let actions: typeof import("./actions");
  const partnerCode = "camping-du-port";

  before(async () => {
    database = await createTestDatabase("checkout_partner_perk");
    louezDb = await import("@louez/db");
    actions = await import("./actions");
    await louezDb.db.insert(louezDb.stores).values({
      id: STORE,
      userId: "owner",
      name: "Vélos du Port",
      slug: SLUG,
      settings: {
        reservationMode: "request",
        currency: "EUR",
        advanceNoticeMinutes: 0,
        pendingBlocksAvailability: false,
      },
    });
    await louezDb.db.insert(louezDb.products).values({
      id: PRODUCT,
      storeId: STORE,
      name: "Vélo",
      price: "10.00",
      pricingMode: "day",
      quantity: 10,
    });
    await louezDb.db.insert(louezDb.promoCodes).values({
      id: PERK,
      storeId: STORE,
      code: "PORT10",
      type: "percentage",
      value: "10.00",
      isActive: true,
    });
    await louezDb.db.insert(louezDb.storePartners).values({
      id: "pa_partner_000000001",
      storeId: STORE,
      name: "Camping du Port",
      code: partnerCode,
      commissionType: "percent",
      commissionValue: "10.00",
      statementToken: "s".repeat(43),
      promoCodeId: PERK,
    });
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  beforeEach(async () => {
    jar.clear();
    await louezDb.db.delete(louezDb.apiRateLimits);
    await louezDb.db
      .update(louezDb.promoCodes)
      .set({ isActive: true })
      .where(eq(louezDb.promoCodes.id, PERK));
  });

  let customers = 0;
  /** The checkout's submission for two days of one bike (20 €). */
  const book = (extra: { partnerCode?: string; partnerPerk?: boolean; promoCode?: string }) =>
    actions.createReservation({
      storeId: STORE,
      customer: {
        email: `guest${++customers}@partner-checkout.test`,
        firstName: "Ada",
        lastName: "Lovelace",
      },
      items: [
        {
          productId: PRODUCT,
          quantity: 1,
          startDate: START,
          endDate: END,
          unitPrice: 10,
          depositPerUnit: 0,
        },
      ],
      subtotalAmount: 20,
      depositAmount: 0,
      totalAmount: extra.partnerPerk ? 18 : 20,
      ...extra,
    });

  /** The reservation's promo and discount, and the partner it is credited to. */
  const booked = async (reservationId: string) => {
    const [row] = await louezDb.db
      .select({
        promoCodeId: louezDb.reservations.promoCodeId,
        discountAmount: louezDb.reservations.discountAmount,
      })
      .from(louezDb.reservations)
      .where(eq(louezDb.reservations.id, reservationId));
    const [credit] = await louezDb.db
      .select({ origin: louezDb.partnerBookings.origin })
      .from(louezDb.partnerBookings)
      .where(
        and(
          eq(louezDb.partnerBookings.storeId, STORE),
          eq(louezDb.partnerBookings.reservationId, reservationId),
        ),
      );
    return { ...row, origin: credit?.origin ?? null };
  };

  const clickedAt = () => new Date(Date.now() - 60_000);
  const followLink = () =>
    jar.set(PARTNER_COOKIE, encodePartnerCookie(SLUG, partnerCode, clickedAt(), SECRET));

  test("the code check gives the partner and the perk's discount, never its promo code", async () => {
    const found = await actions.checkPartnerCode({ storeId: STORE, code: partnerCode });
    assert.deepEqual(found, {
      status: "found",
      partner: {
        name: "Camping du Port",
        perk: { type: "percentage", value: 10, minimumAmount: 0 },
      },
    });
    assert.doesNotMatch(JSON.stringify(found), /PORT10/);
    assert.deepEqual(await actions.checkPartnerCode({ storeId: "nowhere", code: partnerCode }), {
      status: "not_found",
    });
  });

  test("the code check is limited per visitor's address; booking is not", async () => {
    visitorIp = "198.51.100.77";
    try {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await actions.checkPartnerCode({ storeId: STORE, code: "nobody" });
      }
      const limited = await actions.checkPartnerCode({ storeId: STORE, code: partnerCode });
      assert.equal(limited.status, "rate_limited");

      followLink();
      const result = await book({ partnerPerk: true });
      assert.ok(result.success, result.error);
    } finally {
      visitorIp = "198.51.100.10";
    }
  });

  test("a link's perk kept at checkout: the server applies its promo code and credits the partner", async () => {
    followLink();
    const result = await book({ partnerPerk: true });
    assert.ok(result.success, result.error);
    assert.deepEqual(await booked(result.reservationId), {
      promoCodeId: PERK,
      discountAmount: "2.00",
      origin: "link",
    });
  });

  test("a typed code's perk: applied, credited by its code", async () => {
    const result = await book({ partnerCode, partnerPerk: true });
    assert.ok(result.success, result.error);
    assert.deepEqual(await booked(result.reservationId), {
      promoCodeId: PERK,
      discountAmount: "2.00",
      origin: "code",
    });
  });

  test("a perk the customer removed is not applied; the partner is still credited", async () => {
    followLink();
    const result = await book({});
    assert.ok(result.success, result.error);
    assert.deepEqual(await booked(result.reservationId), {
      promoCodeId: null,
      discountAmount: "0.00",
      origin: "link",
    });
  });

  test("a perk that can no longer be used refuses the booking; without it, the customer books", async () => {
    followLink();
    await louezDb.db
      .update(louezDb.promoCodes)
      .set({ isActive: false })
      .where(eq(louezDb.promoCodes.id, PERK));
    const count = async () =>
      (
        await louezDb.db
          .select({ id: louezDb.reservations.id })
          .from(louezDb.reservations)
          .where(eq(louezDb.reservations.storeId, STORE))
      ).length;
    const before = await count();

    assert.deepEqual(await book({ partnerPerk: true }), {
      error: "errors.partnerPerkUnavailable",
    });
    assert.equal(await count(), before);

    const again = await book({});
    assert.ok(again.success, again.error);
    assert.equal((await booked(again.reservationId)).origin, "link");
  });

  test("a cookie the server did not sign gives no perk and credits no one", async () => {
    const seconds = Math.floor(clickedAt().getTime() / 1000);
    const lifted = encodePartnerCookie(SLUG, "hotel-du-port", clickedAt(), SECRET).split(".")[3];
    for (const forged of [
      // The format before the cookie was signed.
      `${SLUG}.${partnerCode}.${seconds}`,
      // Signed with another secret, or a signature lifted onto another code.
      encodePartnerCookie(SLUG, partnerCode, clickedAt(), "not-the-server-secret"),
      `${SLUG}.${partnerCode}.${seconds}.${lifted}`,
    ]) {
      jar.set(PARTNER_COOKIE, forged);
      assert.deepEqual(await book({ partnerPerk: true }), {
        error: "errors.partnerPerkUnavailable",
      });
      const result = await book({});
      assert.ok(result.success, result.error);
      assert.deepEqual(await booked(result.reservationId), {
        promoCodeId: null,
        discountAmount: "0.00",
        origin: null,
      });
    }
  });

  test("without a partner, a kept perk is refused, whatever the client claims", async () => {
    assert.deepEqual(await book({ partnerPerk: true }), {
      error: "errors.partnerPerkUnavailable",
    });
  });
});
