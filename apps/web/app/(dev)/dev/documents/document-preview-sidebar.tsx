import Link from "next/link";

import { Badge } from "@louez/ui";
import { cn } from "@louez/utils";

import type {
  DocumentPreview,
  DocumentPreviewGroup,
} from "@/lib/document-previews/document-previews.types";
import type { EmailLocale } from "@/lib/email/i18n";

interface DocumentPreviewSidebarProps {
  documents: readonly DocumentPreview[];
  groups: readonly { id: DocumentPreviewGroup; label: string }[];
  activeDocumentId: string;
  storeId: string;
  locale: EmailLocale;
}

export const DocumentPreviewSidebar = ({
  documents,
  groups,
  activeDocumentId,
  storeId,
  locale,
}: DocumentPreviewSidebarProps) => {
  const emailCount = documents.filter((document) => document.kind === "email").length;
  const pdfCount = documents.length - emailCount;

  const hrefFor = (document: DocumentPreview) => {
    const params = new URLSearchParams({ doc: document.id, store: storeId });
    // Keep the locale across documents, unless the target one can't render it.
    if (document.locales.includes(locale)) params.set("locale", locale);
    return `/dev/documents?${params.toString()}`;
  };

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r bg-background">
      <div className="space-y-1 border-b px-4 py-4">
        <Badge variant="pending" className="w-fit">
          Dev
        </Badge>
        <h1 className="text-base font-semibold">Documents envoyés</h1>
        <p className="text-xs text-muted-foreground">
          {emailCount} emails · {pdfCount} PDF · données fictives
        </p>
      </div>

      <nav className="flex-1 overflow-y-auto p-2" aria-label="Documents">
        {groups.map((group) => {
          const groupDocuments = documents.filter((document) => document.group === group.id);
          if (groupDocuments.length === 0) return null;

          return (
            <section key={group.id} className="pb-2">
              <h2 className="px-2 pt-3 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                {group.label}
              </h2>
              <ul className="space-y-0.5">
                {groupDocuments.map((document) => {
                  const isActive = document.id === activeDocumentId;
                  return (
                    <li key={document.id}>
                      <Link
                        href={hrefFor(document)}
                        aria-current={isActive ? "page" : undefined}
                        className={cn(
                          "block rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted",
                          isActive && "bg-primary/10 font-medium text-primary hover:bg-primary/10",
                        )}
                      >
                        {document.title}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </nav>
    </aside>
  );
};
