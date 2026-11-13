import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { after, before, describe, mock, test } from "node:test";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import type { Consequence } from "./approval-rule";
import { createMemoryStorage } from "./memory-storage";
import { createTestNewStores } from "./test-new-stores";
import { createTestProductImages } from "./test-product-images";
import { createTestUrls } from "./test-urls";

// tsx loads these packages as CommonJS, whose `export *` names ESM cannot see.
const require = createRequire(import.meta.url);
for (const name of [
  "@louez/types",
  "@louez/utils",
  "@louez/utils/sanitize-rich-text",
  "@louez/validations",
]) {
  const namedExports: Record<string, unknown> = require(name);
  mock.module(name, { namedExports });
}

// Better Auth stays out: every caller here is built in memory.
mock.module("@louez/auth", { namedExports: { auth: {}, authInstance: { api: {} } } });

// Who is asked for a confirmation today, at every place that can ask: each
// sensitive procedure's handler and the confirmation it builds, for each
// branch its preview can take, for a dashboard session, an API key and an
// assistant's connection (OAuth), with the connection's option on and off.
// Where it asks: the preview the caller is shown, the binding of the token,
// and the token's flow (it passes once, then no more).
//
// The services that run under their locks are replaced by a stand-in that
// keeps the confirmation the handler built and stops there: the test then
// asks it with each branch's preview, in a transaction of the test database,
// as the service would. What decides whether to ask (the handler, its
// confirmation, `checkConfirmation`) runs as it is. Three places ask outside
// a service's `confirm` and run for real: `stores.create` in its handler, the
// AI photo runs in `startImageJob`, and the transport tests' fixture.
//
// Each call also records the consequences the place declared, as they reach
// the rule (`confirmationStep`, wrapped below), against a table written here:
// a branch whose declaration changes fails even where today's answer stays the
// same. The token's lifetime is pinned at ten minutes, and tried just before
// and at its end on a test clock. The status changes run once more through
// the real service, which picks the branch from the reservation: from
// `pending` or `quote`, each override, something short or nothing, a message
// or none; a rejection and a cancellation sent a flag.

const USER = "cs_owner_user_000001";
const STORE = "cs_store_a_000000001";
const KEY = "cs_api_key_000000001";
const GRANT = "cs_grant_00000000001";
const FILES = "https://files.louez.test";
const PHOTO = `${FILES}/${STORE}/products/photo.png`;
const PRODUCT = "cs_product_000000001";
const AT = new Date("2027-03-01T09:00:00.000Z");
const UNTIL = new Date("2027-03-03T09:00:00.000Z");

const STOPPED = "the service stand-in stopped here";

type Kind = "session" | "api_key" | "oauth";
type Confirm = (preview: unknown, tx: unknown) => Promise<Error | null>;

/** The service functions that take a `confirm` step, by module. */
const STAND_INS: Record<string, string[]> = {
  "../services/products": ["updateProduct", "updateProductStatus", "deleteProduct"],
  "../services/product-seasonal-pricing": ["deleteSeasonalPricing"],
  "../services/product-units": [
    "declareDowntime",
    "updateDowntime",
    "deleteDowntime",
    "retireUnit",
  ],
  "../services/product-variants": [
    "deleteVariantDefinition",
    "withdrawVariantFromProducts",
    "deleteVariantValue",
  ],
  "../services/categories": ["deleteCategory"],
  "../services/settings": [
    "updateCompany",
    "updateReservationRules",
    "updateDelivery",
    "updateTaxes",
  ],
  "../services/legal-profile": ["upsertLegalProfile"],
  "../services/online-store": ["updateStoreSlug"],
  "../services/launch": ["goLive"],
  "../services/team": ["cancelInvitation", "removeMember"],
  "../services/reservation-status": ["changeStoreReservationStatus"],
  "../services/payment-records": ["recordPayment", "recordDepositReturn", "deletePayment"],
};

/**
 * The payment writes' step takes the transaction first, then the preview with
 * the state it binds; the branches below hand it that pair.
 */
const TRANSACTION_FIRST = new Set(["recordPayment", "recordDepositReturn", "deletePayment"]);

let captured: Confirm | null = null;

/** The consequences each call handed the rule, in order. */
let emitted: Array<readonly Consequence[]> = [];

/** The status changes run through the real service, which stops once it has asked. */
let throughStatusService = false;
let statusAsked: { preview: StatusPreview; refusal: Error | null } | null = null;

interface StatusPreview {
  messages: unknown[];
  overbooking: { shortfalls: unknown[] } | null;
  turnoverBuffer: { shortfalls: unknown[] } | null;
}

/**
 * Puts the stand-ins in place of the services, before the routers load (and
 * once the test database is there: the services load the database client).
 */
async function installStandIns() {
  // First, before any module that asks loads it: the rule, as it is, with
  // what each call declared kept.
  const rule: Record<string, unknown> = await import("./approval-rule");
  const confirmationStep = rule.confirmationStep as (
    consequences: readonly Consequence[],
    credential: unknown,
  ) => unknown;
  mock.module(import.meta.resolve("./approval-rule"), {
    namedExports: {
      ...rule,
      confirmationStep: (consequences: readonly Consequence[], credential: unknown) => {
        emitted.push([...consequences]);
        return confirmationStep(consequences, credential);
      },
    },
  });

  for (const [specifier, names] of Object.entries(STAND_INS)) {
    const actual: Record<string, unknown> = await import(specifier);
    const namedExports: Record<string, unknown> = { ...actual };
    for (const name of names) {
      assert.equal(typeof actual[name], "function", `${specifier} exports ${name}`);
      namedExports[name] = async (...args: unknown[]) => {
        const options = args.findLast(
          (arg): arg is { confirm: Confirm } =>
            typeof arg === "object" && arg !== null && "confirm" in arg,
        );
        assert.ok(options, `${name} was given a confirm step`);
        captured = TRANSACTION_FIRST.has(name)
          ? (preview, tx) => options.confirm(tx, preview)
          : options.confirm;
        if (throughStatusService && name === "changeStoreReservationStatus") {
          // The real service picks the branch; it stops once it has asked,
          // inside its transaction, so nothing is written.
          const real = actual[name] as (...real: unknown[]) => Promise<unknown>;
          return real(...args.slice(0, -1), {
            ...options,
            confirm: async (preview: StatusPreview, tx: unknown) => {
              statusAsked = { preview, refusal: await options.confirm(preview, tx) };
              throw new Error(STOPPED);
            },
          });
        }
        throw new Error(STOPPED);
      };
    }
    mock.module(import.meta.resolve(specifier), { namedExports });
  }

  // The store's creation asks in its handler; what runs before is let
  // through, and the creation itself stops.
  const specifier = "../services/store-creation";
  const actual: Record<string, unknown> = await import(specifier);
  mock.module(import.meta.resolve(specifier), {
    namedExports: {
      ...actual,
      resolvePendingReferral: async () => ({ attribution: null }),
      assertInstanceTakesAStore: async () => {},
      assertUnderCreationLimit: async () => {},
      assertSlugFree: async () => {},
      createStore: async () => {
        throw new Error(STOPPED);
      },
    },
  });
}

