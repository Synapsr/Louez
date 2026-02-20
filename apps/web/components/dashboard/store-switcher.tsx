'use client';

import { useMemo, useState, useTransition } from 'react';

import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';

import { Building2, Check, ChevronsUpDown, Plus, Shield } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button, PopoverPopup } from '@louez/ui';
import {
  Command,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@louez/ui';
import { Popover, PopoverTrigger } from '@louez/ui';
import { cn } from '@louez/utils';

import { switchStore } from '@/app/(dashboard)/dashboard/actions';

function StoreLogo({
  logoUrl,
  name,
  size = 'md',
}: {
  logoUrl: string | null;
  name: string;
  size?: 'sm' | 'md';
}) {
  const dimensions = size === 'sm' ? 'size-6' : 'size-8';
  const textSize = size === 'sm' ? 'text-[10px]' : 'text-sm';

  if (logoUrl) {
    return (
      <div
        className={cn(
          'relative shrink-0 overflow-hidden rounded-md',
          dimensions,
        )}
      >
        <Image
          src={logoUrl}
          alt={name}
          fill
          className="object-contain object-left"
          sizes={size === 'sm' ? '40px' : '48px'}
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        'bg-primary/10 text-primary flex shrink-0 items-center justify-center rounded-md font-medium',
        size === 'sm' ? 'size-6' : 'size-8',
        textSize,
      )}
    >
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

interface StoreWithRole {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  role: 'owner' | 'member' | 'platform_admin';
}

interface StoreSwitcherProps {
  stores: StoreWithRole[];
  currentStoreId: string;
}

function getStoreSwitchDestination(pathname: string): string {
  const pathSegments = pathname.split('/').filter(Boolean);

  if (pathSegments[0] === 'onboarding') {
    return '/onboarding';
  }

  if (pathSegments[0] !== 'dashboard') {
    return '/dashboard';
  }

  const dashboardSection = pathSegments[1];
  return dashboardSection ? `/dashboard/${dashboardSection}` : '/dashboard';
}

function RoleBadge({
  role,
  t,
}: {
  role: StoreWithRole['role'];
  t: ReturnType<typeof useTranslations<'dashboard.storeSwitcher'>>;
}) {
  if (role === 'platform_admin') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-500">
        <Shield className="h-3 w-3" />
        {t('roles.platform_admin')}
      </span>
    );
  }

  return (
    <span className="text-muted-foreground text-xs capitalize">
      {t(`roles.${role}`)}
    </span>
  );
}

export function StoreSwitcher({ stores, currentStoreId }: StoreSwitcherProps) {
  const t = useTranslations('dashboard.storeSwitcher');
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isPending, startTransition] = useTransition();

  const currentStore = stores.find((s) => s.id === currentStoreId);

  const filteredStores = useMemo(() => {
    if (!searchQuery) return stores;
    const query = searchQuery.toLowerCase();
    return stores.filter((store) => store.name.toLowerCase().includes(query));
  }, [stores, searchQuery]);

  const handleStoreSelect = (storeId: string) => {
    if (storeId === currentStoreId) {
      setOpen(false);
      return;
    }

    startTransition(async () => {
      const result = await switchStore(storeId);
      if (result.success) {
        const nextPath = getStoreSwitchDestination(pathname);
        setOpen(false);
        router.replace(nextPath);
        router.refresh();
      }
    });
  };

  const handleCreateStore = () => {
    setOpen(false);
    router.push('/onboarding?new=true');
  };

  const handleMultiStoreView = () => {
    setOpen(false);
    router.push('/multi-store');
  };

  const showMultiStore = stores.length >= 2;

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setSearchQuery('');
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            role="combobox"
            aria-expanded={open}
            aria-label={t('selectStore')}
            className="h-auto w-full justify-between px-3 py-2"
            disabled={isPending}
          />
        }
      >
        <div className="flex min-w-0 items-center gap-3">
          <StoreLogo
            logoUrl={currentStore?.logoUrl || null}
            name={currentStore?.name || '?'}
            size="md"
          />
          <div className="flex min-w-0 flex-col items-start">
            <span className="w-full truncate text-sm font-medium">
              {currentStore?.name || t('selectStore')}
            </span>
            {currentStore && <RoleBadge role={currentStore.role} t={t} />}
          </div>
        </div>
        <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverPopup
        className="w-[260px] p-0 *:pt-0 *:pb-1.5"
        align="start"
        sideOffset={8}
      >
        <Command open filter={null} autoHighlight={false} keepHighlight={false}>
          {stores.length > 5 && (
            <div className="border-b py-1.5">
              <CommandInput
                placeholder={t('searchStores')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          )}
          <CommandList className="max-h-[300px]">
            {filteredStores.length === 0 && searchQuery && (
              <div className="text-muted-foreground py-6 text-center text-sm">
                {t('noStoresFound')}
              </div>
            )}
            <CommandGroup>
              <CommandGroupLabel>{t('yourStores')}</CommandGroupLabel>
              {filteredStores.map((store) => (
                <CommandItem
                  key={store.id}
                  value={store.name}
                  onClick={() => handleStoreSelect(store.id)}
                  className="cursor-pointer py-2"
                >
                  <div className="mr-3">
                    <StoreLogo logoUrl={store.logoUrl} name={store.name} />
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm">{store.name}</span>
                    <RoleBadge role={store.role} t={t} />
                  </div>
                  {store.id === currentStoreId && (
                    <Check className="text-primary ml-2 h-4 w-4 shrink-0" />
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
            {showMultiStore && (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem
                    onClick={handleMultiStoreView}
                    className="cursor-pointer py-2"
                  >
                    <div className="bg-primary/10 mr-3 flex size-6 items-center justify-center rounded-md md:size-8">
                      <Building2 className="text-primary h-4" />
                    </div>
                    <span className="text-sm">{t('multiStoreView')}</span>
                  </CommandItem>
                </CommandGroup>
              </>
            )}
            <CommandSeparator />
            <CommandGroup>
              <CommandItem
                onClick={handleCreateStore}
                className="cursor-pointer py-2"
              >
                <div className="mr-3 flex h-6 w-6 items-center justify-center rounded-md border border-dashed">
                  <Plus className="h-3.5 w-3.5" />
                </div>
                <span className="text-sm">{t('createNewStore')}</span>
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverPopup>
    </Popover>
  );
}
