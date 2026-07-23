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
}

export function CustomersFilters({ totalCount }: CustomersFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations('dashboard.customers');
  const tCommon = useTranslations('common');

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

        <Button
          render={<Link href="/dashboard/customers/new?source=customers_page" />}
        >
          <Plus className="mr-2 h-4 w-4" />
          {tCommon('add')}
        </Button>
      </div>
    </div>
  );
}
