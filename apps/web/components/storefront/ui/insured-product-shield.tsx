"use client";

import { ShieldCheck } from "lucide-react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "@louez/ui";
import { cn } from "@louez/utils";

interface InsuredProductShieldProps {
  /** Tooltip and accessible name, e.g. "Covered by breakage/theft coverage". */
  label: string;
  /** Green when the cover applies, muted when the product is only eligible. */
  applied?: boolean;
  className?: string;
}

/** Small shield next to a product name: this line is (or can be) insured. */
export const InsuredProductShield = ({
  label,
  applied = true,
  className,
}: InsuredProductShieldProps) => (
  <Tooltip>
    <TooltipTrigger
      type="button"
      aria-label={label}
      className={cn(
        "inline-flex size-6 shrink-0 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        applied ? "text-success" : "text-muted-foreground",
        className,
      )}
    >
      <ShieldCheck aria-hidden="true" className="size-3.5" />
    </TooltipTrigger>
    <TooltipPopup className="max-w-64">{label}</TooltipPopup>
  </Tooltip>
);
