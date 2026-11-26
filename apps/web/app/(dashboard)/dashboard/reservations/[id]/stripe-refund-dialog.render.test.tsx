import "@/lib/testing/install-dom";
// Before the dialog, which builds the oRPC client with the `fetch` it finds.
import { setFetchHandler } from "@/lib/testing/fake-fetch";

import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";

import { toastManager } from "@louez/ui";

import { PublicEnvProvider } from "@/components/shared/public-env-provider";
import { deferred, mount, pressKey, settle, typeInto } from "@/lib/testing/dom";
import { publicEnvSchema } from "@/lib/validators/validator.public-env";
import messages from "@/messages/en.json";

// The refund dialog of a payment taken online: what can be refunded, read from Stripe,
// fills the amount; the amount is judged as it is typed; the summary says what follows.
// A double click sends one refund, a retry here of the same values replays, and nothing
// closes the dialog while a send is out; nothing about a refund is kept in the browser.
// The server's guards read as specified: a refund in progress closes the dialog with
// where to look, the same amount again is asked, and only its button confirms it. A
// refusal stays in the dialog; once a refund is returned, the dialog closes and the
// page's server parts are read again.

let refreshes = 0;
mock.module("next/navigation", {
  namedExports: {
    useRouter: () => ({
      refresh: () => {
        refreshes += 1;
      },
    }),
  },
});

const captured: Array<Record<string, unknown>> = [];
mock.module("@/lib/product-analytics/reservation-analytics-client", {
  namedExports: {
    captureStripeRefundRequested: (properties: Record<string, unknown>) => {
      captured.push(properties);
    },
  },
});

// Loaded once the analytics are mocked.
const loadDialog = () => import("./stripe-refund-dialog");

const words = messages.dashboard.reservations.payment.stripeRefund;
const PAYMENT = "pay_dialog_000000001";

const preview = (patch: Record<string, unknown> = {}) => ({
  paymentId: PAYMENT,
  reservationId: "res_dialog_000000001",
  number: "2031-0042",
  type: "rental",
  paidAt: "2031-05-20T10:00:00.000Z",
  currency: "EUR",
  paid: "120.00",
  refunded: "0.00",
  inFlight: "0.00",
  refundable: "120.00",
  card: { brand: "visa", last4: "4242" },
  creditNote: false,
  ...patch,
});

const refundAnswer = (status: "pending" | "succeeded" | "failed") => ({
  refund: {
    id: "op_dialog",
    status,
    detail: status === "pending" ? "processing" : null,
    amount: "45.00",
    currency: "EUR",
    reason: "requested_by_customer",
    createdAt: "2031-06-01T10:00:00.000Z",
    stripeRefundId: null,
    refundPaymentId: null,
    failure: status === "failed" ? { code: "balance_insufficient", message: null } : null,
    creditNote: { status: "not_applicable", number: null, needsCorrection: false },
  },
  paymentId: PAYMENT,
  reservationId: "res_dialog_000000001",
  number: "2031-0042",
});

