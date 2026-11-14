import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, describe, mock, test } from "node:test";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import { createMemoryStorage } from "../platform/memory-storage";
import { createTestNewStores } from "../platform/test-new-stores";
import { createTestUrls } from "../platform/test-urls";

process.env.NODE_ENV = "test";

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
mock.module("@louez/auth", { namedExports: { auth: {}, authInstance: { api: {} } } });

// The six branches a person will approve once pull request 7 switches them
// (docs/architecture/api-and-agents.md, "Pull requests", 6b and 7), run
// through their real procedures and services on a migrated database, as an
// API key asks: what the agent receives (the answer's message and details,
// the token aside) and what its token is bound to, pinned byte for byte.
// Nothing a person's display adds may change one of them.
//
// Each branch also hands its check what a person reads first (`display`,
// services/approval-display.ts), built from the same values in the same
// call: captured here as the check receives it, it is pinned too, and read
// back as the page reads it.

const OWNER = "ab_owner_user_000001";
const MEMBER_USER = "ab_member_user_00001";
const STORE = "ab_store_000000000001";
const KEY = "ab_api_key_000000001";
const CUSTOMER = "ab_customer_00000001";
const SILENT = "ab_customer_silent01";
const MEMBERSHIP = "ab_membership_000001";
const INVITATION = "ab_invitation_000001";
const PAID = "ab_reservation_00001";
const PAYMENT = "ab_payment_000000001";
const BUFFERED = "ab_reservation_00002";
const SHORT = "ab_reservation_00003";
const COVERED = "ab_reservation_00004";
const EARLIER = "ab_reservation_00005";
const HOUR = 3_600_000;
const AT = new Date("2026-12-13T13:00:00.000Z");
const UNTIL = new Date("2026-12-17T13:00:00.000Z");

/** Each branch: its procedure, its input, and what the agent is answered. */
const BRANCHES = [
  {
    name: "a payment recorded",
    path: ["dashboard", "payments", "record"],
    input: { reservationId: PAID, type: "rental", amount: "120.00", method: "cash" },
  },
  {
    name: "a negative adjustment recorded",
    path: ["dashboard", "payments", "record"],
    input: { reservationId: PAID, type: "adjustment", amount: "-20.00", method: "card" },
  },
  {
    name: "a deposit return recorded",
    path: ["dashboard", "payments", "recordDepositReturn"],
    input: { reservationId: PAID, amount: "150.00", method: "transfer" },
  },
  {
    name: "a payment deleted",
    path: ["dashboard", "payments", "delete"],
    input: { paymentId: PAYMENT },
  },
  {
    name: "a member removed",
    path: ["dashboard", "team", "removeMember"],
    input: { id: MEMBERSHIP },
  },
  {
    name: "an invitation cancelled",
    path: ["dashboard", "team", "cancelInvitation"],
    input: { id: INVITATION },
  },
  {
    name: "a booking confirmed past the turnover buffer, a message goes",
    path: ["dashboard", "reservations", "updateStatus"],
    input: { id: BUFFERED, status: "confirmed", overrideTurnoverBuffer: true },
  },
  {
    name: "a booking confirmed beyond the stock, no message",
    path: ["dashboard", "reservations", "updateStatus"],
    input: { id: SHORT, status: "confirmed", allowOverbooking: true },
  },
  {
    name: "a booking confirmed with both flags, nothing short, a message goes",
    path: ["dashboard", "reservations", "updateStatus"],
    input: { id: COVERED, status: "confirmed", allowOverbooking: true, overrideTurnoverBuffer: true },
  },
] as const;

