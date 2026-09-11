import { NextResponse } from "next/server";

import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { db, inspections, reservations } from "@louez/db";

import { getCustomerSession } from "@/lib/customer-auth/session";
import { buildLoginPath } from "@/lib/customer-auth/util.account-redirect";
import { log } from "@/lib/evlog";
import { getInspectionReportPdfBuffer } from "@/lib/pdf/generate-inspection";
import type { SupportedLocale } from "@/lib/pdf/inspection-report";
import { getStoreBySlug } from "@/lib/storefront/get-store-by-slug";
import { getStorefrontUrl } from "@/lib/storefront-url";

const routeParamsSchema = z.object({
  slug: z.string().trim().min(1).max(255),
  reservationId: z.string().length(21),
  inspectionId: z.string().length(21),
});

const SUPPORTED_LOCALES = ["fr", "en"] as const satisfies readonly SupportedLocale[];

const isSupportedLocale = (value: string): value is SupportedLocale =>
  SUPPORTED_LOCALES.some((locale) => locale === value);

/** First supported language of an `Accept-Language` header, French otherwise. */
const getPreferredLocale = (acceptLanguage: string | null): SupportedLocale => {
  if (!acceptLanguage) return "fr";

  const codes = acceptLanguage
    .split(",")
    .map((entry) => {
      const [code = "", quality = "q=1"] = entry.trim().split(";");
      const q = Number.parseFloat(quality.replace("q=", "")) || 1;
      return { code: code.toLowerCase().split("-")[0] ?? "", q };
    })
    .sort((a, b) => b.q - a.q)
    .map((entry) => entry.code);

  return codes.find(isSupportedLocale) ?? "fr";
};

/**
 * The condition report (état des lieux) of the customer's own reservation,
 * rendered on demand with its photos. Drafts stay with the store.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string; reservationId: string; inspectionId: string }> },
) {
  const parsed = routeParamsSchema.safeParse(await params);
  if (!parsed.success) return new NextResponse("Invalid inspection route", { status: 400 });
  const { slug, reservationId, inspectionId } = parsed.data;

  const store = await getStoreBySlug(slug);
  if (!store) return new NextResponse("Store not found", { status: 404 });

  const reportPath = `/account/reservations/${reservationId}/inspections/${inspectionId}`;
  const session = await getCustomerSession(store.id);
  if (!session) {
    return NextResponse.redirect(getStorefrontUrl(slug, buildLoginPath({ redirect: reportPath })));
  }

  const reservation = await db.query.reservations.findFirst({
    columns: { id: true },
    where: and(
      eq(reservations.id, reservationId),
      eq(reservations.storeId, store.id),
      eq(reservations.customerId, session.customerId),
    ),
  });
  if (!reservation) return new NextResponse("Reservation not found", { status: 404 });

  const inspection = await db.query.inspections.findFirst({
    columns: { id: true },
    where: and(
      eq(inspections.id, inspectionId),
      eq(inspections.reservationId, reservation.id),
      eq(inspections.storeId, store.id),
      inArray(inspections.status, ["completed", "signed"]),
    ),
  });
  if (!inspection) return new NextResponse("Inspection not found", { status: 404 });

  const langParam = new URL(request.url).searchParams.get("lang");
  const locale: SupportedLocale =
    langParam !== null && isSupportedLocale(langParam)
      ? langParam
      : getPreferredLocale(request.headers.get("Accept-Language"));

  const result = await getInspectionReportPdfBuffer(inspection.id, locale);
  if (!result) {
    log.error("reservation", `inspection report generation failed for ${inspection.id}`);
    return new NextResponse("Failed to generate inspection report", { status: 500 });
  }

  return new NextResponse(new Uint8Array(result.buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${result.fileName}"`,
      "Content-Language": locale,
    },
  });
}
