'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

import { Plus, Search, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useDebouncedCallback } from 'use-debounce';

import { Input } from '@louez/ui';
import { Button } from '@louez/ui';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@louez/ui';

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
          <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <Input
            placeholder={t('searchCustomers')}
            className="w-full sm:w-[250px]"
            defaultValue={searchParams.get('search') || ''}
            onChange={(e) => handleSearch(e.target.value)}
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

        <Button render={<Link href="/dashboard/customers/new" />}>
          <Plus className="mr-2 h-4 w-4" />
          {tCommon('add')}
        </Button>
      </div>
    </div>
  );
}