const answer = (data: unknown) =>
  new Response(JSON.stringify({ json: data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
const refusal = (code: string, details: Record<string, unknown> = {}) =>
  new Response(
    JSON.stringify({
      json: {
        defined: false,
        code: "CONFLICT",
        status: 409,
        message: "English for agents",
        data: { code, retryable: false, details },
      },
    }),
    { status: 409, headers: { "content-type": "application/json" } },
  );

/** Each refund sent: its body and its idempotency key, answered when the test chooses. */
let sends: Array<{
  body: string;
  key: string | null;
  answer: ReturnType<typeof deferred<Response>>;
}>;
let previewAnswer: () => Response;

beforeEach(() => {
  sends = [];
  captured.length = 0;
  refreshes = 0;
  previewAnswer = () => answer(preview());
  setFetchHandler(async (request) => {
    const endpoint = new URL(request.url).pathname.split("/").at(-1);
    if (endpoint === "previewRefund") return previewAnswer();
    if (endpoint === "refund") {
      const send = {
        body: await request.text(),
        key: request.headers.get("idempotency-key"),
        answer: deferred<Response>(),
      };
      sends.push(send);
      return send.answer.promise;
    }
    return answer(null);
  });
});

let unmount: (() => void) | null = null;
afterEach(() => {
  unmount?.();
  unmount = null;
  mock.restoreAll();
});

const open = async () => {
  unmount?.();
  const { StripeRefundDialog } = await loadDialog();
  const closed = { count: 0 };
  // No garbage collection timer outlives the test.
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { gcTime: Infinity },
    },
  });
  const mounted = mount(
    <PublicEnvProvider
      config={publicEnvSchema.parse({
        NEXT_PUBLIC_APP_URL: "https://app.louez.test",
        NEXT_PUBLIC_APP_DOMAIN: "louez.test",
      })}
    >
      <NextIntlClientProvider locale="en" timeZone="Europe/Paris" messages={messages}>
        <QueryClientProvider client={queryClient}>
          <StripeRefundDialog
            paymentId={PAYMENT}
            reservationId="res_dialog_000000001"
            reservationStatus="confirmed"
            customerName="Ada Lovelace"
            onClose={() => {
              closed.count += 1;
            }}
          />
        </QueryClientProvider>
      </NextIntlClientProvider>
    </PublicEnvProvider>,
  );
  unmount = mounted.unmount;
  // Until Stripe's figures are read: the form, or why there is none.
  for (
    let pass = 0;
    pass < 20 && !document.querySelector('[role="dialog"] form, [role="alert"]');
    pass += 1
  ) {
    await settle();
  }
  return closed;
};

const text = () => document.body.textContent?.replace(/\s+/g, " ") ?? "";
const amountInput = () => {
  const input = document.querySelector<HTMLInputElement>('input[name="amount"]');
  assert.ok(input, "the amount field");
  return input;
};
const submitButton = () => {
  const button = document.querySelector<HTMLButtonElement>('button[type="submit"]');
  assert.ok(button, "the confirm button");
  return button;
};
const submit = () => act(() => submitButton().click());
/** Until the page shows what `shown` waits for, a few renders at most. */
const until = async (shown: () => boolean) => {
  for (let pass = 0; pass < 20 && !shown(); pass += 1) await settle();
};

const recordToasts = () => {
  const toasts: Array<{ title?: unknown; description?: unknown }> = [];
  mock.method(toastManager, "add", (toast: { title?: unknown; description?: unknown }) => {
    toasts.push(toast);
    return "toast";
  });
  return toasts;
};

test("the amount starts at what is refundable, and the button carries it", async () => {
  await open();
  assert.equal(amountInput().value, "120.00");
  assert.match(submitButton().textContent ?? "", /Refund €120\.00/);
});

test("the amount is judged as it is typed: above zero, within what is left, in the currency's decimals", async () => {
  await open();
  typeInto(amountInput(), "0");
  await settle();
  assert.ok(text().includes(words.amountInvalid));
  assert.equal(submitButton().disabled, true);
  typeInto(amountInput(), "130");
  await settle();
  assert.ok(text().includes("At most €120.00 can be refunded."));
  typeInto(amountInput(), "10.005");
  await settle();
  assert.ok(text().includes("A EUR amount has at most 2 decimals."));
  typeInto(amountInput(), "45");
  await settle();
  assert.equal(submitButton().disabled, false);
  assert.match(submitButton().textContent ?? "", /Refund €45\.00/);
});

test("the summary: the card, the payment, what was refunded and stays refundable, and what follows", async () => {
  previewAnswer = () => answer(preview({ refunded: "20.00", paid: "140.00" }));
  await open();
  typeInto(amountInput(), "45");
  await settle();
  const shown = text();
  assert.ok(shown.includes("Visa card ending 4242"));
  assert.ok(shown.includes("#2031-0042 · Ada Lovelace"));
  assert.ok(shown.includes("Rental, €140.00 on"));
  assert.ok(shown.includes(`${words.summary.alreadyRefunded}€20.00`));
  assert.ok(shown.includes(`${words.summary.remainingAfter}€75.00`));
  assert.ok(shown.includes(words.summary.balance));
  assert.ok(shown.includes(words.summary.noMessage));
  assert.ok(shown.includes(words.summary.final));
  // The store issues no invoice for it: no credit note announced.
  assert.ok(!shown.includes(words.summary.creditNote));
});

test("a credit note is announced only when one follows", async () => {
  previewAnswer = () => answer(preview({ creditNote: true }));
  await open();
  assert.ok(text().includes(words.summary.creditNote));
});

