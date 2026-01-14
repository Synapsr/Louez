'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Search, X } from 'lucide-react'
import { useDebouncedCallback } from 'use-debounce'

import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface Category {
  id: string
  name: string
}

interface CatalogFiltersProps {
  storeSlug: string
  categories: Category[]
  activeCategoryId?: string
  searchTerm?: string
}

export function CatalogFilters({
  storeSlug,
  categories,
  activeCategoryId,
  searchTerm,
}: CatalogFiltersProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const t = useTranslations('storefront.catalog')

  const handleSearch = useDebouncedCallback((term: string) => {
    const params = new URLSearchParams(searchParams)
    if (term) {
      params.set('search', term)
    } else {
      params.delete('search')
    }
    router.push(`/${storeSlug}/catalog?${params.toString()}`)
  }, 300)

  const handleCategoryClick = (categoryId?: string) => {
    const params = new URLSearchParams(searchParams)
    if (categoryId) {
      params.set('category', categoryId)
    } else {
      params.delete('category')
    }
    params.delete('search')
    router.push(`/${storeSlug}/catalog?${params.toString()}`)
  }

  const clearFilters = () => {
    router.push(`/${storeSlug}/catalog`)
  }

  const hasFilters = activeCategoryId || searchTerm

  return (
    <div className="space-y-6">
      {/* Search */}
      <div>
        <label className="text-sm font-medium mb-2 block">{t('search')}</label>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t('searchPlaceholder')}
            className="pl-9"
            defaultValue={searchTerm || ''}
            onChange={(e) => handleSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Categories */}
      <div>
        <label className="text-sm font-medium mb-2 block">{t('categories')}</label>
        <div className="space-y-1">
          <button
            onClick={() => handleCategoryClick()}
            className={cn(
              'w-full text-left px-3 py-2 rounded-lg text-sm transition-colors',
              !activeCategoryId
                ? 'bg-primary text-primary-foreground'
                : 'hover:bg-muted'
            )}
          >
            {t('allProducts')}
          </button>
          {categories.map((category) => (
            <button
              key={category.id}
              onClick={() => handleCategoryClick(category.id)}
              className={cn(
                'w-full text-left px-3 py-2 rounded-lg text-sm transition-colors',
                activeCategoryId === category.id
                  ? 'bg-primary text-primary-foreground'
                  : 'hover:bg-muted'
              )}
            >
              {category.name}
            </button>
          ))}
        </div>
      </div>

      {/* Clear Filters */}
      {hasFilters && (
        <Button
          variant="outline"
          size="sm"
          onClick={clearFilters}
          className="w-full"
        >
          <X className="mr-2 h-4 w-4" />
          {t('clearFilters')}
        </Button>
      )}
    </div>
  )
}
