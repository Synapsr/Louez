'use client'

import Link from 'next/link'
import Image from 'next/image'
import { ShoppingCart, Trash2, Plus, Minus, CalendarDays, ImageIcon } from 'lucide-react'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatCurrency } from '@/lib/utils'
import { useCart } from '@/contexts/cart-context'
import { useStoreCurrency } from '@/contexts/store-context'

interface CartContentProps {
  storeSlug: string
  pricingMode: 'day' | 'hour' | 'week'
}

export function CartContent({ storeSlug, pricingMode }: CartContentProps) {
  const t = useTranslations('storefront.cart')
  const tProduct = useTranslations('storefront.product')
  const currency = useStoreCurrency()
  const {
    items,
    globalStartDate,
    globalEndDate,
    removeItem,
    updateItemQuantity,
    setGlobalDates,
    clearCart,
    getSubtotal,
    getTotal,
    getDuration,
  } = useCart()

  const duration = getDuration()

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <ShoppingCart className="h-16 w-16 text-muted-foreground mb-4" />
        <h2 className="text-xl font-semibold mb-2">{t('empty')}</h2>
        <p className="text-muted-foreground mb-6">
          {t('emptyDescription')}
        </p>
        <Button asChild>
          <Link href={`/${storeSlug}/catalog`}>{t('viewCatalog')}</Link>
        </Button>
      </div>
    )
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // Format duration label
  const durationLabel = (() => {
    if (pricingMode === 'hour') {
      return `${duration} ${duration > 1 ? tProduct('pricingUnit.hour.plural') : tProduct('pricingUnit.hour.singular')}`
    } else if (pricingMode === 'week') {
      return `${duration} ${duration > 1 ? tProduct('pricingUnit.week.plural') : tProduct('pricingUnit.week.singular')}`
    }
    return `${duration} ${duration > 1 ? tProduct('pricingUnit.day.plural') : tProduct('pricingUnit.day.singular')}`
  })()

  return (
    <div className="grid lg:grid-cols-3 gap-8">
      {/* Cart Items */}
      <div className="lg:col-span-2 space-y-4">
        {/* Global Period Selection */}
        {globalStartDate && globalEndDate && (
          <Card className="bg-muted/30">
            <CardContent className="p-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <CalendarDays className="h-5 w-5 text-primary" />
                  <span className="font-medium">{t('period')}</span>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="justify-start">
                        {format(new Date(globalStartDate), 'dd MMM yyyy', { locale: fr })}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={new Date(globalStartDate)}
                        onSelect={(date) => {
                          if (date) {
                            const newStart = date.toISOString()
                            const currentEnd = new Date(globalEndDate)
                            if (date >= currentEnd) {
                              const newEnd = new Date(date)
                              newEnd.setDate(newEnd.getDate() + 1)
                              setGlobalDates(newStart, newEnd.toISOString())
                            } else {
                              setGlobalDates(newStart, globalEndDate)
                            }
                          }
                        }}
                        disabled={(date) => date < today}
                        locale={fr}
                      />
                    </PopoverContent>
                  </Popover>
                  <span className="text-muted-foreground">→</span>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="justify-start">
                        {format(new Date(globalEndDate), 'dd MMM yyyy', { locale: fr })}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={new Date(globalEndDate)}
                        onSelect={(date) => {
                          if (date) {
                            setGlobalDates(globalStartDate, date.toISOString())
                          }
                        }}
                        disabled={(date) =>
                          date < today || date <= new Date(globalStartDate)
                        }
                        locale={fr}
                      />
                    </PopoverContent>
                  </Popover>
                  <Badge variant="secondary">{durationLabel}</Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Items List */}
        {items.map((item) => {
          const itemTotal = item.price * item.quantity * duration

          return (
            <Card key={item.productId}>
              <CardContent className="p-4">
                <div className="flex gap-4">
                  {/* Product Image */}
                  <div className="relative h-24 w-24 flex-shrink-0 rounded-lg overflow-hidden bg-muted">
                    {item.productImage ? (
                      <Image
                        src={item.productImage}
                        alt={item.productName}
                        fill
                        className="object-cover"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center">
                        <ImageIcon className="h-8 w-8 text-muted-foreground" />
                      </div>
                    )}
                  </div>

                  {/* Product Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="font-semibold truncate">
                          <Link
                            href={`/${storeSlug}/product/${item.productId}`}
                            className="hover:underline"
                          >
                            {item.productName}
                          </Link>
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          {formatCurrency(item.price, currency)} /{' '}
                          {tProduct(`pricingUnit.${pricingMode}.singular`)}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:text-destructive"
                        onClick={() => removeItem(item.productId)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>

                    {/* Quantity and Total */}
                    <div className="flex items-center justify-between mt-4">
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() =>
                            updateItemQuantity(item.productId, item.quantity - 1)
                          }
                          disabled={item.quantity <= 1}
                        >
                          <Minus className="h-3 w-3" />
                        </Button>
                        <span className="w-8 text-center font-medium">
                          {item.quantity}
                        </span>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() =>
                            updateItemQuantity(item.productId, item.quantity + 1)
                          }
                          disabled={item.quantity >= item.maxQuantity}
                        >
                          <Plus className="h-3 w-3" />
                        </Button>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold">{formatCurrency(itemTotal, currency)}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatCurrency(item.price, currency)} × {item.quantity} × {duration}{' '}
                          {duration > 1
                            ? tProduct(`pricingUnit.${pricingMode}.plural`)
                            : tProduct(`pricingUnit.${pricingMode}.singular`)}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )
        })}

        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
          onClick={clearCart}
        >
          <Trash2 className="mr-2 h-4 w-4" />
          {t('clearCart')}
        </Button>
      </div>

      {/* Order Summary */}
      <div className="lg:col-span-1">
        <Card className="sticky top-4">
          <CardHeader>
            <CardTitle>{t('summary')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between text-sm">
              <span>{t('subtotal')}</span>
              <span>{formatCurrency(getSubtotal(), currency)}</span>
            </div>
            <Separator />
            <div className="flex justify-between font-semibold text-lg">
              <span>{t('total')}</span>
              <span>{formatCurrency(getTotal(), currency)}</span>
            </div>
          </CardContent>
          <CardFooter>
            <Button className="w-full" size="lg" asChild>
              <Link href={`/${storeSlug}/checkout`}>{t('checkout')}</Link>
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  )
}
