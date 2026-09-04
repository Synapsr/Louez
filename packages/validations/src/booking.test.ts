import assert from "node:assert/strict";
import { test } from "node:test";

import {
  bookingAvailabilityInputSchema,
  bookingCalendarInputSchema,
  bookingHoldInputSchema,
} from "./booking";

const storeId = "store0000000000000000";
const productId = "product00000000000000";

test("accepts the strict booking availability request contract", () => {
  assert.equal(
    bookingAvailabilityInputSchema.safeParse({
      storeId,
      items: [{ productId, quantity: 1, attributes: { size: "M" } }],
      windows: [
        {
          startAt: "2026-08-31T09:00:00+02:00",
          endAt: "2026-08-31T18:00:00+02:00",
        },
      ],
    }).success,
    true,
  );
  assert.equal(
    bookingAvailabilityInputSchema.safeParse({
      storeId,
      items: [{ productId, quantity: 1 }],
      windows: [
        {
          startAt: "2026-08-31T09:00:00+02:00",
          endAt: "2026-08-31T18:00:00+02:00",
        },
      ],
      unexpected: true,
    }).success,
    false,
  );
});

test("enforces calendar ordering and the 93-day range limit", () => {
  const base = { storeId, productId, from: "2026-01-01" };
  assert.equal(bookingCalendarInputSchema.safeParse({ ...base, to: "2026-04-04" }).success, true);
  assert.equal(bookingCalendarInputSchema.safeParse({ ...base, to: "2026-04-05" }).success, false);
  assert.equal(
    bookingCalendarInputSchema.safeParse({ ...base, from: "2026-01-02", to: "2026-01-01" }).success,
    false,
  );
});

test("accepts professional customer identity and requires its legal name", () => {
  const base = {
    quoteToken: "signed-quote",
    bookingAttemptId: "9a6af935-2b97-41b3-a494-28560260e1b4",
    customer: {
      email: "customer@example.com",
      firstName: "Customer",
      lastName: "Example",
      customerType: "business",
      companyName: "Lumy",
      companyNumber: "123456789",
      vatNumber: "FR12123456789",
    },
  };

  assert.equal(bookingHoldInputSchema.safeParse(base).success, true);
  assert.equal(
    bookingHoldInputSchema.safeParse({
      ...base,
      customer: { ...base.customer, companyName: undefined },
    }).success,
    false,
  );
});
