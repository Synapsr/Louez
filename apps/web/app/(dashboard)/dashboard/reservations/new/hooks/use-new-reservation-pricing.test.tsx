import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { Product } from "../types";
import { useNewReservationPricing } from "./use-new-reservation-pricing";

// The creation form decides whether a promotion is in force at the instant
// the server gave the page (`pricedAt`), never at the browser's clock: a
// store computer whose date is wrong would otherwise show a price the server
// refuses for ever.

const START = new Date("2031-06-10T09:00:00.000Z");
const END = new Date("2031-06-12T09:00:00.000Z");
/** 20 November 2030, in Paris: the promotion's last day. */
const PRICED_AT = new Date("2030-11-20T10:00:00.000Z");

const paddle: Product = {
  id: "paddle",
  name: "Paddle",
  price: "5.35",
  deposit: "0.00",
  quantity: 10,
  stockKind: "returnable",
  pricingKind: "duration",
  pricingMode: "day",
  images: [],
  trackUnits: false,
  bookingAttributeAxes: null,
  units: [],
  pricingTiers: [],
  seasonalPricings: [],
  promotion: { percentage: 50, startsOn: null, endsOn: "2030-11-20" },
};

const Subtotal = ({ pricedAt }: { pricedAt: Date }) => {
  const { subtotal } = useNewReservationPricing({
    startDate: START,
    endDate: END,
    pricedAt,
    selectedProducts: [{ lineId: "0", productId: paddle.id, quantity: 2 }],
    customItems: [],
    products: [paddle],
  });
  return <>{subtotal.toFixed(2)}</>;
};

/** What the form shows while the browser's clock reads `browserClock`. */
function shownWhileTheBrowserReads(browserClock: Date, pricedAt: Date) {
  mock.timers.enable({ apis: ["Date"], now: browserClock });
  try {
    return renderToStaticMarkup(<Subtotal pricedAt={pricedAt} />);
  } finally {
    mock.timers.reset();
  }
}

test("a browser clock a year late shows the promotion the server's instant has in force", () => {
  assert.equal(shownWhileTheBrowserReads(new Date("2031-11-20T10:00:00.000Z"), PRICED_AT), "10.70");
});

test("a browser clock a year early shows no promotion the server's instant has ended", () => {
  const afterTheEnd = new Date("2030-11-21T10:00:00.000Z");
  assert.equal(shownWhileTheBrowserReads(PRICED_AT, afterTheEnd), "21.40");
});
