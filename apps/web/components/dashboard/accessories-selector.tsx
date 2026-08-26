'use client';

import { useMemo, useState } from 'react';

import { GripVertical, Plus, Search, X } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@louez/ui';
import { Input, InputQuantity, Label, Switch } from '@louez/ui';
import {
  Dialog,
  DialogPopup,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@louez/ui';
import { ScrollArea } from '@louez/ui';
import { formatCurrency } from '@louez/utils';
import { cn } from '@louez/utils';

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
  const tCommon = useTranslations('common');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [search, setSearch] = useState('');

  // Pair each link with its catalog entry; links pointing at a product that is
  // no longer selectable (archived, deleted) are dropped from the display.
  const selectedLinks = useMemo(() => {
    return value.flatMap((link) => {
      const product = availableProducts.find((p) => p.id === link.accessoryId);
      return product ? [{ link, product }] : [];
    });
  }, [value, availableProducts]);

  // Filter available products for the dialog
  const filteredProducts = useMemo(() => {
    const lowerSearch = search.toLowerCase();
    const selectedIds = new Set(value.map((link) => link.accessoryId));
    return availableProducts.filter(
      (p) => !selectedIds.has(p.id) && p.name.toLowerCase().includes(lowerSearch),
    );
  }, [availableProducts, value, search]);

  const handleAdd = (productId: string) => {
    onChange([...value, { accessoryId: productId, required: false, quantity: 1 }]);
  };

  const handleRemove = (productId: string) => {
    onChange(value.filter((link) => link.accessoryId !== productId));
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

      {/* Add accessory button */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogTrigger
          render={
            <Button
              type="button"
              variant="outline"
              className="w-full border-dashed"
              disabled={disabled || filteredProducts.length === 0}
            />
          }
        >
          <Plus className="mr-2 h-4 w-4" />
          {t('addAccessory')}
        </DialogTrigger>
        <DialogPopup className="flex max-h-[80vh] max-w-md flex-col">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle>{t('selectAccessories')}</DialogTitle>
            <DialogDescription>
              {t('selectAccessoriesDescription')}
            </DialogDescription>
          </DialogHeader>

          <div className="flex min-h-0 flex-1 flex-col gap-4 py-4">
            {/* Search */}
            <div className="relative flex-shrink-0">
              <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
              <Input
                placeholder={t('searchProducts')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            {/* Products list - scrollable */}
            <ScrollArea className="-mx-6 flex-1 px-6">
              <div className="space-y-2">
                {filteredProducts.length === 0 ? (
                  <p className="text-muted-foreground py-8 text-center text-sm">
                    {search ? t('noProductsFound') : t('noProductsAvailable')}
                  </p>
                ) : (
                  filteredProducts.map((product) => (
                    <button
                      key={product.id}
                      type="button"
                      className={cn(
                        'flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors',
                        'hover:bg-muted/50 focus:ring-primary focus:ring-2 focus:ring-offset-2 focus:outline-none',
                      )}
                      onClick={() => {
                        handleAdd(product.id);
                        setSearch('');
                      }}
                    >
                      <ProductImage
                        src={product.images?.[0]}
                        alt={product.name}
                        sizes="40px"
                        containerClassName="aspect-square h-10 w-10 shrink-0 rounded-md"
                      />

                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{product.name}</p>
                        <p className="text-muted-foreground text-sm">
                          {formatCurrency(parseFloat(product.price), currency)}
                        </p>
                      </div>

                      <Plus className="text-muted-foreground h-4 w-4 flex-shrink-0" />
                    </button>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>

          {/* Footer with close button */}
          <div className="flex flex-shrink-0 justify-end border-t pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDialogOpen(false);
                setSearch('');
              }}
            >
              {tCommon('close')}
            </Button>
          </div>
        </DialogPopup>
      </Dialog>

      {/* Helper text */}
      {selectedLinks.length === 0 && (
        <p className="text-muted-foreground text-xs">{t('accessoriesHelp')}</p>
      )}
    </div>
  );
}
