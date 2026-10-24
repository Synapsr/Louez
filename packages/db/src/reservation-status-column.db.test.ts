import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import type { Connection, RowDataPacket } from "mysql2/promise";

import {
  createTestDatabase,
  skipWithoutTestDatabase,
  type TestDatabase,
} from "./testing/test-database";

const MIGRATION = fileURLToPath(
  new URL("./migrations/0084_reservation_status_quote_declined.sql", import.meta.url),
);
const ALL_STATUSES =
  "enum('pending','confirmed','ongoing','completed','cancelled','rejected','quote','declined')";

async function statusColumn(connection: Connection) {
  const [[column]] = await connection.query<RowDataPacket[]>(
    `SELECT COLUMN_TYPE AS type, IS_NULLABLE AS nullable, COLUMN_DEFAULT AS defaultValue
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reservations'
       AND COLUMN_NAME = 'reservation_status'`,
  );
  return column as { type: string; nullable: string; defaultValue: string };
}

describe("reservation status column (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let connection: Connection;

  before(async () => {
    database = await createTestDatabase("status_column");
    connection = await database.connect();
  });

  after(async () => {
    await connection?.end();
    await database?.drop();
  });

  test("a database built from migrations has every status, NOT NULL", async () => {
    assert.deepEqual(await statusColumn(connection), {
      type: ALL_STATUSES,
      nullable: "NO",
      defaultValue: "pending",
    });
  });

  test("a column that already has the statuses but allows NULL gets NOT NULL back", async () => {
    // The production column: every status, but nullable.
    await connection.query(
      `ALTER TABLE reservations MODIFY COLUMN reservation_status ${ALL_STATUSES} NULL DEFAULT 'pending'`,
    );

    const sql = await readFile(MIGRATION, "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) {
      await connection.query(statement);
    }

    assert.deepEqual(await statusColumn(connection), {
      type: ALL_STATUSES,
      nullable: "NO",
      defaultValue: "pending",
    });
  });
});
