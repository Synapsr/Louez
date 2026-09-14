import type { DocumentProps } from "@react-pdf/renderer";
import type { ReactElement } from "react";

import type { EmailLocale } from "@/lib/email/i18n";

export type DocumentPreviewGroup = "customer-email" | "store-email" | "platform-email" | "pdf";

/** A fake store every document is rendered for. Two of them cover the branding extremes. */
export interface DocumentPreviewStore {
  id: string;
  label: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  primaryColor: string;
  email: string;
  phone: string;
  address: string;
  timezone: string;
  country: string;
  currency: string;
}

export interface DocumentPreviewContext {
  store: DocumentPreviewStore;
  locale: EmailLocale;
}

interface DocumentPreviewBase {
  id: string;
  group: DocumentPreviewGroup;
  title: string;
  /** What triggers the document in production, so reviewers know the context. */
  description: string;
  locales: readonly EmailLocale[];
}

export interface ComposedEmailPreview {
  /** Null when the subject lives outside the app (auth emails from `@louez/email`). */
  subject: string | null;
  element: ReactElement;
}

export interface EmailDocumentPreview extends DocumentPreviewBase {
  kind: "email";
  compose: (context: DocumentPreviewContext) => ComposedEmailPreview;
}

export interface PdfDocumentPreview extends DocumentPreviewBase {
  kind: "pdf";
  fileName: string;
  compose: (context: DocumentPreviewContext) => ReactElement<DocumentProps>;
}

export type DocumentPreview = EmailDocumentPreview | PdfDocumentPreview;
