'use client';

import { useMemo, useState } from 'react';

import { useTranslations } from 'next-intl';

import {
  Button,
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from '@louez/ui';
import { CheckIcon, PlusIcon } from '@louez/ui/icons';
import { cn, formatCurrency } from '@louez/utils';

import { ProductImage } from '@/components/product/product-image';
import { SearchInput } from '@/components/ui/search-input';

interface AccessoryOption {
  id: string;
  name: string;
  price: string;
  images: string[] | null;
}

interface AccessoriesPickerDialogProps {
  options: AccessoryOption[];
  selectedIds: string[];
  onToggle: (productId: string) => void;
  currency: string;
  disabled?: boolean;
}

/**
 * Catalog picker for product accessories. Selected products stay in the list
 * with a checked row instead of disappearing, so adding several in a row never
 * makes the list jump under the cursor and a mis-click is undone on the spot.
 */
export const AccessoriesPickerDialog = ({
  options,
  selectedIds,
  onToggle,
  currency,
  disabled = false,
}: AccessoriesPickerDialogProps) => {
  const t = useTranslations('dashboard.products.form');
  const tCommon = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  // Links pointing at a product that left the catalog are invisible here, so
  // the footer only counts what the list can actually show.
  const selectedCount = useMemo(
    () => options.filter((option) => selected.has(option.id)).length,
    [options, selected],
  );

  const filteredOptions = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return options;
    return options.filter((option) => option.name.toLowerCase().includes(query));
  }, [options, search]);

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) setSearch('');
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button
            type="button"
            variant="outline"
            className="w-full border-dashed"
            disabled={disabled || options.length === 0}
          />
        }
      >
        <PlusIcon />
        {t('addAccessory')}
      </DialogTrigger>

      <DialogPopup className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('selectAccessories')}</DialogTitle>
          <DialogDescription>{t('selectAccessoriesDescription')}</DialogDescription>
          <SearchInput
            groupClassName="mt-2"
            placeholder={t('searchProducts')}
            clearLabel={t('clearSearch')}
            enableShortcut={false}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onClear={() => setSearch('')}
          />
        </DialogHeader>

        <DialogPanel className="px-4">
          {filteredOptions.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center text-sm">
              {search ? t('noProductsFound') : t('noProductsAvailable')}
            </p>
          ) : (
            <ul className="space-y-0.5">
              {filteredOptions.map((option) => {
                const isSelected = selected.has(option.id);

                return (
                  <li key={option.id}>
                    <button
                      type="button"
                      aria-pressed={isSelected}
                      disabled={disabled}
                      onClick={() => onToggle(option.id)}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors',
                        'hover:bg-muted focus-visible:ring-ring/50 focus-visible:ring-1 focus-visible:outline-none',
                        'disabled:pointer-events-none disabled:opacity-64',
                        isSelected && 'bg-muted/64',
                      )}
                    >
                      <ProductImage
                        src={option.images?.[0]}
                        alt={option.name}
                        sizes="36px"
                        containerClassName="aspect-square size-9 shrink-0 rounded-md"
                      />

                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {option.name}
                      </span>

                      <span className="text-muted-foreground shrink-0 text-sm tabular-nums">
                        {formatCurrency(parseFloat(option.price), currency)}
                      </span>

                      <span
                        aria-hidden
                        className={cn(
                          'flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors',
                          isSelected
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-input text-transparent',
                        )}
                      >
                        <CheckIcon className="size-3" />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </DialogPanel>

        <DialogFooter className="sm:justify-between">
          <p className="text-muted-foreground self-center text-sm max-sm:text-center">
            {t('accessoriesSelectedCount', { count: selectedCount })}
          </p>
          <Button type="button" onClick={() => handleOpenChange(false)}>
            {tCommon('done')}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
};
