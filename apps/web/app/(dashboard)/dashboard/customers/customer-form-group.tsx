"use client";

import type { ReactNode } from "react";

import { ChevronDown } from "lucide-react";

import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@louez/ui";

interface CustomerFormGroupProps {
  title: string;
  /** Short status on the right of the title, e.g. "3 champs". */
  meta: string;
  defaultOpen: boolean;
  children: ReactNode;
}

/** One foldable group of optional fields: creating a customer at the counter stays a short form. */
export const CustomerFormGroup = ({
  title,
  meta,
  defaultOpen,
  children,
}: CustomerFormGroupProps) => (
  <Collapsible defaultOpen={defaultOpen} className="border-b last:border-b-0">
    <CollapsibleTrigger className="group hover:bg-accent/50 flex w-full items-center justify-between gap-3 rounded-lg px-2 py-3 text-left transition-colors">
      <span className="text-sm font-medium">{title}</span>
      <span className="text-muted-foreground flex items-center gap-2 text-xs">
        {meta}
        <ChevronDown className="size-4 transition-transform group-data-panel-open:rotate-180" />
      </span>
    </CollapsibleTrigger>
    <CollapsiblePanel>
      <div className="grid gap-4 px-2 pt-1 pb-4">{children}</div>
    </CollapsiblePanel>
  </Collapsible>
);
