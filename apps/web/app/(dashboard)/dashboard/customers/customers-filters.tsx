'use client';

import { useEffect, useState } from 'react';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

import { Plus, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useDebouncedCallback } from 'use-debounce';

import { Button } from '@louez/ui';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@louez/ui';

import { SearchInput } from '@/components/ui/search-input';

interface CustomersFiltersProps {
  totalCount: number;
  localFilters?: {
    value: CustomersFilterValue;
    onChange: (value: CustomersFilterValue) => void;
  };
  readOnly?: boolean;
}

export type CustomersFilterValue = {
  search: string;
  type: string;
  sort: string;
};

export const CustomersFilters = ({ totalCount, localFilters, readOnly = false }: CustomersFiltersProps) => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations('dashboard.customers');
  const tCommon = useTranslations('common');

  const currentType = localFilters?.value.type ?? (searchParams.get('type') || 'all');
  const currentSort = localFilters?.value.sort ?? (searchParams.get('sort') || 'recent');
  const currentSearch = localFilters?.value.search ?? (searchParams.get('search') || '');
  const [searchQuery, setSearchQuery] = useState(currentSearch);

  useEffect(() => {
    setSearchQuery(currentSearch);
  }, [currentSearch]);

  const typeOptions = [
    { value: 'all', label: t('filter.all') },
    { value: 'individual', label: t('customerType.individual') },
    { value: 'business', label: t('customerType.business') },
  ];

  const sortOptions = [
    { value: 'recent', label: t('sort.recent') },
    { value: 'name', label: t('sort.name') },
    { value: 'reservations', label: t('sort.reservations') },
    { value: 'spent', label: t('sort.spent') },
  ];

  const handleSearch = useDebouncedCallback((term: string) => {
    const params = new URLSearchParams(searchParams);
    if (term) {
      params.set('search', term);
    } else {
      params.delete('search');
    }
    router.push(`?${params.toString()}`);
  }, 300);

  const updateSearchQuery = (term: string) => {
    if (localFilters) {
      localFilters.onChange({ ...localFilters.value, search: term });
      return;
    }
    setSearchQuery(term);
    handleSearch(term);
  };

  const clearSearchQuery = () => {
    if (localFilters) {
      localFilters.onChange({ ...localFilters.value, search: '' });
      return;
    }
    setSearchQuery('');
    handleSearch.cancel();

    const params = new URLSearchParams(searchParams);
    params.delete('search');
    router.push(`?${params.toString()}`);
  };

  const handleSortChange = (value: string | null) => {
    if (value === null) return;
    if (localFilters) {
      localFilters.onChange({ ...localFilters.value, sort: value });
      return;
    }
    const params = new URLSearchParams(searchParams);
    if (value && value !== 'recent') {
      params.set('sort', value);
    } else {
      params.delete('sort');
    }
    router.push(`?${params.toString()}`);
  };

  const handleTypeChange = (value: string | null) => {
    if (value === null) return;
    if (localFilters) {
      localFilters.onChange({ ...localFilters.value, type: value });
      return;
    }
    const params = new URLSearchParams(searchParams);
    if (value && value !== 'all') {
      params.set('type', value);
    } else {
      params.delete('type');
    }
    router.push(`?${params.toString()}`);
  };

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-muted-foreground flex items-center gap-2">
        <Users className="h-4 w-4" />
        <span className="text-sm">
          {t('customerCount', { count: totalCount })}
        </span>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div
          className="relative"
          onClickCapture={(event) => {
            // The shared search addons focus the input on click. Keep local previews focus-free.
            if (!readOnly || !(event.target instanceof Element)) return;
            if (!event.target.closest('[data-slot="input-group-addon"]')) return;
            event.preventDefault();
            event.stopPropagation();
            if (event.target.closest('button')) clearSearchQuery();
          }}
        >
          <SearchInput
            data-demo-target="customers-search"
            autoFocus={false}
            enableShortcut={!readOnly}
            placeholder={t('searchCustomers')}
            groupClassName="w-full sm:w-[250px]"
            value={localFilters ? currentSearch : searchQuery}
            onChange={(event) => updateSearchQuery(event.target.value)}
            onClear={clearSearchQuery}
            clearLabel={t('clearSearch')}
          />
        </div>

        <Select
          modal={!readOnly}
          value={currentType}
          onValueChange={handleTypeChange}
        >
          <SelectTrigger className="w-full sm:w-[150px]">
            <SelectValue placeholder={t('filter.type')}>
              {typeOptions.find((o) => o.value === currentType)?.label}
            </SelectValue>
          </SelectTrigger>
          <SelectContent finalFocus={readOnly ? false : undefined}>
            {typeOptions.map((option) => (
              <SelectItem key={option.value} value={option.value} label={option.label}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          modal={!readOnly}
          value={currentSort}
          onValueChange={handleSortChange}
        >
          <SelectTrigger className="w-full sm:w-[180px]">
            <SelectValue placeholder={t('sort.sortBy')}>
              {sortOptions.find((o) => o.value === currentSort)?.label}
            </SelectValue>
          </SelectTrigger>
          <SelectContent finalFocus={readOnly ? false : undefined}>
            {sortOptions.map((option) => (
              <SelectItem key={option.value} value={option.value} label={option.label}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          disabled={readOnly}
          render={readOnly ? undefined : <Link href="/dashboard/customers/new?source=customers_page" />}
        >
          <Plus className="mr-2 h-4 w-4" />
          {tCommon('add')}
        </Button>
      </div>
    </div>
  );
}
