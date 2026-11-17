import assert from "node:assert/strict";
import { test } from "node:test";

import {
  reservationChannelAnalyticsProperties,
  salesChannelFromCookie,
} from "@/lib/util.sales-channel";

test("only the marketplace value of the channel cookie is a sales channel", () => {
  assert.equal(salesChannelFromCookie("marketplace"), "marketplace");
  for (const value of [undefined, "", "direct", "Marketplace", "reeent"]) {
    assert.equal(salesChannelFromCookie(value), null, String(value));
  }
});

test("a booking from reeent names the marketplace, whatever its source", () => {
  assert.deepEqual(
    reservationChannelAnalyticsProperties({ source: "online", salesChannel: "marketplace" }),
    { reservation_source: "online", sales_channel: "marketplace", marketplace: "reeent" },
  );
  assert.deepEqual(
    reservationChannelAnalyticsProperties({ source: "marketplace", salesChannel: "marketplace" }),
    { reservation_source: "marketplace", sales_channel: "marketplace", marketplace: "reeent" },
  );
});

test("a booking with no channel names no marketplace", () => {
  assert.deepEqual(
    reservationChannelAnalyticsProperties({ source: "online", salesChannel: null }),
    {
      reservation_source: "online",
      sales_channel: null,
    },
  );
  // A row older than the column.
  assert.deepEqual(reservationChannelAnalyticsProperties({ source: null, salesChannel: null }), {
    reservation_source: null,
    sales_channel: null,
  });
});
