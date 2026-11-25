import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mock, test } from "node:test";

// tsx loads @louez/utils as CommonJS, whose `export *` names ESM cannot see.
const require = createRequire(import.meta.url);
mock.module("@louez/utils", { namedExports: require("@louez/utils") });

const { listReservationOnlineRefunds, listReservationPaymentDisputes } =
  await import("./reservation-refunds");

// The reservation's refund operations and disputes are reached through its own payments
// taken online, by each table's index on the payment: a reservation paid only by hand costs
// no query.

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

test("a reservation with no payment taken online reads no dispute", async () => {
  const executor = {
    select: () => {
      throw new Error("no query expected");
    },
  } as unknown as Parameters<typeof listReservationPaymentDisputes>[0];
  assert.deepEqual(
    await listReservationPaymentDisputes(executor, "res_1", [{ id: "pay_cash", method: "cash" }]),
    [],
  );
});
