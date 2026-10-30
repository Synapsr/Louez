import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { after, before, describe, test } from "node:test";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import { formatMinor } from "@/lib/billing/billing-format";
import { BILLING_SETTINGS_PATH } from "@/lib/billing/billing-routes";
import type { sendBalanceLimitEmail } from "@/lib/email/send";

import {
  type FakeBillingService,
  startFakeBillingService,
  useFakeServiceEnv,
} from "./fake-billing-service.fixtures";

// The balance limit's email (louez-billing docs/api, README §8.8): to the store's
// owner, in the store's language, with the balance and the limit the overview gives
// when it is sent. The amounts are neutral test values. The email itself is stubbed.

// The email's logo helper imports "server-only", which throws outside Next.
Reflect.get(
  nodeModule,
  "registerHooks",
)({
  resolve(
    specifier: string,
    context: unknown,
    next: (specifier: string, context: unknown) => unknown,
  ) {
    return specifier === "server-only"
      ? { url: "node:module", shortCircuit: true }
      : next(specifier, context);
  },
});

type SentEmail = Parameters<typeof sendBalanceLimitEmail>[0];

const overview = (balance: unknown) => ({
  at: "2027-02-10T09:00:00.000Z",
  timeZone: "Europe/Paris",
  tariff: { kind: "offer", label: "Test" },
  card: "missing",
  savedCard: null,
  notice: null,
  blocked: null,
  month: null,
  balance,
  cardSetupUnavailable: null,
});

describe("balance limit email (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let service: FakeBillingService;
  let restoreEnv: () => void;
  let louezDb: typeof import("@louez/db");
  let email: typeof import("./balance-limit-email");

  before(async () => {
    database = await createTestDatabase("balance_limit_email");
    service = await startFakeBillingService();
    restoreEnv = useFakeServiceEnv(service);
    louezDb = await import("@louez/db");
    email = await import("./balance-limit-email");
    await louezDb.db.insert(louezDb.users).values([
      { id: "u_bal_fr", email: "owner-fr@louez.test" },
      { id: "u_bal_de", email: "owner-de@louez.test" },
    ]);
    const store = (id: string, userId: string, country: string, currency: string) => ({
      id,
      userId,
      name: `Store ${id}`,
      slug: id.replaceAll("_", "-"),
      email: `${id}@store.test`,
      settings: { reservationMode: "payment" as const, advanceNoticeMinutes: 0, country, currency },
    });
    await louezDb.db
      .insert(louezDb.stores)
      .values([
        store("bal_fr", "u_bal_fr", "FR", "EUR"),
        store("bal_de", "u_bal_de", "DE", "EUR"),
        store("bal_back", "u_bal_fr", "FR", "EUR"),
        store("bal_none", "u_bal_fr", "FR", "EUR"),
        store("bal_down", "u_bal_fr", "FR", "EUR"),
      ]);
    service.handle("/stores/bal_fr/billing", () => ({
      status: 200,
      body: overview({ currency: "EUR", amountMinor: 1234, limitMinor: 1500, standing: "near" }),
    }));
    service.handle("/stores/bal_de/billing", () => ({
      status: 200,
      body: overview({ currency: "EUR", amountMinor: 2000, limitMinor: 1500, standing: "reached" }),
    }));
    service.handle("/stores/bal_back/billing", () => ({
      status: 200,
      body: overview({ currency: "EUR", amountMinor: 0, limitMinor: 1500, standing: "ok" }),
    }));
    service.handle("/stores/bal_none/billing", () => ({ status: 200, body: overview(null) }));
    service.handle("/stores/bal_down/billing", () => ({ status: 503 }));
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await service?.close();
    restoreEnv?.();
    await database?.drop();
  });

  test("the owner gets the overview's balance and limit, in the store's language", async () => {
    const sent: SentEmail[] = [];
    await email.notifyBalanceLimitCrossings(
      [
        { storeId: "bal_fr", version: 2 },
        { storeId: "bal_de", version: 7 },
      ],
      async (input) => {
        sent.push(input);
        return { success: true };
      },
    );

    assert.equal(sent.length, 2);
    const [fr, de] = sent;
    assert.equal(fr?.variant, "near");
    assert.equal(fr?.to, "owner-fr@louez.test");
    assert.equal(fr?.storeId, "bal_fr");
    assert.equal(fr?.locale, "fr");
    assert.equal(fr?.balance, formatMinor(1234, "EUR", "fr"));
    assert.equal(fr?.limit, formatMinor(1500, "EUR", "fr"));
    assert.ok(fr?.ctaUrl.endsWith(BILLING_SETTINGS_PATH));
    assert.equal(de?.variant, "reached");
    assert.equal(de?.to, "owner-de@louez.test");
    assert.equal(de?.locale, "de");
    // The overview's words come in French for a French store, otherwise in English.
    const targets = service.requests.map((request) => request.target);
    assert.ok(targets.includes("/api/v1/louez/stores/bal_fr/billing?lang=fr"));
    assert.ok(targets.includes("/api/v1/louez/stores/bal_de/billing?lang=en"));
  });

  test("nothing is sent without a balance, back under the limit, or for a missing store", async () => {
    const sent: SentEmail[] = [];
    await email.notifyBalanceLimitCrossings(
      [
        { storeId: "bal_back", version: 3 },
        { storeId: "bal_none", version: 1 },
        { storeId: "bal_down", version: 1 },
        { storeId: "bal_gone", version: 1 },
      ],
      async (input) => {
        sent.push(input);
        return { success: true };
      },
    );
    assert.deepEqual(sent, []);
  });

  test("a failed send is logged and the next store still gets its email", async () => {
    const sent: string[] = [];
    await email.notifyBalanceLimitCrossings(
      [
        { storeId: "bal_fr", version: 2 },
        { storeId: "bal_de", version: 7 },
      ],
      async (input) => {
        if (input.storeId === "bal_fr") throw new Error("smtp down");
        sent.push(input.storeId);
        return { success: true };
      },
    );
    assert.deepEqual(sent, ["bal_de"]);
  });
});
