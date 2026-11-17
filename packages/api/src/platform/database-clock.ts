import { db, type Transaction } from "@louez/db";
import { sql } from "drizzle-orm";

/**
 * The database's clock, as every row is dated with it. On a transaction, it
 * is read on that transaction's connection, under the locks it holds. The
 * sessions run in UTC (docs/architecture/api-and-agents.md, the outbox).
 */
export async function databaseNow(executor: Transaction | typeof db = db): Promise<Date> {
  const [result] = await executor.execute(
    sql`SELECT DATE_FORMAT(NOW(3), '%Y-%m-%dT%H:%i:%s.%f') AS now`,
  );
  const row: unknown = Array.isArray(result) ? result[0] : undefined;
  const text =
    row && typeof row === "object" && "now" in row && typeof row.now === "string" ? row.now : "";
  const now = new Date(`${text.slice(0, 23)}Z`);
  return Number.isNaN(now.getTime()) ? new Date() : now;
}
