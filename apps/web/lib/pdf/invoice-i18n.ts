import type { Locale } from "@/i18n/config";
import fr from "@/messages/invoices/fr.json";
import en from "@/messages/invoices/en.json";
import zh from "@/messages/invoices/zh.json";
import ja from "@/messages/invoices/ja.json";
import ru from "@/messages/invoices/ru.json";
import id from "@/messages/invoices/id.json";
import ko from "@/messages/invoices/ko.json";
export type InvoicePdfLocale = Locale;

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

const messages = {
  fr,
  en,
  it: en,
  nl: en,
  pt: en,
  de: en,
  es: en,
  pl: en,
  zh,
  ja,
  ru,
  id,
  ko,
} satisfies Record<Locale, InvoicePdfTranslations>;

export const getInvoicePdfTranslations = (locale: Locale): InvoicePdfTranslations =>
  messages[locale];
