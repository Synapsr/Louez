"use client";

import type { FormEvent } from "react";

import { SearchIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@louez/utils";

import { RentalPeriodPicker } from "@/components/storefront/date-picker/rental-period-picker";
import { useCartActions, useCartState } from "@/contexts/cart-context";
import { useStorefrontSearch } from "@/contexts/storefront-search-context";
import { parseRentalPeriod, type RentalPeriodRules } from "@/lib/utils/util.rental-period";

interface HeaderSearchCapsuleProps {
  /** Store rules the period picker validates against. */
  rules: RentalPeriodRules;
  className?: string;
}

/**
 * The two questions a rental customer arrives with, on one control: what,
 * and when.
 *
 * The period is global state — it prices every card and gates every
 * availability badge — so it is offered here before one has been picked
 * rather than appearing only once it exists. The same capsule rides every
 * route, the catalog included: that page has no toolbar of its own, it reads
 * this one.
 */
export const HeaderSearchCapsule = ({ rules, className }: HeaderSearchCapsuleProps) => {
  const t = useTranslations("storefront.catalog");
  const { draft, setDraft, clear, submit } = useStorefrontSearch();
  const { period } = useCartState();
  const { setPeriod, setPricingMode } = useCartActions();

  const value = period ? parseRentalPeriod(period.startDate, period.endDate) : null;

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submit();
  };

  return (
    <form
      role="search"
      onSubmit={onSubmit}
      className={cn(
        "flex h-12 items-center rounded-full border border-border bg-card p-0.5",
        className,
      )}
      data-slot="header-search-capsule"
    >
      <div className="flex h-10 min-w-0 flex-1 items-center gap-1 rounded-full ps-4 pe-1">
        <input
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          aria-label={t("search")}
          placeholder={t("searchPlaceholder")}
          // 16 px under `md`, or iOS zooms the page on focus.
          className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground md:text-sm"
        />
        {draft ? (
          <button
            type="button"
            onClick={clear}
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
        value={value}
        rules={rules}
        onChange={(next) => {
          setPricingMode(rules.pricingMode);
          setPeriod(next.start.toISOString(), next.end.toISOString());
        }}
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