/** The display each branch hands its check, as JSON. */
const DISPLAYS: Record<(typeof BRANCHES)[number]["name"], string> = {
  "a payment recorded":
    "{\"headline\":{\"key\":\"recordPayment\",\"values\":{}},\"facts\":[{\"key\":\"bookingNumber\",\"values\":{\"number\":{\"type\":\"text\",\"text\":\"R-00090\"}},\"ref\":\"ab_reservation_00001\"},{\"key\":\"received\",\"values\":{\"type\":{\"type\":\"choice\",\"list\":\"paymentType\",\"value\":\"rental\"},\"amount\":{\"type\":\"money\",\"amount\":\"120.00\",\"currency\":\"EUR\"},\"method\":{\"type\":\"choice\",\"list\":\"paymentMethod\",\"value\":\"cash\"}}},{\"key\":\"recordOnly\",\"values\":{}}]}",
  "a negative adjustment recorded":
    "{\"headline\":{\"key\":\"paidBack\",\"values\":{}},\"facts\":[{\"key\":\"bookingNumber\",\"values\":{\"number\":{\"type\":\"text\",\"text\":\"R-00090\"}},\"ref\":\"ab_reservation_00001\"},{\"key\":\"paidBack\",\"values\":{\"type\":{\"type\":\"choice\",\"list\":\"paymentType\",\"value\":\"adjustment\"},\"amount\":{\"type\":\"money\",\"amount\":\"-20.00\",\"currency\":\"EUR\"},\"method\":{\"type\":\"choice\",\"list\":\"paymentMethod\",\"value\":\"card\"}}},{\"key\":\"recordOnly\",\"values\":{}}]}",
  "a deposit return recorded":
    "{\"headline\":{\"key\":\"returnDeposit\",\"values\":{}},\"facts\":[{\"key\":\"bookingNumber\",\"values\":{\"number\":{\"type\":\"text\",\"text\":\"R-00090\"}},\"ref\":\"ab_reservation_00001\"},{\"key\":\"returned\",\"values\":{\"amount\":{\"type\":\"money\",\"amount\":\"150.00\",\"currency\":\"EUR\"},\"method\":{\"type\":\"choice\",\"list\":\"paymentMethod\",\"value\":\"transfer\"}}},{\"key\":\"depositHeld\",\"values\":{\"held\":{\"type\":\"money\",\"amount\":\"300.00\",\"currency\":\"EUR\"}}},{\"key\":\"recordOnly\",\"values\":{}}]}",
  "a payment deleted":
    "{\"headline\":{\"key\":\"deletePayment\",\"values\":{}},\"facts\":[{\"key\":\"bookingNumber\",\"values\":{\"number\":{\"type\":\"text\",\"text\":\"R-00090\"}},\"ref\":\"ab_reservation_00001\"},{\"key\":\"deleted\",\"values\":{\"type\":{\"type\":\"choice\",\"list\":\"paymentType\",\"value\":\"rental\"},\"amount\":{\"type\":\"money\",\"amount\":\"80.00\",\"currency\":\"EUR\"},\"method\":{\"type\":\"choice\",\"list\":\"paymentMethod\",\"value\":\"cash\"}},\"ref\":\"ab_payment_000000001\"},{\"key\":\"recordedOn\",\"values\":{\"at\":{\"type\":\"dateTime\",\"at\":\"2026-11-12T15:30:00.000Z\"}}},{\"key\":\"leavesBalance\",\"values\":{}}]}",
  "a member removed":
    "{\"headline\":{\"key\":\"removeMember\",\"values\":{}},\"facts\":[{\"key\":\"member\",\"values\":{\"name\":{\"type\":\"text\",\"text\":\"Lucas Bernard\"},\"email\":{\"type\":\"text\",\"text\":\"lucas.bernard@ab.test\"}},\"ref\":\"ab_membership_000001\"},{\"key\":\"memberSince\",\"values\":{\"since\":{\"type\":\"dateTime\",\"at\":\"2026-03-03T09:00:00.000Z\"}}},{\"key\":\"losesAccess\",\"values\":{}}]}",
  "an invitation cancelled":
    "{\"headline\":{\"key\":\"cancelInvitation\",\"values\":{}},\"facts\":[{\"key\":\"invited\",\"values\":{\"email\":{\"type\":\"text\",\"text\":\"nina.roux@ab.test\"}},\"ref\":\"ab_invitation_000001\"},{\"key\":\"invitedOn\",\"values\":{\"at\":{\"type\":\"dateTime\",\"at\":\"2026-11-02T08:30:00.000Z\"}}},{\"key\":\"linkStops\",\"values\":{}}]}",
  "a booking confirmed past the turnover buffer, a message goes":
    "{\"headline\":{\"key\":\"confirmPastBuffer\",\"values\":{\"to\":{\"type\":\"choice\",\"list\":\"reservationStatus\",\"value\":\"confirmed\"}}},\"facts\":[{\"key\":\"booking\",\"values\":{\"number\":{\"type\":\"text\",\"text\":\"R-00094\"},\"customer\":{\"type\":\"text\",\"text\":\"Camille Simon\"}},\"ref\":\"ab_reservation_00002\"},{\"key\":\"period\",\"values\":{\"period\":{\"type\":\"dateRange\",\"start\":\"2026-12-13T13:00:00.000Z\",\"end\":\"2026-12-17T13:00:00.000Z\"},\"total\":{\"type\":\"money\",\"amount\":\"98.00\",\"currency\":\"EUR\"}}},{\"key\":\"pastBuffer\",\"values\":{\"product\":{\"type\":\"text\",\"text\":\"Kayak biplace\"},\"requested\":{\"type\":\"count\",\"value\":1},\"available\":{\"type\":\"count\",\"value\":0},\"buffer\":{\"type\":\"duration\",\"minutes\":120}}},{\"key\":\"message\",\"values\":{\"customer\":{\"type\":\"text\",\"text\":\"Camille Simon\"},\"message\":{\"type\":\"choice\",\"list\":\"customerMessage\",\"value\":\"request_accepted\"},\"channels\":{\"type\":\"choice\",\"list\":\"messageChannels\",\"value\":\"email\"}}}]}",
  "a booking confirmed beyond the stock, no message":
    "{\"headline\":{\"key\":\"confirmBeyondStock\",\"values\":{\"to\":{\"type\":\"choice\",\"list\":\"reservationStatus\",\"value\":\"confirmed\"}}},\"facts\":[{\"key\":\"booking\",\"values\":{\"number\":{\"type\":\"text\",\"text\":\"R-00095\"},\"customer\":{\"type\":\"text\",\"text\":\"Bo Ray\"}},\"ref\":\"ab_reservation_00003\"},{\"key\":\"period\",\"values\":{\"period\":{\"type\":\"dateRange\",\"start\":\"2026-12-13T13:00:00.000Z\",\"end\":\"2026-12-17T13:00:00.000Z\"},\"total\":{\"type\":\"money\",\"amount\":\"98.00\",\"currency\":\"EUR\"}}},{\"key\":\"beyondStock\",\"values\":{\"product\":{\"type\":\"text\",\"text\":\"Paddle\"},\"requested\":{\"type\":\"count\",\"value\":2},\"available\":{\"type\":\"count\",\"value\":1},\"missing\":{\"type\":\"count\",\"value\":1}}},{\"key\":\"noMessage\",\"values\":{}}]}",
  "a booking confirmed with both flags, nothing short, a message goes":
    "{\"headline\":{\"key\":\"confirmWithinRules\",\"values\":{\"to\":{\"type\":\"choice\",\"list\":\"reservationStatus\",\"value\":\"confirmed\"}}},\"facts\":[{\"key\":\"booking\",\"values\":{\"number\":{\"type\":\"text\",\"text\":\"R-00096\"},\"customer\":{\"type\":\"text\",\"text\":\"Camille Simon\"}},\"ref\":\"ab_reservation_00004\"},{\"key\":\"period\",\"values\":{\"period\":{\"type\":\"dateRange\",\"start\":\"2026-12-13T13:00:00.000Z\",\"end\":\"2026-12-17T13:00:00.000Z\"},\"total\":{\"type\":\"money\",\"amount\":\"98.00\",\"currency\":\"EUR\"}}},{\"key\":\"withinRules\",\"values\":{}},{\"key\":\"message\",\"values\":{\"customer\":{\"type\":\"text\",\"text\":\"Camille Simon\"},\"message\":{\"type\":\"choice\",\"list\":\"customerMessage\",\"value\":\"request_accepted\"},\"channels\":{\"type\":\"choice\",\"list\":\"messageChannels\",\"value\":\"email\"}}}]}",
};

