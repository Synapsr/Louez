"use client";

import { useState } from "react";

import { Eye, EyeOff } from "lucide-react";

import { Button } from "@louez/ui";

interface MaskedValueProps {
  value: string;
  revealLabel: string;
  hideLabel: string;
  /** Characters left readable at the end while masked. */
  visibleTail?: number;
}

const mask = (value: string, visibleTail: number) => {
  const tail = value.slice(-visibleTail);
  return `${"•".repeat(Math.max(4, value.length - tail.length))}${tail}`;
};

/** A sensitive value kept unreadable until someone asks for it: a screen is often shared at a counter. */
export const MaskedValue = ({
  value,
  revealLabel,
  hideLabel,
  visibleTail = 4,
}: MaskedValueProps) => {
  const [revealed, setRevealed] = useState(false);

  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      <span className="truncate font-mono text-sm tabular-nums" data-openreplay-obscured>
        {revealed ? value : mask(value, visibleTail)}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={revealed ? hideLabel : revealLabel}
        aria-pressed={revealed}
        onClick={() => setRevealed((current) => !current)}
      >
        {revealed ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
      </Button>
    </span>
  );
};
