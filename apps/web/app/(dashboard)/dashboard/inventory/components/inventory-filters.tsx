'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useRouter, useSearchParams } from 'next/navigation';

import { useTranslations } from 'next-intl';
import { useDebouncedCallback } from 'use-debounce';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@louez/ui';

import { SearchInput } from '@/components/ui/search-input';

import type { InventoryProductOption } from './inventory-types';
import { INVENTORY_STATE_OPTIONS } from './inventory.constants';

interface InventoryFiltersProps {
  products: InventoryProductOption[];
  currentProductId?: string;
  currentState?: string;
  currentSearch?: string;
}

export const InventoryFilters = ({
  products,
  currentProductId = 'all',
  currentState = 'all',
  currentSearch = '',
}: InventoryFiltersProps) => {
  const t = useTranslations('dashboard.inventory');
  const router = useRouter();
  const searchParams = useSearchParams();
  const [searchQuery, setSearchQuery] = useState(currentSearch);
  const pendingSearchParamsRef = useRef(new Set<string>());
  const latestSearchQueryRef = useRef(currentSearch);
  const navigateToSearchRef = useRef<
    (term: string, mode?: 'push' | 'replace') => void
  >(() => {});

  const createQueryString = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());

      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === '') {
          params.delete(key);
        } else {
          params.set(key, value);
        }
      }

      return params.toString();
    },
    [searchParams],
  );

  const pushFilters = useCallback(
    (
      updates: Record<string, string | null>,
      mode: 'push' | 'replace' = 'push',
    ) => {
      const queryString = createQueryString({
        ...updates,
        page: null,
      });
      const href = queryString
        ? `/dashboard/inventory?${queryString}`
        : '/dashboard/inventory';

      if (mode === 'replace') {
        router.replace(href);
        return;
      }

      router.push(href);
    },
    [createQueryString, router],
  );

  const navigateToSearch = useCallback(
    (term: string, mode: 'push' | 'replace' = 'push') => {
      if (term === currentSearch) {
        return;
      }

      pendingSearchParamsRef.current.add(term);
      pushFilters({ search: term || null }, mode);
    },
    [currentSearch, pushFilters],
  );

  useEffect(() => {
    navigateToSearchRef.current = navigateToSearch;
  }, [navigateToSearch]);

  useEffect(() => {
    if (pendingSearchParamsRef.current.delete(currentSearch)) {
      if (currentSearch !== '' && latestSearchQueryRef.current === '') {
        navigateToSearchRef.current('', 'replace');
      }
      return;
    }

    latestSearchQueryRef.current = currentSearch;
    setSearchQuery(currentSearch);
  }, [currentSearch]);

  const handleSearch = useDebouncedCallback((term: string) => {
    navigateToSearch(term);
  }, 300);

  const updateSearchQuery = (term: string) => {
    latestSearchQueryRef.current = term;
    setSearchQuery(term);
    handleSearch(term);
  };

  const clearSearchQuery = () => {
    latestSearchQueryRef.current = '';
    setSearchQuery('');
    handleSearch.cancel();
    navigateToSearch('');
  };

  const handleProductChange = (value: string | null) => {
    if (value === null) return;
    pushFilters({ productId: value === 'all' ? null : value });
  };

  const handleStateChange = (value: string | null) => {
    if (value === null) return;
    pushFilters({ state: value === 'all' ? null : value });
  };

  return (
    <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
      <div className="relative max-w-sm flex-1">
        <SearchInput
          value={searchQuery}
          onChange={(event) => updateSearchQuery(event.target.value)}
          onClear={clearSearchQuery}
          placeholder={t('filters.searchPlaceholder')}
          clearLabel={t('filters.clearSearch')}
        />
      </div>

      <Select value={currentProductId} onValueChange={handleProductChange}>
        <SelectTrigger className="w-full sm:w-[220px]">
          <SelectValue placeholder={t('filters.product')}>
            {currentProductId === 'all'
              ? t('filters.allProducts')
              : products.find((product) => product.id === currentProductId)
                  ?.name}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all" label={t('filters.allProducts')}>
            {t('filters.allProducts')}
          </SelectItem>
          {products.map((product) => (
            <SelectItem
              key={product.id}
              value={product.id}
              label={product.name}
            >
              {product.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={currentState} onValueChange={handleStateChange}>
        <SelectTrigger className="w-full sm:w-[190px]">
          <SelectValue placeholder={t('filters.state')}>
            {currentState === 'all'
              ? t('filters.allStates')
              : t(`states.${currentState}`)}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all" label={t('filters.allStates')}>
            {t('filters.allStates')}
          </SelectItem>
          {INVENTORY_STATE_OPTIONS.map((state) => (
            <SelectItem key={state} value={state} label={t(`states.${state}`)}>
              {t(`states.${state}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};
