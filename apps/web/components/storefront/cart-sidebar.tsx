'use client';

import Link from 'next/link';

import { format } from 'date-fns';
import { ArrowRight, CalendarDays, ShoppingCart, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@louez/ui';
import {
  Card,
  CardContent,
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

import { CartLineItem } from '@/components/storefront/cart-line-item';

import {
  getCartLineAvailableMaximumQuantity,
  groupCartLinesByParent,
} from '@/lib/utils/cart-required-accessories';

import { useStorefrontUrl } from '@/hooks/use-storefront-url';

import { useCart } from '@/contexts/cart-context';
import { useStoreCurrency } from '@/contexts/store-context';
import { useFormatLocale } from '@/hooks/use-format-locale';

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
  const { intl: formatLocale, dateFns: dateLocale } = useFormatLocale();
  const currency = useStoreCurrency();
  const formatMoney = (amount: number, currencyOverride = currency) =>
    formatCurrency(amount, currencyOverride, formatLocale);
  const { getUrl } = useStorefrontUrl(storeSlug);
  const {
    items,
    isResolving,
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
  const lineGroups = groupCartLinesByParent(items);

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

  const renderCartContent = () => (
    <>
      {/* Period Display - only shown when showDates is true */}
      {showDates && globalStartDate && globalEndDate && (
        <div className="bg-muted/50 mb-4 rounded-lg p-3">
          <div className="flex items-center gap-2 text-sm">
            <CalendarDays className="text-primary h-4 w-4" />
            <span className="font-medium">{t('period')}</span>
          </div>
          <p className="text-muted-foreground mt-1 text-sm">
            {format(new Date(globalStartDate), 'dd MMM yyyy', { locale: dateLocale })}
            {' → '}
            {format(new Date(globalEndDate), 'dd MMM yyyy', { locale: dateLocale })}
          </p>
          <Badge variant="expired" className="mt-2">
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
          {/* Items List — required accessories nest under their parent line */}
          <div className="-mx-4 max-h-64 flex-1 overflow-y-auto px-4">
            <div className="space-y-3">
              {lineGroups.map((group) => (
                <div key={group.line.lineId} className="space-y-2">
                  <CartLineItem
                    item={group.line}
                    maximumQuantity={getCartLineAvailableMaximumQuantity(
                      items,
                      group.line,
                    )}
                    currency={currency}
                    globalStartDate={globalStartDate}
                    globalEndDate={globalEndDate}
                    onQuantityChange={updateItemQuantityByLineId}
                    onRemove={removeItemByLineId}
                  />
                  {group.children.length > 0 && (
                    <div className="border-border ml-5 space-y-2 border-l pl-3">
                      {group.children.map((child) => (
                        <CartLineItem
                          key={child.lineId}
                          item={child}
                          maximumQuantity={getCartLineAvailableMaximumQuantity(
                            items,
                            child,
                          )}
                          currency={currency}
                          globalStartDate={globalStartDate}
                          globalEndDate={globalEndDate}
                          parent={{
                            name: group.line.productName,
                            quantity: group.line.quantity,
                          }}
                          onQuantityChange={updateItemQuantityByLineId}
                          onRemove={removeItemByLineId}
                        />
                      ))}
                    </div>
                  )}
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
                    {formatMoney(getOriginalSubtotal(), currency)}
                  </span>
                </div>
                <div className="flex justify-between text-sm text-green-600">
                  <span>{t('discount')}</span>
                  <span>-{formatMoney(getTotalSavings(), currency)}</span>
                </div>
                <div className="flex justify-between text-sm font-medium">
                  <span>{t('discountedSubtotal')}</span>
                  <span>{formatMoney(getSubtotal(), currency)}</span>
                </div>
              </>
            ) : (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">{t('subtotal')}</span>
                <span>{formatMoney(getSubtotal(), currency)}</span>
              </div>
            )}
            <Separator />
            <div className="flex justify-between font-semibold">
              <span>{t('total')}</span>
              <span className="text-primary">
                {formatMoney(getTotal(), currency)}
              </span>
            </div>
            {getTotalSavings() > 0 && (
              <p className="text-center text-xs text-green-600">
                {t('youSave', {
                  amount: formatMoney(getTotalSavings(), currency),
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
              disabled={isResolving}
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
              <Badge variant="expired">{t('itemsPlural', { count: itemCount })}</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>{renderCartContent()}</CardContent>
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
              <Badge variant="expired" className="ml-2">
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
                  <Badge variant="expired">{t('itemsPlural', { count: itemCount })}</Badge>
                )}
              </SheetTitle>
            </SheetHeader>
            <div className="flex h-[calc(100%-60px)] flex-col">
              {renderCartContent()}
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}
