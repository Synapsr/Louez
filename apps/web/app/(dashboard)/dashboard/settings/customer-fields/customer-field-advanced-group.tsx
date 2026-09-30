"use client";

import type { ReactNode } from "react";

import { ChevronDown } from "lucide-react";

import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@louez/ui";

interface CustomerFieldAdvancedGroupProps {
  title: string;
  children: ReactNode;
}

/**
 * "Options avancées": a `PanelGroup` that starts folded, since these switches
 * are set once, if ever. Folded content stays mounted.
 */
export const CustomerFieldAdvancedGroup = ({
  title,
  children,
}: CustomerFieldAdvancedGroupProps) => (
  <Collapsible render={<section />} className="py-6 first:pt-0 last:pb-0" data-slot="panel-group">
    <h2 className="text-base font-semibold leading-6">
      <CollapsibleTrigger className="group -my-1 flex w-full items-center justify-between gap-3 rounded-md py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="truncate">{title}</span>
        <ChevronDown
          aria-hidden
          className="size-4 shrink-0 -rotate-90 text-muted-foreground transition-transform duration-200 group-hover:text-foreground group-data-panel-open:rotate-0 motion-reduce:transition-none"
        />
      </CollapsibleTrigger>
    </h2>
    <CollapsiblePanel keepMounted className="-mx-1 -mb-1 px-1 pb-1 motion-reduce:transition-none">
      <div className="flex flex-col gap-4 pt-4">{children}</div>
    </CollapsiblePanel>
  </Collapsible>
);
