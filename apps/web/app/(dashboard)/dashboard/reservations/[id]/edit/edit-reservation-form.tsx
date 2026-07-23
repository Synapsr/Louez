'use client'

import { useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { toastManager } from '@louez/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  Loader2,
  Plus,
  PenLine,
  AlertTriangle,
  Check,
  Mail,
} from 'lucide-react'

import { Button } from '@louez/ui'
import { Card, CardContent } from '@louez/ui'
import { Input } from '@louez/ui'
import { Label } from '@louez/ui'
import { Textarea } from '@louez/ui'
import { Badge } from '@louez/ui'
import { Checkbox } from '@louez/ui'
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
import { TooltipProvider } from '@louez/ui'
import { Alert, AlertDescription } from '@louez/ui'
import { ReservationDatePickerControl } from '@/components/form/form-reservation-date-picker'
import { cn, formatCurrency, getCurrencySymbol, minutesToPriceDuration } from '@louez/utils'
import { calculateDuration } from '@/lib/utils/duration'
import { useStoreTimezone } from '@/contexts/store-context'
import {
  evaluateReservationRules,
  type ReservationValidationWarning,
} from '@/lib/utils/reservation-rules'
import { formatStoreDate } from '@/lib/utils/store-date'
import { isLegacyTulipInsuranceItem } from '@/lib/integrations/tulip/contracts-insurance'
import { orpc } from '@/lib/orpc/react'
import { invalidateReservationAll } from '@/lib/orpc/invalidation'
import type { PricingMode } from '@louez/types'
import { EditReservationItemsSection } from './components/edit-reservation-items-section'
import { EditReservationSummarySection } from './components/edit-reservation-summary-section'
import { EditReservationDeliverySection } from './components/edit-reservation-delivery-section'
import { useEditReservationAvailability } from './hooks/use-edit-reservation-availability'
import { useEditReservationPricing } from './hooks/use-edit-reservation-pricing'
import { useEditReservationDelivery } from './hooks/use-edit-reservation-delivery'
import type { EditReservationFormProps, EditableItem, ReservationItem } from './types'

function parseCoordinate(value: string | null): number | null {
  return value ? parseFloat(value) : null
}

function isSameStoreDay(dateA: Date, dateB: Date, timezone?: string): boolean {
  return (
    formatStoreDate(dateA, timezone, 'yyyy-MM-dd') ===
    formatStoreDate(dateB, timezone, 'yyyy-MM-dd')
  )
}

function resolvePricingModeFromMinutes(
  periodMinutes: number | null | undefined,
  fallback: PricingMode,
): PricingMode {
  if (!periodMinutes || periodMinutes <= 0) {
    return fallback
  }

  const period = minutesToPriceDuration(periodMinutes)
  if (period.unit === 'week') return 'week'
  if (period.unit === 'day') return 'day'
  return 'hour'
}

function resolveInitialManualPricingMode(
  product: EditableItem['product'],
  fallback: PricingMode,
  startDate: Date,
  endDate: Date,
): PricingMode {
  if (!product?.basePeriodMinutes || product.basePeriodMinutes <= 0) {
    return fallback
  }

  const durationMinutes = Math.max(
    1,
    Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60)),
  )
  const periods = [
    product.basePeriodMinutes,
    ...product.pricingTiers.map((tier) => tier.period ?? null),
  ]
    .filter((period): period is number => typeof period === 'number' && period > 0)
    .sort((a, b) => a - b)

  if (periods.length === 0) {
    return fallback
  }

  const applicablePeriod =
    [...periods].reverse().find((period) => period <= durationMinutes) ?? periods[0]

  return resolvePricingModeFromMinutes(applicablePeriod, fallback)
}

function isEmailNotificationResult(
  value: unknown,
): value is { status: 'sent' | 'failed'; error?: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'status' in value &&
    (value.status === 'sent' || value.status === 'failed')
  )
}

function getErrorTranslationKey(error: string): string {
  return error.startsWith('errors.') ? error.replace('errors.', '') : error
}

function isBufferConflictResult(
  value: unknown,
): value is { bufferConflict: true; failedUnitIds?: string[] } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'bufferConflict' in value &&
    value.bufferConflict === true
  )
}

function isTooManyAssignedUnitsResult(
  value: unknown,
): value is {
  error: 'errors.tooManyAssignedUnits'
  reservationItemId: string
  assignedCount: number
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    value.error === 'errors.tooManyAssignedUnits' &&
    'reservationItemId' in value &&
    typeof value.reservationItemId === 'string' &&
    'assignedCount' in value &&
    typeof value.assignedCount === 'number'
  )
}

