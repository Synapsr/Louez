import { DOCUMENT_PREVIEW_STORES } from "./document-previews.fixtures";
import type {
  DocumentPreview,
  DocumentPreviewGroup,
  DocumentPreviewStore,
} from "./document-previews.types";
import { EMAIL_DOCUMENT_PREVIEWS } from "./email-document-previews";
import { PDF_DOCUMENT_PREVIEWS } from "./pdf-document-previews";

export const DOCUMENT_PREVIEW_GROUPS: readonly { id: DocumentPreviewGroup; label: string }[] = [
  { id: "customer-email", label: "Emails client" },
  { id: "store-email", label: "Emails loueur" },
  { id: "platform-email", label: "Emails plateforme" },
  { id: "pdf", label: "Documents PDF" },
];

export const DOCUMENT_PREVIEWS: readonly DocumentPreview[] = [
  ...EMAIL_DOCUMENT_PREVIEWS,
  ...PDF_DOCUMENT_PREVIEWS,
];

export const getDocumentPreview = (id: string): DocumentPreview | null =>
  DOCUMENT_PREVIEWS.find((document) => document.id === id) ?? null;

export const getDocumentPreviewStore = (id: string): DocumentPreviewStore | null =>
  DOCUMENT_PREVIEW_STORES.find((store) => store.id === id) ?? null;
