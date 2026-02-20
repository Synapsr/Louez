'use client';

import { useEffect, useRef, useState } from 'react';

import {
  AlertTriangle,
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
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
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
  onPriceChange: (itemId: string, price: number) => void;
  onToggleManualPrice: (itemId: string) => void;
  onRemoveItem: (itemId: string) => void;
}

function PriceInput({
  value,
  onChange,
  disabled,
  isManual,
  suffix,
  ariaLabel,
}: {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  isManual?: boolean;
  suffix: string;
  ariaLabel: string;
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
        }}
        disabled={disabled}
        aria-label={ariaLabel}
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
              <Select
                onValueChange={(value) => {
                  if (value !== null) onAddProduct(value as string);
                }}
              >
                <SelectTrigger className="h-9 w-[160px]">
                  <Plus className="mr-2 h-4 w-4" />
                  <SelectValue placeholder={t('edit.addItem')} />
                </SelectTrigger>
                <SelectContent>
                  {availableToAdd.map((product) => (
                    <SelectItem
                      key={product.id}
                      value={product.id}
                      label={product.name}
                    >
                      <span className="flex items-center gap-2">
                        <Package className="h-3 w-3" />
                        {product.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
                <div className="flex items-start gap-4">
                  <div className="min-w-0 flex-1">
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
                      value={item.unitPrice}
                      onChange={(price) => onPriceChange(item.id, price)}
                      isManual={item.isManualPrice}
                      suffix={`${currencySymbol}/${getDurationUnit(item.pricingMode)}`}
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
                              onClick={() => onToggleManualPrice(item.id)}
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

                  <div className="w-24 text-right">
                    <p className="font-semibold">
                      {item.totalPrice.toFixed(2)}
                      {currencySymbol}
                    </p>
                  </div>

                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-muted-foreground hover:text-destructive h-8 w-8"
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
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