function isAssignedUnitsConflictResult(
  value: unknown,
): value is {
  error: 'errors.assignedUnitsConflict'
  conflicts: Array<{ identifier: string }>
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    value.error === 'errors.assignedUnitsConflict' &&
    'conflicts' in value &&
    Array.isArray(value.conflicts)
  )
}

function toReservationItemPayload(item: EditableItem) {
  return {
    id: item.id.startsWith('new-') || item.id.startsWith('custom-') ? undefined : item.id,
    productId: item.productId,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    depositPerUnit: item.depositPerUnit,
    isManualPrice: item.isManualPrice,
    pricingMode: item.pricingMode,
    productSnapshot: {
      name: item.productSnapshot.name,
      description: item.productSnapshot.description ?? null,
    },
  }
}

function toEditableItem(item: ReservationItem, startDate: Date, endDate: Date): EditableItem {
  const isManualPrice =
    (item.pricingBreakdown as unknown as Record<string, unknown> | null)?.isManualOverride ===
    true
  const fallbackPricingMode = ((item.product?.pricingMode ??
    (item.pricingBreakdown as unknown as Record<string, unknown> | null)?.pricingMode ??
    'day') as PricingMode)
  const pricingMode = isManualPrice
    ? resolveInitialManualPricingMode(item.product, fallbackPricingMode, startDate, endDate)
    : fallbackPricingMode
  const duration = calculateDuration(startDate, endDate, pricingMode)
  const preciseManualUnitPrice =
    isManualPrice && item.quantity > 0 && duration > 0
      ? Number(item.totalPrice) / (duration * item.quantity)
      : Number(item.unitPrice)

  return {
    id: item.id,
    productId: item.productId,
    quantity: item.quantity,
    unitPrice: preciseManualUnitPrice,
    depositPerUnit: parseFloat(item.depositPerUnit),
    isManualPrice,
    pricingMode,
    basePeriodMinutes: item.product?.basePeriodMinutes ?? null,
    enforceStrictTiers: item.product?.enforceStrictTiers ?? false,
    productSnapshot: item.productSnapshot,
    product: item.product,
  }
}

function roundComparableNumber(value: number): number {
  return Math.round(value * 100) / 100
}

function buildItemsChangeSignature(items: EditableItem[]): string {
  const comparableItems = items
    .map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      unitPrice: roundComparableNumber(item.unitPrice),
      depositPerUnit: roundComparableNumber(item.depositPerUnit),
      isManualPrice: item.isManualPrice,
      pricingMode: item.pricingMode,
      productSnapshotName: item.productSnapshot.name.trim(),
      productSnapshotDescription: item.productSnapshot.description?.trim() ?? null,
    }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))

  return JSON.stringify(comparableItems)
}

