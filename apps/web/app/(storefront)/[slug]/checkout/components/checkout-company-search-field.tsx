'use client';

import { useEffect, useRef, useState } from 'react';

import { useTranslations } from 'next-intl';

import { Badge, Input, Label, Spinner } from '@louez/ui';
import { SearchIcon } from '@louez/ui/icons';

import type { CompanySearchResult } from '@/lib/recherche-entreprises';

import { searchCheckoutCompanyRegistry } from '../actions';

const MIN_QUERY_LENGTH = 3;
const DEBOUNCE_MS = 350;

interface CheckoutCompanySearchFieldProps {
  storeId: string;
  onSelect: (company: CompanySearchResult) => void;
}

/**
 * Optional company lookup on the checkout contact step: picking a result fills
 * the legal name, SIREN and VAT number. Purely an accelerator — the buyer can
 * ignore it entirely and every field it fills stays editable.
 */
export const CheckoutCompanySearchField = ({
  storeId,
  onSelect,
}: CheckoutCompanySearchFieldProps) => {
  const t = useTranslations('storefront.checkout');
  const [query, setQuery] = useState('');
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
      const response = await searchCheckoutCompanyRegistry({
        storeId,
        query: value.trim(),
      });
      setResults(response.results);
      setHasSearched(true);
      setIsSearching(false);
    }, DEBOUNCE_MS);
  };

  const handleSelect = (company: CompanySearchResult) => {
    onSelect(company);
    setQuery('');
    setResults([]);
    setHasSearched(false);
  };

  return (
    <div className="space-y-2">
      <Label htmlFor="checkout-company-search">
        {t('companySearch.label')}
      </Label>
      <div className="relative">
        <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input
          id="checkout-company-search"
          type="search"
          autoComplete="off"
          className="pl-9"
          placeholder={t('companySearch.placeholder')}
          value={query}
          onChange={(event) => handleQueryChange(event.target.value)}
        />
        {isSearching && (
          <Spinner className="text-muted-foreground absolute top-1/2 right-3 size-4 -translate-y-1/2" />
        )}
      </div>
      <p className="text-muted-foreground text-sm">
        {t('companySearch.description')}
      </p>

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
                  {company.legalForm && (
                    <Badge variant="tertiary">{company.legalForm}</Badge>
                  )}
                  {!company.isActive && (
                    <Badge variant="warning">
                      {t('companySearch.closed')}
                    </Badge>
                  )}
                </span>
                <span className="text-muted-foreground block truncate text-sm">
                  {company.siren} — {company.address} {company.postalCode}{' '}
                  {company.city}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {hasSearched && !isSearching && results.length === 0 && (
        <p className="text-muted-foreground text-sm">
          {t('companySearch.noResults')}
        </p>
      )}
    </div>
  );
};