// --- The places that ask, and their branches -----------------------------------

interface Branch {
  name: string;
  /** The preview the service hands its confirm step (none where the procedure asks by itself). */
  preview?: unknown;
  /** Asked of a key or a token whose connection's option is off. */
  asksWithOptionOff: boolean;
  /** Not asked by anyone: the branch runs without a preview. */
  neverAsks?: boolean;
}

interface Site {
  /** The router path of the procedure. */
  path: [string, string, string];
  input: Record<string, unknown>;
  /** How the call stops: the stand-in, else the procedure itself (it runs for real). */
  runsForReal?: boolean;
  branches: Branch[];
}

const unit = { id: "cs_unit_00000000001", identifier: "Bike 1" };
const product = { id: PRODUCT, name: "City bike" };
const productRow = { ...product, status: "active", updatedAt: AT };
const changes = { currency: { from: "EUR", to: "USD" } };

const statusPreview = (overrides: Record<string, unknown>) => ({
  summary: "Confirm reservation R-1.",
  reservation: {
    id: "cs_reservation_00001",
    number: "R-1",
    from: "pending",
    to: "confirmed",
    startDate: AT.toISOString(),
    endDate: UNTIL.toISOString(),
    totalAmount: "80.00",
    currency: "EUR",
  },
  customer: { name: "Ann Lee", email: "ann@cs.test" },
  messages: [],
  reducesAvailability: true,
  overbooking: null,
  turnoverBuffer: null,
  money: null,
  insuranceContract: null,
  recipientsHash: "recipients",
  ...overrides,
});
const shortfall = {
  reservationItemId: "cs_item_000000000001",
  productId: PRODUCT,
  productName: "City bike",
  requested: 2,
  available: 1,
};

