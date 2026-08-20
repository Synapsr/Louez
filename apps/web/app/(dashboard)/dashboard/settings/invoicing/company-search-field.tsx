"use client";

import { useEffect, useRef, useState } from "react";

import { useTranslations } from "next-intl";

import { Badge, Input, Label, Spinner } from "@louez/ui";
import { SearchIcon } from "@louez/ui/icons";

import type { CompanySearchResult } from "@/lib/recherche-entreprises";

import { searchCompanyRegistry } from "./actions";

const MIN_QUERY_LENGTH = 3;
const DEBOUNCE_MS = 350;

type CompanySearchFieldProps = {
  disabled?: boolean;
  onSelect: (company: CompanySearchResult) => void;
};

/**
 * SIREN / SIRET / company-name lookup against the French public registry.
 * Selecting a result prefills the legal identity; every field stays editable.
 */
export const CompanySearchField = ({ disabled = false, onSelect }: CompanySearchFieldProps) => {
  const t = useTranslations("dashboard.settings.invoicing.identity.search");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CompanySearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handleQueryChange = (value: string) => {
    setQuery(value);

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (value.trim().length < MIN_QUERY_LENGTH) {
      setResults([]);
      setHasSearched(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setIsSearching(true);
      const response = await searchCompanyRegistry(value.trim());
      setResults(response.results);
      setHasSearched(true);
      setIsSearching(false);
    }, DEBOUNCE_MS);
  };

  const handleSelect = (company: CompanySearchResult) => {
    onSelect(company);
    setQuery("");
    setResults([]);
    setHasSearched(false);
  };

  return (
    <div className="space-y-2">
      <Label htmlFor="company-registry-search">{t("label")}</Label>
      <div className="relative">
        <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input
          id="company-registry-search"
          type="search"
          autoComplete="off"
          className="pl-9"
          placeholder={t("placeholder")}
          value={query}
          disabled={disabled}
          onChange={(event) => handleQueryChange(event.target.value)}
        />
        {isSearching && (
          <Spinner className="text-muted-foreground absolute top-1/2 right-3 size-4 -translate-y-1/2" />
        )}
      </div>
      <p className="text-muted-foreground text-sm">{t("description")}</p>

      {results.length > 0 && (
        <ul className="divide-border divide-y rounded-lg border">
          {results.map((company) => (
            <li key={company.siren}>
              <button
                type="button"
                onClick={() => handleSelect(company)}
                className="hover:bg-muted/50 w-full px-4 py-3 text-left transition-colors"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{company.legalName}</span>
                  {company.legalForm && <Badge variant="tertiary">{company.legalForm}</Badge>}
                  {!company.isActive && <Badge variant="warning">{t("closed")}</Badge>}
                </span>
                <span className="text-muted-foreground block truncate text-sm">
                  {company.siren} — {company.address} {company.postalCode} {company.city}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {hasSearched && !isSearching && results.length === 0 && (
        <p className="text-muted-foreground text-sm">{t("noResults")}</p>
      )}
    </div>
  );
};
