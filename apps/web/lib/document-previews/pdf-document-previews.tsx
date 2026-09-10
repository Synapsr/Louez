import { ContractDocument, type ContractTranslations } from "@/lib/pdf/contract";
import {
  InspectionReportDocument,
  defaultTranslationsEn,
  defaultTranslationsFr,
} from "@/lib/pdf/inspection-report";
import { InvoiceDocument, type InvoiceDocumentProps } from "@/lib/pdf/invoice";
import enMessages from "@/messages/en.json";
import frMessages from "@/messages/fr.json";

import {
  PDF_PREVIEW_LOCALES,
  type PdfPreviewLocale,
  previewCgvHtml,
  previewCustomer,
  previewReservation,
} from "./document-previews.fixtures";
import type {
  DocumentPreviewContext,
  DocumentPreviewStore,
  PdfDocumentPreview,
} from "./document-previews.types";

const { number, createdAt, startDate, endDate, items } = previewReservation;
const generatedAt = new Date("2026-07-28T14:25:00.000Z");

const toPdfLocale = (locale: DocumentPreviewContext["locale"]): PdfPreviewLocale =>
  locale === "en" ? "en" : "fr";

// Same source as the production generator: the `contract` subtree of the app messages.
const contractTranslations = (locale: PdfPreviewLocale): ContractTranslations =>
  (locale === "fr" ? frMessages : enMessages).contract as ContractTranslations;

const inspectionTranslations = (locale: PdfPreviewLocale) =>
  locale === "fr" ? defaultTranslationsFr : defaultTranslationsEn;

const pdf = (
  definition: Omit<PdfDocumentPreview, "kind" | "group" | "locales">,
): PdfDocumentPreview => ({
  kind: "pdf",
  group: "pdf",
  locales: PDF_PREVIEW_LOCALES,
  ...definition,
});

const contractStore = (store: DocumentPreviewStore) => ({
  name: store.name,
  slug: store.slug,
  logoUrl: store.logoUrl,
  address: store.address,
  phone: store.phone,
  email: store.email,
  siret: null,
  tvaNumber: "FR12345678901",
  primaryColor: store.primaryColor,
  billingAddress: { useSameAsStore: true },
});

const contractItems = items.map((item, index) => ({
  productSnapshot: {
    name: item.name,
    description: index === 0 ? "Paddle gonflable 12'6, pagaie et leash inclus." : null,
  },
  quantity: item.quantity,
  unitPrice: item.unitPrice.toFixed(2),
  totalPrice: item.totalPrice.toFixed(2),
  assignedUnitIdentifiers: index === 0 ? ["PAD-01", "PAD-04"] : [],
  insured: index === 0,
}));

const contractReservation = {
  number,
  startDate,
  endDate,
  createdAt,
  subtotalAmount: previewReservation.subtotal.toFixed(2),
  depositAmount: previewReservation.deposit.toFixed(2),
  totalAmount: previewReservation.total.toFixed(2),
  deliveryFee: previewReservation.deliveryFee.toFixed(2),
  subtotalExclTax: "965.00",
  taxAmount: "193.00",
  taxRate: "20.00",
  outboundMethod: "address",
  returnMethod: "pickup",
  deliveryAddress: "Plage de Kerleven",
  deliveryCity: "La Forêt-Fouesnant",
  deliveryPostalCode: "29940",
  items: contractItems,
};

const individualCustomer = {
  firstName: previewCustomer.firstName,
  lastName: previewCustomer.lastName,
  email: previewCustomer.email,
  phone: previewCustomer.phone,
  address: previewCustomer.address,
  city: previewCustomer.city,
  postalCode: previewCustomer.postalCode,
  customerType: "individual" as const,
};

const businessCustomer = {
  ...individualCustomer,
  customerType: "business" as const,
  companyName: "Centre nautique de Kerleven",
};

const inspectionStore = (store: DocumentPreviewStore) => ({
  name: store.name,
  logoUrl: store.logoUrl,
  address: store.address,
  phone: store.phone,
  email: store.email,
  primaryColor: store.primaryColor,
});

const inspectionPhotos = (label: string) => [
  {
    url: `https://placehold.co/600x400/jpg?text=${encodeURIComponent(`${label} 1`)}`,
    caption: "Vue générale",
  },
  {
    url: `https://placehold.co/600x400/jpg?text=${encodeURIComponent(`${label} 2`)}`,
    caption: null,
  },
];

