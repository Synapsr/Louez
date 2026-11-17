import "@/lib/testing/install-dom";

import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { CartProvider } from "@/contexts/cart-context";
import { StoreProvider } from "@/contexts/store-context";
import { mount, settle } from "@/lib/testing/dom";
import type { ReservationOutcomeEvent } from "@/lib/customer-auth/util.account-redirect";
import { getCartStorageKey } from "@/lib/utils/util.cart-storage";

import { ReservationCartReset } from "./reservation-cart-reset";

// The cart lives in this browser's storage, one key per store. A page reached
// straight from a completed payment is loaded afresh: the cart reads its
// storage on mount, and the reset has to leave it empty all the same.

const CART_KEY = getCartStorageKey("shop");
const PENDING_KEY = "louez:checkout:pending-reservation";

const storedCart = JSON.stringify({
  storeSlug: "shop",
  lines: [{ productId: "tent", productName: "Tent", quantity: 2 }],
  period: { startDate: "2026-12-01T09:00:00.000Z", endDate: "2026-12-03T09:00:00.000Z" },
  pricingMode: "day",
});

const storedLines = (): unknown[] => {
  const raw = window.localStorage.getItem(CART_KEY);
  return raw ? (JSON.parse(raw) as { lines: unknown[] }).lines : [];
};

const renderPage = (event: ReservationOutcomeEvent | null) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { enabled: false } } });
  return mount(
    <QueryClientProvider client={queryClient}>
      <StoreProvider storeId="store" currency="EUR" storeSlug="shop" storeName="Shop">
        <CartProvider>
          <ReservationCartReset event={event} />
        </CartProvider>
      </StoreProvider>
    </QueryClientProvider>,
  );
};

let unmount: (() => void) | null = null;

beforeEach(() => {
  // The cart's clock ticks every second: a mocked one, so nothing outlives the test.
  mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 0 });
  window.localStorage.clear();
  window.localStorage.setItem(CART_KEY, storedCart);
  window.localStorage.setItem(
    PENDING_KEY,
    JSON.stringify({ storeId: "store", reservationId: "booking" }),
  );
});

afterEach(() => {
  unmount?.();
  unmount = null;
  mock.timers.reset();
});

test("a page loaded after a completed payment empties the stored cart", async () => {
  unmount = renderPage("paid").unmount;
  await settle();

  assert.deepEqual(storedLines(), []);
  assert.equal(window.localStorage.getItem(PENDING_KEY), null);
});

test("any other visit keeps the stored cart", async () => {
  unmount = renderPage(null).unmount;
  await settle();

  assert.equal(storedLines().length, 1);
  assert.notEqual(window.localStorage.getItem(PENDING_KEY), null);
});
