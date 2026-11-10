"use client";

import type { ComponentProps, ReactNode } from "react";

import { ArrowRight } from "lucide-react";

import { Button } from "@louez/ui";
import { cn } from "@louez/utils";

/** The banner's single action: a pill in reeent's (readable) orange. */
export const ReeentBannerAction = ({
  className,
  children,
  icon = <ArrowRight />,
  ...props
}: ComponentProps<typeof Button> & { icon?: ReactNode }) => (
  <Button
    size="sm"
    className={cn(
      "bg-reeent-ink text-reeent-ink-foreground hover:bg-reeent-ink/90 focus-visible:ring-reeent-ink group/cta h-8.5 rounded-full px-3.5 font-bold transition-shadow hover:shadow-[0_4px_12px_-4px_color-mix(in_oklch,var(--color-reeent-ink)_55%,transparent)]",
      "[&_svg]:transition-transform [&_svg]:duration-150 hover:[&_svg]:translate-x-0.5 motion-reduce:[&_svg]:transition-none",
      className,
    )}
    {...props}
  >
    {children}
    {icon}
  </Button>
);