/** What each branch answers an agent today, as JSON: the message, the details but the token, the binding. */
const ANSWERS: Record<(typeof BRANCHES)[number]["name"], string> = {
  "a payment recorded":
    "{\"message\":\"Record a rental payment of €120.00 (cash) on reservation #R-00090. Nothing was done yet. To go ahead, call again with the same input and this confirmation token.\",\"details\":{\"preview\":{\"summary\":\"Record a rental payment of €120.00 (cash) on reservation #R-00090.\",\"details\":{\"sensitive\":\"money\",\"reservationId\":\"ab_reservation_00001\",\"number\":\"R-00090\",\"type\":\"rental\",\"amount\":\"120.00\",\"method\":\"cash\"}}},\"bindingHash\":\"3225c13c0152f035a031b36951be16361bac732ad8e2f14de26f546ba9e7443a\"}",
  "a negative adjustment recorded":
    "{\"message\":\"Record a adjustment payment of -€20.00 (card) on reservation #R-00090. Nothing was done yet. To go ahead, call again with the same input and this confirmation token.\",\"details\":{\"preview\":{\"summary\":\"Record a adjustment payment of -€20.00 (card) on reservation #R-00090.\",\"details\":{\"sensitive\":\"money\",\"reservationId\":\"ab_reservation_00001\",\"number\":\"R-00090\",\"type\":\"adjustment\",\"amount\":\"-20.00\",\"method\":\"card\"}}},\"bindingHash\":\"6e2e6d7b231fd3d9155bd6e74e685d69d4d81efaa59dda95e69ae031e8f171c4\"}",
  "a deposit return recorded":
    "{\"message\":\"Record a deposit return of €150.00 (transfer) on reservation #R-00090. Nothing was done yet. To go ahead, call again with the same input and this confirmation token.\",\"details\":{\"preview\":{\"summary\":\"Record a deposit return of €150.00 (transfer) on reservation #R-00090.\",\"details\":{\"sensitive\":\"money\",\"reservationId\":\"ab_reservation_00001\",\"number\":\"R-00090\",\"amount\":\"150.00\",\"method\":\"transfer\",\"returnable\":\"300.00\"}}},\"bindingHash\":\"2ebeaa8e47dc48090d11cbe4ac5c2f972c2cceb8024a724c7a7d15bfe85d48ce\"}",
  "a payment deleted":
    "{\"message\":\"Delete the rental payment of €80.00 (cash) on reservation #R-00090. Nothing was done yet. To go ahead, call again with the same input and this confirmation token.\",\"details\":{\"preview\":{\"summary\":\"Delete the rental payment of €80.00 (cash) on reservation #R-00090.\",\"details\":{\"sensitive\":\"destructive\",\"paymentId\":\"ab_payment_000000001\",\"number\":\"R-00090\",\"type\":\"rental\",\"amount\":\"80.00\",\"method\":\"cash\"}}},\"bindingHash\":\"a6178616dd6b98fb15222101c4fe29b2d37b9c70d7c91080e5aa57005fa95671\"}",
  "a member removed":
    "{\"message\":\"Remove Lucas Bernard (lucas.bernard@ab.test) from \\\"Vélo Liberté\\\". They lose access to the store at once: its customers, reservations and payments. Nothing was done yet. To go ahead, call again with the same input and this confirmation token.\",\"details\":{\"preview\":{\"summary\":\"Remove Lucas Bernard (lucas.bernard@ab.test) from \\\"Vélo Liberté\\\". They lose access to the store at once: its customers, reservations and payments.\",\"details\":{\"member\":{\"id\":\"ab_membership_000001\",\"userId\":\"ab_member_user_00001\",\"name\":\"Lucas Bernard\",\"email\":\"lucas.bernard@ab.test\",\"imageUrl\":null,\"role\":\"member\",\"joinedAt\":\"2026-03-03T09:00:00.000Z\"}}}},\"bindingHash\":\"4a2c8457c3a779fd3c9f885d9aeb7cc8d686ccbd985e193b4c099c94412f5082\"}",
  "an invitation cancelled":
    "{\"message\":\"Cancel the invitation of nina.roux@ab.test to \\\"Vélo Liberté\\\". Its link stops working, and they do not join the store. Nothing was done yet. To go ahead, call again with the same input and this confirmation token.\",\"details\":{\"preview\":{\"summary\":\"Cancel the invitation of nina.roux@ab.test to \\\"Vélo Liberté\\\". Its link stops working, and they do not join the store.\",\"details\":{\"invitation\":{\"id\":\"ab_invitation_000001\",\"email\":\"nina.roux@ab.test\",\"role\":\"member\",\"invitedAt\":\"2026-11-02T08:30:00.000Z\",\"expiresAt\":\"2030-01-01T00:00:00.000Z\",\"expired\":false}}}},\"bindingHash\":\"8486b2e0fd42e9730a0c18ff67a165fce0cef6bc171df3a390f28017e8eea6ca\"}",
  "a booking confirmed past the turnover buffer, a message goes":
    "{\"message\":\"Change reservation #R-00094 for Camille Simon (2026-12-13T13:00:00.000Z to 2026-12-17T13:00:00.000Z, 98.00 EUR) from pending to confirmed. Camille Simon (camille.simon@ab.test) gets the \\\"request accepted\\\" message by email. Its items leave the stock for these dates. These lines fit the stock but not the 120-minute turnover buffer the store keeps between rentals, and are confirmed past it all the same: Kayak biplace, 1 asked, 0 free with the buffer. The reservation's history records it. Nothing was done yet. To go ahead, call again with the same input and this confirmation token.\",\"details\":{\"preview\":{\"summary\":\"Change reservation #R-00094 for Camille Simon (2026-12-13T13:00:00.000Z to 2026-12-17T13:00:00.000Z, 98.00 EUR) from pending to confirmed. Camille Simon (camille.simon@ab.test) gets the \\\"request accepted\\\" message by email. Its items leave the stock for these dates. These lines fit the stock but not the 120-minute turnover buffer the store keeps between rentals, and are confirmed past it all the same: Kayak biplace, 1 asked, 0 free with the buffer. The reservation's history records it.\",\"details\":{\"reservation\":{\"id\":\"ab_reservation_00002\",\"number\":\"R-00094\",\"from\":\"pending\",\"to\":\"confirmed\",\"startDate\":\"2026-12-13T13:00:00.000Z\",\"endDate\":\"2026-12-17T13:00:00.000Z\",\"totalAmount\":\"98.00\",\"currency\":\"EUR\"},\"customer\":{\"name\":\"Camille Simon\",\"email\":\"camille.simon@ab.test\"},\"messages\":[{\"message\":\"request_accepted\",\"channel\":\"email\"}],\"reducesAvailability\":true,\"overbooking\":null,\"turnoverBuffer\":{\"shortfalls\":[{\"productId\":\"ab_product_kayak_001\",\"productName\":\"Kayak biplace\",\"combinationKey\":null,\"requested\":1,\"available\":0,\"reservationItemId\":\"ab_line_00002\",\"selectedAttributes\":null}],\"turnoverBufferMinutes\":120},\"money\":null,\"insuranceContract\":null}}},\"bindingHash\":\"2833e56c62b50bfcf0062af3a2512c34027579a4483dfe1fddf7b55ccf98d0ef\"}",
  "a booking confirmed beyond the stock, no message":
    "{\"message\":\"Change reservation #R-00095 for Bo Ray (2026-12-13T13:00:00.000Z to 2026-12-17T13:00:00.000Z, 98.00 EUR) from pending to confirmed. No message goes to the customer. Its items leave the stock for these dates. The stock cannot cover it, and it is booked over the stock all the same: Paddle, 2 asked, 1 free. The reservation's history records it. Nothing was done yet. To go ahead, call again with the same input and this confirmation token.\",\"details\":{\"preview\":{\"summary\":\"Change reservation #R-00095 for Bo Ray (2026-12-13T13:00:00.000Z to 2026-12-17T13:00:00.000Z, 98.00 EUR) from pending to confirmed. No message goes to the customer. Its items leave the stock for these dates. The stock cannot cover it, and it is booked over the stock all the same: Paddle, 2 asked, 1 free. The reservation's history records it.\",\"details\":{\"reservation\":{\"id\":\"ab_reservation_00003\",\"number\":\"R-00095\",\"from\":\"pending\",\"to\":\"confirmed\",\"startDate\":\"2026-12-13T13:00:00.000Z\",\"endDate\":\"2026-12-17T13:00:00.000Z\",\"totalAmount\":\"98.00\",\"currency\":\"EUR\"},\"customer\":{\"name\":\"Bo Ray\",\"email\":\"\"},\"messages\":[],\"reducesAvailability\":true,\"overbooking\":{\"shortfalls\":[{\"productId\":\"ab_product_kayak_002\",\"productName\":\"Paddle\",\"combinationKey\":null,\"requested\":2,\"available\":1,\"reservationItemId\":\"ab_line_00003\",\"selectedAttributes\":null}]},\"turnoverBuffer\":null,\"money\":null,\"insuranceContract\":null}}},\"bindingHash\":\"1bddd34912d351b410a9db6011e4b575e1e1dae7e44c94769e552c588857b1e6\"}",
  "a booking confirmed with both flags, nothing short, a message goes":
    "{\"message\":\"Change reservation #R-00096 for Camille Simon (2026-12-13T13:00:00.000Z to 2026-12-17T13:00:00.000Z, 98.00 EUR) from pending to confirmed. Camille Simon (camille.simon@ab.test) gets the \\\"request accepted\\\" message by email. Its items leave the stock for these dates. The turnover buffer stops no line: nothing is confirmed past it. The stock covers it: nothing is booked over the stock. Nothing was done yet. To go ahead, call again with the same input and this confirmation token.\",\"details\":{\"preview\":{\"summary\":\"Change reservation #R-00096 for Camille Simon (2026-12-13T13:00:00.000Z to 2026-12-17T13:00:00.000Z, 98.00 EUR) from pending to confirmed. Camille Simon (camille.simon@ab.test) gets the \\\"request accepted\\\" message by email. Its items leave the stock for these dates. The turnover buffer stops no line: nothing is confirmed past it. The stock covers it: nothing is booked over the stock.\",\"details\":{\"reservation\":{\"id\":\"ab_reservation_00004\",\"number\":\"R-00096\",\"from\":\"pending\",\"to\":\"confirmed\",\"startDate\":\"2026-12-13T13:00:00.000Z\",\"endDate\":\"2026-12-17T13:00:00.000Z\",\"totalAmount\":\"98.00\",\"currency\":\"EUR\"},\"customer\":{\"name\":\"Camille Simon\",\"email\":\"camille.simon@ab.test\"},\"messages\":[{\"message\":\"request_accepted\",\"channel\":\"email\"}],\"reducesAvailability\":true,\"overbooking\":{\"shortfalls\":[]},\"turnoverBuffer\":{\"shortfalls\":[],\"turnoverBufferMinutes\":120},\"money\":null,\"insuranceContract\":null}}},\"bindingHash\":\"b51182060925ac7fc82ae6349ef3b4ce6070668d3fc4fe8bce137f3f8cde709e\"}",
};

