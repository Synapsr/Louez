import assert from "node:assert/strict";

import type {
  DepositAuthorizationAnswer,
  DepositAuthorizationRequest,
  DepositHoldStripe,
} from "./deposit-hold-stripe";
import type { DepositIntent } from "./util.deposit-hold-transition";

// Stripe, as far as a deposit hold goes, for the database suites. It is the source of
// truth of what is held: a test asserts on `held()`, per connected account, next to
// the rows. Everything is kept per account, as Stripe keeps it: PaymentIntents, saved
// cards, and idempotency keys.

const DAY = 24 * 3_600_000;

/** Stripe's ids are unique: two fakes of one test run never make the same one. */
let madeIntents = 0;

type Authorize = (
  request: DepositAuthorizationRequest,
  key: string,
) => Promise<DepositAuthorizationAnswer>;

export type FakeIntent = {
  id: string;
  accountId: string;
  customerId: string | null;
  paymentMethodId: string | null;
  amountMinor: number;
  capturedMinor: number;
  currency: string;
  status: string;
  createdAt: Date;
  /** `capture_before` of its charge; null when Stripe states none. */
  captureBefore: Date | null;
  captureMethod: string;
  attemptId: string | null;
  reservationId: string | null;
};

/** What Stripe does with a key's first request, and what the key answers from then on. */
type KeyOutcome = {
  readonly answer: DepositAuthorizationAnswer;
  readonly replay: DepositAuthorizationAnswer;
};

type StoredKey = {
  readonly request: DepositAuthorizationRequest;
  readonly outcome: KeyOutcome;
};

