import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";

import {
  DOCUMENT_PREVIEWS,
  DOCUMENT_PREVIEW_GROUPS,
  getDocumentPreview,
  getDocumentPreviewStore,
} from "@/lib/document-previews/document-previews.catalog";
import {
  DEFAULT_DOCUMENT_PREVIEW_STORE_ID,
  DOCUMENT_PREVIEW_STORES,
  EMAIL_PREVIEW_LOCALES,
} from "@/lib/document-previews/document-previews.fixtures";
import { isDocumentPreviewEnabled } from "@/lib/document-previews/util.document-preview-access";

import { DocumentPreviewSidebar } from "./document-preview-sidebar";
import { DocumentPreviewViewer } from "./document-preview-viewer";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export const metadata: Metadata = {
  title: "Documents · Dev",
  robots: {
    index: false,
    follow: false,
  },
};

const searchParamsSchema = z.object({
  doc: z.string().optional(),
  store: z.string().optional(),
  locale: z.enum(EMAIL_PREVIEW_LOCALES).optional(),
});

interface DocumentsDevPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Gallery of every email and PDF the app sends, rendered with fixture data.
 * One place to see them side by side while editing their shared UI.
 */
export default async function DocumentsDevPage({ searchParams }: DocumentsDevPageProps) {
  if (!isDocumentPreviewEnabled()) {
    notFound();
  }

  const parsedSearchParams = searchParamsSchema.safeParse(await searchParams);
  if (!parsedSearchParams.success) {
    notFound();
  }
  const { doc, store: storeId, locale: requestedLocale } = parsedSearchParams.data;

  const document = doc ? getDocumentPreview(doc) : DOCUMENT_PREVIEWS[0];
  const store = getDocumentPreviewStore(storeId ?? DEFAULT_DOCUMENT_PREVIEW_STORE_ID);
  if (!document || !store) {
    notFound();
  }

  const locale =
    requestedLocale && document.locales.includes(requestedLocale) ? requestedLocale : "fr";
  const subject = document.kind === "email" ? document.compose({ store, locale }).subject : null;

  return (
    <main className="flex h-dvh bg-muted/20 text-foreground">
      <DocumentPreviewSidebar
        documents={DOCUMENT_PREVIEWS}
        groups={DOCUMENT_PREVIEW_GROUPS}
        activeDocumentId={document.id}
        storeId={store.id}
        locale={locale}
      />
      <DocumentPreviewViewer
        key={document.id}
        document={{
          id: document.id,
          kind: document.kind,
          title: document.title,
          description: document.description,
          locales: document.locales,
        }}
        subject={subject}
        stores={DOCUMENT_PREVIEW_STORES.map(({ id, label }) => ({ id, label }))}
        storeId={store.id}
        locale={locale}
      />
    </main>
  );
}
