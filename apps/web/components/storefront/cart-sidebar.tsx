'use client';

import Image from 'next/image';
import Link from 'next/link';

import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  ArrowRight,
  CalendarDays,
  ImageIcon,
  Minus,
  Plus,
  ShoppingCart,
  Trash2,
  X,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@louez/ui';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@louez/ui';
import { Separator } from '@louez/ui';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@louez/ui';
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@louez/ui';
import { Badge } from '@louez/ui';
import { cn, formatCurrency } from '@louez/utils';

import { useStorefrontUrl } from '@/hooks/use-storefront-url';

import { useCart } from '@/contexts/cart-context';
import { useStoreCurrency } from '@/contexts/store-context';

interface CartSidebarProps {
  storeSlug: string;
  className?: string;
  showDates?: boolean;
}

export function CartSidebar({
  storeSlug,
  className,
  showDates = true,
}: CartSidebarProps) {
  const t = useTranslations('storefront.cart');
  const currency = useStoreCurrency();
  const { getUrl } = useStorefrontUrl(storeSlug);
  const {
    items,
    globalStartDate,
    globalEndDate,
    removeItemByLineId,
    updateItemQuantityByLineId,
    clearCart,
    getItemCount,
    getSubtotal,
    getTotal,
    getTotalSavings,
    getOriginalSubtotal,
  } = useCart();

  const itemCount = getItemCount();
  const tProduct = useTranslations('storefront.product');

  const getItemDuration = (item: (typeof items)[number]) => {
    const start = globalStartDate
      ? new Date(globalStartDate)
      : new Date(item.startDate);
    const end = globalEndDate
      ? new Date(globalEndDate)
      : new Date(item.endDate);
    const itemPricingMode =
      item.productPricingMode || item.pricingMode || 'day';
    const diffMs = end.getTime() - start.getTime();
    if (itemPricingMode === 'hour')
      return Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60)));
    if (itemPricingMode === 'week')
      return Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24 * 7)));
    return Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
  };

  const getItemDurationLabel = (item: (typeof items)[number]) => {
    const itemPricingMode =
      item.productPricingMode || item.pricingMode || 'day';
    const duration = getItemDuration(item);
    if (itemPricingMode === 'hour') {
      return `${duration} ${duration > 1 ? tProduct('pricingUnit.hour.plural') : tProduct('pricingUnit.hour.singular')}`;
    }
    if (itemPricingMode === 'week') {
      return `${duration} ${duration > 1 ? tProduct('pricingUnit.week.plural') : tProduct('pricingUnit.week.singular')}`;
    }
    return `${duration} ${duration > 1 ? tProduct('pricingUnit.day.plural') : tProduct('pricingUnit.day.singular')}`;
  };

  // Format duration label
  const durationLabel = items.length > 0 ? getItemDurationLabel(items[0]) : '';

  const CartContent = () => (
    <>
      {/* Period Display - only shown when showDates is true */}
      {showDates && globalStartDate && globalEndDate && (
        <div className="bg-muted/50 mb-4 rounded-lg p-3">
          <div className="flex items-center gap-2 text-sm">
            <CalendarDays className="text-primary h-4 w-4" />
            <span className="font-medium">{t('period')}</span>
          </div>
          <p className="text-muted-foreground mt-1 text-sm">
            {format(new Date(globalStartDate), 'dd MMM yyyy', { locale: fr })}
            {' → '}
            {format(new Date(globalEndDate), 'dd MMM yyyy', { locale: fr })}
          </p>
          <Badge variant="secondary" className="mt-2">
            {durationLabel}
          </Badge>
        </div>
      )}

      {items.length === 0 ? (
        <div className="py-8 text-center">
          <ShoppingCart className="text-muted-foreground mx-auto mb-3 h-12 w-12" />
          <p className="font-medium">{t('empty')}</p>
          <p className="text-muted-foreground mt-1 text-sm">
            {t('emptyDescription')}
          </p>
        </div>
      ) : (
        <>
          {/* Items List */}
          <div className="-mx-4 max-h-64 flex-1 overflow-y-auto px-4">
            <div className="space-y-3">
              {items.map((item) => (
                <div
                  key={item.lineId}
                  className="bg-muted/30 flex gap-3 rounded-lg p-3"
                >
                  {/* Image */}
                  <div className="bg-muted relative aspect-4/3 h-16 flex-shrink-0 overflow-hidden rounded-md">
                    {item.productImage ? (
                      <Image
                        src={item.productImage}
                        alt={item.productName}
                        fill
                        className="object-cover"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center">
                        <ImageIcon className="text-muted-foreground h-6 w-6" />
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {item.productName}
                    </p>
                    {item.selectedAttributes &&
                      Object.keys(item.selectedAttributes).length > 0 && (
                        <p className="text-muted-foreground truncate text-[11px]">
                          {Object.entries(item.selectedAttributes)
                            .map(([key, value]) => `${key}: ${value}`)
                            .join(' • ')}
                        </p>
                      )}
                    <p className="text-muted-foreground text-xs">
                      {formatCurrency(
                        item.price * getItemDuration(item),
                        currency,
                      )}{' '}
                      × {item.quantity}
                    </p>

                    {/* Quantity Controls */}
                    <div className="mt-2 flex items-center justify-between">
                      <div className="flex items-center gap-1">
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() =>
                            updateItemQuantityByLineId(
                              item.lineId,
                              item.quantity - 1,
                            )
                          }
                        >
                          <Minus className="h-3 w-3" />
                        </Button>
                        <span className="w-6 text-center text-sm">
                          {item.quantity}
                        </span>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() =>
                            updateItemQuantityByLineId(
                              item.lineId,
                              item.quantity + 1,
                            )
                          }
                          disabled={item.quantity >= item.maxQuantity}
                        >
                          <Plus className="h-3 w-3" />
                        </Button>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:text-destructive h-6 w-6"
                        onClick={() => removeItemByLineId(item.lineId)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                    {item.quantity >= item.maxQuantity && (
                      <p className="text-muted-foreground mt-1 text-[11px]">
                        {t('lineMaxReached')}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <Separator className="my-4" />

          {/* Totals */}
          <div className="space-y-2">
            {getTotalSavings() > 0 ? (
              <>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{t('subtotal')}</span>
                  <span className="text-muted-foreground line-through">
                    {formatCurrency(getOriginalSubtotal(), currency)}
                  </span>
                </div>
                <div className="flex justify-between text-sm text-green-600">
                  <span>{t('discount')}</span>
                  <span>-{formatCurrency(getTotalSavings(), currency)}</span>
                </div>
                <div className="flex justify-between text-sm font-medium">
                  <span>{t('discountedSubtotal')}</span>
                  <span>{formatCurrency(getSubtotal(), currency)}</span>
                </div>
              </>
            ) : (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">{t('subtotal')}</span>
                <span>{formatCurrency(getSubtotal(), currency)}</span>
              </div>
            )}
            <Separator />
            <div className="flex justify-between font-semibold">
              <span>{t('total')}</span>
              <span className="text-primary">
                {formatCurrency(getTotal(), currency)}
              </span>
            </div>
            {getTotalSavings() > 0 && (
              <p className="text-center text-xs text-green-600">
                {t('youSave', {
                  amount: formatCurrency(getTotalSavings(), currency),
                })}
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="mt-4 space-y-2">
            <Button
              render={<Link href={getUrl('/checkout')} />}
              className="w-full"
              size="lg"
            >
              {t('checkout')}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>

            <AlertDialog>
              <AlertDialogTrigger
                render={
                  <Button
                    variant="ghost"
                    className="text-destructive hover:text-destructive w-full"
                  />
                }
              >
                <Trash2 className="mr-2 h-4 w-4" />
                {t('clear')}
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t('clearConfirm.title')}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t('clearConfirm.description')}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogClose render={<Button variant="outline" />}>
                    {t('clearConfirm.cancel')}
                  </AlertDialogClose>
                  <AlertDialogClose
                    render={<Button variant="destructive" />}
                    onClick={clearCart}
                  >
                    {t('clearConfirm.confirm')}
                  </AlertDialogClose>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </>
      )}
    </>
  );

  // Desktop Sidebar
  return (
    <>
      {/* Desktop Sticky Sidebar */}
      <Card className={cn('sticky top-4 hidden lg:block', className)}>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between text-lg">
            <span className="flex items-center gap-2">
              <ShoppingCart className="h-5 w-5" />
              {t('title')}
            </span>
            {itemCount > 0 && (
              <Badge variant="secondary">
                {t('itemsPlural', { count: itemCount })}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <CartContent />
        </CardContent>
      </Card>

      {/* Mobile Floating Button + Sheet */}
      <div className="fixed right-4 bottom-4 z-50 lg:hidden">
        <Sheet>
          <SheetTrigger
            render={
              <Button size="lg" className="h-14 rounded-full px-6 shadow-lg" />
            }
          >
            <ShoppingCart className="mr-2 h-5 w-5" />
            {t('title')}
            {itemCount > 0 && (
              <Badge variant="secondary" className="ml-2">
                {itemCount}
              </Badge>
            )}
          </SheetTrigger>
          <SheetContent side="bottom" className="h-[85vh] rounded-t-2xl">
            <SheetHeader className="pb-4">
              <SheetTitle className="flex items-center gap-2">
                <ShoppingCart className="h-5 w-5" />
                {t('title')}
                {itemCount > 0 && (
                  <Badge variant="secondary">
                    {t('itemsPlural', { count: itemCount })}
                  </Badge>
                )}
              </SheetTitle>
            </SheetHeader>
            <div className="flex h-[calc(100%-60px)] flex-col">
              <CartContent />
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}
