"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Package, SearchIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn, formatCurrency } from "@louez/utils";

import { RentalPeriodPicker } from "@/components/storefront/date-picker/rental-period-picker";
import type { RentalPeriodValue } from "@/components/storefront/date-picker/core/types";
import type { RentalPeriodRules } from "@/lib/utils/util.rental-period";
import type { ProductSuggestion } from "@/app/(storefront)/[slug]/catalog/search-actions";

interface HeaderSearchCapsuleViewProps {
  rules: RentalPeriodRules;
  className?: string;
  query: string;
  period: RentalPeriodValue | null;
  onQueryChange: (value: string) => void;
  onClear: () => void;
  onSubmit: () => void;
  onPeriodChange: (value: RentalPeriodValue) => void;
  suggestions?: ProductSuggestion[];
  isLoadingSuggestions?: boolean;
  onSelectSuggestion?: (suggestion: ProductSuggestion) => void;
  currency?: string;
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
  suggestions = [],
  isLoadingSuggestions = false,
  onSelectSuggestion,
  currency = "EUR",
}: HeaderSearchCapsuleViewProps) => {
  const t = useTranslations("storefront.catalog");
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const hasSuggestions = suggestions.length > 0;
  const isQueryTyped = query.trim().length >= 1;
  const shouldShowDropdown = isOpen && (hasSuggestions || isLoadingSuggestions || isQueryTyped);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setHighlightedIndex(-1);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, []);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!shouldShowDropdown) {
      if (event.key === "ArrowDown" && isQueryTyped) {
        setIsOpen(true);
      }
      return;
    }

    const totalCount = suggestions.length + 1; // items + footer "see all"

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightedIndex((prev) => (prev + 1) % totalCount);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedIndex((prev) => (prev <= 0 ? totalCount - 1 : prev - 1));
    } else if (event.key === "Enter") {
      if (highlightedIndex >= 0 && highlightedIndex < suggestions.length) {
        event.preventDefault();
        const selected = suggestions[highlightedIndex];
        if (selected) {
          setIsOpen(false);
          onSelectSuggestion?.(selected);
        }
      } else if (highlightedIndex === suggestions.length) {
        event.preventDefault();
        setIsOpen(false);
        onSubmit();
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      setIsOpen(false);
      setHighlightedIndex(-1);
    }
  };

  return (
    <div ref={containerRef} className="relative w-full">
      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          setIsOpen(false);
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
            ref={inputRef}
            type="text"
            value={query}
            onFocus={() => {
              if (isQueryTyped) setIsOpen(true);
            }}
            onChange={(event) => {
              onQueryChange(event.target.value);
              setIsOpen(true);
              setHighlightedIndex(-1);
            }}
            onKeyDown={handleKeyDown}
            aria-label={t("search")}
            placeholder={t("searchPlaceholder")}
            // 16 px under `md`, or iOS zooms the page on focus.
            className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground md:text-sm"
          />
          {query ? (
            <button
              type="button"
              onClick={() => {
                onClear();
                setIsOpen(false);
                setHighlightedIndex(-1);
              }}
              aria-label={t("clearSearch")}
              className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground cursor-pointer"
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
          className="ms-1 flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none cursor-pointer"
        >
          <SearchIcon aria-hidden className="size-4" />
        </button>
      </form>

      {/* Product Suggestions Dropdown */}
      {shouldShowDropdown && (
        <div
          role="listbox"
          aria-label={t("suggestionsTitle")}
          className="absolute start-0 top-full z-50 mt-2 w-full min-w-[280px] sm:w-[380px] max-w-[calc(100vw-2rem)] rounded-2xl border border-border/80 bg-popover/95 p-1.5 shadow-2xl backdrop-blur-md animate-in fade-in-50 zoom-in-95"
        >
          {isLoadingSuggestions ? (
            <div className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin text-primary" />
              <span>{t("searchingProducts")}</span>
            </div>
          ) : hasSuggestions ? (
            <div className="space-y-0.5">
              <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                {t("suggestionsTitle")}
              </div>
              {suggestions.map((item, index) => {
                const isHighlighted = highlightedIndex === index;
                const grossPrice = Number(item.price);
                const netPrice = Math.round(grossPrice / 1.23);
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="option"
                    aria-selected={isHighlighted}
                    onClick={() => {
                      setIsOpen(false);
                      onSelectSuggestion?.(item);
                    }}
                    onMouseEnter={() => setHighlightedIndex(index)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl p-2 text-start transition-colors duration-150 cursor-pointer",
                      isHighlighted
                        ? "bg-accent text-accent-foreground"
                        : "hover:bg-muted/80 text-foreground",
                    )}
                  >
                    {item.image ? (
                      <img
                        src={item.image}
                        alt=""
                        className="size-10 rounded-lg object-cover shrink-0 border border-border/50 bg-muted"
                      />
                    ) : (
                      <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border/50 bg-muted text-muted-foreground">
                        <Package className="size-5" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{item.name}</span>
                      {item.priceNegotiable ? (
                        <span className="block text-xs text-muted-foreground">
                          {t("product.priceNegotiable")}
                        </span>
                      ) : (
                        <div className="mt-0.5 flex flex-col leading-tight tabular-nums">
                          <span className="text-xs font-semibold text-foreground">
                            {formatCurrency(netPrice, currency)}{" "}
                            <span className="font-normal text-muted-foreground">netto</span>
                          </span>
                          <span className="text-[11px] text-muted-foreground/80">
                            {formatCurrency(grossPrice, currency)} brutto
                          </span>
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
              <div className="border-t border-border/60 pt-1 mt-1">
                <button
                  type="button"
                  onClick={() => {
                    setIsOpen(false);
                    onSubmit();
                  }}
                  onMouseEnter={() => setHighlightedIndex(suggestions.length)}
                  className={cn(
                    "flex w-full items-center justify-between rounded-xl px-2.5 py-1.5 text-xs font-medium text-primary transition-colors cursor-pointer",
                    highlightedIndex === suggestions.length
                      ? "bg-primary/10"
                      : "hover:bg-primary/10",
                  )}
                >
                  <span className="truncate">{t("seeAllResults", { query })}</span>
                  <span className="shrink-0 ms-2">→</span>
                </button>
              </div>
            </div>
          ) : isQueryTyped ? (
            <div className="py-4 text-center text-sm text-muted-foreground">
              {t("noProductsFor", { search: query })}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
};