const invoiceSeller = (store: DocumentPreviewStore): InvoiceDocumentProps["seller"] => ({
  legalName: `${store.name} SARL`,
  legalForm: "SARL",
  companyNumber: "123456789",
  companyNumberScheme: "fr_siren",
  siret: "12345678900012",
  vatNumber: "FR12345678901",
  rcsCity: "Quimper",
  shareCapital: "10000",
  address: {
    address: store.address.split(",")[0],
    addressComplement: null,
    postalCode: "29900",
    city: "Concarneau",
    country: "France",
  },
  email: store.email,
  phone: store.phone,
});

const invoiceBuyer: InvoiceDocumentProps["buyer"] = {
  customerType: "individual",
  firstName: previewCustomer.firstName,
  lastName: previewCustomer.lastName,
  companyName: null,
  companyNumber: null,
  companyNumberScheme: null,
  vatNumber: null,
  address: {
    address: previewCustomer.address,
    addressComplement: "Appartement 3",
    postalCode: previewCustomer.postalCode,
    city: previewCustomer.city,
    country: "France",
  },
  email: previewCustomer.email,
  phone: previewCustomer.phone,
};

const invoiceLines: InvoiceDocumentProps["lines"] = [
  {
    id: "line-1",
    description: "Paddle géant — location du 6 au 9 août 2026",
    quantity: "2",
    unitPriceExclTax: "190.83",
    totalExclTax: "381.67",
    taxRate: "20.00",
    taxAmount: "76.33",
    totalInclTax: "458.00",
  },
  {
    id: "line-2",
    description: "Combinaison enfant — location du 6 au 9 août 2026",
    quantity: "1",
    unitPriceExclTax: "583.33",
    totalExclTax: "583.33",
    taxRate: "20.00",
    taxAmount: "116.67",
    totalInclTax: "700.00",
  },
];

const invoiceBase = (
  store: DocumentPreviewStore,
  locale: PdfPreviewLocale,
): Omit<InvoiceDocumentProps, "type" | "number" | "issueDate" | "payment"> => ({
  currency: store.currency,
  locale,
  primaryColor: store.primaryColor,
  seller: invoiceSeller(store),
  buyer: invoiceBuyer,
  lines: invoiceLines,
  vatBreakdown: [
    { taxRate: "20.00", taxableAmount: "965.00", taxAmount: "193.00", exemptionReason: null },
  ],
  totals: { totalExclTax: "965.00", totalTax: "193.00", totalInclTax: "1158.00" },
  processingRule: "b2c",
});

