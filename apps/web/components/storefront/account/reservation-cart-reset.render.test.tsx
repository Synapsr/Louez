import "@/lib/testing/install-dom";

import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { CartProvider } from "@/contexts/cart-context";
import { StoreProvider } from "@/contexts/store-context";
import { mount, settle } from "@/lib/testing/dom";
import { writePendingCheckout } from "@/lib/storefront/util.pending-checkout-storage";
import { getCartStorageKey } from "@/lib/utils/util.cart-storage";

import { ReservationCartReset } from "./reservation-cart-reset";

// The cart lives in this browser's storage, one key per store. A confirmation
// empties it only when this browser started that very checkout (its record of
// the checkout names the reservation) and the outcome is settled; the record
// is consumed, so it happens once. A visit alone, a link to another person's
// checkout, or an old confirmation opened again leaves the cart as it is. The
// page is loaded afresh: the cart reads its storage on mount, and a reset
// that runs must leave it empty all the same.

const STORE = "store";
const CART_KEY = getCartStorageKey("shop");
const PENDING_KEY = `louez:checkout:pending-reservation:${STORE}`;

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

let unmounts: Array<() => void> = [];

const renderPage = (reservationId: string, settled: boolean) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { enabled: false } } });
  const { unmount } = mount(
    <QueryClientProvider client={queryClient}>
      <StoreProvider storeId={STORE} currency="EUR" storeSlug="shop" storeName="Shop">
        <CartProvider>
          <ReservationCartReset reservationId={reservationId} settled={settled} />
        </CartProvider>
      </StoreProvider>
    </QueryClientProvider>,
  );
  unmounts.push(unmount);
  return unmount;
};

beforeEach(() => {
  // The cart's clock ticks every second: a mocked one, so nothing outlives the test.
  mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 0 });
  window.localStorage.clear();
  window.localStorage.setItem(CART_KEY, storedCart);
});

afterEach(() => {
  for (const unmount of unmounts) unmount();
  unmounts = [];
  mock.timers.reset();
});

test("the browser that started the checkout has its cart emptied once the payment is settled", async () => {
  writePendingCheckout({ storeId: STORE, reservationId: "booking", resumable: true });
  renderPage("booking", true);
  await settle();

  assert.deepEqual(storedLines(), []);
  assert.equal(window.localStorage.getItem(PENDING_KEY), null, "the record is consumed");
});

test("a browser that did not start the checkout keeps its cart", async () => {
  renderPage("booking", true);
  await settle();

  assert.equal(storedLines().length, 1);
});

test("a browser that started another checkout keeps its cart and its record", async () => {
  writePendingCheckout({ storeId: STORE, reservationId: "mine", resumable: true });
  renderPage("someone-elses", true);
  await settle();

  assert.equal(storedLines().length, 1);
  assert.notEqual(window.localStorage.getItem(PENDING_KEY), null);
});

test("a record of another store proves nothing here", async () => {
  writePendingCheckout({ storeId: "other_store", reservationId: "booking", resumable: true });
  renderPage("booking", true);
  await settle();

  assert.equal(storedLines().length, 1);
});

test("an outcome not settled yet keeps the cart and the record", async () => {
  writePendingCheckout({ storeId: STORE, reservationId: "booking", resumable: true });
  renderPage("booking", false);
  await settle();

  assert.equal(storedLines().length, 1);
  assert.notEqual(window.localStorage.getItem(PENDING_KEY), null);
});

test("the confirmation opened again later leaves the new cart alone", async () => {
  writePendingCheckout({ storeId: STORE, reservationId: "booking", resumable: true });
  renderPage("booking", true)();
  await settle();
  assert.deepEqual(storedLines(), []);

  window.localStorage.setItem(CART_KEY, storedCart);
  renderPage("booking", true);
  await settle();

  assert.equal(storedLines().length, 1);
});
