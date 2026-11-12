import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, before, beforeEach, test } from "node:test";

// What a new reservation's messages are given: the currency written on the
// reservation travels with them, so the store's new-request email, the customer's
// and the platform's ping state it, whatever the store's is when they go out
// (invariant M2). Every channel is a fake that notes its call.

type Call = { name: string; args: unknown[] };
const CALLS_KEY = "__louezPostCreationTestCalls";
const calls: Call[] = [];
Reflect.set(globalThis, CALLS_KEY, calls);

const noted = (name: string) =>
  `${name}: async (...args) => { globalThis[${JSON.stringify(CALLS_KEY)}].push({ name: ${JSON.stringify(name)}, args }); }`;
const directory = mkdtempSync(join(tmpdir(), "louez-post-creation-"));
const dependenciesPath = join(directory, "dependencies.cjs");
writeFileSync(
  dependenciesPath,
  [
    "module.exports = {",
    // No request scope in a test: the effect runs inline.
    "  after: () => { throw new Error('no request scope'); },",
    "  log: { error() {} },",
    "  markReservationForCalendarSync: async () => {},",
    "  toAnalyticsAmountCents: (amount) => Math.round(Number(amount) * 100),",
    "  productAnalyticsEvents: { checkoutReservationCreated: 'created' },",
    `  ${noted("notifyNewReservation")},`,
    `  ${noted("dispatchCustomerNotification")},`,
    `  ${noted("dispatchNotification")},`,
    `  ${noted("captureProductServerEvent")},`,
    "};",
  ].join("\n"),
);
after(() => rmSync(directory, { recursive: true }));

const STUBBED = new Set([
  "next/server",
  "@/lib/discord/platform-notifications",
  "@/lib/evlog",
  "@/lib/integrations/calendar/sync",
  "@/lib/notifications/customer-dispatcher",
  "@/lib/notifications/dispatcher",
  "@/lib/product-analytics/analytics",
  "@/lib/product-analytics/analytics-events",
]);
Reflect.get(
  nodeModule,
  "registerHooks",
)({
  resolve(
    specifier: string,
    context: { parentURL?: string },
    next: (specifier: string, context: unknown) => unknown,
  ) {
    if (STUBBED.has(specifier) && (context.parentURL ?? "").includes("post-creation-effects.ts")) {
      return { url: pathToFileURL(dependenciesPath).href, shortCircuit: true };
    }
    return next(specifier, context);
  },
});

type Effects = typeof import("./post-creation-effects");
let effects: Effects;
before(async () => {
  effects = await import("./post-creation-effects");
});
beforeEach(() => {
  calls.length = 0;
});

// The store has moved to dollars since the pending checkout was first written.
const store = {
  id: "store_created",
  name: "Harbour Bikes",
  slug: "harbour-bikes",
  email: "contact@bikes.test",
  settings: { currency: "USD", reservationMode: "request" },
} as unknown as Parameters<Effects["notifyRequestReceived"]>[0]["store"];
const customer = {
  id: "customer_created",
  email: "lea@example.test",
  firstName: "Lea",
  lastName: "Martin",
  phone: null,
};
const totals = {
  subtotal: 120,
  discount: 0,
  deposit: 300,
  deliveryFee: 0,
  total: 120,
  taxEnabled: false,
  taxRate: null,
  subtotalExclTax: null,
  taxAmount: null,
} as unknown as Parameters<Effects["notifyRequestReceived"]>[0]["totals"];
const reservation = (currency: string | null) => ({
  id: "res_created",
  number: "R-1001",
  startDate: new Date("2031-05-01T08:00:00Z"),
  endDate: new Date("2031-05-03T08:00:00Z"),
  customerNotes: null,
  currency,
});

/** The currency of the reservation each call was given, by channel. */
const currenciesGiven = () =>
  Object.fromEntries(
    calls.map(({ name, args }) => {
      const context = args[1] as { reservation: { currency?: string | null } };
      return [name, context.reservation.currency];
    }),
  );

test("a new request hands the reservation's currency to the customer's and the store's messages", async () => {
  await effects.notifyRequestReceived({ store, customer, totals, reservation: reservation("EUR") });

  assert.deepEqual(currenciesGiven(), {
    dispatchCustomerNotification: "EUR",
    // The store's new-request email reloads the store: only this tells it the currency.
    dispatchNotification: "EUR",
  });
});

test("a reservation with no currency of its own leaves its messages on the store's", async () => {
  await effects.notifyRequestReceived({ store, customer, totals, reservation: reservation(null) });

  assert.deepEqual(currenciesGiven(), {
    dispatchCustomerNotification: null,
    dispatchNotification: null,
  });
});

test("the funnel event and the platform's ping state the reservation's currency", async () => {
  const run = async (currency: string | null) => {
    calls.length = 0;
    await effects.runPostCreationEffects({
      store,
      reservation: { ...reservation(currency), lineCount: 1, totalQuantity: 1 },
      customer,
      totals,
      delivery: { hasAnyDelivery: false, hasOutboundDelivery: false, hasReturnDelivery: false },
      insurance: { amount: 0, optIn: false },
      promoCodeUsed: false,
    } as unknown as Parameters<Effects["runPostCreationEffects"]>[0]);
    // The event is deferred past the response: let it run.
    await new Promise((resolve) => setImmediate(resolve));
    const event = calls.find((call) => call.name === "captureProductServerEvent");
    const ping = calls.find((call) => call.name === "notifyNewReservation");
    assert.ok(event && ping);
    return [
      (event.args[0] as { properties: { currency: string } }).properties.currency,
      (ping.args[1] as { currency: string }).currency,
    ];
  };

  assert.deepEqual(await run("EUR"), ["EUR", "EUR"]);
  assert.deepEqual(await run(null), ["USD", "USD"]);
});
