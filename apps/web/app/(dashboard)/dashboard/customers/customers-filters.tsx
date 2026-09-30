'use client';

import { useEffect, useState } from 'react';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

import { Plus, Users } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
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

import { CustomersActiveFilters } from './customers-active-filters';
import { CustomersMoreFilters } from './customers-more-filters';

interface CustomersFiltersProps {
  totalCount: number;
  /** Customers matching the filters, shown instead of the total once something narrows the list. */
  filteredCount?: number | null;
  /** Landing demos: filters held in local state instead of the URL. */
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

const MORE_FILTER_KEYS = ['source', 'channel', 'createdFrom', 'createdTo'] as const;

export const CustomersFilters = ({
  totalCount,
  filteredCount = null,
  localFilters,
  readOnly = false,
}: CustomersFiltersProps) => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations('dashboard.customers');
  const tCommon = useTranslations('common');
  const format = useFormatter();

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
    params.delete('page');
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
    params.delete('page');
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
    params.delete('page');
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
    params.delete('page');
    router.push(`?${params.toString()}`);
  };

  const moreFilters = {
    source: searchParams.get('source') ?? '',
    channel: searchParams.get('channel') ?? '',
    createdFrom: searchParams.get('createdFrom') ?? '',
    createdTo: searchParams.get('createdTo') ?? '',
  };

  const setParams = (changes: Record<string, string>) => {
    const params = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(changes)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    params.delete('page');
    router.push(`?${params.toString()}`);
  };

  const formatDay = (day: string) =>
    format.dateTime(new Date(`${day}T00:00:00`), { dateStyle: 'medium' });

  const activeFilters = [
    moreFilters.createdFrom && {
      key: 'createdFrom',
      label: t('filter.from', { date: formatDay(moreFilters.createdFrom) }),
    },
    moreFilters.createdTo && {
      key: 'createdTo',
      label: t('filter.to', { date: formatDay(moreFilters.createdTo) }),
    },
    moreFilters.source && { key: 'source', label: t(`sources.${moreFilters.source}`) },
    moreFilters.channel && { key: 'channel', label: t(`channels.${moreFilters.channel}`) },
  ].filter((filter): filter is { key: string; label: string } => Boolean(filter));

  return (
    <div className="space-y-3">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-muted-foreground flex items-center gap-2">
        <Users className="h-4 w-4" />
        <span className="text-sm">
          {t('customerCount', { count: filteredCount ?? totalCount })}
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

        {/* The advanced filters live in the URL: the landing demos keep to search, type and sort. */}
        {!localFilters && <CustomersMoreFilters value={moreFilters} onChange={setParams} />}

        <Button
          disabled={readOnly}
          render={readOnly ? undefined : <Link href="/dashboard/customers/new?source=customers_page" />}
        >
          <Plus className="mr-2 h-4 w-4" />
          {tCommon('add')}
        </Button>
      </div>
    </div>
    {!localFilters && (
      <CustomersActiveFilters
        filters={activeFilters}
        onRemove={(key) => setParams({ [key]: '' })}
        onReset={() => setParams(Object.fromEntries(MORE_FILTER_KEYS.map((key) => [key, ''])))}
      />
    )}
    </div>
  );
}
