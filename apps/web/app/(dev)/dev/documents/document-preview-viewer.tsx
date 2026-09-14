"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { cn } from "@louez/utils";

import type { EmailLocale } from "@/lib/email/i18n";

import { DocumentPreviewToolbar, type PreviewViewport } from "./document-preview-toolbar";

interface DocumentPreviewViewerProps {
  document: {
    id: string;
    kind: "email" | "pdf";
    title: string;
    description: string;
    locales: readonly EmailLocale[];
  };
  subject: string | null;
  stores: readonly { id: string; label: string }[];
  storeId: string;
  locale: EmailLocale;
}

export const DocumentPreviewViewer = ({
  document,
  subject,
  stores,
  storeId,
  locale,
}: DocumentPreviewViewerProps) => {
  const router = useRouter();
  const [viewport, setViewport] = useState<PreviewViewport>("desktop");
  // Bumped by the refresh button so the iframe refetches after a template edit.
  const [revision, setRevision] = useState(0);

  const renderUrl = `/api/dev/documents/${document.id}?store=${storeId}&locale=${locale}`;
  const frameSrc = `${renderUrl}&v=${revision}`;

  const navigate = (next: { store?: string; locale?: EmailLocale }) => {
    const params = new URLSearchParams({
      doc: document.id,
      store: next.store ?? storeId,
      locale: next.locale ?? locale,
    });
    router.replace(`/dev/documents?${params.toString()}`);
  };

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <DocumentPreviewToolbar
        document={document}
        subject={subject}
        stores={stores}
        storeId={storeId}
        locale={locale}
        viewport={viewport}
        openUrl={renderUrl}
        onStoreChange={(store) => navigate({ store })}
        onLocaleChange={(nextLocale) => navigate({ locale: nextLocale })}
        onViewportChange={setViewport}
        onRefresh={() => setRevision((current) => current + 1)}
      />

      <div className="flex flex-1 justify-center overflow-auto bg-muted/40 p-6">
        <iframe
          key={frameSrc}
          title={document.title}
          src={frameSrc}
          className={cn(
            "h-full rounded-lg border bg-white shadow-sm transition-[width] duration-200",
            document.kind === "email" && viewport === "mobile" ? "w-[375px]" : "w-full max-w-5xl",
          )}
        />
      </div>
    </section>
  );
};
