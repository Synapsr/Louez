import type { EmailLocale } from "@/lib/email/i18n";

import type { DocumentPreviewStore } from "./document-previews.types";

export const DOCUMENT_PREVIEW_STORES: readonly DocumentPreviewStore[] = [
  {
    id: "with-logo",
    label: "Avec logo",
    name: "Ar Mor Location",
    slug: "ar-mor-location",
    logoUrl: "https://placehold.co/160x40/png?text=Ar+Mor",
    primaryColor: "#0e7490",
    email: "contact@armor.example",
    phone: "+33 2 98 00 00 00",
    address: "2 quai du Port, 29900 Concarneau",
    timezone: "Europe/Paris",
    country: "FR",
    currency: "EUR",
  },
  {
    // No logo, so the wordmark fallback kicks in, with a deliberately loud
    // primary color: if a document looks right under both stores it looks right.
    id: "wordmark-loud",
    label: "Wordmark, couleur vive",
    name: "Vélo Ribine",
    slug: "velo-ribine",
    logoUrl: null,
    primaryColor: "#16a34a",
    email: "salut@veloribine.example",
    phone: "+33 6 12 34 56 78",
    address: "14 rue de Siam, 29200 Brest",
    timezone: "Europe/Paris",
    country: "FR",
    currency: "EUR",
  },
];

export const DEFAULT_DOCUMENT_PREVIEW_STORE_ID = DOCUMENT_PREVIEW_STORES[0].id;

export const EMAIL_PREVIEW_LOCALES: readonly EmailLocale[] = [
  "fr",
  "en",
  "de",
  "es",
  "it",
  "nl",
  "pl",
  "pt",
];

export const PDF_PREVIEW_LOCALES = ["fr", "en"] as const satisfies readonly EmailLocale[];
export type PdfPreviewLocale = (typeof PDF_PREVIEW_LOCALES)[number];

export const DOCUMENT_PREVIEW_LOCALE_LABELS: Record<EmailLocale, string> = {
  fr: "Français",
  en: "English",
  de: "Deutsch",
  es: "Español",
  it: "Italiano",
  nl: "Nederlands",
  pl: "Polski",
  pt: "Português",
};

export const PREVIEW_LINK_URL = "https://example.com/preview-link";

export const previewCustomer = {
  firstName: "Tanguy",
  lastName: "Le Goff",
  email: "tanguy.legoff@example.com",
  phone: "+33 6 98 76 54 32",
  address: "5 rue des Goélands",
  city: "Quimper",
  postalCode: "29000",
};

export const previewReservation = {
  number: "2026-0365",
  createdAt: new Date("2026-07-28T14:20:00.000Z"),
  startDate: new Date("2026-08-06T07:00:00.000Z"),
  endDate: new Date("2026-08-09T16:00:00.000Z"),
  previousStartDate: new Date("2026-08-05T07:00:00.000Z"),
  previousEndDate: new Date("2026-08-08T16:00:00.000Z"),
  items: [
    { name: "Paddle géant", quantity: 2, unitPrice: 229, totalPrice: 458 },
    { name: "Combinaison enfant", quantity: 1, unitPrice: 700, totalPrice: 700 },
  ],
  subtotal: 1158,
  deposit: 100,
  deliveryFee: 25,
  total: 1258,
};

/** Rich-text CGV as a store would paste them, to exercise the contract's HTML parser. */
export const previewCgvHtml = `
<h2>Article 1 — Objet</h2>
<p>Les présentes conditions générales régissent la location de matériel nautique proposée par le loueur au client.</p>
<h2>Article 2 — Caution</h2>
<p>Une caution est demandée à la remise du matériel. Elle est restituée au retour, déduction faite des éventuels dommages constatés.</p>
<ul>
  <li>Le matériel est vérifié en présence du client au départ et au retour.</li>
  <li>Toute casse ou perte est facturée au prix de remplacement.</li>
</ul>
<h2>Article 3 — Annulation</h2>
<p>Toute annulation intervenant moins de 48 heures avant le début de la location reste due dans son intégralité, <strong>sauf conditions météo</strong> rendant la pratique dangereuse.</p>
`;
