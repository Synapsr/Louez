import { validateReservationContract } from "@louez/api/services";
import {
  getCustomerFieldValues,
  listCustomerFieldDefinitions,
} from "@louez/api/services/customer-fields";
import { listReservationItemDetails } from "@louez/api/services/customer-fields-online";
import { renderToBuffer } from "@react-pdf/renderer";
import { ContractDocument, SupportedLocale } from "./contract";
import { db } from "@louez/db";
import { documents, reservationContractSignatures, reservations, stores } from "@louez/db";
import { eq, and, sql, desc } from "drizzle-orm";
import { nanoid } from "nanoid";
import { convertImageForPdf } from "./image-utils";
import { getContractCustomerFieldLines } from "./util.contract-customer-fields";
import { getContractItemDetailLines } from "./util.contract-item-details";
import { getReservationInsuredProductIds } from "@/lib/reservations/get-insured-product-ids";
import { reservationCurrency } from "@/lib/reservations/payment-billing-facts";
import { getLogoForLightBackground, resolveReservationBilling } from "@louez/utils";

import { getContractTranslations } from "./contract-i18n";
import { isLocale } from "@/lib/i18n/format-locale";
import { formatStoreDate } from "@/lib/utils/store-date";

interface GenerateContractOptions {
  reservationId: string;
  regenerate?: boolean;
  locale?: SupportedLocale;
}

function toNonEmptyString(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  return value.trim().length > 0 ? value : null;
}