export function fakeDepositStripe(options: { readonly pageSize?: number } = {}) {
  const pageSize = options.pageSize ?? 100;
  const intents: FakeIntent[] = [];
  const keys = new Map<string, StoredKey>();
  const cards = new Map<string, string>();
  const calls: Array<{ key: string; request: DepositAuthorizationRequest }> = [];
  /** Each page read of a customer's PaymentIntents. */
  const pagesRead: Array<{ accountId: string; customerId: string }> = [];
  /** Each cancellation Stripe was asked for, made or not. */
  const releaseCalls: string[] = [];
  const released: string[] = [];
  const next: Authorize[] = [];
  /** Requests Stripe is still running: `finishRunning` lets them create their PaymentIntent. */
  const running: Array<() => void> = [];
  /** Requests Stripe answered 500 to, whose PaymentIntent it makes later: `reconcile`. */
  const unreconciled: Array<() => FakeIntent> = [];
  let clock = () => new Date();
  /** How long Stripe keeps an authorization it makes; null when it states no deadline. */
  let authorizationDays: number | null = 7;
  let releasesToFail = 0;

  const scope = (accountId: string, id: string) => `${accountId}:${id}`;

  const toIntent = (intent: FakeIntent): DepositIntent => ({
    paymentIntentId: intent.id,
    status: intent.status,
    amountMinor: intent.amountMinor,
    capturedMinor: intent.capturedMinor,
    currency: intent.currency,
    captureBefore: intent.captureBefore,
    captureMethod: intent.captureMethod,
    customerId: intent.customerId,
    paymentMethodId: intent.paymentMethodId,
    chargeId: intent.status === "succeeded" ? `ch_${intent.id}` : null,
    attemptId: intent.attemptId,
    reservationId: intent.reservationId,
  });

  const create = (
    values: Omit<
      FakeIntent,
      "id" | "createdAt" | "capturedMinor" | "captureBefore" | "captureMethod"
    > &
      Partial<Pick<FakeIntent, "captureBefore" | "captureMethod">>,
  ) => {
    const createdAt = clock();
    const intent: FakeIntent = {
      captureBefore:
        authorizationDays === null ? null : new Date(createdAt.getTime() + authorizationDays * DAY),
      captureMethod: "manual",
      ...values,
      id: `pi_${++madeIntents}_${values.accountId.slice(-4)}`,
      capturedMinor: 0,
      createdAt,
    };
    intents.push(intent);
    return intent;
  };

  const intentOf = (accountId: string, paymentIntentId: string) => {
    const intent = intents.find(
      (candidate) => candidate.id === paymentIntentId && candidate.accountId === accountId,
    );
    // Stripe answers `resource_missing` for another account's object.
    assert.ok(intent, `No such payment_intent on ${accountId}: ${paymentIntentId}`);
    return intent;
  };

  const fromRequest = (request: DepositAuthorizationRequest, status: string) =>
    create({
      accountId: request.accountId,
      customerId: request.customerId,
      paymentMethodId: request.paymentMethodId,
      amountMinor: request.amountMinor,
      currency: request.currency,
      status,
      attemptId: request.attemptId,
      reservationId: request.reservationId,
    });

  /**
   * A key's first request, with `first` as what Stripe does with it; the same key sent
   * again answers what the first was answered, and with other parameters it is refused.
   */
  const withKey =
    (first: (request: DepositAuthorizationRequest) => KeyOutcome): Authorize =>
    async (request, key) => {
      const stored = keys.get(scope(request.accountId, key));
      if (stored) {
        try {
          assert.deepEqual(request, stored.request);
        } catch {
          return { kind: "key_reused" };
        }
        return stored.outcome.replay;
      }
      // A request that fails validation leaves no key behind.
      if (cards.get(scope(request.accountId, request.paymentMethodId)) !== request.customerId) {
        return {
          kind: "refused",
          paymentIntentId: null,
          message: `No such PaymentMethod: '${request.paymentMethodId}'`,
        };
      }
      const outcome = first(request);
      keys.set(scope(request.accountId, key), { request, outcome });
      return outcome.answer;
    };

  const created = (intent: FakeIntent): DepositAuthorizationAnswer => ({
    kind: "created",
    intent: toIntent(intent),
  });
  const noAnswer = (replayed: boolean, message: string): DepositAuthorizationAnswer => ({
    kind: "indeterminate",
    replayed,
    message,
  });

  /** Stripe authorizes and answers. */
  const accept = withKey((request) => {
    const answer = created(fromRequest(request, "requires_capture"));
    return { answer, replay: answer };
  });

  const port: DepositHoldStripe = {
    authorize(request, key) {
      calls.push({ key, request });
      return (next.shift() ?? accept)(request, key);
    },
    async readIntent(accountId, paymentIntentId) {
      return toIntent(intentOf(accountId, paymentIntentId));
    },
    async cardCustomer(accountId, paymentMethodId) {
      const customerId = cards.get(scope(accountId, paymentMethodId));
      assert.ok(customerId !== undefined, `No such PaymentMethod on ${accountId}`);
      return customerId || null;
    },
    async listCustomerIntents({ accountId, customerId, startingAfter }) {
      pagesRead.push({ accountId, customerId });
      // Newest first, as Stripe lists.
      const ofCustomer = intents
        .filter((intent) => intent.accountId === accountId && intent.customerId === customerId)
        .reverse();
      const from = startingAfter
        ? ofCustomer.findIndex((intent) => intent.id === startingAfter) + 1
        : 0;
      return {
        intents: ofCustomer.slice(from, from + pageSize).map(toIntent),
        hasMore: from + pageSize < ofCustomer.length,
      };
    },
    async capture(accountId, paymentIntentId, amountMinor) {
      const intent = intentOf(accountId, paymentIntentId);
      assert.equal(intent.status, "requires_capture", `${paymentIntentId} cannot be captured`);
      assert.ok(amountMinor <= intent.amountMinor, "capture above the authorization");
      intent.status = "succeeded";
      intent.capturedMinor = amountMinor;
      return toIntent(intent);
    },
    async release(accountId, paymentIntentId) {
      releaseCalls.push(paymentIntentId);
      if (releasesToFail > 0) {
        releasesToFail -= 1;
        throw new Error("Stripe is down");
      }
      const intent = intentOf(accountId, paymentIntentId);
      assert.notEqual(intent.status, "succeeded", `${paymentIntentId} was captured`);
      if (intent.status !== "canceled") released.push(paymentIntentId);
      intent.status = "canceled";
      return toIntent(intent);
    },
  };

  return {
    port,
    calls,
    pagesRead,
    releaseCalls,
    released,
    intents,
    /** Scripts the authorizations to come, in order; `accept` once they are spent. */
    next,
    accept,
    toIntent,
    intentOf,
    /** Saves a card on a customer of a connected account. */
    saveCard(accountId: string, paymentMethodId: string, customerId: string) {
      cards.set(scope(accountId, paymentMethodId), customerId);
    },
    /** Stripe's clock: a PaymentIntent is dated with it. */
    setClock(now: () => Date) {
      clock = now;
    },
    /**
     * How long Stripe keeps the authorizations it makes from now on: 7 days by
     * default, longer on some networks, null when it states no deadline.
     */
    setAuthorizationDays(days: number | null) {
      authorizationDays = days;
    },
    /** The next `count` cancellations fail before they reach the PaymentIntent. */
    failReleases(count: number) {
      releasesToFail = count;
    },
    /** The authorizations Stripe holds, on one account or on all. */
    held: (accountId?: string) =>
      intents.filter(
        (intent) =>
          intent.status === "requires_capture" && (!accountId || intent.accountId === accountId),
      ),
    /** Stripe authorizes; the answer never comes. */
    lostAnswer: withKey((request) => {
      const answer = created(fromRequest(request, "requires_capture"));
      return { answer: noAnswer(false, "socket hang up"), replay: answer };
    }),
    /** The request never reaches Stripe: the key stays unknown to it. */
    neverArrives: (async () => noAnswer(false, "connect ETIMEDOUT")) satisfies Authorize,
    /**
     * Stripe is still running the request when Louez gives up: the PaymentIntent
     * exists only once `finishRunning` is called.
     */
    stillRunning: withKey((request) => {
      const replay: { answer?: DepositAuthorizationAnswer } = {};
      running.push(() => {
        replay.answer = created(fromRequest(request, "requires_capture"));
      });
      return {
        answer: noAnswer(false, "timeout"),
        get replay() {
          // Until Stripe is done, the key is locked: a 409.
          return replay.answer ?? noAnswer(false, "a request with this key is in progress");
        },
      };
    }),
    finishRunning() {
      for (const finish of running.splice(0)) finish();
    },
    /**
     * Stripe fails with a 500 and stores it for the key: every request with the key
     * gets that 500 again, marked as replayed, whatever became of the request. Its
     * authorization is made `now`, `never`, or `later`: Stripe then reconciles the
     * request into a PaymentIntent when `reconcile` is called, and the key still
     * answers its 500.
     */
    serverError: (authorizes: "now" | "never" | "later") =>
      withKey((request) => {
        if (authorizes === "now") fromRequest(request, "requires_capture");
        if (authorizes === "later") {
          unreconciled.push(() => fromRequest(request, "requires_capture"));
        }
        return {
          answer: noAnswer(false, "An unknown error occurred"),
          replay: noAnswer(true, "An unknown error occurred"),
        };
      }),
    /** Stripe makes the PaymentIntents of the requests it answered 500 to; returns them. */
    reconcile: () => unreconciled.splice(0).map((make) => make()),
    /** Stripe never makes anything of the requests it answered 500 to. */
    giveUp() {
      unreconciled.length = 0;
    },
    /** The card is declined: a PaymentIntent exists and holds nothing. */
    declined: withKey((request) => {
      const intent = fromRequest(request, "requires_payment_method");
      const answer: DepositAuthorizationAnswer = {
        kind: "refused",
        paymentIntentId: intent.id,
        message: "Your card was declined.",
      };
      return { answer, replay: answer };
    }),
    /** The card needs the customer: a PaymentIntent exists and holds nothing. */
    needsCustomer: withKey((request) => {
      const answer = created(fromRequest(request, "requires_action"));
      return { answer, replay: answer };
    }),
    /** The customer's own authorization, confirmed on the storefront. */
    customerAuthorizes(input: {
      accountId: string;
      reservationId: string;
      amountMinor?: number;
      currency?: string;
    }) {
      return create({
        accountId: input.accountId,
        customerId: null,
        paymentMethodId: "pm_customer",
        amountMinor: input.amountMinor ?? 5000,
        currency: input.currency ?? "EUR",
        status: "requires_capture",
        attemptId: null,
        reservationId: input.reservationId,
      });
    },
    /** Any PaymentIntent, as Stripe would have it. */
    createIntent: create,
    /** Stripe cancels an authorization: it expired, or someone cancelled it there. */
    cancel(accountId: string, paymentIntentId: string) {
      intentOf(accountId, paymentIntentId).status = "canceled";
    },
    /** A capture made at Stripe, from its dashboard: Louez only hears of it. */
    captureAtStripe(accountId: string, paymentIntentId: string, amountMinor?: number) {
      const intent = intentOf(accountId, paymentIntentId);
      assert.equal(intent.status, "requires_capture", `${paymentIntentId} cannot be captured`);
      intent.status = "succeeded";
      intent.capturedMinor = amountMinor ?? intent.amountMinor;
    },
  };
}

export type FakeDepositStripe = ReturnType<typeof fakeDepositStripe>;
