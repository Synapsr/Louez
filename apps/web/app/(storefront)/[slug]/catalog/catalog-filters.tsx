'use client';

import { useRouter, useSearchParams } from 'next/navigation';

import { Search, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useDebouncedCallback } from 'use-debounce';

import { Input } from '@louez/ui';
import { Button } from '@louez/ui';
import { cn } from '@louez/utils';

import { useStorefrontUrl } from '@/hooks/use-storefront-url';

interface Category {
  id: string;
  name: string;
}

interface CatalogFiltersProps {
  storeSlug: string;
  categories: Category[];
  activeCategoryId?: string;
  searchTerm?: string;
}

export function CatalogFilters({
  storeSlug,
  categories,
  activeCategoryId,
  searchTerm,
}: CatalogFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations('storefront.catalog');
  const { getUrl } = useStorefrontUrl(storeSlug);

  const handleSearch = useDebouncedCallback((term: string) => {
    const params = new URLSearchParams(searchParams);
    if (term) {
      params.set('search', term);
    } else {
      params.delete('search');
    }
    router.push(`${getUrl('/catalog')}?${params.toString()}`);
  }, 300);

  const handleCategoryClick = (categoryId?: string) => {
    const params = new URLSearchParams(searchParams);
    if (categoryId) {
      params.set('category', categoryId);
    } else {
      params.delete('category');
    }
    params.delete('search');
    router.push(`${getUrl('/catalog')}?${params.toString()}`);
  };

  const clearFilters = () => {
    router.push(getUrl('/catalog'));
  };

  const hasFilters = activeCategoryId || searchTerm;

  return (
    <div className="space-y-6">
      {/* Search */}
      <div>
        <label className="mb-2 block text-sm font-medium">{t('search')}</label>
        <div className="relative">
          <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <Input
            placeholder={t('searchPlaceholder')}
            defaultValue={searchTerm || ''}
            onChange={(e) => handleSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Categories */}
      <div>
        <label className="mb-2 block text-sm font-medium">
          {t('categories')}
        </label>
        <div className="space-y-1">
          <button
            onClick={() => handleCategoryClick()}
            className={cn(
              'w-full rounded-lg px-3 py-2 text-left text-sm transition-colors',
              !activeCategoryId
                ? 'bg-primary text-primary-foreground'
                : 'hover:bg-muted',
            )}
          >
            {t('allProducts')}
          </button>
          {categories.map((category) => (
            <button
              key={category.id}
              onClick={() => handleCategoryClick(category.id)}
              className={cn(
                'w-full rounded-lg px-3 py-2 text-left text-sm transition-colors',
                activeCategoryId === category.id
                  ? 'bg-primary text-primary-foreground'
                  : 'hover:bg-muted',
              )}
            >
              {category.name}
            </button>
          ))}
        </div>
      </div>

      {/* Clear Filters */}
      {hasFilters && (
        <Button variant="outline" onClick={clearFilters} className="w-full">
          <X className="mr-2 h-4 w-4" />
          {t('clearFilters')}
        </Button>
      )}
    </div>
  );
}