export const PDF_DOCUMENT_PREVIEWS: readonly PdfDocumentPreview[] = [
  pdf({
    id: "contract-pending",
    title: "Contrat en attente de signature",
    description: "Contrat généré à la confirmation, avant signature, sans CGV intégrées.",
    fileName: "contrat-en-attente",
    compose: ({ store, locale: rawLocale }) => {
      const locale = toPdfLocale(rawLocale);
      return ContractDocument({
        reservation: {
          ...contractReservation,
          customer: individualCustomer,
          payments: [
            {
              id: "pay-1",
              amount: previewReservation.total.toFixed(2),
              type: "rental",
              method: "stripe",
              status: "pending",
              paidAt: null,
              createdAt,
            },
          ],
        },
        store: contractStore(store),
        document: { number: "2026-0042", generatedAt },
        locale,
        translations: contractTranslations(locale),
        currency: store.currency,
        timezone: store.timezone,
        fullCgvHtml: null,
      });
    },
  }),
  pdf({
    id: "contract-signed",
    title: "Contrat signé, client pro, CGV intégrées",
    description: "Contrat signé en ligne par une entreprise, paiements encaissés et CGV en annexe.",
    fileName: "contrat-signe",
    compose: ({ store, locale: rawLocale }) => {
      const locale = toPdfLocale(rawLocale);
      return ContractDocument({
        reservation: {
          ...contractReservation,
          customer: businessCustomer,
          signedAt: new Date("2026-07-29T09:12:00.000Z"),
          signatureIp: "82.64.12.7",
          payments: [
            {
              id: "pay-1",
              amount: previewReservation.total.toFixed(2),
              type: "rental",
              method: "stripe",
              status: "completed",
              paidAt: new Date("2026-07-29T09:13:00.000Z"),
              createdAt,
            },
            {
              id: "pay-2",
              amount: previewReservation.deposit.toFixed(2),
              type: "deposit",
              method: "card",
              status: "completed",
              paidAt: startDate,
              createdAt: startDate,
            },
          ],
        },
        store: contractStore(store),
        document: { number: "2026-0042", generatedAt },
        locale,
        translations: contractTranslations(locale),
        currency: store.currency,
        timezone: store.timezone,
        fullCgvHtml: previewCgvHtml,
      });
    },
  }),
  pdf({
    id: "inspection-departure",
    title: "État des lieux de départ",
    description: "Matériel en bon état, photos jointes, pas encore signé.",
    fileName: "etat-des-lieux-depart",
    compose: ({ store, locale: rawLocale }) => {
      const locale = toPdfLocale(rawLocale);
      return InspectionReportDocument({
        inspection: {
          id: "insp-1",
          type: "departure",
          status: "completed",
          reservationNumber: number,
          customerName: `${previewCustomer.firstName} ${previewCustomer.lastName}`,
          hasDamage: false,
          notes: "Matériel remis propre et complet.",
          performedByName: "Morgane",
          createdAt: startDate,
          signedAt: null,
          signatureIp: null,
          customerSignature: null,
          items: [
            {
              productName: "Paddle géant — PAD-01",
              condition: "excellent",
              notes: null,
              photos: inspectionPhotos("Paddle"),
            },
            {
              productName: "Paddle géant — PAD-04",
              condition: "good",
              notes: "Légère rayure sur le nose, sans incidence.",
              photos: [],
            },
            {
              productName: "Combinaison enfant",
              condition: "good",
              notes: null,
              photos: [],
            },
          ],
        },
        store: inspectionStore(store),
        document: { number: "EDL-2026-0017", generatedAt: startDate },
        locale,
        translations: inspectionTranslations(locale),
        timezone: store.timezone,
      });
    },
  }),
  pdf({
    id: "inspection-return",
    title: "État des lieux de retour avec dommage",
    description: "Retour signé par le client, un article endommagé.",
    fileName: "etat-des-lieux-retour",
    compose: ({ store, locale: rawLocale }) => {
      const locale = toPdfLocale(rawLocale);
      return InspectionReportDocument({
        inspection: {
          id: "insp-2",
          type: "return",
          status: "signed",
          reservationNumber: number,
          customerName: `${previewCustomer.firstName} ${previewCustomer.lastName}`,
          hasDamage: true,
          notes: "Retour à l'heure. Aileron cassé sur un paddle, à facturer.",
          performedByName: "Morgane",
          createdAt: endDate,
          signedAt: endDate,
          signatureIp: "82.64.12.7",
          customerSignature: null,
          items: [
            {
              productName: "Paddle géant — PAD-01",
              condition: "damaged",
              notes: "Aileron central cassé.",
              photos: inspectionPhotos("Aileron"),
            },
            {
              productName: "Paddle géant — PAD-04",
              condition: "good",
              notes: null,
              photos: [],
            },
            {
              productName: "Combinaison enfant",
              condition: "fair",
              notes: "Zip un peu dur.",
              photos: [],
            },
          ],
        },
        store: inspectionStore(store),
        document: { number: "EDL-2026-0018", generatedAt: endDate },
        locale,
        translations: inspectionTranslations(locale),
        timezone: store.timezone,
      });
    },
  }),
  pdf({
    id: "invoice",
    title: "Facture",
    description: "Facture émise après encaissement du solde.",
    fileName: "facture",
    compose: ({ store, locale: rawLocale }) =>
      InvoiceDocument({
        ...invoiceBase(store, toPdfLocale(rawLocale)),
        type: "invoice",
        number: "F-2026-0031",
        issueDate: "2026-07-29",
        payment: {
          method: "stripe",
          paidAt: new Date("2026-07-29T09:13:00.000Z"),
          amount: "1158.00",
        },
      }),
  }),
  pdf({
    id: "credit-note",
    title: "Avoir",
    description: "Avoir annulant une facture après remboursement.",
    fileName: "avoir",
    compose: ({ store, locale: rawLocale }) =>
      InvoiceDocument({
        ...invoiceBase(store, toPdfLocale(rawLocale)),
        type: "credit_note",
        number: "AV-2026-0004",
        issueDate: "2026-08-12",
        payment: {
          method: "stripe",
          paidAt: new Date("2026-08-12T10:00:00.000Z"),
          amount: "1158.00",
        },
        precedingInvoice: { number: "F-2026-0031", issueDate: "2026-07-29" },
      }),
  }),
];
