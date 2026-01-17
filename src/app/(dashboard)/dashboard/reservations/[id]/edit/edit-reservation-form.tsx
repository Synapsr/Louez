'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { toast } from 'sonner'
import {
  ArrowLeft,
  Calendar,
  Loader2,
  Trash2,
  Plus,
  Lock,
  Unlock,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableFooter,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Calendar as CalendarComponent } from '@/components/ui/calendar'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn, getCurrencySymbol } from '@/lib/utils'
import { updateReservation } from '../../actions'
import type { PricingBreakdown, ProductSnapshot } from '@/types'

interface PricingTier {
  id: string
  minDuration: number
  discountPercent: string
}

interface Product {
  id: string
  name: string
  price: string
  deposit: string
  pricingMode: string | null
  pricingTiers: PricingTier[]
}

interface ReservationItem {
  id: string
  productId: string | null
  quantity: number
  unitPrice: string
  depositPerUnit: string
  totalPrice: string
  isCustomItem: boolean
  pricingBreakdown: PricingBreakdown | null
  productSnapshot: ProductSnapshot
  product: Product | null
}

interface Reservation {
  id: string
  number: string
  startDate: Date
  endDate: Date
  subtotalAmount: string
  depositAmount: string
  items: ReservationItem[]
  customer: {
    firstName: string
    lastName: string
  }
}

interface EditableItem {
  id: string
  productId: string | null
  quantity: number
  unitPrice: number
  depositPerUnit: number
  isManualPrice: boolean
  productSnapshot: ProductSnapshot
  product: Product | null
}

interface EditReservationFormProps {
  reservation: Reservation
  availableProducts: Product[]
  pricingMode: string
  currency: string
}

function calculateDuration(
  startDate: Date,
  endDate: Date,
  pricingMode: string
): number {
  const diffMs = endDate.getTime() - startDate.getTime()
  if (pricingMode === 'hour') {
    return Math.ceil(diffMs / (1000 * 60 * 60))
  } else if (pricingMode === 'week') {
    return Math.ceil(diffMs / (1000 * 60 * 60 * 24 * 7))
  }
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24))
}

function findApplicableTier(
  tiers: PricingTier[],
  duration: number
): PricingTier | null {
  if (!tiers.length) return null
  const sorted = [...tiers].sort((a, b) => b.minDuration - a.minDuration)
  return sorted.find((tier) => duration >= tier.minDuration) || null
}

function calculateItemPrice(
  item: EditableItem,
  duration: number,
  pricingMode: string
): { unitPrice: number; totalPrice: number; tierLabel: string | null } {
  if (item.isManualPrice || !item.product) {
    return {
      unitPrice: item.unitPrice,
      totalPrice: item.unitPrice * duration * item.quantity,
      tierLabel: item.isManualPrice ? 'Manuel' : null,
    }
  }

  const basePrice = parseFloat(item.product.price)
  const tiers = item.product.pricingTiers
  const tier = findApplicableTier(tiers, duration)

  if (tier) {
    const discount = parseFloat(tier.discountPercent)
    const effectivePrice = basePrice * (1 - discount / 100)
    return {
      unitPrice: effectivePrice,
      totalPrice: effectivePrice * duration * item.quantity,
      tierLabel: `-${discount}% (${tier.minDuration}+ ${pricingMode === 'day' ? 'j' : pricingMode === 'hour' ? 'h' : 'sem'})`,
    }
  }

  return {
    unitPrice: basePrice,
    totalPrice: basePrice * duration * item.quantity,
    tierLabel: null,
  }
}

