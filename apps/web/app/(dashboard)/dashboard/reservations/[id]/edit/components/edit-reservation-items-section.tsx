'use client';

import { useEffect, useRef, useState } from 'react';

import {
  AlertTriangle,
  Check,
  ChevronsUpDown,
  Lock,
  Minus,
  Package,
  PenLine,
  Plus,
  Trash2,
  Unlock,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { PricingMode } from '@louez/types';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@louez/ui';
import { cn } from '@louez/utils';

import type {
  AvailabilityWarning,
  Product,
  ReservationCalculations,
} from '../types';

interface EditReservationItemsSectionProps {
  calculations: ReservationCalculations;
  availabilityWarnings: AvailabilityWarning[];
  availableToAdd: Product[];
  itemsCount: number;
  currencySymbol: string;
  getDurationUnit: (mode: PricingMode) => string;
  onOpenCustomItemDialog: () => void;
  onAddProduct: (productId: string) => void;
  onQuantityChange: (itemId: string, quantity: number) => void;
  onPriceChange: (
    itemId: string,
    price: number,
    pricingMode?: PricingMode,
  ) => void;
  onTotalPriceChange: (
    itemId: string,
    totalPrice: number,
    pricingMode?: PricingMode,
  ) => void;
  onToggleManualPrice: (
    itemId: string,
    effectiveUnitPrice?: number,
    pricingMode?: PricingMode,
  ) => void;
  onRemoveItem: (itemId: string) => void;
}

function PriceInput({
  value,
  onChange,
  disabled,
  isManual,
  suffix,
  ariaLabel,
  autoFocus,
  revertValue,
  onCommit,
  onCancel,
}: {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  isManual?: boolean;
  suffix: string;
  ariaLabel: string;
  autoFocus?: boolean;
  revertValue?: number;
  onCommit?: () => void;
  onCancel?: () => void;
}) {
  const [localValue, setLocalValue] = useState(value.toFixed(2));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (document.activeElement !== inputRef.current) {
      setLocalValue(value.toFixed(2));
    }
  }, [value]);

  return (
    <div className="relative">
      <Input
        ref={inputRef}
        inputMode="decimal"
        value={localValue}
        onChange={(event) => {
          const raw = event.target.value;
          if (raw === '' || /^\d*[.,]?\d{0,2}$/.test(raw)) {
            setLocalValue(raw);
            const parsed = parseFloat(raw.replace(',', '.'));
            if (!Number.isNaN(parsed)) {
              onChange(parsed);
            }
          }
        }}
        onBlur={() => {
          const parsed = parseFloat(localValue.replace(',', '.'));
          const final = Number.isNaN(parsed) ? 0 : parsed;
          setLocalValue(final.toFixed(2));
          onChange(final);
          onCommit?.();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            const resetValue = revertValue ?? value;
            setLocalValue(resetValue.toFixed(2));
            onChange(resetValue);
            onCancel?.();
            return;
          }

          if (event.key === 'Enter') {
            event.preventDefault();
            const parsed = parseFloat(localValue.replace(',', '.'));
            const final = Number.isNaN(parsed) ? 0 : parsed;
            setLocalValue(final.toFixed(2));
            onChange(final);
            onCommit?.();
          }
        }}
        disabled={disabled}
        aria-label={ariaLabel}
        autoFocus={autoFocus}
        className={cn(
          'h-8 w-28 [appearance:textfield] pr-8 text-right tabular-nums [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
          isManual && 'border-amber-300 bg-amber-50 dark:bg-amber-950/20',
        )}
      />
      <span
        className="text-muted-foreground pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs select-none"
        aria-hidden="true"
      >
        {suffix}
      </span>
    </div>
  );
}

