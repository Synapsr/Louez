import "@/lib/testing/install-dom";
import { setFetchHandler } from "@/lib/testing/fake-fetch";

import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { PublicEnvProvider } from "@/components/shared/public-env-provider";
import { mount, settle } from "@/lib/testing/dom";
import { publicEnvSchema } from "@/lib/validators/validator.public-env";

import type { StripeRefundOperation } from "./util.stripe-refund";

// A refund still pending is read again; once it moved, the reservation and the page's
// server parts (its invoices and credit notes) are read again, without a reload.

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

const loadWatcher = () => import("./pending-stripe-refunds-watcher");

const pending: StripeRefundOperation = {
  id: "op_watch",
  paymentId: "pay_watch",
  refundPaymentId: null,
  status: "pending",
  amount: "20.00",
  createdAt: "2031-06-01T10:00:00Z",
  failure: null,
};

/** `get_refund`'s answer for that refund, in the state the test gives. */
const refundRead = (status: string, refundPaymentId: string | null) =>
  new Response(
    JSON.stringify({
      json: {
        refund: {
          id: "op_watch",
          status,
          detail: status === "pending" ? "sending" : null,
          amount: "20.00",
          currency: "EUR",
          reason: "requested_by_customer",
          createdAt: "2031-06-01T10:00:00.000Z",
          stripeRefundId: refundPaymentId ? "re_watch" : null,
          refundPaymentId,
          failure: null,
          creditNote: { status: "pending", number: null, needsCorrection: false },
        },
        paymentId: "pay_watch",
        reservationId: "res_watch",
        number: "2031-0042",
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

let unmount: (() => void) | null = null;
afterEach(() => {
  unmount?.();
  unmount = null;
  refreshes = 0;
  mock.restoreAll();
});

const watch = async (answer: () => Response) => {
  const reads: string[] = [];
  setFetchHandler(async (request) => {
    reads.push(new URL(request.url).pathname.split("/").at(-1) ?? "");
    return answer();
  });
  const { PendingStripeRefundsWatcher } = await loadWatcher();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const invalidated = mock.method(queryClient, "invalidateQueries");
  unmount = mount(
    <PublicEnvProvider
      config={publicEnvSchema.parse({
        NEXT_PUBLIC_APP_URL: "https://app.louez.test",
        NEXT_PUBLIC_APP_DOMAIN: "louez.test",
      })}
    >
      <QueryClientProvider client={queryClient}>
        <PendingStripeRefundsWatcher reservationId="res_watch" refunds={[pending]} enabled />
      </QueryClientProvider>
    </PublicEnvProvider>,
  ).unmount;
  for (let pass = 0; pass < 5; pass += 1) await settle();
  return { reads, invalidated };
};

test("a refund that moved: the reservation and the page's server parts are read again", async () => {
  const { reads, invalidated } = await watch(() => refundRead("succeeded", "pay_refund"));
  assert.deepEqual(reads, ["getRefund"]);
  assert.ok(invalidated.mock.callCount() > 0);
  assert.equal(refreshes, 1);
});

test("a refund still as the page shows it: nothing is read again", async () => {
  const { reads, invalidated } = await watch(() => refundRead("pending", null));
  assert.deepEqual(reads, ["getRefund"]);
  assert.equal(invalidated.mock.callCount(), 0);
  assert.equal(refreshes, 0);
});
