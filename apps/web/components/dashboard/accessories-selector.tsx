'use client';

import { useMemo } from 'react';

import { GripVertical, X } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@louez/ui';
import { InputQuantity, Label, Switch } from '@louez/ui';
import { formatCurrency } from '@louez/utils';
import { cn } from '@louez/utils';

import { AccessoriesPickerDialog } from '@/components/dashboard/accessories-picker-dialog';
import { ProductImage } from '@/components/product/product-image';

import type { ProductAccessoryLinkInput } from '@louez/validations';

interface Product {
  id: string;
  name: string;
  price: string;
  images: string[] | null;
}

interface AccessoriesSelectorProps {
  availableProducts: Product[];
  value: ProductAccessoryLinkInput[];
  onChange: (links: ProductAccessoryLinkInput[]) => void;
  currency?: string;
  disabled?: boolean;
}

export function AccessoriesSelector({
  availableProducts,
  value,
  onChange,
  currency = 'EUR',
  disabled = false,
}: AccessoriesSelectorProps) {
  const t = useTranslations('dashboard.products.form');

  // Pair each link with its catalog entry; links pointing at a product that is
  // no longer selectable (archived, deleted) are dropped from the display.
  const selectedLinks = useMemo(() => {
    return value.flatMap((link) => {
      const product = availableProducts.find((p) => p.id === link.accessoryId);
      return product ? [{ link, product }] : [];
    });
  }, [value, availableProducts]);

  const selectedIds = useMemo(
    () => value.map((link) => link.accessoryId),
    [value],
  );

  const handleRemove = (productId: string) => {
    onChange(value.filter((link) => link.accessoryId !== productId));
  };

  // The picker toggles a link on and off; a product added back starts from the
  // default "suggested, one per unit" link again.
  const handleToggle = (productId: string) => {
    if (value.some((link) => link.accessoryId === productId)) {
      handleRemove(productId);
      return;
    }

    onChange([...value, { accessoryId: productId, required: false, quantity: 1 }]);
  };

  const handleLinkChange = (
    productId: string,
    patch: Partial<Omit<ProductAccessoryLinkInput, 'accessoryId'>>,
  ) => {
    onChange(
      value.map((link) =>
        link.accessoryId === productId ? { ...link, ...patch } : link,
      ),
    );
  };

  const handleReorder = (fromIndex: number, toIndex: number) => {
    const reordered = [...value];
    const [removed] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, removed);
    onChange(reordered);
  };

  return (
    <div className="space-y-4">
      {/* Selected accessories */}
      {selectedLinks.length > 0 && (
        <div className="space-y-2">
          {selectedLinks.map(({ link, product }, index) => (
            <div
              key={product.id}
              className={cn(
                'bg-card rounded-lg border transition-colors',
                'hover:bg-muted/50',
              )}
            >
              <div className="flex items-center gap-3 p-3">
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground cursor-grab"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    const startY = e.clientY;
                    const startIndex = index;

                    const handleMouseMove = (moveEvent: MouseEvent) => {
                      const diff = moveEvent.clientY - startY;
                      const itemHeight = 64; // approximate height of each item
                      const indexDiff = Math.round(diff / itemHeight);
                      const newIndex = Math.max(
                        0,
                        Math.min(selectedLinks.length - 1, startIndex + indexDiff),
                      );
                      if (newIndex !== startIndex) {
                        handleReorder(startIndex, newIndex);
                      }
                    };

                    const handleMouseUp = () => {
                      document.removeEventListener('mousemove', handleMouseMove);
                      document.removeEventListener('mouseup', handleMouseUp);
                    };

                    document.addEventListener('mousemove', handleMouseMove);
                    document.addEventListener('mouseup', handleMouseUp);
                  }}
                >
                  <GripVertical className="h-4 w-4" />
                </button>

                <ProductImage
                  src={product.images?.[0]}
                  alt={product.name}
                  sizes="48px"
                  containerClassName="aspect-square h-12 w-12 shrink-0 rounded-md"
                />

                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{product.name}</p>
                  <p className="text-muted-foreground text-sm">
                    {formatCurrency(parseFloat(product.price), currency)}
                  </p>
                </div>

                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-destructive h-8 w-8 flex-shrink-0"
                  onClick={() => handleRemove(product.id)}
                  disabled={disabled}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              {/* Required accessories are booked with their parent, so the
                  quantity only makes sense once the toggle is on. */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t px-3 py-2">
                <div className="flex items-center gap-2">
                  <Switch
                    id={`accessory-required-${product.id}`}
                    checked={link.required}
                    onCheckedChange={(checked) =>
                      handleLinkChange(product.id, { required: checked })
                    }
                    disabled={disabled}
                  />
                  <Label
                    htmlFor={`accessory-required-${product.id}`}
                    className="font-normal"
                  >
                    {t('accessoryRequired')}
                  </Label>
                </div>

                {link.required ? (
                  <div className="ml-auto flex items-center gap-2">
                    <InputQuantity
                      value={link.quantity}
                      onChange={(next) =>
                        handleLinkChange(product.id, { quantity: next })
                      }
                      min={1}
                      disabled={disabled}
                      ariaLabel={t('accessoryQuantity')}
                    />
                    <span className="text-muted-foreground text-xs">
                      {t('accessoryQuantityPerUnit')}
                    </span>
                  </div>
                ) : (
                  <span className="text-muted-foreground ml-auto text-xs">
                    {t('accessoryOptionalHint')}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <AccessoriesPickerDialog
        options={availableProducts}
        selectedIds={selectedIds}
        onToggle={handleToggle}
        currency={currency}
        disabled={disabled}
      />

      {/* Helper text */}
      {selectedLinks.length === 0 && (
        <p className="text-muted-foreground text-xs">{t('accessoriesHelp')}</p>
      )}
    </div>
  );
}