function TotalPriceEditor({
  value,
  savings,
  isManual,
  currencySymbol,
  ariaLabel,
  onChange,
}: {
  value: number;
  savings: number;
  isManual?: boolean;
  currencySymbol: string;
  ariaLabel: string;
  onChange: (value: number) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editStartValue, setEditStartValue] = useState(value);

  if (isEditing) {
    return (
      <div className="relative flex w-32 justify-end">
        <PriceInput
          value={value}
          onChange={onChange}
          isManual={isManual}
          suffix={currencySymbol}
          ariaLabel={ariaLabel}
          autoFocus
          revertValue={editStartValue}
          onCommit={() => setIsEditing(false)}
          onCancel={() => setIsEditing(false)}
        />
      </div>
    );
  }

  return (
    <div className="flex w-32 items-start justify-end gap-1">
      <div className="min-w-0 text-right">
        <p className="font-semibold tabular-nums">
          {value.toFixed(2)}
          {currencySymbol}
        </p>
        {savings > 0 && !isManual && (
          <p className="text-[10px] text-emerald-600">
            -{savings.toFixed(2)}
            {currencySymbol}
          </p>
        )}
      </div>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="text-muted-foreground h-7 w-7 shrink-0"
              onClick={() => {
                setEditStartValue(value);
                setIsEditing(true);
              }}
            />
          }
        >
          <PenLine className="h-3.5 w-3.5" />
        </TooltipTrigger>
        <TooltipContent>{ariaLabel}</TooltipContent>
      </Tooltip>
    </div>
  );
}

