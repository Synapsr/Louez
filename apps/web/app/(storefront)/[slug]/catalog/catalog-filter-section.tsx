"use client";

import type { ReactNode } from "react";

import { ChevronDownIcon } from "lucide-react";

import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@louez/ui";

interface CatalogFilterSectionProps {
  title: string;
  /** Sections open by default; the visitor may fold the ones they don't use. */
  children: ReactNode;
}

/** One foldable block of the catalog sidebar: a heading row and its controls. */
export const CatalogFilterSection = ({ title, children }: CatalogFilterSectionProps) => (
  <Collapsible defaultOpen data-slot="catalog-filter-section">
    <CollapsibleTrigger className="group flex w-full items-center justify-between gap-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background">
      {title}
      <ChevronDownIcon
        aria-hidden
        className="size-4 shrink-0 transition-transform group-data-panel-open:rotate-180"
      />
    </CollapsibleTrigger>
    <CollapsiblePanel>
      <div className="pb-2 pt-1">{children}</div>
    </CollapsiblePanel>
  </Collapsible>
);
