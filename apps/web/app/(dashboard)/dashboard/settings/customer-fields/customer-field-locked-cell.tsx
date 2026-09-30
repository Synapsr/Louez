"use client";

import type { ReactNode } from "react";

import { Lock } from "lucide-react";

import { Label } from "@louez/ui";

interface CustomerFieldLockedCellProps {
  label: string;
  /** A short word at the end of the label's line, when the block itself does not say why. */
  note?: string;
  /** The input, disabled: there to be read. */
  children: ReactNode;
}

/**
 * A Louez field nobody can change, drawn like every field of the canvas (its
 * label above its input) with a lock after its name, and nothing to hover or click.
 */
export const CustomerFieldLockedCell = ({
  label,
  note,
  children,
}: CustomerFieldLockedCellProps) => (
  <div className="flex min-w-0 flex-col gap-2">
    <div className="flex min-w-0 items-center justify-between gap-2">
      <span className="flex min-w-0 items-center gap-1.5">
        <Label render={<p />} className="min-w-0">
          {label}
        </Label>
        <Lock aria-hidden className="text-muted-foreground size-3 shrink-0" />
      </span>
      {note && <span className="text-muted-foreground shrink-0 text-xs">{note}</span>}
    </div>
    {children}
  </div>
);
