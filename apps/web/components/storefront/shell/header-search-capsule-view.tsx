"use client";

import { SearchIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@louez/utils";

import { RentalPeriodPicker } from "@/components/storefront/date-picker/rental-period-picker";
import type { RentalPeriodValue } from "@/components/storefront/date-picker/core/types";
import type { RentalPeriodRules } from "@/lib/utils/util.rental-period";

interface HeaderSearchCapsuleViewProps {
  rules: RentalPeriodRules;
  className?: string;
  query: string;
  period: RentalPeriodValue | null;
  onQueryChange: (value: string) => void;
  onClear: () => void;
  onSubmit: () => void;
  onPeriodChange: (value: RentalPeriodValue) => void;
}

/** Shared search and date controls, independent of routing and cart storage. */
export const HeaderSearchCapsuleView = ({
  rules,
  className,
  query,
  period,
  onQueryChange,
  onClear,
  onSubmit,
  onPeriodChange,
}: HeaderSearchCapsuleViewProps) => {
  const t = useTranslations("storefront.catalog");

  return (
    <form
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
      className={cn(
        "flex h-12 items-center rounded-full border border-border bg-card p-0.5",
        className,
      )}
      data-slot="header-search-capsule"
    >
      <div className="flex h-10 min-w-0 flex-1 items-center gap-1 rounded-full ps-4 pe-1">
        <input
          type="text"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          aria-label={t("search")}
          placeholder={t("searchPlaceholder")}
          // 16 px under `md`, or iOS zooms the page on focus.
          className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground md:text-sm"
        />
        {query ? (
          <button
            type="button"
            onClick={onClear}
            aria-label={t("clearSearch")}
            className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <XIcon aria-hidden className="size-4" />
          </button>
        ) : null}
      </div>

      <span aria-hidden className="h-6 w-px shrink-0 bg-border" />

      <RentalPeriodPicker
        layout="compact"
        value={period}
        rules={rules}
        onChange={onPeriodChange}
        className="h-10 shrink-0 rounded-full border-0 bg-transparent px-3 hover:bg-muted dark:bg-transparent"
      />

      <button
        type="submit"
        aria-label={t("search")}
        className="ms-1 flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <SearchIcon aria-hidden className="size-4" />
      </button>
    </form>
  );
};
