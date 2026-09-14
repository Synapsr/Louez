import assert from "node:assert/strict";
import { test } from "node:test";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import type { Transaction } from "@louez/db";
import { validateReservationContract } from "./reservation-contract-validation";

const harness = (
  reservation: { status: string; signedAt: Date | null } | null,
  hasPayment = false,
) => {
  const writes: unknown[] = [];
  const conditions: Array<{ sql: string; params: unknown[] }> = [];
  const dialect = new MySqlDialect();
  const tx = {
    select: () => ({
      from: () => ({
        where: (condition: SQL) => {
          conditions.push(dialect.sqlToQuery(condition));
          return {
            for: async () => (reservation ? [reservation] : []),
            limit: async () => (hasPayment ? [{ id: "payment" }] : []),
          };
        },
      }),
    }),
    update: () => ({
      set: (value: unknown) => ({
        where: async (condition: SQL) => {
          conditions.push(dialect.sqlToQuery(condition));
          writes.push(value);
        },
      }),
    }),
    insert: () => ({
      values: async (value: unknown) => {
        writes.push(value);
      },
    }),
  } as unknown as Transaction;
  return { tx, writes, conditions };
};

test("confirmed reservations are validated once with an explicit automatic audit record", async () => {
  const h = harness({ status: "confirmed", signedAt: null });
  const timestamp = await validateReservationContract(h.tx, "reservation", "store", "confirmation");
  assert.ok(timestamp instanceof Date);
  assert.deepEqual(h.writes[0], { signedAt: timestamp, signatureIp: null, updatedAt: timestamp });
  assert.equal(h.writes.length, 2);
  assert.match(JSON.stringify(h.writes[1]), /automatic_contract_validation/);
  for (const condition of h.conditions) assert.ok(condition.params.includes("store"));
});

test("existing signatures, missing and closed reservations are left untouched", async () => {
  for (const row of [
    null,
    { status: "confirmed", signedAt: new Date() },
    ...["cancelled", "rejected", "declined"].map((status) => ({ status, signedAt: null })),
  ]) {
    const h = harness(row, true);
    assert.equal(await validateReservationContract(h.tx, "reservation", "store", "payment"), null);
    assert.deepEqual(h.writes, []);
  }
});

test("pending reservations and quotes require a persisted successful rental payment", async () => {
  for (const status of ["pending", "quote"]) {
    for (const hasPayment of [false, true]) {
      const h = harness({ status, signedAt: null }, hasPayment);
      const result = await validateReservationContract(h.tx, "reservation", "store", "payment");
      assert.equal(result !== null, hasPayment);
      assert.ok(h.conditions[1].params.includes("rental"));
      assert.ok(h.conditions[1].params.includes("completed"));
      assert.ok(h.conditions[1].params.includes("0"));
    }
    const h = harness({ status, signedAt: null }, true);
    assert.equal(
      await validateReservationContract(h.tx, "reservation", "store", "confirmation"),
      null,
    );
    assert.deepEqual(h.writes, []);
  }
});
