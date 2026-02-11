'use client'

import { useState, useMemo, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { toastManager } from '@louez/ui'
import {
  ArrowLeft,
  Loader2,
  Trash2,
  Plus,
  Lock,
  Unlock,
  PenLine,
  AlertTriangle,
  Package,
  Check,
  ChevronRight,
  Minus,
} from 'lucide-react'

import { Button } from '@louez/ui'
import { Card, CardContent } from '@louez/ui'
import { Input } from '@louez/ui'
import { Label } from '@louez/ui'
import { Textarea } from '@louez/ui'
import { Badge } from '@louez/ui'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@louez/ui'
import {
  Dialog,
  DialogPopup,
  DialogPanel,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@louez/ui'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@louez/ui'
import { Alert, AlertDescription } from '@louez/ui'
import { Separator } from '@louez/ui'
import { DateTimePicker } from '@/components/ui/date-time-picker'
import { cn, getCurrencySymbol } from '@louez/utils'
import { dateRangesOverlap } from '@/lib/utils/duration'
import {
  evaluateReservationRules,
  type ReservationValidationWarning,
} from '@/lib/utils/reservation-rules'
import { updateReservation } from '../../actions'
import type { PricingBreakdown, PricingMode, ProductSnapshot, StoreSettings } from '@louez/types'

// Types
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
  quantity: number
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

interface ExistingReservation {
  id: string
  startDate: Date
  endDate: Date
  status: string
  items: { productId: string | null; quantity: number }[]
}

interface Reservation {
  id: string
  number: string
  status: string
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
  pricingMode: PricingMode
  productSnapshot: ProductSnapshot
  product: Product | null
}

interface AvailabilityWarning {
  productId: string
  productName: string
  requestedQuantity: number
  availableQuantity: number
}

interface EditReservationFormProps {
  reservation: Reservation
  availableProducts: Product[]
  existingReservations: ExistingReservation[]
  currency: string
  storeSettings: StoreSettings | null
}

// Helper functions
function calculateDuration(
  startDate: Date,
  endDate: Date,
  pricingMode: PricingMode
): number {
  const diffMs = endDate.getTime() - startDate.getTime()
  if (pricingMode === 'hour') {
    return Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60)))
  } else if (pricingMode === 'week') {
    return Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24 * 7)))
  }
  return Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)))
}

function findApplicableTier(tiers: PricingTier[], duration: number): PricingTier | null {
  if (!tiers.length) return null
  const sorted = [...tiers].sort((a, b) => b.minDuration - a.minDuration)
  return sorted.find((tier) => duration >= tier.minDuration) || null
}

function calculateItemPrice(
  item: EditableItem,
  duration: number
): { unitPrice: number; totalPrice: number; tierLabel: string | null; discount: number } {
  if (item.isManualPrice || !item.product) {
    return {
      unitPrice: item.unitPrice,
      totalPrice: item.unitPrice * duration * item.quantity,
      tierLabel: null,
      discount: 0,
    }
  }

  const basePrice = parseFloat(item.product.price)
  const tiers = item.product.pricingTiers
  const tier = findApplicableTier(tiers, duration)

  if (tier) {
    const discount = parseFloat(tier.discountPercent)
    const effectivePrice = basePrice * (1 - discount / 100)
    const unit = item.pricingMode === 'day' ? 'j' : item.pricingMode === 'hour' ? 'h' : 'sem'
    return {
      unitPrice: effectivePrice,
      totalPrice: effectivePrice * duration * item.quantity,
      tierLabel: `-${discount}% (${tier.minDuration}+ ${unit})`,
      discount,
    }
  }

  return {
    unitPrice: basePrice,
    totalPrice: basePrice * duration * item.quantity,
    tierLabel: null,
    discount: 0,
  }
}