const SITES: Site[] = [
  {
    path: ["dashboard", "products", "update"],
    input: { id: PRODUCT, name: "City bike" },
    branches: [
      {
        name: "archives",
        preview: {
          summary: "Archive City bike.",
          product: productRow,
          archives: true,
          deletedTierCount: 0,
          deletedSeasonalPricingCount: 0,
          deletedUnits: [],
        },
        asksWithOptionOff: false,
      },
      {
        name: "deletes units and tiers",
        preview: {
          summary: "Update City bike: deletes a unit and a tier.",
          product: productRow,
          archives: false,
          deletedTierCount: 1,
          deletedSeasonalPricingCount: 1,
          deletedUnits: [{ ...unit, attributes: {} }],
        },
        asksWithOptionOff: false,
      },
    ],
  },
  {
    path: ["dashboard", "products", "updateStatus"],
    input: { id: PRODUCT, status: "archived" },
    branches: [
      {
        name: "archives",
        preview: { summary: "Archive City bike.", product: productRow, activeReservationCount: 2 },
        asksWithOptionOff: false,
      },
    ],
  },
  {
    path: ["dashboard", "products", "delete"],
    input: { id: PRODUCT },
    branches: [
      {
        name: "deletes",
        preview: {
          summary: "Delete City bike.",
          product: { ...product, updatedAt: AT },
          units: [unit],
          reservationCount: 3,
        },
        asksWithOptionOff: false,
      },
    ],
  },
  {
    path: ["dashboard", "products", "deleteSeasonalPricing"],
    input: { id: "cs_season_0000000001" },
    branches: [
      {
        name: "deletes",
        preview: {
          summary: "Delete the season Summer.",
          season: {
            id: "cs_season_0000000001",
            name: "Summer",
            startDate: "2027-07-01",
            endDate: "2027-08-31",
            price: "30.00",
            updatedAt: AT,
          },
          product,
          tierCount: 2,
        },
        asksWithOptionOff: false,
      },
    ],
  },
  ...(["declareDowntime", "updateDowntime", "retireUnit"] as const).map(
    (name): Site => ({
      path: ["dashboard", "products", name],
      input: { unitId: unit.id, downtimeId: "cs_downtime_00000001", reason: "repair" },
      branches: [
        {
          name: "conflicts",
          preview: {
            summary: "Bike 1 leaves the stock.",
            unit,
            product,
            window: { start: AT, end: UNTIL },
            conflicts: [],
          },
          asksWithOptionOff: false,
        },
      ],
    }),
  ),
  {
    path: ["dashboard", "products", "deleteDowntime"],
    input: { downtimeId: "cs_downtime_00000001" },
    branches: [
      {
        name: "deletes",
        preview: {
          summary: "Delete the downtime of Bike 1.",
          unit,
          product,
          downtime: {
            id: "cs_downtime_00000001",
            reason: "repair",
            startsAt: AT,
            endsAt: null,
            note: null,
          },
        },
        asksWithOptionOff: false,
      },
    ],
  },
  {
    path: ["dashboard", "products", "deleteVariantDefinition"],
    input: { id: "cs_variant_000000001" },
    branches: [
      {
        name: "deletes the entry",
        preview: {
          summary: "Delete the variant Size.",
          definition: { id: "cs_variant_000000001", key: "size", label: "Size", valueIds: ["v1"] },
        },
        asksWithOptionOff: false,
      },
    ],
  },
  {
    path: ["dashboard", "products", "withdrawVariantFromProducts"],
    input: { id: "cs_variant_000000001" },
    branches: [
      {
        name: "products use it",
        preview: {
          summary: "Withdraw Size from 1 product.",
          definition: { id: "cs_variant_000000001", key: "size", label: "Size" },
          products: [product],
        },
        asksWithOptionOff: false,
      },
      {
        name: "no product uses it",
        preview: {
          summary: "Withdraw Size: no product uses it.",
          definition: { id: "cs_variant_000000001", key: "size", label: "Size" },
          products: [],
        },
        asksWithOptionOff: false,
      },
    ],
  },
  {
    path: ["dashboard", "products", "deleteVariantValue"],
    input: { id: "cs_value_00000000001" },
    branches: [
      {
        name: "deletes the entry",
        preview: {
          summary: "Delete the value M.",
          value: { id: "cs_value_00000000001", label: "M" },
          definition: { id: "cs_variant_000000001", label: "Size" },
          products: [product],
        },
        asksWithOptionOff: false,
      },
    ],
  },
  {
    path: ["dashboard", "categories", "delete"],
    input: { id: "cs_category_00000001" },
    branches: [
      {
        name: "deletes",
        preview: {
          summary: "Delete the category Bikes.",
          category: { id: "cs_category_00000001", name: "Bikes", updatedAt: AT },
          replacement: null,
          affectedProductCount: 2,
          uncategorizedProductCount: 2,
        },
        asksWithOptionOff: false,
      },
    ],
  },
  ...(["updateCompany", "updateReservationRules", "updateDelivery", "updateTaxes"] as const).map(
    (name): Site => ({
      path: ["dashboard", "settings", name],
      input: { currency: "USD" },
      branches: [
        {
          name: "changes",
          preview: { summary: "Customers pay in USD.", changes },
          asksWithOptionOff: false,
        },
      ],
    }),
  ),
  {
    path: ["dashboard", "settings", "upsertLegalProfile"],
    input: { legalName: "Cycles SARL" },
    branches: [
      {
        name: "changes",
        preview: {
          summary: "Invoices name Cycles SARL.",
          changes: { legalName: { from: "", to: "Cycles SARL" } },
        },
        asksWithOptionOff: false,
      },
    ],
  },
  {
    path: ["dashboard", "onlineStore", "updateSlug"],
    input: { slug: "cs-new" },
    branches: [
      {
        name: "store online",
        preview: {
          summary: "Move the storefront to cs-new.",
          previousSlug: "cs-store",
          slug: "cs-new",
          previousUrl: "https://cs-store.louez.test/",
          url: "https://cs-new.louez.test/",
          online: true,
        },
        asksWithOptionOff: false,
      },
      {
        name: "store offline",
        preview: {
          summary: "Move the storefront to cs-new.",
          previousSlug: "cs-store",
          slug: "cs-new",
          previousUrl: "https://cs-store.louez.test/",
          url: "https://cs-new.louez.test/",
          online: false,
        },
        asksWithOptionOff: false,
      },
    ],
  },
  {
    path: ["dashboard", "stores", "completeOnboarding"],
    input: {},
    branches: [
      {
        name: "goes live",
        preview: {
          summary: "Put the store online.",
          storefrontUrl: "https://cs-store.louez.test/",
          bookingMode: "request",
          statuses: { products: "done" },
          warnings: [],
          legalStatuses: {},
          toCheck: [],
          customersWillSee: ["Your products."],
          stillMissing: [],
          optional: [],
        },
        asksWithOptionOff: false,
      },
    ],
  },
  {
    path: ["dashboard", "team", "cancelInvitation"],
    input: { id: "cs_invitation_000001" },
    branches: [
      {
        name: "cancels",
        preview: {
          summary: "Cancel the invitation of bob@cs.test.",
          invitation: {
            id: "cs_invitation_000001",
            email: "bob@cs.test",
            role: "member",
            expiresAt: UNTIL,
          },
        },
        asksWithOptionOff: true,
      },
    ],
  },
  {
    path: ["dashboard", "team", "removeMember"],
    input: { id: "cs_membership_000001" },
    branches: [
      {
        name: "removes",
        preview: {
          summary: "Remove bob@cs.test from the store.",
          member: {
            id: "cs_membership_000001",
            userId: "cs_member_user_00001",
            email: "bob@cs.test",
            role: "member",
          },
        },
        asksWithOptionOff: true,
      },
    ],
  },
  ...(
    [
      ["updateStatus", { id: "cs_reservation_00001", status: "confirmed" }],
      ["cancel", { id: "cs_reservation_00001" }],
    ] as const
  ).map(
    ([name, input]): Site => ({
      path: ["dashboard", "reservations", name],
      input,
      // A cancellation takes no stock: the service never sets an override on
      // its preview, so it has the message branches only.
      branches: [
        {
          name: "a message goes",
          preview: statusPreview({ messages: [{ message: "accepted", channel: "email" }] }),
          asksWithOptionOff: false,
        },
        {
          name: "no message",
          preview: statusPreview({}),
          asksWithOptionOff: false,
        },
        {
          name: "booked over the stock, nothing short",
          preview: statusPreview({ overbooking: { shortfalls: [] } }),
          asksWithOptionOff: true,
        },
        {
          name: "booked over the stock, a message goes",
          preview: statusPreview({
            overbooking: { shortfalls: [shortfall] },
            messages: [{ message: "accepted", channel: "email" }],
          }),
          asksWithOptionOff: true,
        },
        {
          name: "past the turnover buffer",
          preview: statusPreview({
            turnoverBuffer: { shortfalls: [shortfall], turnoverBufferMinutes: 60 },
          }),
          asksWithOptionOff: true,
        },
      ].slice(0, name === "cancel" ? 2 : undefined),
    }),
  ),
  // The three payment writes ask in their transaction, under the
  // reservation's lock, with the preview and the state the token binds. The
  // deletion is money too: it erases a record of money received.
  {
    path: ["dashboard", "payments", "record"],
    input: {
      reservationId: "cs_reservation_00001",
      type: "rental",
      amount: "80.00",
      method: "cash",
    },
    branches: [
      {
        name: "records a payment",
        preview: {
          preview: {
            summary: "Record a rental payment of €80.00 (cash) on reservation #R-1.",
            details: {
              reservationId: "cs_reservation_00001",
              number: "R-1",
              type: "rental",
              amount: "80.00",
              method: "cash",
            },
          },
          state: { status: "confirmed" },
        },
        asksWithOptionOff: true,
      },
    ],
  },
  {
    path: ["dashboard", "payments", "recordDepositReturn"],
    input: { reservationId: "cs_reservation_00001", amount: "50.00", method: "cash" },
    branches: [
      {
        name: "records a return",
        preview: {
          preview: {
            summary: "Record a deposit return of €50.00 (cash) on reservation #R-1.",
            details: {
              reservationId: "cs_reservation_00001",
              number: "R-1",
              amount: "50.00",
              method: "cash",
              returnable: "50.00",
            },
          },
          state: { returnable: "50.00" },
        },
        asksWithOptionOff: true,
      },
    ],
  },
  {
    path: ["dashboard", "payments", "delete"],
    input: { paymentId: "cs_payment_000000001" },
    branches: [
      {
        name: "deletes",
        preview: {
          preview: {
            summary: "Delete the deposit payment of €50.00 (cash) on reservation #R-1.",
            details: {
              paymentId: "cs_payment_000000001",
              number: "R-1",
              type: "deposit",
              amount: "50.00",
              method: "cash",
            },
          },
          state: { amount: "50.00", status: "completed" },
        },
        asksWithOptionOff: true,
      },
    ],
  },
  {
    path: ["dashboard", "stores", "create"],
    input: {
      name: "Brest Bikes",
      slug: "cs-brest-bikes",
      country: "FR",
      currency: "EUR",
      address: "1 quai de la Douane, 29200 Brest",
      email: "hello@cs.test",
      phone: "+33600000000",
    },
    runsForReal: true,
    branches: [{ name: "creates", asksWithOptionOff: false }],
  },
  ...(["enhanceImage", "removeImageBackground"] as const).map(
    (name): Site => ({
      path: ["dashboard", "products", name],
      input: { id: PRODUCT, imageUrl: PHOTO },
      runsForReal: true,
      branches: [
        { name: "priced", asksWithOptionOff: true },
        { name: "free", asksWithOptionOff: false, neverAsks: true },
      ],
    }),
  ),
  {
    path: ["fixture", "notes", "remove"],
    input: { id: "note_1" },
    runsForReal: true,
    branches: [{ name: "removes", asksWithOptionOff: false }],
  },
];

