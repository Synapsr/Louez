'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback } from 'react'
import { useTranslations } from 'next-intl'

import { Button } from '@louez/ui'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@louez/ui'
import { Badge } from '@louez/ui'

interface Category {
  id: string
  name: string
}

interface ProductCounts {
  all: number
  active: number
  draft: number
  archived: number
}

interface ProductsFiltersProps {
  categories: Category[]
  counts: ProductCounts
  currentStatus?: string
  currentCategory?: string
}

export function ProductsFilters({
  categories,
  counts,
  currentStatus = 'all',
  currentCategory = 'all',
}: ProductsFiltersProps) {
  const t = useTranslations('dashboard.products')
  const router = useRouter()
  const searchParams = useSearchParams()

  const STATUS_OPTIONS = [
    { value: 'all', label: t('filters.all') },
    { value: 'active', label: t('filters.active') },
    { value: 'draft', label: t('filters.draft') },
    { value: 'archived', label: t('filters.archived') },
  ]

  const createQueryString = useCallback(
    (name: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString())
      if (value === 'all') {
        params.delete(name)
      } else {
        params.set(name, value)
      }
      return params.toString()
    },
    [searchParams]
  )

  const handleStatusChange = (value: string) => {
    router.push(`/dashboard/products?${createQueryString('status', value)}`)
  }

  const handleCategoryChange = (value: string | null) => {
    if (value === null) return
    router.push(`/dashboard/products?${createQueryString('category', value)}`)
  }

  return (
    <div className="flex flex-wrap items-center gap-4">
      {/* Status Tabs */}
      <div className="flex items-center gap-1 rounded-lg border bg-muted/50 p-1">
        {STATUS_OPTIONS.map((option) => {
          const count =
            option.value === 'all'
              ? counts.all
              : counts[option.value as keyof Omit<ProductCounts, 'all'>]
          const isActive = currentStatus === option.value

          return (
            <Button
              key={option.value}
              variant={isActive ? 'secondary' : 'ghost'}
              className="gap-2"
              onClick={() => handleStatusChange(option.value)}
            >
              {option.label}
              <Badge
                variant={isActive ? 'default' : 'secondary'}
                className="ml-1 h-5 min-w-5 px-1.5"
              >
                {count}
              </Badge>
            </Button>
          )
        })}
      </div>

      {/* Category Filter */}
      {categories.length > 0 && (
        <Select value={currentCategory} onValueChange={handleCategoryChange}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder={t('category')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('allCategories')}</SelectItem>
            {categories.map((category) => (
              <SelectItem key={category.id} value={category.id}>
                {category.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  )
}
