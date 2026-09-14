import type { ReactNode } from "react";

import { Label } from "@louez/ui";

interface PanelRowProps {
  /** The id of the control, so a click on the label reaches it. */
  htmlFor?: string;
  label: string;
  /** One short line under the label, for a state the control alone cannot explain. */
  hint?: string;
  /** Extra detail behind an info icon, for what most people never need to read. */
  helper?: string;
  children: ReactNode;
}

/** A setting on one line: the label on the left, its control on the right. */
export const PanelRow = ({ htmlFor, label, hint, helper, children }: PanelRowProps) => (
  <div className="flex min-h-8 items-center justify-between gap-4" data-slot="panel-row">
    <div className="flex min-w-0 flex-col gap-1">
      <Label htmlFor={htmlFor} helper={helper} className="font-normal">
        {label}
      </Label>
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
    </div>
    {children}
  </div>
);