test("a payment that cannot be refunded now says why instead of the form", async () => {
  previewAnswer = () => refusal("PAYMENT_DISPUTED");
  await open();
  assert.ok(text().includes(words.errors.disputed));
  assert.equal(document.querySelector('input[name="amount"]'), null);
});

test("a double click sends one refund; a refusal stays in the dialog, nothing was refunded, so the next send is free", async () => {
  const closed = await open();
  typeInto(amountInput(), "45");
  await settle();
  act(() => {
    submitButton().click();
    submitButton().click();
  });
  await settle();
  assert.equal(sends.length, 1);
  const [first] = sends;
  assert.ok(first?.key);
  assert.match(first.body, /"amount":"45\.00"/);
  assert.match(first.body, /"reason":"requested_by_customer"/);
  assert.doesNotMatch(first.body, /confirmRepeat/);

  first.answer.resolve(
    refusal("REFUND_EXCEEDS_REFUNDABLE", { refundable: "30.00", currency: "EUR" }),
  );
  await settle();
  assert.ok(text().includes("At most €30.00 can still be refunded on this payment."));
  assert.equal(closed.count, 0);
  assert.equal(captured.at(-1)?.outcome, "REFUND_EXCEEDS_REFUNDABLE");
  submit();
  await settle();
  assert.equal(sends.length, 2);
  assert.notEqual(sends[1]?.key, first.key);
});

test("while a refund is being sent, nothing closes the dialog", async () => {
  // Before anything is sent, Escape closes it, and it has its close button.
  const idle = await open();
  assert.ok(document.querySelector('button[aria-label="Close"]'));
  const idlePopup = document.querySelector<HTMLElement>('[role="dialog"]');
  assert.ok(idlePopup);
  pressKey(idlePopup, "Escape");
  await settle();
  assert.equal(idle.count, 1);

  const closed = await open();
  submit();
  await settle();
  assert.equal(sends.length, 1);
  const cancel = () =>
    [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === messages.common.cancel,
    );
  await until(() => cancel()?.disabled === true);
  assert.equal(cancel()?.disabled, true);
  assert.equal(document.querySelector('button[aria-label="Close"]'), null);
  const popup = document.querySelector<HTMLElement>('[role="dialog"]');
  assert.ok(popup);
  pressKey(popup, "Escape");
  await settle();
  assert.equal(closed.count, 0);
  assert.ok(document.querySelector('input[name="amount"]'), "still open");
  sends[0]?.answer.resolve(answer(refundAnswer("succeeded")));
  await settle();
  assert.equal(closed.count, 1);
});

test("an outcome not known: a retry here replays with the same key, and the person is told to check the history", async () => {
  await open();
  typeInto(amountInput(), "20");
  await settle();
  submit();
  await settle();
  sends[0]?.answer.resolve(refusal("OPERATION_OUTCOME_UNKNOWN"));
  await settle();
  assert.ok(text().includes(words.errors.outcomeUnknown));
  submit();
  await settle();
  assert.equal(sends[1]?.key, sends[0]?.key);
  // A code the dialog does not know proves nothing was refunded either.
  sends[1]?.answer.resolve(refusal("RESERVATION_BUSY"));
  await settle();
  assert.ok(text().includes(words.errors.outcomeUnknown));
});

test("another refund of the payment in progress: the dialog closes and says where to look", async () => {
  const toasts = recordToasts();
  const closed = await open();
  submit();
  await settle();
  sends[0]?.answer.resolve(refusal("REFUND_ALREADY_IN_PROGRESS"));
  await settle();
  assert.equal(closed.count, 1);
  assert.equal(toasts[0]?.title, words.toast.alreadyInProgress);
  assert.equal(toasts[0]?.description, words.toast.alreadyInProgressDescription);
});

