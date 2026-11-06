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
  filteredCount: number | null;
}

const MORE_FILTER_KEYS = ['source', 'channel', 'createdFrom', 'createdTo', 'import'] as const;

export function CustomersFilters({ totalCount, filteredCount }: CustomersFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations('dashboard.customers');
  const tCommon = useTranslations('common');
  const format = useFormatter();

  const currentType = searchParams.get('type') || 'all';
  const currentSort = searchParams.get('sort') || 'recent';
  const currentSearch = searchParams.get('search') || '';
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
    setSearchQuery(term);
    handleSearch(term);
  };

  const clearSearchQuery = () => {
    setSearchQuery('');
    handleSearch.cancel();

    const params = new URLSearchParams(searchParams);
    params.delete('search');
    params.delete('page');
    router.push(`?${params.toString()}`);
  };

  const handleSortChange = (value: string | null) => {
    if (value === null) return;
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
    searchParams.get('import') && { key: 'import', label: t('filter.importRun') },
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
        <div className="relative">
          <SearchInput
            placeholder={t('searchCustomers')}
            groupClassName="w-full sm:w-[250px]"
            value={searchQuery}
            onChange={(event) => updateSearchQuery(event.target.value)}
            onClear={clearSearchQuery}
            clearLabel={t('clearSearch')}
          />
        </div>

        <Select
          value={currentType}
          onValueChange={handleTypeChange}
        >
          <SelectTrigger className="w-full sm:w-[150px]">
            <SelectValue placeholder={t('filter.type')}>
              {typeOptions.find((o) => o.value === currentType)?.label}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {typeOptions.map((option) => (
              <SelectItem key={option.value} value={option.value} label={option.label}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={currentSort}
          onValueChange={handleSortChange}
        >
          <SelectTrigger className="w-full sm:w-[180px]">
            <SelectValue placeholder={t('sort.sortBy')}>
              {sortOptions.find((o) => o.value === currentSort)?.label}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {sortOptions.map((option) => (
              <SelectItem key={option.value} value={option.value} label={option.label}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <CustomersMoreFilters value={moreFilters} onChange={setParams} />

        <Button
          render={<Link href="/dashboard/customers/new?source=customers_page" />}
        >
          <Plus className="mr-2 h-4 w-4" />
          {tCommon('add')}
        </Button>
      </div>
    </div>
    <CustomersActiveFilters
      filters={activeFilters}
      onRemove={(key) => setParams({ [key]: '' })}
      onReset={() => setParams(Object.fromEntries(MORE_FILTER_KEYS.map((key) => [key, ''])))}
    />
    </div>
  );
}