/**
 * A fingerprint, per place and branch, of what each caller asked is shown
 * (the answer's message and preview) and of what its token is bound to: the
 * same as before any change to how confirmations are asked.
 */
const FINGERPRINTS: Record<string, string> = {
  "fixture.notes.remove, removes":
    "89982eb0fae061b990907db3e8df6a912e1b78efd17e807cf2316faba7f34c17",
  "dashboard.products.update, archives":
    "d1c5616488c0e133f42fec29688c5ce261cb1199b6b754948b515cd5bafe8ce3",
  "dashboard.products.update, deletes units and tiers":
    "1a7b54e9c4c1179fbb925aeb85799b8b02b4abcd96716578333bb5dd82d1f7fa",
  "dashboard.products.updateStatus, archives":
    "d56ff907e1721e29968e4a1a6028fd6c38232e3c96bfc9052854169e9023b30d",
  "dashboard.products.delete, deletes":
    "d39a8dfb291e4afc43eefc311005fc1a02a0183fe488348f4ce3e83e6c730d61",
  "dashboard.products.deleteSeasonalPricing, deletes":
    "9652a5a3a77213f5bf2e4c596009ddbe69532004b029c8d8a5c5780401f543c3",
  "dashboard.products.declareDowntime, conflicts":
    "162bfe327686e721ae75a39fd53bf3fe77571697269536ac58c9135d645e0cf1",
  "dashboard.products.updateDowntime, conflicts":
    "e1e8985bd0e79c3df66282eabdc7da9f0e022b179a75ecffe8333cc5b13d17c9",
  "dashboard.products.retireUnit, conflicts":
    "9d3ed7ca96d3068b91ccbf8332442581436d0dcbb50d18e88166fad07db2a400",
  "dashboard.products.deleteDowntime, deletes":
    "54c853b317b2e863a1672001a6e2cf3d93518b7a291486a1cf7d05030463e38a",
  "dashboard.products.deleteVariantDefinition, deletes the entry":
    "1fe8ed219ab4dab967ca0dfd56e90d24570cbb3d6b1200b580b4fbc566a70715",
  "dashboard.products.withdrawVariantFromProducts, products use it":
    "1d5ef3c6e80f606573590cedc18e46b8c8c944a207b335d7f2318f8d9579d902",
  "dashboard.products.withdrawVariantFromProducts, no product uses it":
    "864822bf64051a4150f3ce4ec19c1f268f39291f90f3dec7aa34bf0f3928f588",
  "dashboard.products.deleteVariantValue, deletes the entry":
    "2c3ddc73a489e3e874596defa4f6c6a8a2102f331835908a271f95813996aad0",
  "dashboard.categories.delete, deletes":
    "db790c0a3d8e352bff70e8209d61cb4b72cd73a0d0ba951049110318d38d337a",
  "dashboard.settings.updateCompany, changes":
    "4c5afca80342dcd337daaee1de313487680d858d96545c4425b6ebc37217f6b3",
  "dashboard.settings.updateReservationRules, changes":
    "05ce3f07bdbdc7099f33e6ae193d7e6550d06ade16aaa58e467f53f36bfb295e",
  "dashboard.settings.updateDelivery, changes":
    "d2a1f383b1a6cbd0d50a836cdd5d705a895bdf3b9bab9ca9a4de09e2749c8e04",
  "dashboard.settings.updateTaxes, changes":
    "111a61219e55d91e3555f2c2199cfaecdb8115eac387e47c8e149240cd1f626d",
  "dashboard.settings.upsertLegalProfile, changes":
    "8650f650eb576e3dbea8abb10718be5c0ba370c0aa5828e57a8c026eb2431162",
  "dashboard.onlineStore.updateSlug, store online":
    "89b6d9d030ab179f57915f97c91f8233f1bdf46b7086a350e0d12e74f933c928",
  "dashboard.onlineStore.updateSlug, store offline":
    "78f3e43c3a791d23a741deea2a2fabb4e3e357fa492b218e63edc678556331bb",
  "dashboard.stores.completeOnboarding, goes live":
    "c9f0eaaaf776fd2f5f0ebad31cb8cf816d5c1484e1c692df27cbaeb554901526",
  "dashboard.team.cancelInvitation, cancels":
    "9e987a8272e5fe2ae5866225bc77abf6982ed52ecf59b82935ef85164112ee3f",
  "dashboard.team.removeMember, removes":
    "922da19e5307ba4a2a76939d278670616af0c5821ea2d785007c899539ea9635",
  "dashboard.reservations.updateStatus, a message goes":
    "37650d5e95d66d9acb818f3e84580b9bb5dda8819f1d5e8881b0e428cfac7299",
  "dashboard.reservations.updateStatus, no message":
    "97f4e6411befe5d319e0c5a2b052fad142118aa9eb03d332cd90b4d6cec38406",
  "dashboard.reservations.updateStatus, booked over the stock, nothing short":
    "4d5e9b81a015b03eb6010206889f7f2ae3a9091a076a4384a106fb1f2851f9d6",
  "dashboard.reservations.updateStatus, booked over the stock, a message goes":
    "2f14f1fd637ec249a5bdf689ee93792795f04720bed4fb61b1d9fadda9fa3ebd",
  "dashboard.reservations.updateStatus, past the turnover buffer":
    "e89b33198c23b22454f505af923922f86880d1a745711690f26382570670b807",
  "dashboard.reservations.cancel, a message goes":
    "bfd6897c223270bdc61a2fd3082c8bb97da3eb369ae94cf6c738a84af9f22e5f",
  "dashboard.reservations.cancel, no message":
    "0c4213cf9f48761267bb8fa2d0862ae1db4ce4c6e00a2c082b9feea305db2417",
  "dashboard.payments.record, records a payment":
    "5dc4e9b7580e0f12b141acf99724ef683068990a543b6cbb5ce3cd9dfa7431f0",
  "dashboard.payments.recordDepositReturn, records a return":
    "83c6191808fff5376d85199787c8949c427393f9f2e68b45c0a682aa440304da",
  "dashboard.payments.delete, deletes":
    "b9d4c93529b32260d7e4cae338d168da7ab86e9448f83051aa1fe2aa84bf46d4",
  "dashboard.stores.create, creates":
    "ad17363db02c0e1e3c6f488f11b118ff4ca0b64236d2b4d2a13efc65658627ef",
  "dashboard.products.enhanceImage, priced":
    "a7c8f4d2ccfcbbb835c4ba4a3447bf235a2266535366c347574a839d887807e5",
  "dashboard.products.enhanceImage, free":
    "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
  "dashboard.products.removeImageBackground, priced":
    "e24f296d8987d46e1021b32946b7eea62118a0ab2724a8c93f6f9f24e5d213ad",
  "dashboard.products.removeImageBackground, free":
    "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
};

