import { getTranslations } from "next-intl/server";

import { cn } from "@louez/utils";

import type { StoreReassuranceKey } from "@/lib/utils/util.store-reassurance";

import { STORE_REASSURANCE_ICONS } from "./store-reassurance.constants";

type StoreReassuranceTone = "onPhoto" | "onSurface";

interface StoreReassuranceProps {
  items: StoreReassuranceKey[];
  /** `onPhoto` for white text over the hero photos, `onSurface` on the page or a band. */
  tone: StoreReassuranceTone;
  className?: string;
}

const TONE_CLASS_NAMES: Record<StoreReassuranceTone, string> = {
  onPhoto: "text-white/80",
  onSurface: "text-muted-foreground",
};

/**
 * One quiet line of what the store actually offers, derived from its
 * settings; sits under the period search in the hero.
 */
export const StoreReassurance = async ({ items, tone, className }: StoreReassuranceProps) => {
  const t = await getTranslations("storefront.hero");

  if (items.length === 0) return null;

  return (
    <ul
      className={cn(
        "flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs sm:text-sm",
        TONE_CLASS_NAMES[tone],
        className,
      )}
      data-slot="store-reassurance"
    >
      {items.map((key) => {
        const Icon = STORE_REASSURANCE_ICONS[key];
        return (
          <li key={key} className="inline-flex items-center gap-1.5">
            <Icon aria-hidden className="size-4 shrink-0" />
            {t(key)}
          </li>
        );
      })}
    </ul>
  );
};