export function EditReservationForm({
  reservation,
  availableProducts,
  pricingMode,
  currency,
}: EditReservationFormProps) {
  const router = useRouter()
  const t = useTranslations('dashboard.reservations')
  const tCommon = useTranslations('common')
  const tErrors = useTranslations('errors')
  const currencySymbol = getCurrencySymbol(currency)

  const [isLoading, setIsLoading] = useState(false)
  const [startDate, setStartDate] = useState<Date>(new Date(reservation.startDate))
  const [endDate, setEndDate] = useState<Date>(new Date(reservation.endDate))
  const [items, setItems] = useState<EditableItem[]>(
    reservation.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      quantity: item.quantity,
      unitPrice: parseFloat(item.unitPrice),
      depositPerUnit: parseFloat(item.depositPerUnit),
      isManualPrice: (item.pricingBreakdown as unknown as Record<string, unknown> | null)?.isManualOverride === true,
      productSnapshot: item.productSnapshot,
      product: item.product,
    }))
  )

  // Original values for comparison
  const originalSubtotal = parseFloat(reservation.subtotalAmount)
  const originalDeposit = parseFloat(reservation.depositAmount)
  const originalDuration = calculateDuration(
    new Date(reservation.startDate),
    new Date(reservation.endDate),
    pricingMode
  )

  // Calculate new values
  const newDuration = useMemo(
    () => calculateDuration(startDate, endDate, pricingMode),
    [startDate, endDate, pricingMode]
  )

  const calculations = useMemo(() => {
    let subtotal = 0
    let deposit = 0

    const itemCalculations = items.map((item) => {
      const calc = calculateItemPrice(item, newDuration, pricingMode)
      subtotal += calc.totalPrice
      deposit += item.depositPerUnit * item.quantity
      return { ...item, ...calc }
    })

    return {
      items: itemCalculations,
      subtotal,
      deposit,
      difference: subtotal - originalSubtotal,
    }
  }, [items, newDuration, pricingMode, originalSubtotal])

  const handleQuantityChange = (itemId: string, quantity: number) => {
    setItems((prev) =>
      prev.map((item) =>
        item.id === itemId ? { ...item, quantity: Math.max(1, quantity) } : item
      )
    )
  }

  const handlePriceChange = (itemId: string, price: number) => {
    setItems((prev) =>
      prev.map((item) =>
        item.id === itemId ? { ...item, unitPrice: price, isManualPrice: true } : item
      )
    )
  }

  const handleToggleManualPrice = (itemId: string) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== itemId) return item
        if (item.isManualPrice && item.product) {
          // Reset to automatic pricing
          return { ...item, isManualPrice: false, unitPrice: parseFloat(item.product.price) }
        }
        return { ...item, isManualPrice: true }
      })
    )
  }

  const handleRemoveItem = (itemId: string) => {
    if (items.length <= 1) {
      toast.error(t('edit.cannotRemoveLastItem'))
      return
    }
    setItems((prev) => prev.filter((item) => item.id !== itemId))
  }

  const handleAddProduct = (productId: string) => {
    const product = availableProducts.find((p) => p.id === productId)
    if (!product) return

    // Check if product already exists
    const existing = items.find((item) => item.productId === productId)
    if (existing) {
      handleQuantityChange(existing.id, existing.quantity + 1)
      return
    }

    const newItem: EditableItem = {
      id: `new-${Date.now()}`,
      productId: product.id,
      quantity: 1,
      unitPrice: parseFloat(product.price),
      depositPerUnit: parseFloat(product.deposit),
      isManualPrice: false,
      productSnapshot: {
        name: product.name,
        description: null,
        images: [],
      },
      product,
    }

    setItems((prev) => [...prev, newItem])
  }

  const handleSave = async () => {
    if (items.length === 0) {
      toast.error(t('edit.noItems'))
      return
    }

    setIsLoading(true)
    try {
      const result = await updateReservation(reservation.id, {
        startDate,
        endDate,
        items: items.map((item) => ({
          id: item.id.startsWith('new-') ? undefined : item.id,
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          depositPerUnit: item.depositPerUnit,
          isManualPrice: item.isManualPrice,
          productSnapshot: item.productSnapshot,
        })),
      })

      if (result.error) {
        toast.error(tErrors(result.error))
      } else {
        toast.success(t('edit.saved'))
        router.push(`/dashboard/reservations/${reservation.id}`)
        router.refresh()
      }
    } catch {
      toast.error(tErrors('generic'))
    } finally {
      setIsLoading(false)
    }
  }

  const hasChanges =
    startDate.getTime() !== new Date(reservation.startDate).getTime() ||
    endDate.getTime() !== new Date(reservation.endDate).getTime() ||
    calculations.subtotal !== originalSubtotal

  const durationLabel =
    pricingMode === 'hour'
      ? tCommon('hours', { count: newDuration })
      : pricingMode === 'week'
        ? tCommon('weeks', { count: newDuration })
        : tCommon('days', { count: newDuration })

  return (
    <TooltipProvider>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" asChild>
              <Link href={`/dashboard/reservations/${reservation.id}`}>
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div>
              <h1 className="text-xl font-semibold">{t('edit.title')}</h1>
              <p className="text-sm text-muted-foreground">
                #{reservation.number} • {reservation.customer.firstName}{' '}
                {reservation.customer.lastName}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" asChild>
              <Link href={`/dashboard/reservations/${reservation.id}`}>
                {tCommon('cancel')}
              </Link>
            </Button>
            <Button onClick={handleSave} disabled={isLoading || !hasChanges}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('edit.save')}
            </Button>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Dates */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  {t('edit.dates')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                  <div className="space-y-1.5 flex-1">
                    <Label className="text-xs text-muted-foreground">
                      {t('edit.startDate')}
                    </Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          className="w-full justify-start font-normal"
                        >
                          <Calendar className="mr-2 h-4 w-4" />
                          {format(startDate, 'PPP', { locale: fr })}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <CalendarComponent
                          mode="single"
                          selected={startDate}
                          onSelect={(date) => date && setStartDate(date)}
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                  </div>

                  <span className="text-muted-foreground hidden sm:block">→</span>

                  <div className="space-y-1.5 flex-1">
                    <Label className="text-xs text-muted-foreground">
                      {t('edit.endDate')}
                    </Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          className="w-full justify-start font-normal"
                        >
                          <Calendar className="mr-2 h-4 w-4" />
                          {format(endDate, 'PPP', { locale: fr })}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <CalendarComponent
                          mode="single"
                          selected={endDate}
                          onSelect={(date) => date && setEndDate(date)}
                          disabled={(date) => date < startDate}
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                  </div>

                  <div className="sm:pt-6">
                    <span className="inline-flex items-center px-2.5 py-1 rounded-md bg-muted text-sm">
                      {durationLabel}
                      {newDuration !== originalDuration && (
                        <span className="ml-1.5 text-xs text-muted-foreground">
                          ({originalDuration} →)
                        </span>
                      )}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Items */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{t('edit.items')}</CardTitle>
                  <Select onValueChange={handleAddProduct}>
                    <SelectTrigger className="w-[200px] h-8 text-sm">
                      <Plus className="h-3.5 w-3.5 mr-1.5" />
                      <SelectValue placeholder={t('edit.addItem')} />
                    </SelectTrigger>
                    <SelectContent>
                      {availableProducts.map((product) => (
                        <SelectItem key={product.id} value={product.id}>
                          {product.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent>
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/30">
                        <TableHead>{t('edit.product')}</TableHead>
                        <TableHead className="text-center w-24">{t('edit.qty')}</TableHead>
                        <TableHead className="text-right w-36">{t('edit.unitPrice')}</TableHead>
                        <TableHead className="text-right w-28">{t('edit.total')}</TableHead>
                        <TableHead className="w-16"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {calculations.items.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell>
                            <div>
                              <p className="font-medium text-sm">
                                {item.productSnapshot.name}
                              </p>
                              {item.tierLabel && (
                                <p className="text-xs text-emerald-600">
                                  {item.tierLabel}
                                </p>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              min="1"
                              value={item.quantity}
                              onChange={(e) =>
                                handleQuantityChange(item.id, parseInt(e.target.value) || 1)
                              }
                              className="w-16 h-8 text-center mx-auto"
                            />
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center justify-end gap-1">
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                value={item.unitPrice.toFixed(2)}
                                onChange={(e) =>
                                  handlePriceChange(item.id, parseFloat(e.target.value) || 0)
                                }
                                className={cn(
                                  'w-24 h-8 text-right',
                                  item.isManualPrice && 'border-amber-300 bg-amber-50 dark:bg-amber-950/20'
                                )}
                              />
                              <span className="text-sm text-muted-foreground">
                                {currencySymbol}
                              </span>
                              {item.product && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8"
                                      onClick={() => handleToggleManualPrice(item.id)}
                                    >
                                      {item.isManualPrice ? (
                                        <Lock className="h-3.5 w-3.5 text-amber-600" />
                                      ) : (
                                        <Unlock className="h-3.5 w-3.5 text-muted-foreground" />
                                      )}
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    {item.isManualPrice
                                      ? t('edit.unlockPrice')
                                      : t('edit.lockPrice')}
                                  </TooltipContent>
                                </Tooltip>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {item.totalPrice.toFixed(2)}{currencySymbol}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-destructive"
                              onClick={() => handleRemoveItem(item.id)}
                              disabled={items.length <= 1}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                    <TableFooter>
                      <TableRow>
                        <TableCell colSpan={3} className="text-right font-medium">
                          {t('edit.subtotal')}
                        </TableCell>
                        <TableCell className="text-right font-bold">
                          {calculations.subtotal.toFixed(2)}{currencySymbol}
                        </TableCell>
                        <TableCell></TableCell>
                      </TableRow>
                    </TableFooter>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Summary Sidebar */}
          <div className="space-y-6">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{t('edit.summary')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Before/After comparison */}
                <div className="space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{t('edit.before')}</span>
                    <span className="font-medium">
                      {originalSubtotal.toFixed(2)}{currencySymbol}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{t('edit.after')}</span>
                    <span className="font-medium">
                      {calculations.subtotal.toFixed(2)}{currencySymbol}
                    </span>
                  </div>
                  <div className="border-t pt-3">
                    <div className="flex justify-between">
                      <span className="font-medium">{t('edit.difference')}</span>
                      <span
                        className={cn(
                          'font-bold',
                          calculations.difference > 0 && 'text-emerald-600',
                          calculations.difference < 0 && 'text-red-600'
                        )}
                      >
                        {calculations.difference >= 0 ? '+' : ''}
                        {calculations.difference.toFixed(2)}{currencySymbol}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Info message */}
                {calculations.difference !== 0 && (
                  <div className="p-3 rounded-lg bg-muted/50 text-xs text-muted-foreground">
                    {calculations.difference > 0
                      ? t('edit.adjustmentPositive', {
                          amount: `${calculations.difference.toFixed(2)}${currencySymbol}`,
                        })
                      : t('edit.adjustmentNegative', {
                          amount: `${Math.abs(calculations.difference).toFixed(2)}${currencySymbol}`,
                        })}
                  </div>
                )}

                {/* Deposit info */}
                <div className="pt-3 border-t">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{t('edit.deposit')}</span>
                    <span>
                      {originalDeposit.toFixed(2)} → {calculations.deposit.toFixed(2)}
                      {currencySymbol}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </TooltipProvider>
  )
}
