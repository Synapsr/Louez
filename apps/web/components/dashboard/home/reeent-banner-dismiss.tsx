"use client";

import { X } from "lucide-react";

import { Button } from "@louez/ui";

/** Closes an offer for good: a round button, set apart by a hairline. */
export const ReeentBannerDismiss = ({
  label,
  onDismiss,
}: {
  label: string;
  onDismiss: () => void;
}) => (
  <>
    <span aria-hidden className="bg-border mx-0.5 h-5 w-px" />
    <Button
      variant="ghost"
      size="icon-xs"
      onClick={onDismiss}
      aria-label={label}
      title={label}
      className="text-muted-foreground rounded-full"
    >
      <X />
    </Button>
  </>
);