test("the same amount as a refund made a moment ago is asked; only its button sends it again, confirmed, with a new key", async () => {
  const closed = await open();
  typeInto(amountInput(), "20");
  await settle();
  submit();
  await settle();
  sends[0]?.answer.resolve(
    refusal("REFUND_REPEAT_UNCONFIRMED", {
      refundedAt: "2031-06-01T10:05:00.000Z",
      by: "Grace Hopper",
      amount: "20.00",
      currency: "EUR",
    }),
  );
  await settle();
  assert.equal(closed.count, 0);
  const shown = text();
  assert.ok(shown.includes("A refund of €20.00 was made at"), shown);
  assert.ok(shown.includes("by Grace Hopper. Refund the same amount again?"));
  const again = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "Refund €20.00 again",
  );
  assert.ok(again);
  act(() => again.click());
  await settle();
  assert.equal(sends.length, 2);
  assert.match(sends[1]?.body ?? "", /"confirmRepeat":true/);
  assert.match(sends[1]?.body ?? "", /"amount":"20\.00"/);
  assert.notEqual(sends[1]?.key, sends[0]?.key);
  sends[1]?.answer.resolve(answer(refundAnswer("succeeded")));
  await settle();
  assert.equal(closed.count, 1);
});

test("the confirmation is the request refused: changed, the warning and its button go, and the new amount goes through the usual checks", async () => {
  await open();
  typeInto(amountInput(), "20");
  await settle();
  submit();
  await settle();
  sends[0]?.answer.resolve(
    refusal("REFUND_REPEAT_UNCONFIRMED", {
      refundedAt: "2031-06-01T10:05:00.000Z",
      by: "Grace Hopper",
      amount: "20.00",
      currency: "EUR",
    }),
  );
  await settle();
  const confirmButton = () =>
    [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Refund €20.00 again",
    );
  assert.ok(confirmButton());
  typeInto(amountInput(), "50");
  await settle();
  assert.equal(confirmButton(), undefined);
  assert.ok(!text().includes("Refund the same amount again?"));
  submit();
  await settle();
  assert.equal(sends.length, 2);
  assert.match(sends[1]?.body ?? "", /"amount":"50\.00"/);
  assert.doesNotMatch(sends[1]?.body ?? "", /confirmRepeat/);
  assert.notEqual(sends[1]?.key, sends[0]?.key);
});

test("nothing about a refund is kept in the browser", async () => {
  const calls: string[] = [];
  for (const storage of [window.sessionStorage, window.localStorage]) {
    for (const method of ["getItem", "setItem", "removeItem"] as const) {
      mock.method(storage, method, (...args: unknown[]) => {
        calls.push(`${method}:${String(args[0])}`);
        return null;
      });
    }
  }
  await open();
  submit();
  await settle();
  sends[0]?.answer.resolve(refusal("OPERATION_OUTCOME_UNKNOWN"));
  await settle();
  submit();
  await settle();
  assert.deepEqual(calls, []);
});

test("once a refund is returned the dialog closes, with what became of it", async () => {
  const toasts: Array<{ title?: unknown; type?: unknown }> = [];
  mock.method(toastManager, "add", (toast: { title?: unknown; type?: unknown }) => {
    toasts.push(toast);
    return "toast";
  });
  const closed = await open();
  typeInto(amountInput(), "45");
  await settle();
  submit();
  await settle();
  sends[0]?.answer.resolve(answer(refundAnswer("pending")));
  await settle();
  assert.equal(closed.count, 1);
  // The invoices and credit notes are read again.
  assert.equal(refreshes, 1);
  assert.deepEqual(
    toasts.map((toast) => [toast.title, toast.type]),
    [[words.toast.pending, "info"]],
  );
  assert.deepEqual(captured, [
    {
      reservationId: "res_dialog_000000001",
      reservationStatus: "confirmed",
      scope: "partial",
      reason: "requested_by_customer",
      outcome: "pending",
    },
  ]);
});

test("a refund Stripe made at once reads succeeded", async () => {
  const toasts = recordToasts();
  const closed = await open();
  submit();
  await settle();
  sends[0]?.answer.resolve(answer(refundAnswer("succeeded")));
  await settle();
  assert.equal(closed.count, 1);
  assert.equal(toasts[0]?.title, words.toast.succeeded);
  assert.equal(captured[0]?.scope, "full");
});

test("a refund Stripe refused once asked reads failed, with why", async () => {
  const toasts = recordToasts();
  const closed = await open();
  submit();
  await settle();
  sends[0]?.answer.resolve(answer(refundAnswer("failed")));
  await settle();
  assert.equal(closed.count, 1);
  assert.equal(toasts[0]?.title, words.toast.failed);
  assert.equal(toasts[0]?.description, words.failures.balance);
  assert.equal(captured[0]?.outcome, "failed");
});
