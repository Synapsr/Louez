"use client";

import type { ReactNode } from "react";

import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@louez/ui";
import { ChevronDown } from "lucide-react";

interface PanelGroupProps {
  title: string;
  /**
   * The switch that turns the group on, at the end of the title row. Such a
   * group does not fold: the switch already shows or hides its fields.
   */
  action?: ReactNode;
  children?: ReactNode;
}

/**
 * One block of settings in the editor panel: a title and its fields, no
 * card around them. The panel draws the rule between two groups.
 *
 * Without a switch, the whole title row folds the group, with the chevron
 * at its end. Folded fields stay mounted, so an upload or an editor in
 * progress keeps its state.
 */
export const PanelGroup = ({ title, action, children }: PanelGroupProps) => {
  if (action) {
    return (
      <section className="flex flex-col gap-4 py-6 first:pt-0 last:pb-0" data-slot="panel-group">
        <div className="flex min-h-6 items-center justify-between gap-3">
          <h2 className="text-base font-semibold leading-6">{title}</h2>
          {action}
        </div>
        {children}
      </section>
    );
  }

  return (
    <Collapsible
      defaultOpen
      render={<section />}
      className="py-6 first:pt-0 last:pb-0"
      data-slot="panel-group"
    >
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
};