/**
 * What each place and branch declares, as the rule receives it: the same for
 * every caller, a session included. None where the branch never asks.
 */
const CONSEQUENCES: Record<string, readonly Consequence[] | null> = {
  "fixture.notes.remove, removes": ["deletion"],
  "dashboard.products.update, archives": ["change"],
  "dashboard.products.update, deletes units and tiers": ["deletion"],
  "dashboard.products.updateStatus, archives": ["change"],
  "dashboard.products.delete, deletes": ["deletion"],
  "dashboard.products.deleteSeasonalPricing, deletes": ["deletion"],
  "dashboard.products.declareDowntime, conflicts": ["change"],
  "dashboard.products.updateDowntime, conflicts": ["change"],
  "dashboard.products.retireUnit, conflicts": ["change"],
  "dashboard.products.deleteDowntime, deletes": ["change"],
  "dashboard.products.deleteVariantDefinition, deletes the entry": ["change"],
  "dashboard.products.withdrawVariantFromProducts, products use it": ["deletion"],
  "dashboard.products.withdrawVariantFromProducts, no product uses it": ["change"],
  "dashboard.products.deleteVariantValue, deletes the entry": ["change"],
  "dashboard.categories.delete, deletes": ["deletion"],
  "dashboard.settings.updateCompany, changes": ["change"],
  "dashboard.settings.updateReservationRules, changes": ["change"],
  "dashboard.settings.updateDelivery, changes": ["change"],
  "dashboard.settings.updateTaxes, changes": ["change"],
  "dashboard.settings.upsertLegalProfile, changes": ["change"],
  "dashboard.onlineStore.updateSlug, store online": ["deletion"],
  "dashboard.onlineStore.updateSlug, store offline": ["change"],
  "dashboard.stores.completeOnboarding, goes live": ["change"],
  "dashboard.team.cancelInvitation, cancels": ["access_removed"],
  "dashboard.team.removeMember, removes": ["access_removed"],
  "dashboard.reservations.updateStatus, a message goes": ["customer_message"],
  "dashboard.reservations.updateStatus, no message": ["change"],
  "dashboard.reservations.updateStatus, booked over the stock, nothing short": ["stock_override"],
  "dashboard.reservations.updateStatus, booked over the stock, a message goes": [
    "stock_override",
    "customer_message",
  ],
  "dashboard.reservations.updateStatus, past the turnover buffer": ["stock_override"],
  "dashboard.reservations.cancel, a message goes": ["customer_message"],
  "dashboard.reservations.cancel, no message": ["change"],
  "dashboard.payments.record, records a payment": ["money"],
  "dashboard.payments.recordDepositReturn, records a return": ["money"],
  "dashboard.payments.delete, deletes": ["money"],
  "dashboard.stores.create, creates": ["change"],
  "dashboard.products.enhanceImage, priced": ["credits"],
  "dashboard.products.enhanceImage, free": null,
  "dashboard.products.removeImageBackground, priced": ["credits"],
  "dashboard.products.removeImageBackground, free": null,
};

/** A token's lifetime, written out: ten minutes. */
const TOKEN_LIFETIME_MS = 600_000;

// --- The status changes, through the real service ------------------------------

interface StatusRow {
  name: string;
  procedure: "updateStatus" | "cancel";
  from: "pending" | "quote" | "confirmed";
  to: "confirmed" | "rejected" | "cancelled";
  flags: { allowOverbooking?: true; overrideTurnoverBuffer?: true };
  /** What the reservation lacks: nothing, stock (two asked of one), or the turnover buffer. */
  short: "nothing" | "stock" | "buffer";
  /** Whether the customer has an address the message goes to. */
  message: boolean;
  /** What the branch declares; null when the service refuses before it asks. */
  consequences: readonly Consequence[] | null;
  asksWithOptionOff: boolean;
  /** The refusal's code, when the service refuses before it asks. */
  refused?: string;
}

const OVERBOOK = { allowOverbooking: true } as const;
const PAST_BUFFER = { overrideTurnoverBuffer: true } as const;
const BOTH = { allowOverbooking: true, overrideTurnoverBuffer: true } as const;

const confirming = (from: "pending" | "quote"): StatusRow[] => [
  {
    name: `${from}, no flag, nothing short, a message`,
    procedure: "updateStatus",
    from,
    to: "confirmed",
    flags: {},
    short: "nothing",
    message: true,
    consequences: ["customer_message"],
    asksWithOptionOff: false,
  },
  {
    name: `${from}, no flag, nothing short, no message`,
    procedure: "updateStatus",
    from,
    to: "confirmed",
    flags: {},
    short: "nothing",
    message: false,
    consequences: ["change"],
    asksWithOptionOff: false,
  },
  {
    name: `${from}, allowOverbooking, nothing short, a message`,
    procedure: "updateStatus",
    from,
    to: "confirmed",
    flags: OVERBOOK,
    short: "nothing",
    message: true,
    consequences: ["stock_override", "customer_message"],
    asksWithOptionOff: true,
  },
  {
    name: `${from}, allowOverbooking, nothing short, no message`,
    procedure: "updateStatus",
    from,
    to: "confirmed",
    flags: OVERBOOK,
    short: "nothing",
    message: false,
    consequences: ["stock_override"],
    asksWithOptionOff: true,
  },
  {
    name: `${from}, allowOverbooking, stock short, a message`,
    procedure: "updateStatus",
    from,
    to: "confirmed",
    flags: OVERBOOK,
    short: "stock",
    message: true,
    consequences: ["stock_override", "customer_message"],
    asksWithOptionOff: true,
  },
  {
    name: `${from}, allowOverbooking, stock short, no message`,
    procedure: "updateStatus",
    from,
    to: "confirmed",
    flags: OVERBOOK,
    short: "stock",
    message: false,
    consequences: ["stock_override"],
    asksWithOptionOff: true,
  },
  {
    name: `${from}, overrideTurnoverBuffer, nothing short, a message`,
    procedure: "updateStatus",
    from,
    to: "confirmed",
    flags: PAST_BUFFER,
    short: "nothing",
    message: true,
    consequences: ["stock_override", "customer_message"],
    asksWithOptionOff: true,
  },
  {
    name: `${from}, overrideTurnoverBuffer, nothing short, no message`,
    procedure: "updateStatus",
    from,
    to: "confirmed",
    flags: PAST_BUFFER,
    short: "nothing",
    message: false,
    consequences: ["stock_override"],
    asksWithOptionOff: true,
  },
  {
    name: `${from}, overrideTurnoverBuffer, buffer short, a message`,
    procedure: "updateStatus",
    from,
    to: "confirmed",
    flags: PAST_BUFFER,
    short: "buffer",
    message: true,
    consequences: ["stock_override", "customer_message"],
    asksWithOptionOff: true,
  },
  {
    name: `${from}, overrideTurnoverBuffer, buffer short, no message`,
    procedure: "updateStatus",
    from,
    to: "confirmed",
    flags: PAST_BUFFER,
    short: "buffer",
    message: false,
    consequences: ["stock_override"],
    asksWithOptionOff: true,
  },
  {
    name: `${from}, both flags, stock short, no message`,
    procedure: "updateStatus",
    from,
    to: "confirmed",
    flags: BOTH,
    short: "stock",
    message: false,
    consequences: ["stock_override"],
    asksWithOptionOff: true,
  },
  {
    name: `${from}, no flag, stock short`,
    procedure: "updateStatus",
    from,
    to: "confirmed",
    flags: {},
    short: "stock",
    message: true,
    consequences: null,
    asksWithOptionOff: false,
    refused: "RESERVATION_INSUFFICIENT_CAPACITY",
  },
  {
    name: `${from}, allowOverbooking, buffer short`,
    procedure: "updateStatus",
    from,
    to: "confirmed",
    flags: OVERBOOK,
    short: "buffer",
    message: true,
    consequences: null,
    asksWithOptionOff: false,
    refused: "RESERVATION_TURNOVER_BUFFER_CONFLICT",
  },
];

