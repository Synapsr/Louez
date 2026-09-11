"use client";

import { useTranslations } from "next-intl";

import { STORE_REASSURANCE_ICONS } from "@/components/storefront/home/store-reassurance.constants";
import type { StoreReassuranceKey } from "@/lib/utils/util.store-reassurance";

interface EmbedReassuranceProps {
  items: StoreReassuranceKey[];
}

/** The hero's reassurance line, sized for the widget and rendered on the client. */
export const EmbedReassurance = ({ items }: EmbedReassuranceProps) => {
  const t = useTranslations("storefront.hero");

  if (items.length === 0) return null;

  return (
    <ul className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
      {items.map((key) => {
        const Icon = STORE_REASSURANCE_ICONS[key];
        return (
          <li key={key} className="inline-flex items-center gap-1">
            <Icon aria-hidden className="size-3 shrink-0 text-primary" />
            {t(key)}
          </li>
        );
      })}
    </ul>
  );
};