export async function generateContract({
  reservationId,
  regenerate = false,
  locale: requestedLocale,
}: GenerateContractOptions) {
  // The stored contract is dated from this read, not from the end of the render: a signature
  // recorded while it renders is newer, so the next download renders it again.
  const readAt = new Date();

  // Get reservation with all relations including payments and assigned units
  const reservation = await db.query.reservations.findFirst({
    where: eq(reservations.id, reservationId),
    with: {
      items: {
        with: {
          assignedUnits: true,
        },
      },
      customer: true,
      payments: true,
    },
  });

  if (!reservation) {
    throw new Error("Reservation not found");
  }

  const locale =
    requestedLocale ??
    (reservation.locale && isLocale(reservation.locale) ? reservation.locale : "fr");

  const automaticallyValidatedAt = !reservation.contractValidatedAt
    ? await db.transaction((tx) =>
        validateReservationContract(
          tx,
          reservation.id,
          reservation.storeId,
          reservation.payments.some(
            (payment) =>
              payment.type === "rental" &&
              payment.status === "completed" &&
              Number(payment.amount) > 0,
          )
            ? "payment"
            : "confirmation",
        ),
      )
    : null;
  if (automaticallyValidatedAt) {
    reservation.contractValidatedAt = automaticallyValidatedAt;
  } else if (!reservation.contractValidatedAt) {
    // Another request may have validated it in the meantime.
    const current = await db.query.reservations.findFirst({
      where: and(
        eq(reservations.id, reservation.id),
        eq(reservations.storeId, reservation.storeId),
      ),
      columns: { contractValidatedAt: true },
    });
    if (current) {
      reservation.contractValidatedAt = current.contractValidatedAt;
    }
  }

  const drawnSignature =
    reservation.signatureMethod === "in_store"
      ? ((await db.query.reservationContractSignatures.findFirst({
          where: eq(reservationContractSignatures.reservationId, reservation.id),
          columns: { signerName: true, image: true },
        })) ?? null)
      : null;

  // Get store
  const store = await db.query.stores.findFirst({
    where: eq(stores.id, reservation.storeId),
  });

  if (!store) {
    throw new Error("Store not found");
  }

  // Check if contract already exists
  const existingContract = await db.query.documents.findFirst({
    where: and(eq(documents.reservationId, reservationId), eq(documents.type, "contract")),
  });

  if (
    existingContract &&
    !regenerate &&
    !automaticallyValidatedAt &&
    (!reservation.signedAt || existingContract.generatedAt >= reservation.signedAt)
  ) {
    return existingContract;
  }

  // Generate document number
  const documentNumber = await generateDocumentNumber(store.id);

  // Use reservation creation date as document date (for consistency across regenerations)
  const documentData = {
    number: documentNumber,
    generatedAt: reservation.createdAt,
  };

  // Get translations for the locale
  const translations = getContractTranslations(locale);

  // Convert store logo to PDF-compatible format (handles SVG conversion)
  // Use dark logo for PDFs (light background) when store has dark theme
  const pdfLogoUrl = await convertImageForPdf(getLogoForLightBackground(store));

  const shouldIncludeFullCgv = store.includeCgvInContract;
  const isFinalContract = Boolean(reservation.signedAt || reservation.contractValidatedAt);
  const storeCgvRaw = store.cgv ?? "";
  const storeCgv = toNonEmptyString(storeCgvRaw);
  const hasExistingCgvSnapshot =
    existingContract?.cgvSnapshot !== null && existingContract?.cgvSnapshot !== undefined;
  const existingCgvSnapshotRaw = hasExistingCgvSnapshot
    ? (existingContract?.cgvSnapshot ?? "")
    : "";

  let fullCgvHtml: string | null = null;
  let cgvSnapshotToPersist: string | undefined = undefined;

  // Validated or signed contracts keep their snapshot whatever the current store setting.
  if (isFinalContract && (shouldIncludeFullCgv || hasExistingCgvSnapshot)) {
    const resolvedSnapshotRaw = hasExistingCgvSnapshot ? existingCgvSnapshotRaw : storeCgvRaw;
    fullCgvHtml = toNonEmptyString(resolvedSnapshotRaw);

    // Older final contracts get their snapshot on their first regeneration.
    if (!hasExistingCgvSnapshot) {
      cgvSnapshotToPersist = resolvedSnapshotRaw;
    }
  } else if (shouldIncludeFullCgv) {
    fullCgvHtml = storeCgv;
  }

  const insuredProductIds = await getReservationInsuredProductIds(reservation);

  // Read at generation time: the stored PDF keeps these values even if the
  // customer record, the rented units' details or the field definitions
  // change afterwards.
  const [customerFieldDefinitions, customerFieldValues, itemDetails] = await Promise.all([
    listCustomerFieldDefinitions(reservation.storeId, { activeOnly: true, scope: "customer" }),
    getCustomerFieldValues(reservation.storeId, reservation.customer.id),
    listReservationItemDetails({
      storeId: reservation.storeId,
      reservationId: reservation.id,
      audience: "team",
    }),
  ]);
  // A calendar day has no timezone: noon UTC never slips to the day before.
  const formatFieldDate = (isoDate: string) =>
    formatStoreDate(new Date(`${isoDate}T12:00:00Z`), "UTC", "MEDIUM_DATE", locale);
  // Stored as "80.5": the contract reads "80,5" in French.
  const numberFormat = new Intl.NumberFormat(locale);
  const formatFieldNumber = (value: number) => numberFormat.format(value);
  const customFieldLines = getContractCustomerFieldLines(
    customerFieldDefinitions,
    customerFieldValues,
    {
      customerType: reservation.customer.customerType,
      formatDate: formatFieldDate,
      formatNumber: formatFieldNumber,
    },
  );
  const itemDetailLines = getContractItemDetailLines(itemDetails, {
    formatDate: formatFieldDate,
    formatNumber: formatFieldNumber,
  });

  // Generate PDF buffer
  const pdfBuffer = await renderToBuffer(
    ContractDocument({
      reservation: {
        number: reservation.number,
        startDate: reservation.startDate,
        endDate: reservation.endDate,
        subtotalAmount: reservation.subtotalAmount,
        depositAmount: reservation.depositAmount,
        totalAmount: reservation.totalAmount,
        deliveryFee: reservation.deliveryFee,
        subtotalExclTax: reservation.subtotalExclTax,
        taxAmount: reservation.taxAmount,
        taxRate: reservation.taxRate,
        signedAt: reservation.signedAt,
        contractValidatedAt: reservation.contractValidatedAt,
        signatureMethod: reservation.signatureMethod,
        signatureIp: reservation.signatureIp,
        drawnSignature,
        createdAt: reservation.createdAt,
        customer: {
          ...reservation.customer,
          ...resolveReservationBilling(reservation, reservation.customer),
          customFieldLines,
        },
        outboundMethod: reservation.outboundMethod,
        returnMethod: reservation.returnMethod,
        deliveryAddress: reservation.deliveryAddress,
        deliveryCity: reservation.deliveryCity,
        deliveryPostalCode: reservation.deliveryPostalCode,
        returnAddress: reservation.returnAddress,
        returnCity: reservation.returnCity,
        returnPostalCode: reservation.returnPostalCode,
        pickupLocationSnapshot: reservation.pickupLocationSnapshot,
        returnLocationSnapshot: reservation.returnLocationSnapshot,
        items: reservation.items.map((item) => ({
          productSnapshot: item.productSnapshot as { name: string; description?: string | null },
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          totalPrice: item.totalPrice,
          assignedUnitIdentifiers:
            item.assignedUnits?.map((au) => au.identifierSnapshot).filter(Boolean) || [],
          insured: item.productId !== null && insuredProductIds.has(item.productId),
          detailLines: itemDetailLines.get(item.id) ?? [],
        })),
        payments: reservation.payments.map((payment) => ({
          id: payment.id,
          amount: payment.amount,
          type: payment.type as "rental" | "deposit" | "deposit_return" | "damage",
          method: payment.method as "stripe" | "cash" | "card" | "transfer" | "check" | "other",
          status: payment.status as "pending" | "completed" | "failed" | "refunded",
          paidAt: payment.paidAt,
          createdAt: payment.createdAt,
        })),
      },
      store: {
        name: store.name,
        slug: store.slug,
        logoUrl: pdfLogoUrl,
        address: store.address,
        phone: store.phone,
        email: store.email,
        siret: null, // SIRET can be added to store settings in future
        tvaNumber: store.settings?.tax?.taxNumber || null,
        primaryColor: store.theme?.primaryColor || "#0066FF",
        billingAddress: store.settings?.billingAddress || null,
      },
      document: documentData,
      locale,
      translations,
      currency: reservationCurrency(reservation.currency, store.settings),
      timezone: store.settings?.timezone || undefined,
      fullCgvHtml,
    }),
  );

  // For now, store in database as base64 (in production, upload to R2/S3)
  const base64Content = pdfBuffer.toString("base64");
  const fileName =
    locale === "fr" ? `contrat-${reservation.number}.pdf` : `contract-${reservation.number}.pdf`;

  // A reservation has one contract: a stale or regenerated one is updated in place.
  if (existingContract) {
    const updateData: {
      fileUrl: string;
      fileName: string;
      generatedAt: Date;
      cgvSnapshot?: string | null;
    } = {
      fileUrl: `data:application/pdf;base64,${base64Content}`,
      fileName,
      generatedAt: readAt,
    };

    if (cgvSnapshotToPersist !== undefined) {
      updateData.cgvSnapshot = cgvSnapshotToPersist;
    }

    await db.update(documents).set(updateData).where(eq(documents.id, existingContract.id));

    return await db.query.documents.findFirst({
      where: eq(documents.id, existingContract.id),
    });
  }

  // Create new document record
  const documentId = nanoid();
  await db.insert(documents).values({
    id: documentId,
    reservationId: reservation.id,
    type: "contract",
    number: documentNumber,
    fileName,
    fileUrl: `data:application/pdf;base64,${base64Content}`,
    cgvSnapshot: isFinalContract && shouldIncludeFullCgv ? storeCgvRaw : null,
    generatedAt: readAt,
  });

  return await db.query.documents.findFirst({
    where: eq(documents.id, documentId),
  });
}