function ProductAddCombobox({
  products,
  onAddProduct,
  placeholder,
  searchPlaceholder,
  emptyLabel,
}: {
  products: Product[];
  onAddProduct: (productId: string) => void;
  placeholder: string;
  searchPlaceholder: string;
  emptyLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredProducts = products.filter((product) =>
    product.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="h-9 w-[220px] justify-between"
          />
        }
      >
        <span className="flex min-w-0 items-center gap-2">
          <Plus className="h-4 w-4 shrink-0" />
          <span className="truncate">{placeholder}</span>
        </span>
        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent className="w-[360px] p-0 pt-2 *:p-0" align="end">
        <Command open items={filteredProducts} filter={null}>
          <CommandInput
            placeholder={searchPlaceholder}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
          <CommandEmpty>{emptyLabel}</CommandEmpty>
          <CommandList className="max-h-[320px]">
            <CommandGroup>
              {filteredProducts.map((product) => (
                <CommandItem
                  key={product.id}
                  value={product.id}
                  onClick={() => {
                    onAddProduct(product.id);
                    setOpen(false);
                    setSearchQuery('');
                  }}
                  className="flex items-center gap-2"
                >
                  <Package className="text-muted-foreground h-4 w-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">
                    {product.name}
                  </span>
                  <Check className="h-4 w-4 shrink-0 opacity-0" />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function EditReservationItemsSection({
  calculations,
  availabilityWarnings,
  availableToAdd,
  itemsCount,
  currencySymbol,
  getDurationUnit,
  onOpenCustomItemDialog,
  onAddProduct,
  onQuantityChange,
  onPriceChange,
  onTotalPriceChange,
  onToggleManualPrice,
  onRemoveItem,
}: EditReservationItemsSectionProps) {
  const t = useTranslations('dashboard.reservations');
  const tForm = useTranslations('dashboard.reservations.manualForm');
  const tCommon = useTranslations('common');

  return (
    <Card>
      <CardContent className="p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-muted-foreground text-sm font-medium">
            {t('edit.items')}
          </h2>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={onOpenCustomItemDialog}>
              <PenLine className="mr-2 h-4 w-4" />
              {tForm('customItem.button')}
            </Button>
            {availableToAdd.length > 0 && (
              <ProductAddCombobox
                products={availableToAdd}
                onAddProduct={onAddProduct}
                placeholder={t('edit.addItem')}
                searchPlaceholder={t('edit.searchProductsPlaceholder', {
                  count: availableToAdd.length,
                })}
                emptyLabel={t('edit.noProductsFound')}
              />
            )}
          </div>
        </div>

        <div className="space-y-3">
          {calculations.items.map((item) => {
            const hasWarning = availabilityWarnings.some(
              (warning) => warning.productId === item.productId,
            );

            return (
              <div
                key={item.id}
                className={cn(
                  'bg-background rounded-lg border p-4 transition-colors',
                  hasWarning &&
                    'border-amber-300 bg-amber-50/50 dark:border-amber-700 dark:bg-amber-950/20',
                )}
              >
                <div className="space-y-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-medium">
                        {item.productSnapshot.name}
                      </p>
                      {!item.product && (
                        <Badge
                          variant="outline"
                          className="shrink-0 text-[10px]"
                        >
                          {tForm('customItem.badge')}
                        </Badge>
                      )}
                      {item.isManualPrice && item.product && (
                        <Badge
                          variant="outline"
                          className="shrink-0 border-amber-300 text-[10px] text-amber-600"
                        >
                          Manuel
                        </Badge>
                      )}
                    </div>
                    {item.tierLabel && !item.isManualPrice && (
                      <p className="mt-0.5 text-xs text-emerald-600">
                        {item.tierLabel}
                      </p>
                    )}
                    {hasWarning && (
                      <p className="mt-1 flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                        <AlertTriangle className="h-3 w-3" />
                        {tForm('warnings.insufficientStock')}
                      </p>
                    )}
                  </div>
                  <div className="flex items-start gap-4">
                    <div
                      className="flex items-center gap-1"
                      role="group"
                      aria-label={`${t('edit.qty')}, ${item.productSnapshot.name}`}
                    >
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() =>
                          onQuantityChange(item.id, item.quantity - 1)
                        }
                        disabled={item.quantity <= 1}
                        aria-label={`${t('edit.qty')} −1`}
                      >
                        <Minus className="h-3 w-3" />
                      </Button>
                      <Input
                        type="number"
                        min="1"
                        value={item.quantity}
                        onChange={(event) =>
                          onQuantityChange(
                            item.id,
                            parseInt(event.target.value) || 1,
                          )
                        }
                        aria-label={t('edit.qty')}
                        className="h-8 w-14 [appearance:textfield] text-center tabular-nums [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      />
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() =>
                          onQuantityChange(item.id, item.quantity + 1)
                        }
                        aria-label={`${t('edit.qty')} +1`}
                      >
                        <Plus className="h-3 w-3" />
                      </Button>
                    </div>

                    <div className="flex items-center gap-1">
                      <PriceInput
                        value={
                          item.isManualPrice
                            ? item.unitPrice
                            : item.effectiveUnitPrice
                        }
                        onChange={(price) =>
                          onPriceChange(item.id, price, item.displayPricingMode)
                        }
                        isManual={item.isManualPrice}
                        suffix={`${currencySymbol}/${getDurationUnit(item.displayPricingMode)}`}
                        ariaLabel={`${t('edit.unitPrice')}, ${item.productSnapshot.name}`}
                      />
                      {item.product && (
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() =>
                                  onToggleManualPrice(
                                    item.id,
                                    item.effectiveUnitPrice,
                                    item.displayPricingMode,
                                  )
                                }
                              />
                            }
                          >
                            {item.isManualPrice ? (
                              <Lock className="h-3.5 w-3.5 text-amber-600" />
                            ) : (
                              <Unlock className="text-muted-foreground h-3.5 w-3.5" />
                            )}
                          </TooltipTrigger>
                          <TooltipContent>
                            {item.isManualPrice
                              ? t('edit.unlockPrice')
                              : t('edit.lockPrice')}
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>

                    <TotalPriceEditor
                      value={item.totalPrice}
                      savings={item.savings}
                      isManual={item.isManualPrice}
                      currencySymbol={currencySymbol}
                      onChange={(totalPrice) =>
                        onTotalPriceChange(
                          item.id,
                          totalPrice,
                          item.displayPricingMode,
                        )
                      }
                      ariaLabel={`${tForm('customItem.totalPrice')}, ${item.productSnapshot.name}`}
                    />

                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-muted-foreground hover:text-destructive ml-auto h-8 w-8"
                            onClick={() => onRemoveItem(item.id)}
                            disabled={itemsCount <= 1}
                          />
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                      </TooltipTrigger>
                      <TooltipContent>{tCommon('delete')}</TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
