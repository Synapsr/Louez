import { invoiceSequences } from "@louez/db";
import { and, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import type { db } from "@louez/db";

import { formatInvoiceNumber, type InvoiceSeries } from "./core";

export type InvoiceTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function claimInvoiceNumber(
  tx: InvoiceTransaction,
  storeId: string,
  series: InvoiceSeries,
  year: number,
): Promise<string> {
  await tx
    .insert(invoiceSequences)
    .values({
      id: nanoid(),
      storeId,
      series,
      year,
      nextNumber: 2,
    })
    .onDuplicateKeyUpdate({
      set: {
        nextNumber: sql`${invoiceSequences.nextNumber} + 1`,
        updatedAt: new Date(),
      },
    });

  const [sequence] = await tx
    .select({ nextNumber: invoiceSequences.nextNumber })
    .from(invoiceSequences)
    .where(
      and(
        eq(invoiceSequences.storeId, storeId),
        eq(invoiceSequences.series, series),
        eq(invoiceSequences.year, year),
      ),
    )
    .limit(1);

  if (!sequence) {
    throw new Error("Invoice sequence could not be read after atomic claim");
  }

  return formatInvoiceNumber(series, year, sequence.nextNumber - 1);
}