async function generateDocumentNumber(storeId: string): Promise<string> {
  const year = new Date().getFullYear();

  // Get all documents for reservations belonging to this store
  const storeReservations = await db.query.reservations.findMany({
    where: eq(reservations.storeId, storeId),
    columns: { id: true },
  });

  const reservationIds = storeReservations.map((r) => r.id);

  if (reservationIds.length === 0) {
    return `${year}-0001`;
  }

  // Get last document for these reservations this year
  const lastDoc = await db.query.documents.findFirst({
    where: and(
      sql`${documents.reservationId} IN (${sql.join(
        reservationIds.map((id) => sql`${id}`),
        sql`, `,
      )})`,
      sql`YEAR(${documents.createdAt}) = ${year}`,
    ),
    orderBy: [desc(documents.createdAt)],
  });

  let sequence = 1;
  if (lastDoc && lastDoc.number) {
    const parts = lastDoc.number.split("-");
    if (parts.length === 2) {
      sequence = parseInt(parts[1], 10) + 1;
    }
  }

  return `${year}-${sequence.toString().padStart(4, "0")}`;
}

export async function getContractPdfBuffer(reservationId: string): Promise<Buffer | null> {
  const contract = await db.query.documents.findFirst({
    where: and(eq(documents.reservationId, reservationId), eq(documents.type, "contract")),
  });

  if (!contract || !contract.fileUrl) {
    return null;
  }

  // If it's a base64 data URL
  if (contract.fileUrl.startsWith("data:application/pdf;base64,")) {
    const base64 = contract.fileUrl.replace("data:application/pdf;base64,", "");
    return Buffer.from(base64, "base64");
  }

  // In production, fetch from R2/S3
  // For now, return null for URLs
  return null;
}
