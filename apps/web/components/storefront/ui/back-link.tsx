"use client";

import { ArrowLeftIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { cn } from "@louez/utils";

import { StorefrontLink } from "@/components/storefront/ui/storefront-link";

interface BackLinkProps {
  /** Where "back" leads. A known parent beats `history.back()`: it is deterministic. */
  href: string;
  className?: string;
  /** Defaults to the shared "Retour". */
  children?: ReactNode;
}

/** Quiet return link above a page title; 44 px tall so it is tappable. */
export const BackLink = ({ href, className, children }: BackLinkProps) => {
  const t = useTranslations("common");

  return (
    <StorefrontLink
      href={href}
      className={cn(
        "-ml-1 inline-flex min-h-11 items-center gap-1.5 pr-2 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground",
        className,
      )}
      data-slot="back-link"
    >
      <ArrowLeftIcon aria-hidden className="size-4" />
      {children ?? t("back")}
    </StorefrontLink>
  );
};