describe("the six branches a person will approve, as an agent is answered (database)", {
  skip: skipWithoutTestDatabase(),
}, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let orm: typeof import("drizzle-orm");
  let permissions: typeof import("../platform/permissions");
  let routers: Record<string, Record<string, unknown>>;
  let preview: typeof import("./approval-preview");
  /** What the last call handed `checkConfirmation` as its display. */
  let displays: unknown[] = [];

  const ports = {
    planFeatures: async () => ({ apiAccess: true }),
    runReservationEffects: async () => {},
    insurance: { createContract: async () => null, cancelContract: async () => {} },
    newStores: createTestNewStores(),
    dispatchEffects: () => {},
    storage: createMemoryStorage(),
    urls: createTestUrls(),
    afterCommit: () => {},
    team: { collaboratorLimit: async () => 10, emailConfigured: () => true },
    // Every branch here is asked first: its writer is never reached.
    paymentRecords: {
      insert: async () => {
        throw new Error("the payment writer is not reached");
      },
    },
  };

  before(async () => {
    database = await createTestDatabase("api_approval_branches");
    louezDb = await import("@louez/db");
    orm = await import("drizzle-orm");
    permissions = await import("../platform/permissions");
    preview = await import("./approval-preview");
    // The check as it is, with the display each call hands it kept.
    const confirmation: Record<string, unknown> = await import("../platform/confirmation");
    const check = confirmation.checkConfirmation as (input: { display?: unknown }) => unknown;
    mock.module(import.meta.resolve("../platform/confirmation"), {
      namedExports: {
        ...confirmation,
        checkConfirmation: (input: { display?: unknown }) => {
          displays.push(input.display);
          return check(input);
        },
      },
    });
    routers = {
      team: (await import("../routers/dashboard/team")).dashboardTeamRouter,
      reservations: (await import("../routers/dashboard/reservations"))
        .dashboardReservationsRouter,
      payments: (await import("../routers/dashboard/payments")).dashboardPaymentsRouter,
    };
    const { db } = louezDb;
    await db.insert(louezDb.users).values([
      { id: OWNER, email: "owner@ab.test", name: "Olga Owner" },
      { id: MEMBER_USER, email: "lucas.bernard@ab.test", name: "Lucas Bernard" },
    ]);
    await db.insert(louezDb.stores).values({
      id: STORE,
      userId: OWNER,
      name: "Vélo Liberté",
      slug: "ab-velo-liberte",
      onboardingCompleted: true,
      settings: {
        reservationMode: "request" as const,
        currency: "EUR",
        timezone: "Europe/Paris",
        pendingBlocksAvailability: false,
        advanceNoticeMinutes: 0,
        minRentalMinutes: 0,
        turnoverBufferMinutes: 120,
      },
    });
    await db.insert(louezDb.storeMembers).values([
      { storeId: STORE, userId: OWNER, role: "owner" },
      {
        id: MEMBERSHIP,
        storeId: STORE,
        userId: MEMBER_USER,
        role: "member",
        createdAt: new Date("2026-03-03T09:00:00.000Z"),
      },
    ]);
    await db.insert(louezDb.storeInvitations).values({
      id: INVITATION,
      storeId: STORE,
      email: "nina.roux@ab.test",
      role: "member",
      token: "ab_invitation_token_0000000000000001",
      invitedBy: OWNER,
      expiresAt: new Date("2030-01-01T00:00:00.000Z"),
      createdAt: new Date("2026-11-02T08:30:00.000Z"),
    });
    await db.insert(louezDb.customers).values([
      {
        id: CUSTOMER,
        storeId: STORE,
        email: "camille.simon@ab.test",
        firstName: "Camille",
        lastName: "Simon",
      },
      // No email, no phone: no message can go.
      { id: SILENT, storeId: STORE, email: "", firstName: "Bo", lastName: "Ray" },
    ]);
    const product = (id: string, name: string) =>
      db.insert(louezDb.products).values({
        id,
        storeId: STORE,
        name,
        price: "10.00",
        pricingMode: "day",
        quantity: 1,
      });
    await product("ab_product_kayak_001", "Kayak biplace");
    await product("ab_product_kayak_002", "Paddle");
    await product("ab_product_kayak_003", "Vélo cargo");
    const reservation = (
      id: string,
      number: string,
      status: "pending" | "confirmed",
      customerId: string,
      start: Date,
      end: Date,
    ) =>
      db.insert(louezDb.reservations).values({
        id,
        storeId: STORE,
        customerId,
        number,
        status,
        startDate: start,
        endDate: end,
        subtotalAmount: "98.00",
        depositAmount: "300.00",
        totalAmount: "98.00",
        currency: "EUR",
      });
    const line = (reservationId: string, productId: string, name: string, quantity: number) =>
      db.insert(louezDb.reservationItems).values({
        id: `${reservationId.replace("reservation", "line")}`,
        reservationId,
        productId,
        quantity,
        unitPrice: "49.00",
        depositPerUnit: "0.00",
        totalPrice: "98.00",
        productSnapshot: { name, description: null, images: [] },
      });
    await reservation(PAID, "R-00090", "confirmed", CUSTOMER, AT, UNTIL);
    await db.insert(louezDb.payments).values([
      {
        id: "ab_payment_deposit01",
        reservationId: PAID,
        amount: "300.00",
        type: "deposit",
        method: "card",
        status: "completed",
        currency: "EUR",
        paidAt: new Date("2026-11-10T09:00:00.000Z"),
      },
      {
        id: PAYMENT,
        reservationId: PAID,
        amount: "80.00",
        type: "rental",
        method: "cash",
        status: "completed",
        currency: "EUR",
        paidAt: new Date("2026-11-12T15:30:00.000Z"),
      },
    ]);
    // One kayak asked, free only without the turnover buffer.
    await reservation(BUFFERED, "R-00094", "pending", CUSTOMER, AT, UNTIL);
    await line(BUFFERED, "ab_product_kayak_001", "Kayak biplace", 1);
    await reservation(
      EARLIER,
      "R-00093",
      "confirmed",
      SILENT,
      new Date(AT.getTime() - 24 * HOUR),
      new Date(AT.getTime() - HOUR),
    );
    await line(EARLIER, "ab_product_kayak_001", "Kayak biplace", 1);
    // Two paddles asked of one.
    await reservation(SHORT, "R-00095", "pending", SILENT, AT, UNTIL);
    await line(SHORT, "ab_product_kayak_002", "Paddle", 2);
    // A cargo bike the stock and the buffer cover.
    await reservation(COVERED, "R-00096", "pending", CUSTOMER, AT, UNTIL);
    await line(COVERED, "ab_product_kayak_003", "Vélo cargo", 1);
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  async function context() {
    const store = await louezDb.db.query.stores.findFirst({
      where: orm.eq(louezDb.stores.id, STORE),
    });
    return {
      transport: "mcp" as const,
      headers: new Headers(),
      ports,
      receipt: {},
      store,
      actor: {
        transport: "mcp" as const,
        isPlatformAdmin: false,
        credential: {
          kind: "api_key" as const,
          id: KEY,
          clientName: "Sample assistant",
          userId: OWNER,
          email: "owner@ab.test",
          storeId: STORE,
          stores: null,
          scopes: permissions.presetScopes("write"),
          confirmSensitive: true,
          bundles: null,
        },
        storeId: STORE,
        role: "owner" as const,
      },
    };
  }

  /** What the agent is answered, as JSON: the code, the message, the details but the token, the binding. */
  async function answerOf(branch: (typeof BRANCHES)[number]): Promise<string> {
    const [, domain, name] = branch.path;
    const procedure = routers[domain]?.[name] as
      | { "~orpc": { handler: (options: unknown) => Promise<unknown> } }
      | undefined;
    assert.ok(procedure, `${branch.path.join(".")} is a procedure`);
    let error: unknown = null;
    displays = [];
    try {
      await procedure["~orpc"].handler({
        context: await context(),
        input: branch.input,
        path: branch.path,
      });
    } catch (caught) {
      error = caught;
    }
    const data = (error as { data?: { code?: string; details?: Record<string, unknown> } }).data;
    assert.equal(data?.code, "CONFIRMATION_REQUIRED", `${branch.name}: asked`);
    const { confirmationToken, expiresAt: _expiresAt, ...details } = data?.details ?? {};
    const [row] = await louezDb.db
      .select({ bindingHash: louezDb.apiConfirmations.bindingHash })
      .from(louezDb.apiConfirmations)
      .where(orm.eq(louezDb.apiConfirmations.id, String(confirmationToken)));
    assert.ok(row, `${branch.name}: its token is recorded`);
    return JSON.stringify({
      message: (error as Error).message,
      details,
      bindingHash: row.bindingHash,
    });
  }

  test("the amount a display shows is the amount the row holds: MySQL's own `decimal(10,2)`", async () => {
    const { storedAmount } = await import("./approval-presentations");
    // As the writer hands it the column: the amount as it was sent
    // (apps/web lib/reservations/dashboard-payment-writes.ts).
    const sent = [
      "1.49",
      "1.234",
      "1.235",
      "1.245",
      "-20.005",
      "-20.004",
      "-0.004",
      "0.004",
      "120",
      "120.5",
      "007.5",
      "1500.00",
      "99999999.99",
      "99999999.994",
    ];
    for (const [index, amount] of sent.entries()) {
      const id = `ab_amount_${String(index).padStart(11, "0")}`;
      await louezDb.db.insert(louezDb.payments).values({
        id,
        reservationId: PAID,
        amount,
        type: "rental",
        method: "cash",
        status: "pending",
        currency: "JPY",
      });
      const [row] = await louezDb.db
        .select({ amount: louezDb.payments.amount })
        .from(louezDb.payments)
        .where(orm.eq(louezDb.payments.id, id));
      assert.equal(storedAmount(amount), row?.amount, amount);
      await louezDb.db.delete(louezDb.payments).where(orm.eq(louezDb.payments.id, id));
    }
    // Past eight integer digits the column refuses it, and no display shows it.
    for (const amount of ["99999999.995", "100000000"]) {
      await assert.rejects(
        louezDb.db.insert(louezDb.payments).values({
          id: "ab_amount_out_of_range",
          reservationId: PAID,
          amount,
          type: "rental",
          method: "cash",
          status: "pending",
        }),
        amount,
      );
      assert.equal(storedAmount(amount), null, amount);
    }
  });

  for (const branch of BRANCHES) {
    test(`${branch.name}: its check gets a display the page shows, kept out of the answer`, async () => {
      const answer = await answerOf(branch);
      assert.equal(displays.length, 1);
      const [display] = displays;
      assert.equal(JSON.stringify(display), DISPLAYS[branch.name]);
      const shown = preview.shownDisplay(display);
      assert.ok(shown?.readable, "the page reads it whole");
      // Nothing of it reaches the agent.
      assert.doesNotMatch(answer, /headline|"facts"|"key":/);
    });
  }

  for (const branch of BRANCHES) {
    test(`${branch.name}: the agent is answered as before, byte for byte`, async () => {
      const answer = await answerOf(branch);
      assert.equal(answer, ANSWERS[branch.name]);
    });
  }
});
