'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useRouter, useSearchParams } from 'next/navigation';

import { LayoutGrid, List } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useDebouncedCallback } from 'use-debounce';

import {
  Badge,
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  ToggleGroup,
  ToggleGroupItem,
} from '@louez/ui';

import { SearchInput } from '@/components/ui/search-input';

import type { ReservationCounts } from './reservations-types';

interface ReservationsFiltersProps {
  counts: ReservationCounts;
  currentStatus?: string;
  currentPeriod?: string;
}

const STATUS_KEYS = [
  'all',
  'pending',
  'confirmed',
  'ongoing',
  'completed',
  'cancelled',
] as const;
const PERIOD_KEYS = ['all', 'today', 'thisWeek', 'thisMonth'] as const;

export const ReservationsFilters = ({
  counts,
  currentStatus = 'all',
  currentPeriod = 'all',
}: ReservationsFiltersProps) => {
  const t = useTranslations('dashboard.reservations');
  const router = useRouter();
  const searchParams = useSearchParams();

  const currentView = searchParams.get('view') || 'cards';
  const currentSearch = searchParams.get('search') || '';
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

  const navigateToSearch = useCallback(
    (term: string, mode: 'push' | 'replace' = 'push') => {
      if (term === currentSearch) {
        return;
      }

      pendingSearchParamsRef.current.add(term);
      const href = `/dashboard/reservations?${createQueryString({
        search: term || null,
        page: null,
      })}`;

      if (mode === 'replace') {
        router.replace(href);
        return;
      }

      router.push(href);
    },
    [createQueryString, currentSearch, router],
  );

  useEffect(() => {
    navigateToSearchRef.current = navigateToSearch;
  }, [navigateToSearch]);

  // Search route updates can land after newer keystrokes. Ignore values pushed
  // by this component so an older URL state cannot overwrite the local input.
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

  const handleStatusChange = (value: string) => {
    router.push(
      `/dashboard/reservations?${createQueryString({
        status: value === 'all' ? null : value,
        operation: null,
        page: null, // reset page when changing filters
      })}`,
    );
  };

  const handlePeriodChange = (value: string | null) => {
    if (value === null) return;
    router.push(
      `/dashboard/reservations?${createQueryString({
        period: value === 'all' ? null : value,
        operation: null,
        page: null,
      })}`,
    );
  };

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

  const handleViewChange = (value: string[]) => {
    const selected = value[0];
    if (!selected) return;
    router.push(
      `/dashboard/reservations?${createQueryString({
        view: selected === 'cards' ? null : selected,
      })}`,
    );
  };

  const getCount = (status: string): number => {
    if (status === 'all') return counts.all;
    return counts[status as keyof Omit<ReservationCounts, 'all'>] || 0;
  };

  const getStatusLabel = (key: string): string => {
    if (key === 'all') return t('filters.all');
    return t(`status.${key}`);
  };

  const getPeriodLabel = (key: string): string => {
    if (key === 'all') return t('allPeriods');
    return t(`filters.${key}`);
  };

  // Map period keys to URL values
  const periodUrlMap: Record<string, string> = {
    all: 'all',
    today: 'today',
    thisWeek: 'week',
    thisMonth: 'month',
  };

  // Map URL values back to keys for display
  const urlToPeriodMap: Record<string, string> = {
    all: 'all',
    today: 'today',
    week: 'thisWeek',
    month: 'thisMonth',
  };

  return (
    <div className="space-y-4">
      {/* Row 1: Status Tabs */}
      <div className="bg-muted/50 flex items-center gap-1 overflow-x-auto rounded-lg border p-1">
        {STATUS_KEYS.map((key) => {
          const count = getCount(key);
          const isActive = currentStatus === key;

          return (
            <Button
              key={key}
              variant={isActive ? 'secondary' : 'ghost'}
              className="shrink-0 gap-2"
              onClick={() => handleStatusChange(key)}
            >
              {getStatusLabel(key)}
              {key === 'pending' && count > 0 ? (
                <Badge
                  variant="default"
                  className="ml-1 h-5 min-w-5 bg-orange-500 px-1.5"
                >
                  {count}
                </Badge>
              ) : (
                <Badge
                  variant={isActive ? 'default' : 'secondary'}
                  className="ml-1 h-5 min-w-5 px-1.5"
                >
                  {count}
                </Badge>
              )}
            </Button>
          );
        })}
      </div>

      {/* Row 2: Search + Period + View Toggle */}
      <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
        {/* Search */}
        <div className="relative max-w-sm flex-1">
          <SearchInput
            value={searchQuery}
            onChange={(event) => updateSearchQuery(event.target.value)}
            onClear={clearSearchQuery}
            placeholder={t('searchReservations')}
            clearLabel={t('clearSearch')}
          />
        </div>

        {/* Period Filter */}
        <Select value={currentPeriod} onValueChange={handlePeriodChange}>
          <SelectTrigger className="w-full sm:w-[180px]">
            <SelectValue placeholder={t('period')}>
              {getPeriodLabel(urlToPeriodMap[currentPeriod] || 'all')}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {PERIOD_KEYS.map((key) => (
              <SelectItem
                key={key}
                value={periodUrlMap[key]}
                label={getPeriodLabel(key)}
              >
                {getPeriodLabel(key)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* View Toggle */}
        <ToggleGroup
          value={[currentView]}
          onValueChange={handleViewChange}
          className="hidden sm:flex"
        >
          <ToggleGroupItem value="cards" aria-label={t('viewCards')}>
            <LayoutGrid className="h-4 w-4" />
          </ToggleGroupItem>
          <ToggleGroupItem value="table" aria-label={t('viewTable')}>
            <List className="h-4 w-4" />
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
    </div>
  );
};
