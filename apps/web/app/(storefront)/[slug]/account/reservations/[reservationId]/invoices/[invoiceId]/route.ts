import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db, documents, invoices, reservations, stores } from "@louez/db";

import { buildPdfResponse } from "@/lib/invoicing/util.pdf-response";
import { storefrontRedirect } from "@/lib/storefront-url";

import { getCustomerSession } from "../../../../actions";

const invoiceRouteParamsSchema = z.object({
  slug: z.string().trim().min(1).max(255),
  reservationId: z.string().length(21),
  invoiceId: z.string().length(21),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string; reservationId: string; invoiceId: string }> },
) {
  const parsed = invoiceRouteParamsSchema.safeParse(await params);
  if (!parsed.success) return new Response("Invalid invoice route", { status: 400 });
  const { slug, reservationId, invoiceId } = parsed.data;

  const [store] = await db
    .select({ id: stores.id })
    .from(stores)
    .where(eq(stores.slug, slug))
    .limit(1);
  if (!store) return new Response("Store not found", { status: 404 });

  const session = await getCustomerSession(slug);
  if (!session) {
    storefrontRedirect(
      slug,
      `/account/login?redirect=${encodeURIComponent(
        `/account/reservations/${reservationId}/invoices/${invoiceId}`,
      )}`,
    );
  }

  const [invoice] = await db
    .select({
      fileName: documents.fileName,
      fileUrl: documents.fileUrl,
    })
    .from(invoices)
    .innerJoin(documents, eq(documents.id, invoices.documentId))
    .innerJoin(reservations, eq(reservations.id, invoices.reservationId))
    .where(
      and(
        eq(invoices.id, invoiceId),
        eq(invoices.reservationId, reservationId),
        eq(invoices.storeId, store.id),
        eq(invoices.customerId, session.customerId),
        eq(reservations.id, reservationId),
        eq(reservations.storeId, store.id),
        eq(reservations.customerId, session.customerId),
      ),
    )
    .limit(1);
  if (!invoice) return new Response("Invoice not found", { status: 404 });
  return buildPdfResponse(invoice.fileUrl, invoice.fileName);
}
