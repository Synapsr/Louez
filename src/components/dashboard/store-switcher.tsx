'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { useTranslations } from 'next-intl'
import { Check, ChevronsUpDown, Plus, Shield, Building2 } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { switchStore } from '@/app/(dashboard)/dashboard/actions'

function StoreLogo({
  logoUrl,
  name,
  size = 'md',
}: {
  logoUrl: string | null
  name: string
  size?: 'sm' | 'md'
}) {
  const dimensions = size === 'sm' ? 'h-6 w-10' : 'h-8 w-12'
  const textSize = size === 'sm' ? 'text-[10px]' : 'text-sm'

  if (logoUrl) {
    return (
      <div className={cn('relative shrink-0', dimensions)}>
        <Image
          src={logoUrl}
          alt={name}
          fill
          className="object-contain object-left"
          sizes={size === 'sm' ? '40px' : '48px'}
        />
      </div>
    )
  }

  return (
    <div
      className={cn(
        'flex items-center justify-center shrink-0 rounded-md bg-primary/10 text-primary font-medium',
        size === 'sm' ? 'h-6 w-6' : 'h-8 w-8',
        textSize
      )}
    >
      {name.charAt(0).toUpperCase()}
    </div>
  )
}

interface StoreWithRole {
  id: string
  name: string
  slug: string
  logoUrl: string | null
  role: 'owner' | 'member' | 'platform_admin'
}

interface StoreSwitcherProps {
  stores: StoreWithRole[]
  currentStoreId: string
}

function RoleBadge({
  role,
  t,
}: {
  role: StoreWithRole['role']
  t: ReturnType<typeof useTranslations<'dashboard.storeSwitcher'>>
}) {
  if (role === 'platform_admin') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-500">
        <Shield className="h-3 w-3" />
        {t('roles.platform_admin')}
      </span>
    )
  }

  return (
    <span className="text-xs text-muted-foreground capitalize">
      {t(`roles.${role}`)}
    </span>
  )
}

export function StoreSwitcher({ stores, currentStoreId }: StoreSwitcherProps) {
  const t = useTranslations('dashboard.storeSwitcher')
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  const currentStore = stores.find((s) => s.id === currentStoreId)

  const handleStoreSelect = (storeId: string) => {
    if (storeId === currentStoreId) {
      setOpen(false)
      return
    }

    startTransition(async () => {
      const result = await switchStore(storeId)
      if (result.success) {
        setOpen(false)
        router.refresh()
      }
    })
  }

  const handleCreateStore = () => {
    setOpen(false)
    router.push('/onboarding?new=true')
  }

  const handleMultiStoreView = () => {
    setOpen(false)
    router.push('/multi-store')
  }

  const showMultiStore = stores.length >= 2

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          role="combobox"
          aria-expanded={open}
          aria-label={t('selectStore')}
          className="w-full justify-between px-3 py-2 h-auto"
          disabled={isPending}
        >
          <div className="flex items-center gap-3 min-w-0">
            <StoreLogo
              logoUrl={currentStore?.logoUrl || null}
              name={currentStore?.name || '?'}
              size="md"
            />
            <div className="flex flex-col items-start min-w-0">
              <span className="truncate font-medium text-sm">
                {currentStore?.name || t('selectStore')}
              </span>
              {currentStore && <RoleBadge role={currentStore.role} t={t} />}
            </div>
          </div>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[260px] p-0" align="start" sideOffset={8}>
        <Command>
          {stores.length > 5 && (
            <CommandInput placeholder={t('searchStores')} className="h-9" />
          )}
          <CommandList>
            <CommandEmpty>{t('noStoresFound')}</CommandEmpty>
            <CommandGroup heading={t('yourStores')}>
              {stores.map((store) => (
                <CommandItem
                  key={store.id}
                  value={store.id}
                  onSelect={() => handleStoreSelect(store.id)}
                  className="cursor-pointer py-2"
                >
                  <div className="mr-3">
                    <StoreLogo logoUrl={store.logoUrl} name={store.name} size="sm" />
                  </div>
                  <div className="flex flex-col flex-1 min-w-0">
                    <span className="truncate text-sm">{store.name}</span>
                    <RoleBadge role={store.role} t={t} />
                  </div>
                  {store.id === currentStoreId && (
                    <Check className="ml-2 h-4 w-4 text-primary shrink-0" />
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
            {showMultiStore && (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem
                    onSelect={handleMultiStoreView}
                    className="cursor-pointer py-2"
                  >
                    <div className="flex h-6 w-6 items-center justify-center mr-3 rounded-md bg-primary/10">
                      <Building2 className="h-3.5 w-3.5 text-primary" />
                    </div>
                    <span className="text-sm">{t('multiStoreView')}</span>
                  </CommandItem>
                </CommandGroup>
              </>
            )}
            <CommandSeparator />
            <CommandGroup>
              <CommandItem
                onSelect={handleCreateStore}
                className="cursor-pointer py-2"
              >
                <div className="flex h-6 w-6 items-center justify-center mr-3 rounded-md border border-dashed">
                  <Plus className="h-3.5 w-3.5" />
                </div>
                <span className="text-sm">{t('createNewStore')}</span>
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