/** Each status change, through the real service, and what it declares. */
const STATUS_ROWS: StatusRow[] = [
  ...confirming("pending"),
  ...confirming("quote"),
  // A rejection or a cancellation takes no stock: a flag sent changes nothing.
  {
    name: "reject, allowOverbooking sent, a message",
    procedure: "updateStatus",
    from: "pending",
    to: "rejected",
    flags: OVERBOOK,
    short: "nothing",
    message: true,
    consequences: ["customer_message"],
    asksWithOptionOff: false,
  },
  {
    name: "reject, overrideTurnoverBuffer sent, no message",
    procedure: "updateStatus",
    from: "pending",
    to: "rejected",
    flags: PAST_BUFFER,
    short: "nothing",
    message: false,
    consequences: ["change"],
    asksWithOptionOff: false,
  },
  {
    name: "reject, both flags sent, no message",
    procedure: "updateStatus",
    from: "pending",
    to: "rejected",
    flags: BOTH,
    short: "nothing",
    message: false,
    consequences: ["change"],
    asksWithOptionOff: false,
  },
  {
    name: "cancel through updateStatus, allowOverbooking sent, a message",
    procedure: "updateStatus",
    from: "confirmed",
    to: "cancelled",
    flags: OVERBOOK,
    short: "nothing",
    message: true,
    consequences: ["customer_message"],
    asksWithOptionOff: false,
  },
  {
    name: "cancel through updateStatus, overrideTurnoverBuffer sent, no message",
    procedure: "updateStatus",
    from: "confirmed",
    to: "cancelled",
    flags: PAST_BUFFER,
    short: "nothing",
    message: false,
    consequences: ["change"],
    asksWithOptionOff: false,
  },
  {
    name: "cancel, a message",
    procedure: "cancel",
    from: "confirmed",
    to: "cancelled",
    flags: {},
    short: "nothing",
    message: true,
    consequences: ["customer_message"],
    asksWithOptionOff: false,
  },
  {
    name: "cancel, no message",
    procedure: "cancel",
    from: "confirmed",
    to: "cancelled",
    flags: {},
    short: "nothing",
    message: false,
    consequences: ["change"],
    asksWithOptionOff: false,
  },
];

// --- The test --------------------------------------------------------------------

