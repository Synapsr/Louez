"use client";

import Link from "next/link";

import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@louez/utils";

interface HomeListMoreProps {
  href: string;
  /** Rows the list leaves out; nothing renders at zero. */
  count: number;
  className?: string;
}

/** "See the N others" under a home list that does not show every row. */
export const HomeListMore = ({ href, count, className }: HomeListMoreProps) => {
  const t = useTranslations("dashboard.home");
  if (count <= 0) return null;

  return (
    <Link
      href={href}
      className={cn(
        "text-primary inline-flex items-center gap-1 px-2 py-2 text-sm font-semibold hover:underline sm:px-3",
        className,
      )}
    >
      {t("list.more", { count })}
      <ArrowRight className="size-3.5" />
    </Link>
  );
};