export function EditReservationForm({
  reservation,
  availableProducts,
  existingReservations,
  currency,
  tulipInsuranceMode,
  storeSettings,
  storeDelivery,
}: EditReservationFormProps) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const t = useTranslations('dashboard.reservations')
  const tForm = useTranslations('dashboard.reservations.manualForm')
  const tCommon = useTranslations('common')
  const tErrors = useTranslations('errors')
  const tValidation = useTranslations('validation')
  const timezone = useStoreTimezone()
  const currencySymbol = getCurrencySymbol(currency)

  const updateReservationMutation = useMutation(
    orpc.dashboard.reservations.updateReservation.mutationOptions({
      onSuccess: async () => {
        await invalidateReservationAll(queryClient, reservation.id)
        await queryClient.fetchQuery(
          orpc.dashboard.reservations.getById.queryOptions({
            input: { reservationId: reservation.id },
          }),
        )
      },
    }),
  )
  const sendModificationEmailMutation = useMutation(
    orpc.dashboard.reservations.sendModificationEmail.mutationOptions({
      onSuccess: async () => {
        await invalidateReservationAll(queryClient, reservation.id)
      },
    }),
  )

  // State
  const [isLoading, setIsLoading] = useState(false)
  const [startDate, setStartDate] = useState<Date | undefined>(new Date(reservation.startDate))
  const [endDate, setEndDate] = useState<Date | undefined>(new Date(reservation.endDate))
  const endMinTime =
    startDate && endDate && isSameStoreDay(startDate, endDate, timezone)
      ? formatStoreDate(startDate, timezone, 'TIME_ONLY')
      : '00:00'
  const handleEndDateChange = useCallback(
    (date: Date | undefined) => {
      if (date && startDate && isSameStoreDay(startDate, date, timezone) && date < startDate) {
        setEndDate(startDate)
        return
      }

      setEndDate(date)
    },
    [startDate, timezone],
  )
  const editableReservationItems = reservation.items.filter(
    (item) =>
      !isLegacyTulipInsuranceItem({
        isCustomItem: item.isCustomItem,
        productSnapshot: item.productSnapshot,
      })
  )
  const initialEditableItems = useMemo(
    () =>
      editableReservationItems.map((item) =>
        toEditableItem(
          item,
          new Date(reservation.startDate),
          new Date(reservation.endDate),
        )
      ),
    [editableReservationItems, reservation.startDate, reservation.endDate],
  )
  const legacyInsuranceAmount = reservation.items.reduce((sum, item) => {
    if (
      !isLegacyTulipInsuranceItem({
        isCustomItem: item.isCustomItem,
        productSnapshot: item.productSnapshot,
      })
    ) {
      return sum
    }

    const parsed = Number(item.totalPrice)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return sum
    }

    return sum + parsed
  }, 0)
  const initialTulipInsuranceAmount = (() => {
    const parsedInsuranceAmount = Number(reservation.tulipInsuranceAmount ?? '0')
    if (Number.isFinite(parsedInsuranceAmount) && parsedInsuranceAmount > 0) {
      return parsedInsuranceAmount
    }

    return legacyInsuranceAmount
  })()
  const [items, setItems] = useState<EditableItem[]>(
    initialEditableItems
  )
  const [validationWarningsToConfirm, setValidationWarningsToConfirm] = useState<
    ReservationValidationWarning[]
  >([])
  const [showValidationConfirmDialog, setShowValidationConfirmDialog] = useState(false)
  const [notifyCustomerByEmail, setNotifyCustomerByEmail] = useState(false)
  const [emailRetryWarning, setEmailRetryWarning] = useState<string | null>(null)
  const initialTulipInsuranceOptIn =
    tulipInsuranceMode === 'required'
      ? true
      : tulipInsuranceMode === 'optional'
        ? reservation.tulipInsuranceOptIn === true
        : false
  const [tulipInsuranceOptIn, setTulipInsuranceOptIn] = useState(initialTulipInsuranceOptIn)
  const isTulipInsurancePastDateBlocked =
    tulipInsuranceMode !== 'no_public' &&
    startDate !== undefined &&
    startDate.getTime() < Date.now()
  const effectiveTulipInsuranceOptIn =
    !isTulipInsurancePastDateBlocked &&
    (tulipInsuranceMode === 'required'
      ? true
      : tulipInsuranceMode === 'optional'
        ? tulipInsuranceOptIn
        : false)
  const tulipInsuranceQuoteItems = useMemo(
    () =>
      items
        .filter(
          (item): item is EditableItem & { productId: string } =>
            typeof item.productId === 'string' &&
            item.productId.length > 0 &&
            item.quantity > 0,
        )
        .map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
        })),
    [items],
  )
  const tulipInsuranceQuoteRequest = useMemo(() => {
    if (
      !effectiveTulipInsuranceOptIn ||
      isTulipInsurancePastDateBlocked ||
      !startDate ||
      !endDate ||
      endDate < startDate ||
      tulipInsuranceQuoteItems.length === 0
    ) {
      return null
    }

    return {
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      tulipInsuranceOptIn: true,
      items: tulipInsuranceQuoteItems,
    }
  }, [
    effectiveTulipInsuranceOptIn,
    endDate,
    isTulipInsurancePastDateBlocked,
    startDate,
    tulipInsuranceQuoteItems,
  ])
  const tulipInsuranceQuoteInput = {
    reservationId: reservation.id,
    payload:
      tulipInsuranceQuoteRequest ??
      ({
        startDate: (startDate ?? new Date(reservation.startDate)).toISOString(),
        endDate: (endDate ?? new Date(reservation.endDate)).toISOString(),
        tulipInsuranceOptIn: false,
        items: [],
      } as const),
  }
  const tulipInsuranceQuoteQuery = useQuery({
    ...orpc.dashboard.reservations.previewTulipQuote.queryOptions({
      input: tulipInsuranceQuoteInput,
    }),
    enabled: tulipInsuranceQuoteRequest !== null,
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  })
  const isTulipInsuranceQuoteLoading =
    tulipInsuranceQuoteRequest !== null &&
    (tulipInsuranceQuoteQuery.isLoading ||
      (tulipInsuranceQuoteQuery.isFetching && !tulipInsuranceQuoteQuery.data))
  const tulipInsuranceQuotePreview = tulipInsuranceQuoteQuery.data
  const quotedTulipInsuranceAmount =
    tulipInsuranceQuotePreview?.appliedOptIn && tulipInsuranceQuotePreview.amount > 0
      ? tulipInsuranceQuotePreview.amount
      : 0
  const quoteFallbackTulipInsuranceAmount =
    isTulipInsuranceQuoteLoading ||
    tulipInsuranceQuotePreview?.quoteUnavailable ||
    tulipInsuranceQuoteQuery.isError
      ? initialTulipInsuranceAmount
      : 0
  const originalPeriodMs =
    new Date(reservation.endDate).getTime() - new Date(reservation.startDate).getTime()
  const currentPeriodMs =
    startDate && endDate ? endDate.getTime() - startDate.getTime() : originalPeriodMs
  const isPeriodReduced = currentPeriodMs < originalPeriodMs
  const fixedTulipInsuranceAmount = effectiveTulipInsuranceOptIn
    ? Math.max(
        quotedTulipInsuranceAmount > 0
          ? quotedTulipInsuranceAmount
          : quoteFallbackTulipInsuranceAmount,
        isPeriodReduced ? initialTulipInsuranceAmount : 0,
      )
    : 0
  const tulipInsuranceQuoteErrorKey = tulipInsuranceQuoteQuery.isError
    ? 'errors.tulipQuoteFailed'
    : (tulipInsuranceQuotePreview?.quoteError ?? null)
  const tulipInsuranceQuoteErrorMessage = tulipInsuranceQuoteErrorKey
    ? tErrors(tulipInsuranceQuoteErrorKey.replace('errors.', ''))
    : null

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
  const originalDeliveryFee = parseFloat(reservation.deliveryFee ?? '0')
  const originalDuration = calculateDuration(
    new Date(reservation.startDate),
    new Date(reservation.endDate),
    'day'
  )
  const { getDurationForMode, getDurationUnit, newDuration, calculations } =
    useEditReservationPricing({
      startDate,
      endDate,
      items,
      originalSubtotal,
      fixedChargesTotal: fixedTulipInsuranceAmount,
    })
  const { availabilityWarnings, availableQuantityByProduct } =
    useEditReservationAvailability({
      startDate,
      endDate,
      items,
      products: availableProducts,
      existingReservations,
      turnoverBufferMinutes: storeSettings?.turnoverBufferMinutes ?? 0,
    })

  // Delivery state
  const delivery = useEditReservationDelivery({
    storeDelivery,
    initialDelivery: reservation.delivery,
    subtotal: calculations.subtotal,
  })

  // Handlers
  const handleQuantityChange = (itemId: string, quantity: number) => {
    setItems((prev) =>
      prev.map((item) =>
        item.id === itemId ? { ...item, quantity: Math.max(1, quantity) } : item
      )
    )
  }

  const handlePriceChange = (
    itemId: string,
    price: number,
    pricingMode?: PricingMode,
  ) => {
    setItems((prev) =>
      prev.map((item) =>
        item.id === itemId
          ? {
              ...item,
              unitPrice: price,
              isManualPrice: true,
              pricingMode: pricingMode ?? item.pricingMode,
            }
          : item
      )
    )
  }

  const handleItemTotalPriceChange = (
    itemId: string,
    totalPrice: number,
    pricingMode?: PricingMode,
  ) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== itemId) return item

        const effectivePricingMode = pricingMode ?? item.pricingMode
        const itemDuration = startDate && endDate
          ? getDurationForMode(effectivePricingMode)
          : 0
        const unitPrice =
          itemDuration > 0 && item.quantity > 0
            ? totalPrice / (itemDuration * item.quantity)
            : totalPrice

        return {
          ...item,
          unitPrice,
          isManualPrice: true,
          pricingMode: effectivePricingMode,
        }
      })
    )
  }

  const handleDepositChange = (itemId: string, depositPerUnit: number) => {
    setItems((prev) =>
      prev.map((item) =>
        item.id === itemId
          ? { ...item, depositPerUnit: Math.max(0, depositPerUnit) }
          : item
      )
    )
  }

  const handleToggleManualPrice = (
    itemId: string,
    effectiveUnitPrice?: number,
    pricingMode?: PricingMode,
  ) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== itemId) return item
        if (item.isManualPrice && item.product) {
          return { ...item, isManualPrice: false, unitPrice: parseFloat(item.product.price) }
        }
        return {
          ...item,
          isManualPrice: true,
          unitPrice: effectiveUnitPrice ?? item.unitPrice,
          pricingMode: pricingMode ?? item.pricingMode,
        }
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
      basePeriodMinutes: product.basePeriodMinutes ?? null,
      enforceStrictTiers: product.enforceStrictTiers ?? false,
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

  const saveReservation = async (overrideTurnoverBuffer = false) => {
    if (!startDate || !endDate) return

    if (items.length === 0) {
      toastManager.add({ title: t('edit.noItems'), type: 'error' })
      return
    }
    setIsLoading(true)
    try {
      // Build delivery payload when delivery is available
      const deliveryPayload = storeDelivery
        ? {
            outbound: {
              method: delivery.outbound.method as 'store' | 'address',
              ...(delivery.outbound.method === 'address'
                ? {
                    address: delivery.outbound.address.address,
                    city: delivery.outbound.address.city,
                    postalCode: delivery.outbound.address.postalCode,
                    country: delivery.outbound.address.country,
                    latitude: delivery.outbound.address.latitude ?? undefined,
                    longitude: delivery.outbound.address.longitude ?? undefined,
                  }
                : {
                    locationId: delivery.outbound.locationId,
                  }),
            },
            return: {
              method: delivery.inbound.method as 'store' | 'address',
              ...(delivery.inbound.method === 'address'
                ? {
                    address: delivery.inbound.address.address,
                    city: delivery.inbound.address.city,
                    postalCode: delivery.inbound.address.postalCode,
                    country: delivery.inbound.address.country,
                    latitude: delivery.inbound.address.latitude ?? undefined,
                    longitude: delivery.inbound.address.longitude ?? undefined,
                  }
                : {
                    locationId: delivery.inbound.locationId,
                  }),
            },
          }
        : undefined

      const result = await updateReservationMutation.mutateAsync({
        reservationId: reservation.id,
        payload: {
          startDate,
          endDate,
          notifyCustomerByEmail,
          tulipInsuranceOptIn: effectiveTulipInsuranceOptIn,
          overrideTurnoverBuffer,
          delivery: deliveryPayload,
          items: items.map(toReservationItemPayload),
        },
      })

      if (result.error) {
        if (isBufferConflictResult(result)) {
          const shouldOverride = window.confirm(
            tErrors('turnoverBufferConflict'),
          )
          if (shouldOverride) {
            await saveReservation(true)
          }
          return
        }

        if (isTooManyAssignedUnitsResult(result)) {
          const itemName =
            items.find((item) => item.id === result.reservationItemId)
              ?.productSnapshot.name ?? result.reservationItemId
          toastManager.add({
            title: tErrors('tooManyAssignedUnits', {
              item: itemName,
              assignedCount: result.assignedCount,
            }),
            type: 'error',
          })
          return
        }

        if (isAssignedUnitsConflictResult(result)) {
          const identifiers = result.conflicts
            .map((conflict) => conflict.identifier)
            .filter((identifier) => identifier.length > 0)
            .join(', ')
          toastManager.add({
            title: tErrors('assignedUnitsConflict', { identifiers }),
            type: 'error',
          })
          return
        }

        toastManager.add({
          title: tErrors(getErrorTranslationKey(result.error)),
          type: 'error',
        })
      } else {
        const warnings = result.warnings
        if (Array.isArray(warnings) && warnings.length > 0) {
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

        const emailNotification = isEmailNotificationResult(result.emailNotification)
          ? result.emailNotification
          : null
        if (emailNotification?.status === 'failed') {
          setEmailRetryWarning(t('edit.emailNotificationFailed'))
          toastManager.add({ title: t('edit.savedEmailFailed'), type: 'warning' })
          return
        }

        setEmailRetryWarning(null)
        toastManager.add({
          title:
            emailNotification?.status === 'sent'
              ? t('edit.savedEmailSent')
              : t('edit.saved'),
          type: 'success',
        })
        router.push(`/dashboard/reservations/${reservation.id}`)
        router.refresh()
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('errors.')) {
        toastManager.add({
          title: tErrors(getErrorTranslationKey(error.message)),
          type: 'error',
        })
        return
      }

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

    if (endDate < startDate) {
      toastManager.add({ title: tValidation('endDateBeforeStart'), type: 'error' })
      return
    }

    if (delivery.isCalculating) {
      toastManager.add({ title: tForm('loading'), type: 'error' })
      return
    }

    // Check for delivery errors
    if (delivery.hasErrors) {
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

  const handleRetryModificationEmail = async () => {
    setIsLoading(true)
    try {
      await sendModificationEmailMutation.mutateAsync({
        reservationId: reservation.id,
        payload: {
          previousStartDate: reservation.startDate,
          previousEndDate: reservation.endDate,
        },
      })
      setEmailRetryWarning(null)
      toastManager.add({ title: t('edit.emailNotificationSent'), type: 'success' })
      router.push(`/dashboard/reservations/${reservation.id}`)
    } catch {
      setEmailRetryWarning(t('edit.emailNotificationFailed'))
      toastManager.add({ title: t('edit.emailNotificationRetryFailed'), type: 'error' })
    } finally {
      setIsLoading(false)
    }
  }

  const hasDeliveryAddressChanges =
    (
      (delivery.outbound.method === 'address' ||
        reservation.delivery.outboundMethod === 'address') &&
      (
        delivery.outbound.address.address !== (reservation.delivery.deliveryAddress ?? '') ||
        delivery.outbound.address.latitude !== parseCoordinate(reservation.delivery.deliveryLatitude) ||
        delivery.outbound.address.longitude !== parseCoordinate(reservation.delivery.deliveryLongitude)
      )
    ) ||
    (
      (delivery.inbound.method === 'address' ||
        reservation.delivery.returnMethod === 'address') &&
      (
        delivery.inbound.address.address !== (reservation.delivery.returnAddress ?? '') ||
        delivery.inbound.address.latitude !== parseCoordinate(reservation.delivery.returnLatitude) ||
        delivery.inbound.address.longitude !== parseCoordinate(reservation.delivery.returnLongitude)
      )
    )

  const deliveryMinimumAmount =
    storeDelivery?.settings.minimumOrderAmountForDelivery ?? null
  const deliveryMinimumWarning =
    storeDelivery?.settings.mode === 'optional' &&
    deliveryMinimumAmount !== null &&
    calculations.subtotal < deliveryMinimumAmount &&
    (delivery.outbound.method === 'address' || delivery.inbound.method === 'address')
      ? tForm('deliveryMinimumOverrideWarning', {
          amount: formatCurrency(deliveryMinimumAmount, currency),
        })
      : null

  const hasDeliveryLocationChanges =
    (
      (delivery.outbound.method === 'store' ||
        reservation.delivery.outboundMethod === 'store') &&
      delivery.outbound.locationId !== reservation.delivery.pickupLocationId
    ) ||
    (
      (delivery.inbound.method === 'store' ||
        reservation.delivery.returnMethod === 'store') &&
      delivery.inbound.locationId !== reservation.delivery.returnLocationId
    )

  const originalItemsSignature = useMemo(
    () => buildItemsChangeSignature(initialEditableItems),
    [initialEditableItems],
  )
  const currentItemsSignature = useMemo(
    () => buildItemsChangeSignature(items),
    [items],
  )
  const hasItemChanges = currentItemsSignature !== originalItemsSignature

  const hasChanges =
    (startDate?.getTime() ?? 0) !== new Date(reservation.startDate).getTime() ||
    (endDate?.getTime() ?? 0) !== new Date(reservation.endDate).getTime() ||
    calculations.subtotal !== originalSubtotal ||
    effectiveTulipInsuranceOptIn !== initialTulipInsuranceOptIn ||
    hasItemChanges ||
    delivery.totalFee !== originalDeliveryFee ||
    delivery.outbound.method !== reservation.delivery.outboundMethod ||
    delivery.inbound.method !== reservation.delivery.returnMethod ||
    hasDeliveryLocationChanges ||
    hasDeliveryAddressChanges

  const hasScheduleChanges =
    (startDate?.getTime() ?? 0) !== new Date(reservation.startDate).getTime() ||
    (endDate?.getTime() ?? 0) !== new Date(reservation.endDate).getTime()

  // The add handler increments quantity when the product is already present.
  const availableToAdd = availableProducts

  return (
    <TooltipProvider>
      <div className="-mx-4 -my-6 sm:-mx-6 lg:-mx-8 min-h-screen bg-muted/30">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-background border-b">
          <div className="container max-w-5xl mx-auto px-3 py-3 sm:px-4 sm:py-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
                <Button render={<Link href={`/dashboard/reservations/${reservation.id}`} />} variant="ghost" size="icon" className="shrink-0">
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <h1 className="text-base sm:text-lg font-semibold truncate">{t('edit.title')}</h1>
                    <Badge variant="outline" className="font-mono shrink-0">
                      #{reservation.number}
                    </Badge>
                  </div>
                  <p className="text-xs sm:text-sm text-muted-foreground truncate">
                    {reservation.customer.firstName} {reservation.customer.lastName}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  render={<Link href={`/dashboard/reservations/${reservation.id}`} />}
                  variant="outline"
                  size="icon"
                  className="sm:hidden"
                  title={tCommon('cancel')}
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <Button
                  render={<Link href={`/dashboard/reservations/${reservation.id}`} />}
                  variant="outline"
                  className="hidden sm:inline-flex"
                >
                  {tCommon('cancel')}
                </Button>
                <Button
                  onClick={handleSave}
                  disabled={isLoading || delivery.isCalculating || !hasChanges}
                  size="icon"
                  className="sm:hidden"
                  title={t('edit.save')}
                >
                  {isLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4" />
                  )}
                </Button>
                <Button
                  onClick={handleSave}
                  disabled={isLoading || delivery.isCalculating || !hasChanges}
                  className="hidden sm:inline-flex"
                >
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

        <div className="container max-w-5xl mx-auto px-3 py-4 sm:px-4 sm:py-6">
          {emailRetryWarning && (
            <Alert variant="warning" className="mb-4 sm:mb-6">
              <Mail className="h-4 w-4" />
              <AlertDescription className="ml-2">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-sm font-medium text-amber-800 dark:text-amber-200">
                    {emailRetryWarning}
                  </span>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => router.push(`/dashboard/reservations/${reservation.id}`)}
                    >
                      {t('edit.ignoreEmailFailure')}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleRetryModificationEmail}
                      disabled={isLoading}
                    >
                      {isLoading ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Mail className="mr-2 h-4 w-4" />
                      )}
                      {t('edit.retryEmailNotification')}
                    </Button>
                  </div>
                </div>
              </AlertDescription>
            </Alert>
          )}

          <div className="grid gap-4 sm:gap-6 lg:grid-cols-3">
            {/* Main Content */}
            <div className="lg:col-span-2 space-y-4 sm:space-y-6 min-w-0">
              {/* Dates Card */}
              <Card>
                <CardContent className="p-4 sm:p-6">
                  <h2 className="text-sm font-medium text-muted-foreground mb-4">
                    {t('edit.dates')}
                  </h2>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label className="text-xs">{t('edit.startDate')}</Label>
                      <ReservationDatePickerControl
                        id="edit-reservation-start-date"
                        value={startDate}
                        onChange={setStartDate}
                        minTime="00:00"
                        maxTime="23:59"
                        timeStep={30}
                        timezone={timezone}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs">{t('edit.endDate')}</Label>
                      <ReservationDatePickerControl
                        id="edit-reservation-end-date"
                        value={endDate}
                        onChange={handleEndDateChange}
                        minTime={endMinTime}
                        maxTime="23:59"
                        timeStep={30}
                        referenceDate={startDate}
                        disabledDates={(date) => {
                          if (!startDate) return false

                          const startDay = new Date(startDate)
                          startDay.setHours(0, 0, 0, 0)
                          return date < startDay
                        }}
                        timezone={timezone}
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
              <EditReservationItemsSection
                calculations={calculations}
                availabilityWarnings={availabilityWarnings}
                availableToAdd={availableToAdd}
                availableQuantityByProduct={availableQuantityByProduct}
                itemsCount={items.length}
                currencySymbol={currencySymbol}
                getDurationUnit={getDurationUnit}
                onOpenCustomItemDialog={() => setShowCustomItemDialog(true)}
                onAddProduct={handleAddProduct}
                onQuantityChange={handleQuantityChange}
                onPriceChange={handlePriceChange}
                onTotalPriceChange={handleItemTotalPriceChange}
                onDepositChange={handleDepositChange}
                onToggleManualPrice={handleToggleManualPrice}
                onRemoveItem={handleRemoveItem}
              />

              {/* Delivery Card */}
              {storeDelivery && (
                <EditReservationDeliverySection
                  outbound={delivery.outbound}
                  inbound={delivery.inbound}
                  totalFee={delivery.totalFee}
                  isDeliveryIncluded={delivery.isDeliveryIncluded}
                  deliveryMinimumWarning={deliveryMinimumWarning}
                  storeAddress={storeDelivery.address}
                  locations={storeDelivery.locations}
                  currencySymbol={currencySymbol}
                  onOutboundMethodChange={delivery.setOutboundMethod}
                  onInboundMethodChange={delivery.setInboundMethod}
                  onOutboundLocationChange={delivery.setOutboundLocationId}
                  onInboundLocationChange={delivery.setInboundLocationId}
                  onOutboundAddressChange={delivery.setOutboundAddress}
                  onInboundAddressChange={delivery.setInboundAddress}
                />
              )}
            </div>

            {/* Sidebar */}
            <div className="space-y-4 sm:space-y-6 min-w-0">
              {tulipInsuranceMode !== 'no_public' && (
                <Card>
                  <CardContent className="p-4 sm:p-6 space-y-3">
                    <h2 className="text-sm font-medium">{tForm('tulipInsurance.title')}</h2>
                    <p className="text-xs text-muted-foreground">
                      {tForm('tulipInsurance.appliesMappedProducts')}
                    </p>

                    {isTulipInsurancePastDateBlocked && (
                      <Alert variant="warning">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertDescription className="ml-2 text-xs">
                          {tForm('tulipInsurance.pastStartWarning')}
                        </AlertDescription>
                      </Alert>
                    )}

                    {tulipInsuranceMode === 'required' ? (
                      <p
                        className={cn(
                          'text-sm font-medium',
                          isTulipInsurancePastDateBlocked
                            ? 'text-amber-700 dark:text-amber-300'
                            : 'text-emerald-700',
                        )}
                      >
                        {isTulipInsurancePastDateBlocked
                          ? tForm('tulipInsurance.disabledPastStart')
                          : tForm('tulipInsurance.required')}
                      </p>
                    ) : (
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="edit-form-tulip-insurance-opt-in"
                          checked={effectiveTulipInsuranceOptIn}
                          disabled={isTulipInsurancePastDateBlocked}
                          onCheckedChange={(checked) => {
                            if (isTulipInsurancePastDateBlocked) return
                            setTulipInsuranceOptIn(checked === true)
                          }}
                        />
                        <label
                          htmlFor="edit-form-tulip-insurance-opt-in"
                          className={cn(
                            'text-sm',
                            isTulipInsurancePastDateBlocked
                              ? 'cursor-not-allowed text-muted-foreground'
                              : 'cursor-pointer',
                          )}
                        >
                          {tForm('tulipInsurance.optionalLabel')}
                        </label>
                      </div>
                    )}

                    {effectiveTulipInsuranceOptIn && !isTulipInsurancePastDateBlocked && (
                      <div className="space-y-2">
                        {isTulipInsuranceQuoteLoading ? (
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            <span>{tForm('tulipInsurance.calculating')}</span>
                          </div>
                        ) : fixedTulipInsuranceAmount > 0 ? (
                          <p className="text-xs font-medium text-muted-foreground">
                            {tForm('tulipInsurance.estimatedAmount', {
                              amount: formatCurrency(fixedTulipInsuranceAmount, currency),
                            })}
                          </p>
                        ) : null}

                        {tulipInsuranceQuoteErrorMessage && (
                          <Alert variant="warning">
                            <AlertTriangle className="h-4 w-4" />
                            <AlertDescription className="ml-2 text-xs">
                              {tForm('tulipInsurance.previewUnavailable')}{' '}
                              {tulipInsuranceQuoteErrorMessage}
                            </AlertDescription>
                          </Alert>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Summary Card */}
              <EditReservationSummarySection
                availabilityWarnings={availabilityWarnings}
                originalSubtotal={originalSubtotal}
                originalDeposit={originalDeposit}
                originalDeliveryFee={originalDeliveryFee}
                calculations={calculations}
                deliveryFee={delivery.totalFee}
                currencySymbol={currencySymbol}
                isLoading={isLoading}
                isDeliveryCalculating={delivery.isCalculating}
                hasChanges={hasChanges}
                notifyCustomerByEmail={notifyCustomerByEmail}
                onNotifyCustomerByEmailChange={setNotifyCustomerByEmail}
                hasScheduleChanges={hasScheduleChanges}
                onSave={handleSave}
              />
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
                      <SelectValue>
                        {customItemForm.pricingMode === 'hour' ? tForm('perHour') : customItemForm.pricingMode === 'day' ? tForm('perDay') : tForm('perWeek')}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hour" label={tForm('perHour')}>{tForm('perHour')}</SelectItem>
                      <SelectItem value="day" label={tForm('perDay')}>{tForm('perDay')}</SelectItem>
                      <SelectItem value="week" label={tForm('perWeek')}>{tForm('perWeek')}</SelectItem>
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
