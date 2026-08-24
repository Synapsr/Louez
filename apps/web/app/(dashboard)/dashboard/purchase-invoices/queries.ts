import { count, desc, eq } from "drizzle-orm";

import { db, receivedInvoices } from "@louez/db";

import type { ReceivedInvoiceAction } from "./util.purchase-invoices";

export const PURCHASE_INVOICES_PAGE_SIZE = 20;

/** One row of the supplier-invoice inbox. */
export type ReceivedInvoiceListItem = {
  currency: string;
  id: string;
  /** `YYYY-MM-DD`, as stored by the Super PDP poller. */
  issueDate: string;
  latestStatus: string | null;
  number: string;
  ourAction: ReceivedInvoiceAction;
  sellerIdentifier: string;
  sellerName: string;
  totalInclTax: string;
};

export type ReceivedInvoicesPage = {
  invoices: ReceivedInvoiceListItem[];
  page: number;
  pageCount: number;
  totalCount: number;
};

/**
 * Read one page of the store's received supplier invoices, newest first.
 * Always scoped to `storeId` — this table is multi-tenant.
 */
export const getReceivedInvoicesPage = async ({
  page,
  storeId,
}: {
  page: number;
  storeId: string;
}): Promise<ReceivedInvoicesPage> => {
  const [totals] = await db
    .select({ value: count() })
    .from(receivedInvoices)
    .where(eq(receivedInvoices.storeId, storeId));

  const totalCount = totals?.value ?? 0;
  const pageCount = Math.max(1, Math.ceil(totalCount / PURCHASE_INVOICES_PAGE_SIZE));
  // A stale `?page=` (bookmarked, or the last row of the last page just moved)
  // must not render a blank table.
  const currentPage = Math.min(page, pageCount);

  const invoices = await db
    .select({
      currency: receivedInvoices.currency,
      id: receivedInvoices.id,
      issueDate: receivedInvoices.issueDate,
      latestStatus: receivedInvoices.latestStatus,
      number: receivedInvoices.number,
      ourAction: receivedInvoices.ourAction,
      sellerIdentifier: receivedInvoices.sellerIdentifier,
      sellerName: receivedInvoices.sellerName,
      totalInclTax: receivedInvoices.totalInclTax,
    })
    .from(receivedInvoices)
    .where(eq(receivedInvoices.storeId, storeId))
    .orderBy(desc(receivedInvoices.issueDate), desc(receivedInvoices.createdAt))
    .limit(PURCHASE_INVOICES_PAGE_SIZE)
    .offset((currentPage - 1) * PURCHASE_INVOICES_PAGE_SIZE);

  return {
    invoices,
    page: currentPage,
    pageCount,
    totalCount,
  };
};