describe(
  "who is asked for a confirmation, at every place that asks (database)",
  { skip: skipWithoutTestDatabase() },
  () => {
    let database: TestDatabase;
    let louezDb: typeof import("@louez/db");
    let orm: typeof import("drizzle-orm");
    let permissions: typeof import("./permissions");
    let confirmation: typeof import("./confirmation");
    let routers: Record<string, Record<string, unknown>>;

    const images = createTestProductImages(FILES);
    const ports = {
      planFeatures: async () => ({ apiAccess: true }),
      runReservationEffects: async () => {},
      insurance: { createContract: async () => null, cancelContract: async () => {} },
      newStores: createTestNewStores(),
      dispatchEffects: () => {},
      storage: createMemoryStorage(),
      urls: createTestUrls(),
      afterCommit: () => {},
      productImages: images.port,
      // The payment writes stop before they write: their writer is never reached.
      paymentRecords: {
        insert: async () => {
          throw new Error("the payment writer is not reached");
        },
      },
    };

    before(async () => {
      database = await createTestDatabase("api_confirmation_sites");
      await installStandIns();
      louezDb = await import("@louez/db");
      orm = await import("drizzle-orm");
      permissions = await import("./permissions");
      confirmation = await import("./confirmation");
      routers = {
        products: (await import("../routers/dashboard/products")).dashboardProductsRouter,
        categories: (await import("../routers/dashboard/categories")).dashboardCategoriesRouter,
        settings: (await import("../routers/dashboard/settings")).dashboardSettingsRouter,
        onlineStore: (await import("../routers/dashboard/online-store")).dashboardOnlineStoreRouter,
        stores: (await import("../routers/dashboard/stores")).dashboardStoresRouter,
        team: (await import("../routers/dashboard/team")).dashboardTeamRouter,
        reservations: (await import("../routers/dashboard/reservations"))
          .dashboardReservationsRouter,
        payments: (await import("../routers/dashboard/payments")).dashboardPaymentsRouter,
        notes: (await import("./testing")).createFixtureRouter().fixture.notes,
      };

      await louezDb.db.insert(louezDb.users).values({ id: USER, email: "owner@cs.test" });
      await louezDb.db.insert(louezDb.stores).values({
        id: STORE,
        userId: USER,
        name: "Cycles",
        slug: "cs-store",
        onboardingCompleted: true,
      });
      await louezDb.db.insert(louezDb.storeMembers).values({
        storeId: STORE,
        userId: USER,
        role: "owner",
      });
      await louezDb.db.insert(louezDb.products).values({
        id: PRODUCT,
        storeId: STORE,
        name: "City bike",
        price: "20.00",
        pricingMode: "day",
        images: [PHOTO],
      });
    });

    after(async () => {
      await louezDb?.db.$client.end();
      await database?.drop();
    });

    function credentialOf(kind: Kind, confirmSensitive: boolean) {
      return {
        kind,
        id: kind === "session" ? null : kind === "api_key" ? KEY : GRANT,
        clientName: kind === "session" ? null : "Test client",
        userId: USER,
        email: "owner@cs.test",
        storeId: kind === "api_key" ? STORE : null,
        stores: null,
        scopes: kind === "session" ? null : permissions.presetScopes("write"),
        confirmSensitive,
        bundles: null,
      };
    }

    async function context(kind: Kind, confirmSensitive: boolean, token: string | null) {
      const credential = credentialOf(kind, confirmSensitive);
      const store = await louezDb.db.query.stores.findFirst({
        where: orm.eq(louezDb.stores.id, STORE),
      });
      const headers = new Headers();
      if (token) headers.set(confirmation.CONFIRMATION_HEADER, token);
      return {
        transport: kind === "session" ? ("rpc" as const) : ("mcp" as const),
        headers,
        ports,
        receipt: {},
        store,
        actor: {
          transport: kind === "session" ? ("rpc" as const) : ("mcp" as const),
          isPlatformAdmin: false,
          credential,
          storeId: STORE,
          role: "owner" as const,
        },
      };
    }

    const handlerOf = (site: Site) => {
      const [, domain, name] = site.path;
      const procedure = routers[domain]?.[name] as
        | { "~orpc": { handler: (options: unknown) => Promise<unknown> } }
        | undefined;
      assert.ok(procedure, `${site.path.join(".")} is a procedure`);
      return procedure["~orpc"].handler;
    };

    /** One call: null when it went on (ran), else the error that stopped it. */
    async function attempt(
      site: Site,
      branch: Branch,
      kind: Kind,
      confirmSensitive: boolean,
      token: string | null,
    ): Promise<Error | null> {
      const handler = handlerOf(site);
      const ctx = await context(kind, confirmSensitive, token);
      captured = null;
      emitted = [];
      if (site.runsForReal) {
        await louezDb.db.delete(louezDb.apiJobs);
        images.state.quote = {
          available: true,
          priceMicro: branch.name === "priced" ? 2_000_000 : 0,
          credits: { allowed: true, monthlyRemainingMicro: 0, prepaidMicro: 10_000_000 },
        };
        try {
          await handler({ context: ctx, input: site.input, path: site.path });
          return null;
        } catch (error) {
          if (error instanceof Error && error.message === STOPPED) return null;
          return error as Error;
        }
      }
      await assert.rejects(
        handler({ context: ctx, input: site.input, path: site.path }),
        new RegExp(STOPPED),
      );
      const confirm = captured as Confirm | null;
      assert.ok(confirm, `${site.path.join(".")} handed its confirmation to the service`);
      let refusal: Error | null = null;
      await louezDb.db.transaction(async (tx) => {
        refusal = await confirm(branch.preview, tx);
      });
      return refusal;
    }

    const CASES: Array<{ kind: Kind; confirmSensitive: boolean }> = [
      // A session's option is always off: the dashboard has its own dialogs.
      { kind: "session", confirmSensitive: false },
      { kind: "api_key", confirmSensitive: true },
      { kind: "api_key", confirmSensitive: false },
      { kind: "oauth", confirmSensitive: true },
      { kind: "oauth", confirmSensitive: false },
    ];

    const errorData = (error: Error | null) =>
      (error as { data?: { code?: string; details?: Record<string, unknown> } } | null)?.data;

    for (const site of SITES) {
      for (const branch of site.branches) {
        test(`${site.path.join(".")}, ${branch.name}`, async () => {
          const seen: unknown[] = [];
          for (const { kind, confirmSensitive } of CASES) {
            const label = `${kind}, option ${confirmSensitive ? "on" : "off"}`;
            const expected =
              !branch.neverAsks &&
              kind !== "session" &&
              (confirmSensitive || branch.asksWithOptionOff);

            const first = await attempt(site, branch, kind, confirmSensitive, null);
            const declared = CONSEQUENCES[`${site.path.join(".")}, ${branch.name}`];
            assert.notEqual(declared, undefined, `${label}: the table has this branch`);
            assert.deepEqual(emitted, declared ? [declared] : [], `${label}: what it declares`);
            if (!expected) {
              assert.equal(first, null, `${label}: runs without being asked`);
              continue;
            }

            // Asked: nothing ran, and the answer carries the preview and a token.
            const data = errorData(first);
            assert.equal(data?.code, "CONFIRMATION_REQUIRED", `${label}: asked`);
            assert.equal((first as { status?: number }).status, 412);
            const { confirmationToken, expiresAt, ...details } = data?.details ?? {};
            assert.equal(typeof confirmationToken, "string");
            const [row] = await louezDb.db
              .select()
              .from(louezDb.apiConfirmations)
              .where(orm.eq(louezDb.apiConfirmations.id, confirmationToken as string));
            assert.ok(row, `${label}: the preview is recorded`);
            assert.equal(
              row.storeId,
              site.path[1] === "stores" && site.path[2] === "create" ? "" : STORE,
            );
            assert.equal(row.procedure, site.path.join("."));
            const lifetime = row.expiresAt.getTime() - row.createdAt.getTime();
            assert.ok(
              Math.abs(lifetime - confirmation.CONFIRMATION_TTL_MS) < 2_000,
              `${label}: the token lasts ten minutes`,
            );
            assert.ok(
              Math.abs(lifetime - TOKEN_LIFETIME_MS) < 2_000,
              `${label}: ten minutes, written out`,
            );
            assert.ok(
              Math.abs(new Date(expiresAt as string).getTime() - row.expiresAt.getTime()) < 1_000,
              `${label}: the answer gives the token's expiry`,
            );
            seen.push({
              kind,
              confirmSensitive,
              message: first?.message,
              retryable: (data as { retryable?: boolean }).retryable,
              details,
              bindingHash: row.bindingHash,
            });

            // The same call with the token goes on, once.
            const second = await attempt(
              site,
              branch,
              kind,
              confirmSensitive,
              confirmationToken as string,
            );
            assert.equal(second, null, `${label}: the token lets the call go on`);
            assert.deepEqual(emitted, [declared], `${label}: the confirmed call declares the same`);
            const third = await attempt(
              site,
              branch,
              kind,
              confirmSensitive,
              confirmationToken as string,
            );
            assert.equal(errorData(third)?.code, "CONFIRMATION_INVALID", `${label}: once only`);
          }
          const fingerprint = createHash("sha256").update(JSON.stringify(seen)).digest("hex");
          assert.equal(
            fingerprint,
            FINGERPRINTS[`${site.path.join(".")}, ${branch.name}`],
            `what the caller is shown and the token's binding are as recorded`,
          );
        });
      }
    }

    // The token's end, on the test clock: no real waiting.
    const NOW = Date.UTC(2027, 0, 4, 10, 0, 0);
    for (const site of SITES) {
      const branch = site.branches.find((candidate) => !candidate.neverAsks);
      if (!branch) continue;
      test(`${site.path.join(".")}, ${branch.name}: the token works until ten minutes have passed`, async (t) => {
        t.mock.timers.enable({ apis: ["Date"], now: NOW });
        const token = async () => {
          const data = errorData(await attempt(site, branch, "api_key", true, null));
          assert.equal(data?.code, "CONFIRMATION_REQUIRED");
          assert.equal(data?.details?.expiresAt, new Date(NOW + TOKEN_LIFETIME_MS).toISOString());
          return data?.details?.confirmationToken as string;
        };
        const early = await token();
        t.mock.timers.setTime(NOW + TOKEN_LIFETIME_MS - 1);
        assert.equal(
          await attempt(site, branch, "api_key", true, early),
          null,
          "a millisecond before its end, it lets the call go on",
        );
        t.mock.timers.setTime(NOW);
        const late = await token();
        t.mock.timers.setTime(NOW + TOKEN_LIFETIME_MS);
        assert.equal(
          errorData(await attempt(site, branch, "api_key", true, late))?.code,
          "CONFIRMATION_INVALID",
          "at its end, it is refused",
        );
      });
    }

    describe("the status changes, through the real service", () => {
      const MAILED = "cs_customer_mail_0001";
      const UNREACHABLE = "cs_customer_none_0001";
      const HOUR = 3_600_000;
      let fixtures = 0;

      before(async () => {
        await louezDb.db.insert(louezDb.customers).values([
          { id: MAILED, storeId: STORE, email: "ann@cs.test", firstName: "Ann", lastName: "Lee" },
          // No email, no phone: no message can go.
          { id: UNREACHABLE, storeId: STORE, email: "", firstName: "Bo", lastName: "Ray" },
        ]);
      });

      async function line(reservationId: string, productId: string, quantity: number) {
        await louezDb.db.insert(louezDb.reservationItems).values({
          id: `${reservationId}_l`,
          reservationId,
          productId,
          quantity,
          unitPrice: "10.00",
          depositPerUnit: "0.00",
          totalPrice: "20.00",
          productSnapshot: { name: "Kayak", description: null, images: [] },
        });
      }

      /** A reservation in the row's status, on a kayak of its own, one in stock. */
      async function reservationFor(row: StatusRow) {
        const n = String((fixtures += 1)).padStart(4, "0");
        const productId = `cs_status_prd_${n}`;
        await louezDb.db.insert(louezDb.products).values({
          id: productId,
          storeId: STORE,
          name: `Kayak ${n}`,
          price: "10.00",
          pricingMode: "day",
          quantity: 1,
        });
        const reservation = (id: string, status: StatusRow["from"], start: Date, end: Date) =>
          louezDb.db.insert(louezDb.reservations).values({
            id,
            storeId: STORE,
            customerId: row.message ? MAILED : UNREACHABLE,
            number: id,
            status,
            startDate: start,
            endDate: end,
            subtotalAmount: "20.00",
            depositAmount: "0.00",
            totalAmount: "20.00",
          });
        const id = `cs_status_res_${n}`;
        await reservation(id, row.from, AT, UNTIL);
        await line(id, productId, row.short === "stock" ? 2 : 1);
        if (row.short === "buffer") {
          // Back an hour before AT, in a store that keeps two hours between rentals.
          const other = `cs_status_oth_${n}`;
          await reservation(
            other,
            "confirmed",
            new Date(AT.getTime() - 24 * HOUR),
            new Date(AT.getTime() - HOUR),
          );
          await line(other, productId, 1);
        }
        return id;
      }

      const bufferOf = (minutes: number | null) =>
        louezDb.db
          .update(louezDb.stores)
          .set({
            settings:
              minutes === null
                ? null
                : {
                    reservationMode: "request" as const,
                    currency: "EUR",
                    pendingBlocksAvailability: false,
                    advanceNoticeMinutes: 0,
                    minRentalMinutes: 0,
                    turnoverBufferMinutes: minutes,
                  },
          })
          .where(orm.eq(louezDb.stores.id, STORE));

      for (const row of STATUS_ROWS) {
        test(row.name, async () => {
          const id = await reservationFor(row);
          if (row.short === "buffer") await bufferOf(120);
          try {
            const path = ["dashboard", "reservations", row.procedure];
            const handler = handlerOf({ path, input: {}, branches: [] } as unknown as Site);
            const input =
              row.procedure === "cancel" ? { id } : { id, status: row.to, ...row.flags };
            for (const { kind, confirmSensitive } of CASES) {
              const label = `${kind}, option ${confirmSensitive ? "on" : "off"}`;
              const ctx = await context(kind, confirmSensitive, null);
              emitted = [];
              statusAsked = null;
              throughStatusService = true;
              let error: Error | null = null;
              try {
                await handler({ context: ctx, input, path });
              } catch (caught) {
                error = caught as Error;
              } finally {
                throughStatusService = false;
              }

              if (row.consequences === null) {
                assert.equal(statusAsked, null, `${label}: refused before it asks`);
                assert.deepEqual(emitted, [], `${label}: nothing declared`);
                assert.equal(errorData(error)?.code, row.refused, `${label}: the refusal`);
                continue;
              }
              assert.equal(error?.message, STOPPED, `${label}: the service asked`);
              const asked = statusAsked as { preview: StatusPreview; refusal: Error | null } | null;
              assert.ok(asked, `${label}: the service asked`);
              // The reservation took the branch the row names.
              const { preview, refusal } = asked;
              assert.equal(preview.messages.length > 0, row.message, `${label}: a message`);
              const takesStock = row.to === "confirmed";
              assert.equal(
                preview.overbooking !== null,
                takesStock && row.flags.allowOverbooking === true,
                `${label}: booked over the stock`,
              );
              assert.equal(
                preview.turnoverBuffer !== null,
                takesStock && row.flags.overrideTurnoverBuffer === true,
                `${label}: past the turnover buffer`,
              );
              assert.equal(
                (preview.overbooking?.shortfalls.length ?? 0) +
                  (preview.turnoverBuffer?.shortfalls.length ?? 0),
                row.short === "nothing" ? 0 : 1,
                `${label}: what is short`,
              );

              assert.deepEqual(emitted, [row.consequences], `${label}: what it declares`);
              const expected = kind !== "session" && (confirmSensitive || row.asksWithOptionOff);
              assert.equal(
                errorData(refusal)?.code,
                expected ? "CONFIRMATION_REQUIRED" : undefined,
                `${label}: ${expected ? "asked" : "runs without being asked"}`,
              );
            }
          } finally {
            if (row.short === "buffer") await bufferOf(null);
          }
        });
      }
    });
  },
);
