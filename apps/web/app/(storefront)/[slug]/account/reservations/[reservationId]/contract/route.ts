import { NextResponse } from "next/server";

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db, documents, reservations } from "@louez/db";

import { getCustomerSession } from "@/lib/customer-auth/session";
import { buildLoginPath } from "@/lib/customer-auth/util.account-redirect";
import { log } from "@/lib/evlog";
import type { SupportedLocale } from "@/lib/pdf/contract";
import { generateContract, getContractPdfBuffer } from "@/lib/pdf/generate";
import { getReservationActions } from "@/lib/reservations/util.reservation-actions";
import { getStoreBySlug } from "@/lib/storefront/get-store-by-slug";
import { getStorefrontUrl } from "@/lib/storefront-url";

const routeParamsSchema = z.object({
  slug: z.string().trim().min(1).max(255),
  reservationId: z.string().length(21),
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
 * The stored contract is served as is when nothing changed since it was
 * generated (no edit, no signature after it) and no language was forced;
 * otherwise it is regenerated in the requested language.
 */
const isStoredContractCurrent = (
  contract: { generatedAt: Date } | undefined,
  reservation: { updatedAt: Date; signedAt: Date | null },
  forcedLocale: boolean,
): contract is { generatedAt: Date } =>
  contract !== undefined &&
  reservation.signedAt !== null &&
  !forcedLocale &&
  contract.generatedAt >= reservation.updatedAt &&
  (reservation.signedAt === null || contract.generatedAt >= reservation.signedAt);

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string; reservationId: string }> },
) {
  const parsed = routeParamsSchema.safeParse(await params);
  if (!parsed.success) return new NextResponse("Invalid contract route", { status: 400 });
  const { slug, reservationId } = parsed.data;

  const store = await getStoreBySlug(slug);
  if (!store) return new NextResponse("Store not found", { status: 404 });

  const contractPath = `/account/reservations/${reservationId}/contract`;
  const session = await getCustomerSession(store.id);
  if (!session) {
    return NextResponse.redirect(
      getStorefrontUrl(slug, buildLoginPath({ redirect: contractPath })),
    );
  }

  const reservation = await db.query.reservations.findFirst({
    columns: { id: true, status: true, updatedAt: true, signedAt: true },
    where: and(
      eq(reservations.id, reservationId),
      eq(reservations.storeId, store.id),
      eq(reservations.customerId, session.customerId),
    ),
  });
  if (!reservation) return new NextResponse("Reservation not found", { status: 404 });

  const { canDownloadContract } = getReservationActions({
    status: reservation.status,
    isRentalPaid: false,
    isSigned: reservation.signedAt !== null,
    stripeAccountId: null,
    stripeChargesEnabled: false,
  });
  if (!canDownloadContract) {
    return new NextResponse("Contract not available for this status", { status: 400 });
  }

  const langParam = new URL(request.url).searchParams.get("lang");
  const forcedLocale = langParam !== null && isSupportedLocale(langParam);
  const locale: SupportedLocale = forcedLocale
    ? langParam
    : getPreferredLocale(request.headers.get("Accept-Language"));

  const stored = await db.query.documents.findFirst({
    columns: { id: true, fileName: true, generatedAt: true },
    where: and(eq(documents.reservationId, reservationId), eq(documents.type, "contract")),
  });

  let fileName = stored?.fileName ?? "contrat.pdf";
  if (!isStoredContractCurrent(stored, reservation, forcedLocale)) {
    try {
      const contract = await generateContract({ reservationId, regenerate: true, locale });
      if (!contract) return new NextResponse("Failed to generate contract", { status: 500 });
      fileName = contract.fileName;
    } catch (error) {
      log.error(
        "reservation",
        `contract generation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return new NextResponse("Failed to generate contract", { status: 500 });
    }
  }

  const pdfBuffer = await getContractPdfBuffer(reservationId);
  if (!pdfBuffer) return new NextResponse("Contract file not found", { status: 404 });

  return new NextResponse(new Uint8Array(pdfBuffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Content-Language": locale,
    },
  });
}
