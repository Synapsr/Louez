'use client'

import { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import {
  ShoppingCart,
  Trash2,
  Plus,
  Minus,
  ImageIcon,
  CalendarDays,
  X,
  ArrowRight,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { cn, formatCurrency } from '@/lib/utils'
import { useCart } from '@/contexts/cart-context'
import { useStoreCurrency } from '@/contexts/store-context'

interface CartSidebarProps {
  storeSlug: string
  className?: string
  showDates?: boolean
}

export function CartSidebar({ className, showDates = true }: CartSidebarProps) {
  const t = useTranslations('storefront.cart')
  const currency = useStoreCurrency()
  const {
    items,
    globalStartDate,
    globalEndDate,
    removeItem,
    updateItemQuantity,
    clearCart,
    getItemCount,
    getSubtotal,
    getTotal,
    getDuration,
    pricingMode,
    getTotalSavings,
    getOriginalSubtotal,
  } = useCart()

  const itemCount = getItemCount()
  const duration = getDuration()

  // Format duration label
  const durationLabel = (() => {
    const tProduct = useTranslations('storefront.product')
    if (pricingMode === 'hour') {
      return `${duration} ${duration > 1 ? tProduct('pricingUnit.hour.plural') : tProduct('pricingUnit.hour.singular')}`
    } else if (pricingMode === 'week') {
      return `${duration} ${duration > 1 ? tProduct('pricingUnit.week.plural') : tProduct('pricingUnit.week.singular')}`
    }
    return `${duration} ${duration > 1 ? tProduct('pricingUnit.day.plural') : tProduct('pricingUnit.day.singular')}`
  })()

  const CartContent = () => (
    <>
      {/* Period Display - only shown when showDates is true */}
      {showDates && globalStartDate && globalEndDate && (
        <div className="bg-muted/50 rounded-lg p-3 mb-4">
          <div className="flex items-center gap-2 text-sm">
            <CalendarDays className="h-4 w-4 text-primary" />
            <span className="font-medium">{t('period')}</span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
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
        <div className="text-center py-8">
          <ShoppingCart className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
          <p className="font-medium">{t('empty')}</p>
          <p className="text-sm text-muted-foreground mt-1">{t('emptyDescription')}</p>
        </div>
      ) : (
        <>
          {/* Items List */}
          <div className="flex-1 -mx-4 px-4 overflow-y-auto max-h-64">
            <div className="space-y-3">
              {items.map((item) => (
                <div
                  key={item.productId}
                  className="flex gap-3 p-3 rounded-lg bg-muted/30"
                >
                  {/* Image */}
                  <div className="relative h-16 w-16 flex-shrink-0 rounded-md overflow-hidden bg-muted">
                    {item.productImage ? (
                      <Image
                        src={item.productImage}
                        alt={item.productName}
                        fill
                        className="object-cover"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center">
                        <ImageIcon className="h-6 w-6 text-muted-foreground" />
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{item.productName}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatCurrency(item.price * duration, currency)} × {item.quantity}
                    </p>

                    {/* Quantity Controls */}
                    <div className="flex items-center justify-between mt-2">
                      <div className="flex items-center gap-1">
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => updateItemQuantity(item.productId, item.quantity - 1)}
                        >
                          <Minus className="h-3 w-3" />
                        </Button>
                        <span className="w-6 text-center text-sm">{item.quantity}</span>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => updateItemQuantity(item.productId, item.quantity + 1)}
                          disabled={item.quantity >= item.maxQuantity}
                        >
                          <Plus className="h-3 w-3" />
                        </Button>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-destructive hover:text-destructive"
                        onClick={() => removeItem(item.productId)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
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
                  <span className="line-through text-muted-foreground">{formatCurrency(getOriginalSubtotal(), currency)}</span>
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
              <span className="text-primary">{formatCurrency(getTotal(), currency)}</span>
            </div>
            {getTotalSavings() > 0 && (
              <p className="text-xs text-green-600 text-center">{t('youSave', { amount: formatCurrency(getTotalSavings(), currency) })}</p>
            )}
          </div>

          {/* Actions */}
          <div className="mt-4 space-y-2">
            <Button asChild className="w-full" size="lg">
              <Link href="/checkout">
                {t('checkout')}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="sm" className="w-full text-destructive hover:text-destructive">
                  <Trash2 className="mr-2 h-4 w-4" />
                  {t('clear')}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t('clearConfirm.title')}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t('clearConfirm.description')}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t('clearConfirm.cancel')}</AlertDialogCancel>
                  <AlertDialogAction onClick={clearCart} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                    {t('clearConfirm.confirm')}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </>
      )}
    </>
  )

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
              <Badge variant="secondary">{t('itemsPlural', { count: itemCount })}</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <CartContent />
        </CardContent>
      </Card>

      {/* Mobile Floating Button + Sheet */}
      <div className="fixed bottom-4 right-4 z-50 lg:hidden">
        <Sheet>
          <SheetTrigger asChild>
            <Button size="lg" className="h-14 px-6 shadow-lg rounded-full">
              <ShoppingCart className="h-5 w-5 mr-2" />
              {t('title')}
              {itemCount > 0 && (
                <Badge variant="secondary" className="ml-2">
                  {itemCount}
                </Badge>
              )}
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom" className="h-[85vh] rounded-t-2xl">
            <SheetHeader className="pb-4">
              <SheetTitle className="flex items-center gap-2">
                <ShoppingCart className="h-5 w-5" />
                {t('title')}
                {itemCount > 0 && (
                  <Badge variant="secondary">{t('itemsPlural', { count: itemCount })}</Badge>
                )}
              </SheetTitle>
            </SheetHeader>
            <div className="flex flex-col h-[calc(100%-60px)]">
              <CartContent />
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </>
  )
}
