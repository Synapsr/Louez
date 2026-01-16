'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Search, Plus, Users } from 'lucide-react'
import { useDebouncedCallback } from 'use-debounce'

import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import Link from 'next/link'

interface CustomersFiltersProps {
  totalCount: number
}

export function CustomersFilters({ totalCount }: CustomersFiltersProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const t = useTranslations('dashboard.customers')
  const tCommon = useTranslations('common')

  const handleSearch = useDebouncedCallback((term: string) => {
    const params = new URLSearchParams(searchParams)
    if (term) {
      params.set('search', term)
    } else {
      params.delete('search')
    }
    router.push(`?${params.toString()}`)
  }, 300)

  const handleSortChange = (value: string) => {
    const params = new URLSearchParams(searchParams)
    if (value && value !== 'recent') {
      params.set('sort', value)
    } else {
      params.delete('sort')
    }
    router.push(`?${params.toString()}`)
  }

  const handleTypeChange = (value: string) => {
    const params = new URLSearchParams(searchParams)
    if (value && value !== 'all') {
      params.set('type', value)
    } else {
      params.delete('type')
    }
    router.push(`?${params.toString()}`)
  }

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Users className="h-4 w-4" />
        <span className="text-sm">{t('customerCount', { count: totalCount })}</span>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t('searchCustomers')}
            className="pl-9 w-full sm:w-[250px]"
            defaultValue={searchParams.get('search') || ''}
            onChange={(e) => handleSearch(e.target.value)}
          />
        </div>

        <Select
          defaultValue={searchParams.get('type') || 'all'}
          onValueChange={handleTypeChange}
        >
          <SelectTrigger className="w-full sm:w-[150px]">
            <SelectValue placeholder={t('filter.type')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('filter.all')}</SelectItem>
            <SelectItem value="individual">{t('customerType.individual')}</SelectItem>
            <SelectItem value="business">{t('customerType.business')}</SelectItem>
          </SelectContent>
        </Select>

        <Select
          defaultValue={searchParams.get('sort') || 'recent'}
          onValueChange={handleSortChange}
        >
          <SelectTrigger className="w-full sm:w-[180px]">
            <SelectValue placeholder={t('sort.sortBy')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="recent">{t('sort.recent')}</SelectItem>
            <SelectItem value="name">{t('sort.name')}</SelectItem>
            <SelectItem value="reservations">{t('sort.reservations')}</SelectItem>
            <SelectItem value="spent">{t('sort.spent')}</SelectItem>
          </SelectContent>
        </Select>

        <Button asChild>
          <Link href="/dashboard/customers/new">
            <Plus className="mr-2 h-4 w-4" />
            {tCommon('add')}
          </Link>
        </Button>
      </div>
    </div>
  )
}