export function EditReservationForm({
  reservation,
  availableProducts,
  existingReservations,
  currency,
  storeSettings,
}: EditReservationFormProps) {
  const router = useRouter()
  // Use separate translators for different namespaces
  const t = useTranslations('dashboard.reservations')
  const tForm = useTranslations('dashboard.reservations.manualForm')
  const tCommon = useTranslations('common')
  const tErrors = useTranslations('errors')
  const currencySymbol = getCurrencySymbol(currency)

  // State
  const [isLoading, setIsLoading] = useState(false)
  const [startDate, setStartDate] = useState<Date | undefined>(new Date(reservation.startDate))
  const [endDate, setEndDate] = useState<Date | undefined>(new Date(reservation.endDate))
  const [items, setItems] = useState<EditableItem[]>(
    reservation.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      quantity: item.quantity,
      unitPrice: parseFloat(item.unitPrice),
      depositPerUnit: parseFloat(item.depositPerUnit),
      isManualPrice: (item.pricingBreakdown as unknown as Record<string, unknown> | null)?.isManualOverride === true,
      pricingMode: ((item.product?.pricingMode ??
        (item.pricingBreakdown as unknown as Record<string, unknown> | null)?.pricingMode ??
        'day') as PricingMode),
      productSnapshot: item.productSnapshot,
      product: item.product,
    }))
  )
  const [availabilityWarnings, setAvailabilityWarnings] = useState<AvailabilityWarning[]>([])
  const [validationWarningsToConfirm, setValidationWarningsToConfirm] = useState<
    ReservationValidationWarning[]
  >([])
  const [showValidationConfirmDialog, setShowValidationConfirmDialog] = useState(false)

  // Custom item dialog state
  const [showCustomItemDialog, setShowCustomItemDialog] = useState(false)
  const [customItemForm, setCustomItemForm] = useState({
    name: '',
    description: '',
    unitPrice: '',
    totalPrice: '',
    deposit: '',
    quantity: '1',
    pricingMode: 'day' as PricingMode,
  })

  // Original values for comparison
  const originalSubtotal = parseFloat(reservation.subtotalAmount)
  const originalDeposit = parseFloat(reservation.depositAmount)
  const originalDuration = calculateDuration(
    new Date(reservation.startDate),
    new Date(reservation.endDate),
    'day'
  )

  const getDurationForMode = useCallback(
    (mode: PricingMode) => {
      if (!startDate || !endDate) return 0
      return calculateDuration(startDate, endDate, mode)
    },
    [startDate, endDate]
  )

  // Period summary stays day-based; line calculations use each item pricing mode.
  const newDuration = useMemo(() => getDurationForMode('day'), [getDurationForMode])

  const getDurationUnit = useCallback(
    (mode: PricingMode) => (mode === 'hour' ? 'h' : mode === 'week' ? 'sem' : 'j'),
    []
  )

  // Check availability warnings
  const checkAvailabilityWarnings = useCallback(() => {
    if (!startDate || !endDate || items.length === 0) {
      setAvailabilityWarnings([])
      return
    }

    const warnings: AvailabilityWarning[] = []

    // Calculate reserved quantities from other reservations
    const reservedByProduct = new Map<string, number>()

    for (const res of existingReservations) {
      if (!['pending', 'confirmed', 'ongoing'].includes(res.status)) continue
      if (dateRangesOverlap(res.startDate, res.endDate, startDate, endDate)) {
        for (const item of res.items) {
          if (!item.productId) continue
          const current = reservedByProduct.get(item.productId) || 0
          reservedByProduct.set(item.productId, current + item.quantity)
        }
      }
    }

    // Check each item
    for (const item of items) {
      if (!item.productId || !item.product) continue

      const reserved = reservedByProduct.get(item.productId) || 0
      const available = Math.max(0, item.product.quantity - reserved)

      if (item.quantity > available) {
        warnings.push({
          productId: item.productId,
          productName: item.productSnapshot.name,
          requestedQuantity: item.quantity,
          availableQuantity: available,
        })
      }
    }

    setAvailabilityWarnings(warnings)
  }, [startDate, endDate, items, existingReservations])

  // Effect: check warnings when dates or items change
  useEffect(() => {
    checkAvailabilityWarnings()
  }, [checkAvailabilityWarnings])

  // Calculate totals
  const calculations = useMemo(() => {
    let subtotal = 0
    let deposit = 0

    const itemCalculations = items.map((item) => {
      const itemDuration = getDurationForMode(item.pricingMode)
      const calc = calculateItemPrice(item, itemDuration)
      subtotal += calc.totalPrice
      deposit += item.depositPerUnit * item.quantity
      return { ...item, ...calc, duration: itemDuration }
    })

    return {
      items: itemCalculations,
      subtotal,
      deposit,
      difference: subtotal - originalSubtotal,
    }
  }, [items, getDurationForMode, originalSubtotal])

  // Handlers
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
          return { ...item, isManualPrice: false, unitPrice: parseFloat(item.product.price) }
        }
        return { ...item, isManualPrice: true }
      })
    )
  }

  const handleRemoveItem = (itemId: string) => {
    if (items.length <= 1) {
      toastManager.add({ title: t('edit.cannotRemoveLastItem'), type: 'error' })
      return
    }
    setItems((prev) => prev.filter((item) => item.id !== itemId))
  }

  const handleAddProduct = (productId: string) => {
    const product = availableProducts.find((p) => p.id === productId)
    if (!product) return

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
      pricingMode: (product.pricingMode ?? 'day') as PricingMode,
    }

    setItems((prev) => [...prev, newItem])
  }

  // Custom item handlers
  const resetCustomItemForm = () => {
    setCustomItemForm({
      name: '',
      description: '',
      unitPrice: '',
      totalPrice: '',
      deposit: '',
      quantity: '1',
      pricingMode: 'day',
    })
  }

  const handleTotalPriceChange = (value: string) => {
    const total = parseFloat(value) || 0
    const qty = parseInt(customItemForm.quantity) || 1
    const customDuration = getDurationForMode(customItemForm.pricingMode)
    const unit = customDuration > 0 && qty > 0 ? total / (customDuration * qty) : 0
    setCustomItemForm((prev) => ({
      ...prev,
      totalPrice: value,
      unitPrice: unit > 0 ? unit.toFixed(2) : '',
    }))
  }

  const handleUnitPriceChange = (value: string) => {
    const unit = parseFloat(value) || 0
    const qty = parseInt(customItemForm.quantity) || 1
    const customDuration = getDurationForMode(customItemForm.pricingMode)
    const total = unit * customDuration * qty
    setCustomItemForm((prev) => ({
      ...prev,
      unitPrice: value,
      totalPrice: total > 0 ? total.toFixed(2) : '',
    }))
  }

  const handleCustomItemQuantityChange = (value: string) => {
    const qty = parseInt(value) || 1
    const unit = parseFloat(customItemForm.unitPrice) || 0
    const customDuration = getDurationForMode(customItemForm.pricingMode)
    const total = unit * customDuration * qty
    setCustomItemForm((prev) => ({
      ...prev,
      quantity: value,
      totalPrice: unit > 0 ? total.toFixed(2) : prev.totalPrice,
    }))
  }

  const handleAddCustomItem = () => {
    const name = customItemForm.name.trim()
    if (!name) {
      toastManager.add({ title: tForm('customItem.nameRequired'), type: 'error' })
      return
    }

    const totalPrice = parseFloat(customItemForm.totalPrice) || 0
    const unitPrice = parseFloat(customItemForm.unitPrice) || 0
    const quantity = parseInt(customItemForm.quantity) || 1
    const deposit = parseFloat(customItemForm.deposit) || 0

    if (totalPrice <= 0 && unitPrice <= 0) {
      toastManager.add({ title: tForm('customItem.priceRequired'), type: 'error' })
      return
    }

    const customDuration = getDurationForMode(customItemForm.pricingMode)
    if (customDuration <= 0) {
      toastManager.add({ title: tForm('customItem.selectPeriodFirst'), type: 'error' })
      return
    }

    const effectiveUnitPrice =
      unitPrice > 0
        ? unitPrice
        : totalPrice / (customDuration * quantity)

    const newItem: EditableItem = {
      id: `custom-${Date.now()}`,
      productId: null,
      quantity,
      unitPrice: effectiveUnitPrice,
      depositPerUnit: deposit,
      isManualPrice: true,
      productSnapshot: {
        name,
        description: customItemForm.description || null,
        images: [],
      },
      product: null,
      pricingMode: customItemForm.pricingMode,
    }

    setItems((prev) => [...prev, newItem])
    resetCustomItemForm()
    setShowCustomItemDialog(false)
    toastManager.add({ title: tForm('customItem.added'), type: 'success' })
  }

  const getRuleWarnings = useCallback((): ReservationValidationWarning[] => {
    if (!startDate || !endDate) return []

    return evaluateReservationRules({
      startDate,
      endDate,
      storeSettings,
    })
  }, [startDate, endDate, storeSettings])

  const getWarningLabel = useCallback(
    (warning: ReservationValidationWarning) => {
      const key = warning.key.replace('errors.', '')
      return tErrors(key, warning.params || {})
    },
    [tErrors]
  )

  const saveReservation = async () => {
    if (!startDate || !endDate) return

    if (items.length === 0) {
      toastManager.add({ title: t('edit.noItems'), type: 'error' })
      return
    }
    setIsLoading(true)
    try {
      const result = await updateReservation(reservation.id, {
        startDate,
        endDate,
        items: items.map((item) => ({
          id: item.id.startsWith('new-') || item.id.startsWith('custom-') ? undefined : item.id,
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          depositPerUnit: item.depositPerUnit,
          isManualPrice: item.isManualPrice,
          pricingMode: item.pricingMode,
          productSnapshot: item.productSnapshot,
        })),
      })

      if (result.error) {
        toastManager.add({ title: tErrors(result.error), type: 'error' })
      } else {
        const warnings = 'warnings' in result ? result.warnings : undefined
        if (warnings && warnings.length > 0) {
          const toastableWarnings = warnings.filter(
            (warning: ReservationValidationWarning) =>
              warning.code !== 'min_duration' &&
              warning.key !== 'errors.minRentalDurationViolation'
          )

          const warningMessage = toastableWarnings
            .map((warning: ReservationValidationWarning) => getWarningLabel(warning))
            .join(' • ')

          if (warningMessage) {
            toastManager.add({ title: warningMessage, type: 'warning' })
          }
        }

        toastManager.add({ title: t('edit.saved'), type: 'success' })
        router.push(`/dashboard/reservations/${reservation.id}`)
        router.refresh()
      }
    } catch {
      toastManager.add({ title: tErrors('generic'), type: 'error' })
    } finally {
      setIsLoading(false)
    }
  }

  const handleSave = async () => {
    if (!startDate || !endDate) {
      toastManager.add({ title: t('edit.datesRequired'), type: 'error' })
      return
    }

    const warnings = getRuleWarnings()
    if (warnings.length > 0) {
      setValidationWarningsToConfirm(warnings)
      setShowValidationConfirmDialog(true)
      return
    }

    await saveReservation()
  }

  const handleConfirmWarningSave = async () => {
    setShowValidationConfirmDialog(false)
    await saveReservation()
  }

  const hasChanges =
    (startDate?.getTime() ?? 0) !== new Date(reservation.startDate).getTime() ||
    (endDate?.getTime() ?? 0) !== new Date(reservation.endDate).getTime() ||
    calculations.subtotal !== originalSubtotal ||
    items.length !== reservation.items.length

  // Products not in the reservation
  const availableToAdd = availableProducts.filter(
    (p) => !items.some((item) => item.productId === p.id)
  )

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-muted/30">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-background border-b">
          <div className="container max-w-5xl mx-auto px-4 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Button render={<Link href={`/dashboard/reservations/${reservation.id}`} />} variant="ghost" size="icon" className="shrink-0">
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <div>
                  <div className="flex items-center gap-2">
                    <h1 className="text-lg font-semibold">{t('edit.title')}</h1>
                    <Badge variant="outline" className="font-mono">
                      #{reservation.number}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {reservation.customer.firstName} {reservation.customer.lastName}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button render={<Link href={`/dashboard/reservations/${reservation.id}`} />} variant="outline">
                  {tCommon('cancel')}
                </Button>
                <Button onClick={handleSave} disabled={isLoading || !hasChanges}>
                  {isLoading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="mr-2 h-4 w-4" />
                  )}
                  {t('edit.save')}
                </Button>
              </div>
            </div>
          </div>
        </div>

        <div className="container max-w-5xl mx-auto px-4 py-6">
          {/* Warnings */}
          {availabilityWarnings.length > 0 && (
            <Alert className="mb-6 border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-500" />
              <AlertDescription className="ml-2">
                <div className="flex flex-col gap-1">
                  {availabilityWarnings.map((warning) => (
                    <span key={warning.productId} className="font-medium text-amber-800 dark:text-amber-200">
                      <strong>{warning.productName}</strong>: {tForm('warnings.productConflictDetails', {
                        requested: warning.requestedQuantity,
                        available: warning.availableQuantity,
                      })}
                    </span>
                  ))}
                  <span className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                    {tForm('warnings.conflictCanContinue')}
                  </span>
                </div>
              </AlertDescription>
            </Alert>
          )}

          <div className="grid gap-6 lg:grid-cols-3">
            {/* Main Content */}
            <div className="lg:col-span-2 space-y-6">
              {/* Dates Card */}
              <Card>
                <CardContent className="p-6">
                  <h2 className="text-sm font-medium text-muted-foreground mb-4">
                    {t('edit.dates')}
                  </h2>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label className="text-xs">{t('edit.startDate')}</Label>
                      <DateTimePicker
                        date={startDate}
                        setDate={setStartDate}
                        showTime={true}
                        minTime="00:00"
                        maxTime="23:59"
                        timeStep={30}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs">{t('edit.endDate')}</Label>
                      <DateTimePicker
                        date={endDate}
                        setDate={setEndDate}
                        showTime={true}
                        minTime="00:00"
                        maxTime="23:59"
                        timeStep={30}
                        disabledDates={(date) => (startDate ? date < startDate : false)}
                      />
                    </div>
                  </div>
                  {newDuration > 0 && (
                    <div className="mt-4 flex items-center gap-2">
                      <Badge variant="secondary" className="font-mono">
                        {newDuration} {getDurationUnit('day')}
                      </Badge>
                      {newDuration !== originalDuration && (
                        <span className="text-xs text-muted-foreground">
                          (avant: {originalDuration} {getDurationUnit('day')})
                        </span>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Items Card */}
              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-sm font-medium text-muted-foreground">
                      {t('edit.items')}
                    </h2>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        onClick={() => setShowCustomItemDialog(true)}
                      >
                        <PenLine className="h-4 w-4 mr-2" />
                        {tForm('customItem.button')}
                      </Button>
                      {availableToAdd.length > 0 && (
                        <Select onValueChange={(value) => { if (value !== null) handleAddProduct(value as string) }}>
                          <SelectTrigger className="w-[160px] h-9">
                            <Plus className="h-4 w-4 mr-2" />
                            <SelectValue placeholder={t('edit.addItem')} />
                          </SelectTrigger>
                          <SelectContent>
                            {availableToAdd.map((product) => (
                              <SelectItem key={product.id} value={product.id}>
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
                        (w) => w.productId === item.productId
                      )
                      return (
                        <div
                          key={item.id}
                          className={cn(
                            'p-4 rounded-lg border bg-background transition-colors',
                            hasWarning && 'border-amber-300 bg-amber-50/50 dark:border-amber-700 dark:bg-amber-950/20'
                          )}
                        >
                          <div className="flex items-start gap-4">
                            {/* Product info */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="font-medium truncate">
                                  {item.productSnapshot.name}
                                </p>
                                {!item.product && (
                                  <Badge variant="outline" className="text-[10px] shrink-0">
                                    {tForm('customItem.badge')}
                                  </Badge>
                                )}
                                {item.isManualPrice && item.product && (
                                  <Badge variant="outline" className="text-[10px] shrink-0 border-amber-300 text-amber-600">
                                    Manuel
                                  </Badge>
                                )}
                              </div>
                              {item.tierLabel && !item.isManualPrice && (
                                <p className="text-xs text-emerald-600 mt-0.5">
                                  {item.tierLabel}
                                </p>
                              )}
                              {hasWarning && (
                                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1 flex items-center gap-1">
                                  <AlertTriangle className="h-3 w-3" />
                                  {tForm('warnings.insufficientStock')}
                                </p>
                              )}
                            </div>

                            {/* Quantity */}
                            <div className="flex items-center gap-1">
                              <Button
                                variant="outline"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => handleQuantityChange(item.id, item.quantity - 1)}
                                disabled={item.quantity <= 1}
                              >
                                <Minus className="h-3 w-3" />
                              </Button>
                              <Input
                                type="number"
                                min="1"
                                value={item.quantity}
                                onChange={(e) =>
                                  handleQuantityChange(item.id, parseInt(e.target.value) || 1)
                                }
                                className="w-14 h-8 text-center"
                              />
                              <Button
                                variant="outline"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => handleQuantityChange(item.id, item.quantity + 1)}
                              >
                                <Plus className="h-3 w-3" />
                              </Button>
                            </div>

                            {/* Unit price */}
                            <div className="flex items-center gap-1">
                              <div className="relative">
                                <Input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  value={item.unitPrice.toFixed(2)}
                                  onChange={(e) =>
                                    handlePriceChange(item.id, parseFloat(e.target.value) || 0)
                                  }
                                  className={cn(
                                    'w-24 h-8 text-right pr-10',
                                    item.isManualPrice && 'border-amber-300 bg-amber-50 dark:bg-amber-950/20'
                                  )}
                                />
                                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                                  {currencySymbol}/{getDurationUnit(item.pricingMode)}
                                </span>
                              </div>
                              {item.product && (
                                <Tooltip>
                                  <TooltipTrigger render={<Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8"
                                      onClick={() => handleToggleManualPrice(item.id)}
                                    />}>
                                    {item.isManualPrice ? (
                                      <Lock className="h-3.5 w-3.5 text-amber-600" />
                                    ) : (
                                      <Unlock className="h-3.5 w-3.5 text-muted-foreground" />
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

                            {/* Total */}
                            <div className="w-24 text-right">
                              <p className="font-semibold">
                                {item.totalPrice.toFixed(2)}{currencySymbol}
                              </p>
                            </div>

                            {/* Remove */}
                            <Tooltip>
                              <TooltipTrigger render={<Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                  onClick={() => handleRemoveItem(item.id)}
                                  disabled={items.length <= 1}
                                />}>
                                <Trash2 className="h-4 w-4" />
                              </TooltipTrigger>
                              <TooltipContent>{tCommon('delete')}</TooltipContent>
                            </Tooltip>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Sidebar */}
            <div className="space-y-6">
              {/* Summary Card */}
              <Card className="sticky top-24">
                <CardContent className="p-6">
                  <h2 className="text-sm font-medium text-muted-foreground mb-4">
                    {t('edit.summary')}
                  </h2>

                  <div className="space-y-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{t('edit.before')}</span>
                      <span>{originalSubtotal.toFixed(2)}{currencySymbol}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{t('edit.after')}</span>
                      <span className="font-medium">{calculations.subtotal.toFixed(2)}{currencySymbol}</span>
                    </div>

                    <Separator />

                    <div className="flex justify-between">
                      <span className="font-medium">{t('edit.difference')}</span>
                      <span
                        className={cn(
                          'font-bold text-lg',
                          calculations.difference > 0 && 'text-emerald-600',
                          calculations.difference < 0 && 'text-red-600'
                        )}
                      >
                        {calculations.difference >= 0 ? '+' : ''}
                        {calculations.difference.toFixed(2)}{currencySymbol}
                      </span>
                    </div>

                    {calculations.difference !== 0 && (
                      <p className="text-xs text-muted-foreground bg-muted rounded-lg p-3">
                        {calculations.difference > 0
                          ? t('edit.adjustmentPositive', {
                              amount: `${calculations.difference.toFixed(2)}${currencySymbol}`,
                            })
                          : t('edit.adjustmentNegative', {
                              amount: `${Math.abs(calculations.difference).toFixed(2)}${currencySymbol}`,
                            })}
                      </p>
                    )}

                    <Separator />

                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{t('edit.deposit')}</span>
                      <span>
                        {originalDeposit !== calculations.deposit ? (
                          <>
                            <span className="text-muted-foreground line-through mr-2">
                              {originalDeposit.toFixed(2)}
                            </span>
                            {calculations.deposit.toFixed(2)}{currencySymbol}
                          </>
                        ) : (
                          <>{calculations.deposit.toFixed(2)}{currencySymbol}</>
                        )}
                      </span>
                    </div>
                  </div>

                  <Button
                    className="w-full mt-6"
                    size="lg"
                    onClick={handleSave}
                    disabled={isLoading || !hasChanges}
                  >
                    {isLoading ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <ChevronRight className="mr-2 h-4 w-4" />
                    )}
                    {t('edit.save')}
                  </Button>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>

      {/* Custom Item Dialog */}
      <Dialog open={showCustomItemDialog} onOpenChange={setShowCustomItemDialog}>
        <DialogPopup className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PenLine className="h-5 w-5" />
              {tForm('customItem.dialogTitle')}
            </DialogTitle>
            <DialogDescription>
              {tForm('customItem.dialogDescription')}
            </DialogDescription>
          </DialogHeader>

          <DialogPanel>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="custom-name">{tForm('customItem.name')} *</Label>
              <Input
                id="custom-name"
                placeholder={tForm('customItem.namePlaceholder')}
                value={customItemForm.name}
                onChange={(e) => setCustomItemForm({ ...customItemForm, name: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="custom-description">{tForm('customItem.description')}</Label>
              <Textarea
                id="custom-description"
                placeholder={tForm('customItem.descriptionPlaceholder')}
                value={customItemForm.description}
                onChange={(e) =>
                  setCustomItemForm({ ...customItemForm, description: e.target.value })
                }
                className="resize-none"
                rows={2}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="custom-quantity">{tForm('customItem.quantity')}</Label>
                <Input
                  id="custom-quantity"
                  type="number"
                  min="1"
                  value={customItemForm.quantity}
                  onChange={(e) => handleCustomItemQuantityChange(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="custom-deposit">{tForm('customItem.deposit')}</Label>
                <div className="relative">
                  <Input
                    id="custom-deposit"
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    value={customItemForm.deposit}
                    onChange={(e) =>
                      setCustomItemForm({ ...customItemForm, deposit: e.target.value })
                    }
                    className="pr-8"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    {currencySymbol}
                  </span>
                </div>
              </div>
            </div>

            {getDurationForMode(customItemForm.pricingMode) > 0 ? (
              <div className="rounded-lg border bg-muted/30 p-4 space-y-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{tForm('customItem.pricingPeriod')}</span>
                  <span className="font-medium">
                    {getDurationForMode(customItemForm.pricingMode)}{' '}
                    {getDurationUnit(customItemForm.pricingMode)} × {customItemForm.quantity || 1}{' '}
                    {tForm('customItem.units')}
                  </span>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="custom-pricing-mode" className="text-xs">
                    {tForm('pricingMode')}
                  </Label>
                  <Select
                    value={customItemForm.pricingMode}
                    onValueChange={(value) => {
                      if (value === null) return
                      const pricingMode = value as PricingMode
                      setCustomItemForm((prev) => ({ ...prev, pricingMode }))
                    }}
                  >
                    <SelectTrigger id="custom-pricing-mode" className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hour">{tForm('perHour')}</SelectItem>
                      <SelectItem value="day">{tForm('perDay')}</SelectItem>
                      <SelectItem value="week">{tForm('perWeek')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="custom-total" className="text-xs">
                      {tForm('customItem.totalPrice')} *
                    </Label>
                    <div className="relative">
                      <Input
                        id="custom-total"
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        value={customItemForm.totalPrice}
                        onChange={(e) => handleTotalPriceChange(e.target.value)}
                        className="pr-8"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                        {currencySymbol}
                      </span>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="custom-unit" className="text-xs">
                      {tForm('customItem.unitPrice')}
                    </Label>
                    <div className="relative">
                      <Input
                        id="custom-unit"
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        value={customItemForm.unitPrice}
                        onChange={(e) => handleUnitPriceChange(e.target.value)}
                        className="pr-12"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                        {currencySymbol}/{getDurationUnit(customItemForm.pricingMode)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{tForm('customItem.selectPeriodFirst')}</AlertDescription>
              </Alert>
            )}
          </div>
          </DialogPanel>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                resetCustomItemForm()
                setShowCustomItemDialog(false)
              }}
            >
              {tCommon('cancel')}
            </Button>
            <Button
              type="button"
              onClick={handleAddCustomItem}
              disabled={getDurationForMode(customItemForm.pricingMode) === 0}
            >
              <Plus className="h-4 w-4 mr-2" />
              {tForm('customItem.addButton')}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>

      <Dialog open={showValidationConfirmDialog} onOpenChange={setShowValidationConfirmDialog}>
        <DialogPopup className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              {t('edit.warningDialogTitle')}
            </DialogTitle>
            <DialogDescription>
              {t('edit.warningDialogDescription')}
            </DialogDescription>
          </DialogHeader>

          <DialogPanel>
          <div className="space-y-2">
            {validationWarningsToConfirm.map((warning, index) => (
              <div
                key={`${warning.code}-${index}`}
                className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
              >
                {getWarningLabel(warning)}
              </div>
            ))}
            <p className="text-sm text-muted-foreground">{tForm('warnings.canContinue')}</p>
          </div>
          </DialogPanel>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowValidationConfirmDialog(false)}
              disabled={isLoading}
            >
              {tCommon('cancel')}
            </Button>
            <Button onClick={handleConfirmWarningSave} disabled={isLoading}>
              {isLoading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <AlertTriangle className="mr-2 h-4 w-4" />
              )}
              {t('edit.confirmWithWarnings')}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </TooltipProvider>
  )
}
