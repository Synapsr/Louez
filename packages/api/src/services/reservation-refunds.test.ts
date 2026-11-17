import assert from "node:assert/strict";
import { test } from "node:test";

import { listReservationOnlineRefunds } from "./reservation-refunds";

// The reservation's refund operations are reached through its own payments taken online,
// by the table's index on the payment: a reservation paid only by hand costs no query.

test("a reservation with no payment taken online reads no operation", async () => {
  let queries = 0;
  const executor = {
    select: () => {
      queries += 1;
      throw new Error("no query expected");
    },
  } as unknown as Parameters<typeof listReservationOnlineRefunds>[0];

  assert.deepEqual(
    await listReservationOnlineRefunds(executor, "store_1", "res_1", [
      { id: "pay_cash", method: "cash" },
      { id: "pay_transfer", method: "transfer" },
    ]),
    [],
  );
  assert.deepEqual(await listReservationOnlineRefunds(executor, "store_1", "res_1", []), []);
  assert.equal(queries, 0);
});
