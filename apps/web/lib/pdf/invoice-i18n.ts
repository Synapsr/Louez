export type InvoicePdfLocale = "fr" | "en";

export interface InvoicePdfTranslations {
  documentType: { invoice: string; creditNote: string };
  labels: {
    number: string;
    date: string;
    seller: string;
    buyer: string;
    contact: string;
    companyNumber: string;
    siret: string;
    vatNumber: string;
    rcs: string;
    shareCapital: string;
    precedingInvoice: string;
    payment: string;
    paymentDate: string;
    paymentMethod: string;
  };
  table: {
    description: string;
    quantity: string;
    unitPriceExclTax: string;
    vatRate: string;
    totalExclTax: string;
  };
  vat: {
    title: string;
    rate: string;
    taxableAmount: string;
    taxAmount: string;
  };
  totals: { exclTax: string; tax: string; inclTax: string };
  methods: Record<string, string>;
}

const translations: Record<InvoicePdfLocale, InvoicePdfTranslations> = {
  fr: {
    documentType: { invoice: "Facture", creditNote: "Avoir" },
    labels: {
      number: "N°",
      date: "Date",
      seller: "Vendeur",
      buyer: "Client",
      contact: "Contact",
      companyNumber: "SIREN / BCE",
      siret: "SIRET",
      vatNumber: "N° TVA",
      rcs: "RCS",
      shareCapital: "Capital social",
      precedingInvoice: "Avoir relatif à la facture",
      payment: "Paiement",
      paymentDate: "Date d'encaissement",
      paymentMethod: "Mode de paiement",
    },
    table: {
      description: "Désignation",
      quantity: "Qté",
      unitPriceExclTax: "PU HT",
      vatRate: "TVA",
      totalExclTax: "Total HT",
    },
    vat: {
      title: "Détail de TVA",
      rate: "Taux",
      taxableAmount: "Base HT",
      taxAmount: "TVA",
    },
    totals: { exclTax: "Total HT", tax: "Total TVA", inclTax: "Total TTC" },
    methods: {
      stripe: "Carte en ligne",
      cash: "Espèces",
      card: "Carte",
      transfer: "Virement",
      check: "Chèque",
      other: "Autre",
    },
  },
  en: {
    documentType: { invoice: "Invoice", creditNote: "Credit note" },
    labels: {
      number: "No.",
      date: "Date",
      seller: "Seller",
      buyer: "Customer",
      contact: "Contact",
      companyNumber: "Company number",
      siret: "SIRET",
      vatNumber: "VAT number",
      rcs: "Trade register",
      shareCapital: "Share capital",
      precedingInvoice: "Credit note for invoice",
      payment: "Payment",
      paymentDate: "Payment date",
      paymentMethod: "Payment method",
    },
    table: {
      description: "Description",
      quantity: "Qty",
      unitPriceExclTax: "Unit price excl. tax",
      vatRate: "VAT",
      totalExclTax: "Total excl. tax",
    },
    vat: {
      title: "VAT breakdown",
      rate: "Rate",
      taxableAmount: "Taxable amount",
      taxAmount: "VAT",
    },
    totals: { exclTax: "Total excl. tax", tax: "Total VAT", inclTax: "Total incl. tax" },
    methods: {
      stripe: "Online card",
      cash: "Cash",
      card: "Card",
      transfer: "Bank transfer",
      check: "Cheque",
      other: "Other",
    },
  },
};

export function getInvoicePdfTranslations(locale: InvoicePdfLocale): InvoicePdfTranslations {
  return translations[locale];
}
