'use client'

import { useState, useMemo, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useStore } from '@tanstack/react-form'
import { useMutation } from '@tanstack/react-query'
import { format } from 'date-fns'
import { fr, enUS } from 'date-fns/locale'
import { useLocale } from 'next-intl'
import { formatStoreDate } from '@/lib/utils/store-date'
import { useStoreTimezone } from '@/contexts/store-context'
import {
  Loader2,
  Plus,
  Minus,
  Trash2,
  User,
  UserPlus,
  Calendar,
  Package,
  Check,
  ArrowLeft,
  ArrowRight,
  ShoppingCart,
  PenLine,
  ImageIcon,
  AlertTriangle,
  Clock,
  PackageX,
} from 'lucide-react'
import { toastManager } from '@louez/ui'
import { useTranslations } from 'next-intl'

import { Button } from '@louez/ui'
import { Input } from '@louez/ui'
import { Textarea } from '@louez/ui'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@louez/ui'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@louez/ui'
import { RadioGroup, RadioGroupItem } from '@louez/ui'
import { DateTimePicker } from '@/components/ui/date-time-picker'
import { Separator } from '@louez/ui'
import { Badge } from '@louez/ui'
import { Stepper, StepContent, StepActions } from '@louez/ui'
import { CustomerCombobox } from '@/components/dashboard/customer-combobox'
import {
  Dialog,
  DialogPopup,
  DialogPanel,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@louez/ui'
import { Label } from '@louez/ui'
import { Checkbox } from '@louez/ui'

import { cn, formatCurrency } from '@louez/utils'
import { isWithinBusinessHours, getDaySchedule } from '@/lib/utils/business-hours'
import { getDetailedDuration, getMinStartDateTime, dateRangesOverlap } from '@/lib/utils/duration'
import { Alert, AlertDescription } from '@louez/ui'
import { findApplicableTier } from '@louez/utils'
import { formatDurationFromMinutes } from '@/lib/utils/rental-duration'
import { createManualReservation } from '../actions'
import type { BusinessHours, PricingMode } from '@louez/types'
import type { PricingTier } from '@louez/types'
import { useAppForm } from '@/hooks/form/form'

interface Customer {
  id: string
  email: string
  firstName: string
  lastName: string
  phone: string | null
}

interface ProductPricingTier {
  id: string
  minDuration: number
  discountPercent: string
  displayOrder: number | null
}

interface Product {
  id: string
  name: string
  price: string
  deposit: string | null
  quantity: number
  pricingMode: PricingMode | null
  images: string[] | null
  pricingTiers: ProductPricingTier[]
}

interface SelectedProduct {
  productId: string
  quantity: number
  priceOverride?: {
    unitPrice: number // Prix unitaire personnalisé par période
  }
}

interface CustomItem {
  id: string // Temporary ID for UI
  name: string
  description: string
  unitPrice: number
  deposit: number
  quantity: number
  pricingMode: PricingMode
}

// Warning types for flexible date selection
interface PeriodWarning {
  type: 'advance_notice' | 'day_closed' | 'outside_hours' | 'closure_period'
  field: 'start' | 'end' | 'both'
  message: string
  details?: string
}

interface AvailabilityWarning {
  productId: string
  productName: string
  requestedQuantity: number
  availableQuantity: number
  conflictingReservations?: number
}

interface NewReservationFormProps {
  customers: Customer[]
  products: Product[]
  businessHours?: BusinessHours
  advanceNoticeMinutes?: number
  existingReservations?: Array<{
    id: string
    startDate: Date
    endDate: Date
    status: string
    items: Array<{ productId: string | null; quantity: number }>
  }>
}

type StepFieldName =
  | 'customerId'
  | 'email'
  | 'firstName'
  | 'lastName'
  | 'startDate'
  | 'endDate'

export function NewReservationForm({
  customers,
  products,
  businessHours,
  advanceNoticeMinutes = 0,
  existingReservations = [],
}: NewReservationFormProps) {
  const router = useRouter()
  const locale = useLocale()
  const timezone = useStoreTimezone()
  const t = useTranslations('dashboard.reservations.manualForm')
  const tCommon = useTranslations('common')
  const tErrors = useTranslations('errors')
  const tValidation = useTranslations('validation')

  const dateLocale = locale === 'fr' ? fr : enUS

  // Warning states for flexible date selection (warnings instead of blocking)
  const [periodWarnings, setPeriodWarnings] = useState<PeriodWarning[]>([])
  const [availabilityWarnings, setAvailabilityWarnings] = useState<AvailabilityWarning[]>([])

  // Calculate minimum start date based on advance notice setting (for warning, not blocking)
  const minDateTime = useMemo(
    () => getMinStartDateTime(advanceNoticeMinutes),
    [advanceNoticeMinutes]
  )

  // Check period warnings when dates change
  const checkPeriodWarnings = useCallback((startDate: Date | undefined, endDate: Date | undefined) => {
    const warnings: PeriodWarning[] = []

    if (startDate) {
      // Check advance notice
      if (startDate < minDateTime) {
        warnings.push({
          type: 'advance_notice',
          field: 'start',
          message: t('warnings.advanceNotice'),
          details: t('warnings.advanceNoticeDetails', {
            duration: formatDurationFromMinutes(advanceNoticeMinutes),
          }),
        })
      }

      // Check business hours for start date
      if (businessHours?.enabled) {
        const startCheck = isWithinBusinessHours(startDate, businessHours)
        if (!startCheck.valid) {
          if (startCheck.reason === 'day_closed') {
            warnings.push({
              type: 'day_closed',
              field: 'start',
              message: t('warnings.startDayClosed'),
              details: t('warnings.dayClosedDetails'),
            })
          } else if (startCheck.reason === 'outside_hours') {
            const startDaySchedule = getDaySchedule(startDate, businessHours)
            warnings.push({
              type: 'outside_hours',
              field: 'start',
              message: t('warnings.startOutsideHours'),
              details: t('warnings.outsideHoursDetails', {
                open: startDaySchedule.openTime,
                close: startDaySchedule.closeTime
              }),
            })
          } else if (startCheck.reason === 'closure_period' && startCheck.closurePeriod) {
            warnings.push({
              type: 'closure_period',
              field: 'start',
              message: t('warnings.startClosurePeriod'),
              details: startCheck.closurePeriod.name || t('warnings.closurePeriodDetails'),
            })
          }
        }
      }
    }

    if (endDate) {
      // Check business hours for end date
      if (businessHours?.enabled) {
        const endCheck = isWithinBusinessHours(endDate, businessHours)
        if (!endCheck.valid) {
          if (endCheck.reason === 'day_closed') {
            warnings.push({
              type: 'day_closed',
              field: 'end',
              message: t('warnings.endDayClosed'),
              details: t('warnings.dayClosedDetails'),
            })
          } else if (endCheck.reason === 'outside_hours') {
            const endDaySchedule = getDaySchedule(endDate, businessHours)
            warnings.push({
              type: 'outside_hours',
              field: 'end',
              message: t('warnings.endOutsideHours'),
              details: t('warnings.outsideHoursDetails', {
                open: endDaySchedule.openTime,
                close: endDaySchedule.closeTime
              }),
            })
          } else if (endCheck.reason === 'closure_period' && endCheck.closurePeriod) {
            warnings.push({
              type: 'closure_period',
              field: 'end',
              message: t('warnings.endClosurePeriod'),
              details: endCheck.closurePeriod.name || t('warnings.closurePeriodDetails'),
            })
          }
        }
      }
    }

    setPeriodWarnings(warnings)
  }, [businessHours, minDateTime, advanceNoticeMinutes, t])

  // Check availability warnings when dates and products change
  const checkAvailabilityWarnings = useCallback((
    startDate: Date | undefined,
    endDate: Date | undefined,
    selectedItems: SelectedProduct[]
  ) => {
    if (!startDate || !endDate || selectedItems.length === 0) {
      setAvailabilityWarnings([])
      return
    }

    const warnings: AvailabilityWarning[] = []

    // Calculate reserved quantities from existing reservations
    const reservedByProduct = new Map<string, number>()

    for (const reservation of existingReservations) {
      // Only check active reservations
      if (!['pending', 'confirmed', 'ongoing'].includes(reservation.status)) continue

      // Check if reservation overlaps with selected period
      if (dateRangesOverlap(reservation.startDate, reservation.endDate, startDate, endDate)) {
        for (const item of reservation.items) {
          if (!item.productId) continue
          const current = reservedByProduct.get(item.productId) || 0
          reservedByProduct.set(item.productId, current + item.quantity)
        }
      }
    }

    // Check each selected product
    for (const selectedItem of selectedItems) {
      const product = products.find(p => p.id === selectedItem.productId)
      if (!product) continue

      const reserved = reservedByProduct.get(selectedItem.productId) || 0
      const available = Math.max(0, product.quantity - reserved)

      if (selectedItem.quantity > available) {
        warnings.push({
          productId: selectedItem.productId,
          productName: product.name,
          requestedQuantity: selectedItem.quantity,
          availableQuantity: available,
          conflictingReservations: reserved,
        })
      }
    }

    setAvailabilityWarnings(warnings)
  }, [existingReservations, products])

  // Full time range for dashboard (no restrictions)
  const getTimeSlotsForDate = (_date: Date | undefined): { minTime: string; maxTime: string } => {
    // Dashboard: allow full day selection (store owners can book anytime)
    return { minTime: '00:00', maxTime: '23:30' }
  }

  const STEPS = useMemo(() => [
    { id: 'customer', title: t('steps.customer'), description: t('steps.customerDescription') },
    { id: 'period', title: t('steps.period'), description: t('steps.periodDescription') },
    { id: 'products', title: t('steps.products'), description: t('steps.productsDescription') },
    { id: 'confirm', title: t('steps.confirm'), description: t('steps.confirmDescription') },
  ], [t])

  const [currentStep, setCurrentStep] = useState(0)
  const [stepDirection, setStepDirection] = useState<'forward' | 'backward'>(
    'forward'
  )
  const [selectedProducts, setSelectedProducts] = useState<SelectedProduct[]>([])
  const [customItems, setCustomItems] = useState<CustomItem[]>([])
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
  const [priceInputMode, setPriceInputMode] = useState<'unit' | 'total'>('total')
  const [sendConfirmationEmail, setSendConfirmationEmail] = useState(true)

  // Price override dialog state
  const [priceOverrideDialog, setPriceOverrideDialog] = useState<{
    isOpen: boolean
    productId: string | null
    currentPrice: number
    newPrice: string
    pricingMode: PricingMode
    duration: number
  }>({
    isOpen: false,
    productId: null,
    currentPrice: 0,
    newPrice: '',
    pricingMode: 'day',
    duration: 0,
  })

  const createReservationMutation = useMutation({
    mutationFn: async (
      value: Parameters<typeof createManualReservation>[0]
    ) => {
      const result = await createManualReservation(value)

      if (result.error) {
        throw new Error(result.error)
      }

      return result
    },
  })

  const getActionErrorMessage = (error: unknown) => {
    if (error instanceof Error) {
      if (error.message.startsWith('errors.')) {
        return tErrors(error.message.replace('errors.', ''))
      }
      return error.message
    }

    return tErrors('generic')
  }

  const getFieldErrorMessage = (error: unknown) => {
    if (typeof error === 'string' && error.length > 0) {
      return error
    }

    if (
      typeof error === 'object' &&
      error !== null &&
      'message' in error &&
      typeof error.message === 'string'
    ) {
      return error.message
    }

    return tErrors('generic')
  }

  const form = useAppForm({
    defaultValues: {
      customerType: (customers.length > 0 ? 'existing' : 'new') as 'existing' | 'new',
      customerId: '',
      email: '',
      firstName: '',
      lastName: '',
      phone: '',
      startDate: undefined as Date | undefined,
      endDate: undefined as Date | undefined,
      internalNotes: '',
    },
    onSubmit: async ({ value }) => {
      // Ensure we're on the confirmation step before submitting
      if (currentStep !== STEPS.length - 1) {
        return
      }

      if (!validateCurrentStep()) return

      try {
        const result = await createReservationMutation.mutateAsync({
          customerId: value.customerType === 'existing' ? value.customerId : undefined,
          newCustomer:
            value.customerType === 'new'
              ? {
                  email: value.email,
                  firstName: value.firstName,
                  lastName: value.lastName,
                  phone: value.phone || undefined,
                }
              : undefined,
          startDate: value.startDate!,
          endDate: value.endDate!,
          items: selectedProducts,
          customItems: customItems.map((item) => ({
            name: item.name,
            description: item.description,
            unitPrice: item.unitPrice,
            deposit: item.deposit,
            quantity: item.quantity,
            pricingMode: item.pricingMode,
          })),
          internalNotes: value.internalNotes || undefined,
          sendConfirmationEmail,
        })

        toastManager.add({ title: t('reservationCreated'), type: 'success' })
        router.push(`/dashboard/reservations/${result.reservationId}`)
      } catch (error) {
        toastManager.add({ title: getActionErrorMessage(error), type: 'error' })
      }
    },
  })

  const watchCustomerType = useStore(form.store, (s) => s.values.customerType)
  const watchCustomerId = useStore(form.store, (s) => s.values.customerId)
  const watchStartDate = useStore(form.store, (s) => s.values.startDate)
  const watchEndDate = useStore(form.store, (s) => s.values.endDate)
  const watchedValues = useStore(form.store, (s) => s.values)
  const isSaving = createReservationMutation.isPending

  const calculateDurationForMode = useCallback(
    (startDate: Date, endDate: Date, mode: PricingMode): number => {
      const diffMs = endDate.getTime() - startDate.getTime()
      if (mode === 'hour') {
        return Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60)))
      }
      if (mode === 'week') {
        return Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24 * 7)))
      }
      return Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)))
    },
    []
  )

  // Get selected customer details
  const selectedCustomer = customers.find((c) => c.id === watchCustomerId)

  // Human-readable period summary uses day units, while item pricing uses each item's pricing mode.
  const duration = useMemo(() => {
    if (!watchStartDate || !watchEndDate) {
      return 0
    }
    return calculateDurationForMode(watchStartDate, watchEndDate, 'day')
  }, [watchStartDate, watchEndDate, calculateDurationForMode])

  // Get detailed duration breakdown for transparency
  const detailedDuration = useMemo(() => {
    if (!watchStartDate || !watchEndDate) return null
    return getDetailedDuration(watchStartDate, watchEndDate)
  }, [watchStartDate, watchEndDate])

  // Check if there are any items (products or custom)
  const hasItems = selectedProducts.length > 0 || customItems.length > 0

  // Effect: Check period warnings when dates change
  useEffect(() => {
    checkPeriodWarnings(watchStartDate, watchEndDate)
  }, [watchStartDate, watchEndDate, checkPeriodWarnings])

  // Effect: Check availability warnings when dates or selected products change
  useEffect(() => {
    checkAvailabilityWarnings(watchStartDate, watchEndDate, selectedProducts)
  }, [watchStartDate, watchEndDate, selectedProducts, checkAvailabilityWarnings])

  // Calculate totals with pricing tier discounts
  const { subtotal, originalSubtotal, deposit, totalSavings } = useMemo(() => {
    if (!watchStartDate || !watchEndDate || !hasItems || duration === 0) {
      return { subtotal: 0, originalSubtotal: 0, deposit: 0, totalSavings: 0 }
    }

    let subtotalAmount = 0
    let originalAmount = 0
    let depositAmount = 0

    // Calculate for catalog products
    for (const item of selectedProducts) {
      const product = products.find((p) => p.id === item.productId)
      if (product) {
        const basePrice = parseFloat(product.price)
        const productDeposit = parseFloat(product.deposit || '0')

        // Convert pricing tiers
        const productTiers: PricingTier[] = product.pricingTiers.map((tier) => ({
          id: tier.id,
          minDuration: tier.minDuration,
          discountPercent: parseFloat(tier.discountPercent),
          displayOrder: tier.displayOrder || 0,
        }))

        const productPricingMode = (product.pricingMode ?? 'day') as PricingMode
        const productDuration = calculateDurationForMode(
          watchStartDate,
          watchEndDate,
          productPricingMode
        )

        // Find applicable tier
        const applicableTier = findApplicableTier(productTiers, productDuration)
        const calculatedPrice = applicableTier
          ? basePrice * (1 - applicableTier.discountPercent / 100)
          : basePrice

        // Use price override if set, otherwise use calculated price
        const effectivePrice = item.priceOverride
          ? item.priceOverride.unitPrice
          : calculatedPrice

        originalAmount += basePrice * productDuration * item.quantity
        subtotalAmount += effectivePrice * productDuration * item.quantity
        depositAmount += productDeposit * item.quantity
      }
    }

    // Calculate for custom items (no tiered pricing)
    for (const item of customItems) {
      const itemDuration = calculateDurationForMode(
        watchStartDate,
        watchEndDate,
        item.pricingMode
      )
      const itemTotal = item.unitPrice * itemDuration * item.quantity
      subtotalAmount += itemTotal
      originalAmount += itemTotal
      depositAmount += item.deposit * item.quantity
    }

    return {
      subtotal: subtotalAmount,
      originalSubtotal: originalAmount,
      deposit: depositAmount,
      totalSavings: originalAmount - subtotalAmount,
    }
  }, [watchStartDate, watchEndDate, selectedProducts, customItems, products, duration, hasItems, calculateDurationForMode])

  const addProduct = (productId: string) => {
    const existing = selectedProducts.find((p) => p.productId === productId)
    if (existing) {
      setSelectedProducts(
        selectedProducts.map((p) =>
          p.productId === productId ? { ...p, quantity: p.quantity + 1 } : p
        )
      )
    } else {
      setSelectedProducts([...selectedProducts, { productId, quantity: 1 }])
    }
  }

  const updateQuantity = (productId: string, delta: number) => {
    setSelectedProducts(
      selectedProducts
        .map((p) => {
          if (p.productId === productId) {
            const newQuantity = p.quantity + delta
            return newQuantity > 0 ? { ...p, quantity: newQuantity } : null
          }
          return p
        })
        .filter(Boolean) as SelectedProduct[]
    )
  }

  const removeProduct = (productId: string) => {
    setSelectedProducts(selectedProducts.filter((p) => p.productId !== productId))
  }

  // Custom item management
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

  const customItemDuration = useMemo(() => {
    if (!watchStartDate || !watchEndDate) return 0
    return calculateDurationForMode(
      watchStartDate,
      watchEndDate,
      customItemForm.pricingMode
    )
  }, [watchStartDate, watchEndDate, customItemForm.pricingMode, calculateDurationForMode])

  // Calculate unit price from total price
  const calculateUnitPriceFromTotal = (totalPrice: string, qty: string) => {
    const total = parseFloat(totalPrice)
    const quantity = parseInt(qty) || 1
    if (isNaN(total) || total <= 0 || customItemDuration <= 0) return ''
    return (total / (quantity * customItemDuration)).toFixed(2)
  }

  // Calculate total price from unit price
  const calculateTotalFromUnitPrice = (unitPrice: string, qty: string) => {
    const unit = parseFloat(unitPrice)
    const quantity = parseInt(qty) || 1
    if (isNaN(unit) || unit <= 0 || customItemDuration <= 0) return ''
    return (unit * quantity * customItemDuration).toFixed(2)
  }

  // Handle unit price change
  const handleUnitPriceChange = (value: string) => {
    const quantity = customItemForm.quantity
    setCustomItemForm({
      ...customItemForm,
      unitPrice: value,
      totalPrice: calculateTotalFromUnitPrice(value, quantity),
    })
  }

  // Handle total price change
  const handleTotalPriceChange = (value: string) => {
    const quantity = customItemForm.quantity
    setCustomItemForm({
      ...customItemForm,
      totalPrice: value,
      unitPrice: calculateUnitPriceFromTotal(value, quantity),
    })
  }

  // Handle quantity change for custom item form
  const handleCustomItemQuantityChange = (value: string) => {
    if (priceInputMode === 'total') {
      // Recalculate unit price based on total
      setCustomItemForm({
        ...customItemForm,
        quantity: value,
        unitPrice: calculateUnitPriceFromTotal(customItemForm.totalPrice, value),
      })
    } else {
      // Recalculate total based on unit price
      setCustomItemForm({
        ...customItemForm,
        quantity: value,
        totalPrice: calculateTotalFromUnitPrice(customItemForm.unitPrice, value),
      })
    }
  }

  const handleAddCustomItem = () => {
    let unitPrice: number

    if (priceInputMode === 'total') {
      // Calculate unit price from total
      const totalPrice = parseFloat(customItemForm.totalPrice)
      const quantity = parseInt(customItemForm.quantity) || 1
      if (isNaN(totalPrice) || totalPrice <= 0) {
        toastManager.add({ title: t('customItem.priceRequired'), type: 'error' })
        return
      }
      if (customItemDuration <= 0) {
        toastManager.add({ title: t('customItem.selectPeriodFirst'), type: 'error' })
        return
      }
      unitPrice = totalPrice / (quantity * customItemDuration)
    } else {
      unitPrice = parseFloat(customItemForm.unitPrice)
      if (isNaN(unitPrice) || unitPrice <= 0) {
        toastManager.add({ title: t('customItem.priceRequired'), type: 'error' })
        return
      }
    }

    const deposit = parseFloat(customItemForm.deposit) || 0
    const quantity = parseInt(customItemForm.quantity) || 1

    if (!customItemForm.name.trim()) {
      toastManager.add({ title: t('customItem.nameRequired'), type: 'error' })
      return
    }

    const newItem: CustomItem = {
      id: `custom-${Date.now()}`,
      name: customItemForm.name.trim(),
      description: customItemForm.description.trim(),
      unitPrice,
      deposit,
      quantity,
      pricingMode: customItemForm.pricingMode,
    }

    setCustomItems([...customItems, newItem])
    resetCustomItemForm()
    setShowCustomItemDialog(false)
    toastManager.add({ title: t('customItem.added'), type: 'success' })
  }

  const updateCustomItemQuantity = (id: string, delta: number) => {
    setCustomItems(
      customItems
        .map((item) => {
          if (item.id === id) {
            const newQuantity = item.quantity + delta
            return newQuantity > 0 ? { ...item, quantity: newQuantity } : null
          }
          return item
        })
        .filter(Boolean) as CustomItem[]
    )
  }

  const removeCustomItem = (id: string) => {
    setCustomItems(customItems.filter((item) => item.id !== id))
  }

  // Price override functions
  const openPriceOverrideDialog = (
    productId: string,
    calculatedPrice: number,
    pricingMode: PricingMode,
    duration: number
  ) => {
    const existingOverride = selectedProducts.find((p) => p.productId === productId)?.priceOverride
    setPriceOverrideDialog({
      isOpen: true,
      productId,
      currentPrice: calculatedPrice,
      newPrice: existingOverride ? existingOverride.unitPrice.toString() : calculatedPrice.toString(),
      pricingMode,
      duration,
    })
  }

  const closePriceOverrideDialog = () => {
    setPriceOverrideDialog({
      isOpen: false,
      productId: null,
      currentPrice: 0,
      newPrice: '',
      pricingMode: 'day',
      duration: 0,
    })
  }

  const applyPriceOverride = () => {
    if (!priceOverrideDialog.productId) return

    const newPrice = parseFloat(priceOverrideDialog.newPrice)
    if (isNaN(newPrice)) {
      toastManager.add({ title: t('customItem.priceRequired'), type: 'error' })
      return
    }

    setSelectedProducts(
      selectedProducts.map((p) => {
        if (p.productId === priceOverrideDialog.productId) {
          // Si le nouveau prix est égal au prix calculé, on supprime l'override
          if (Math.abs(newPrice - priceOverrideDialog.currentPrice) < 0.01) {
            const { priceOverride, ...rest } = p
            return rest
          }
          return { ...p, priceOverride: { unitPrice: newPrice } }
        }
        return p
      })
    )

    toastManager.add({ title: t('priceOverride.priceUpdated'), type: 'success' })
    closePriceOverrideDialog()
  }

  const resetPriceOverride = (productId: string) => {
    setSelectedProducts(
      selectedProducts.map((p) => {
        if (p.productId === productId) {
          const { priceOverride, ...rest } = p
          return rest
        }
        return p
      })
    )
    toastManager.add({ title: t('priceOverride.priceReset'), type: 'success' })
  }

  const setStepFieldError = (name: StepFieldName, message: string) => {
    form.setFieldMeta(name, (prev) => ({
      ...prev,
      isTouched: true,
      errorMap: {
        ...prev?.errorMap,
        onSubmit: message,
      },
    }))
  }

  const clearStepFieldError = (name: StepFieldName) => {
    form.setFieldMeta(name, (prev) => ({
      ...prev,
      errorMap: {
        ...prev?.errorMap,
        onSubmit: undefined,
      },
    }))
  }

  const validateCurrentStep = (): boolean => {
    let isValid = true

    switch (currentStep) {
      case 0: // Customer
        if (watchCustomerType === 'existing') {
          clearStepFieldError('email')
          clearStepFieldError('firstName')
          clearStepFieldError('lastName')

          if (!watchCustomerId?.trim()) {
            setStepFieldError('customerId', tValidation('required'))
            isValid = false
          } else {
            clearStepFieldError('customerId')
          }
        } else {
          clearStepFieldError('customerId')

          const { email, firstName, lastName } = watchedValues

          if (!email?.trim()) {
            setStepFieldError('email', tValidation('required'))
            isValid = false
          } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
            setStepFieldError('email', tValidation('email'))
            isValid = false
          } else {
            clearStepFieldError('email')
          }

          if (!firstName?.trim()) {
            setStepFieldError('firstName', tValidation('required'))
            isValid = false
          } else {
            clearStepFieldError('firstName')
          }

          if (!lastName?.trim()) {
            setStepFieldError('lastName', tValidation('required'))
            isValid = false
          } else {
            clearStepFieldError('lastName')
          }
        }

        if (!isValid) {
          toastManager.add({ title: t('fillCustomerInfoError'), type: 'error' })
        }

        return isValid

      case 1: // Period
        if (!watchStartDate) {
          setStepFieldError('startDate', tValidation('required'))
          isValid = false
        } else {
          clearStepFieldError('startDate')
        }

        if (!watchEndDate) {
          setStepFieldError('endDate', tValidation('required'))
          isValid = false
        } else if (watchStartDate && watchEndDate < watchStartDate) {
          setStepFieldError('endDate', tValidation('endDateBeforeStart'))
          isValid = false
        } else {
          clearStepFieldError('endDate')
        }

        if (!isValid) {
          toastManager.add({ title: t('selectDatesError'), type: 'error' })
        }

        return isValid

      case 2: // Products
        if (selectedProducts.length === 0 && customItems.length === 0) {
          toastManager.add({ title: t('addProductError'), type: 'error' })
          return false
        }
        return true
      case 3: // Confirmation
        return true
      default:
        return true
    }
  }

  const goToNextStep = () => {
    if (validateCurrentStep() && currentStep < STEPS.length - 1) {
      setStepDirection('forward')
      setCurrentStep(currentStep + 1)
    }
  }

  const goToPreviousStep = () => {
    if (currentStep > 0) {
      setStepDirection('backward')
      setCurrentStep(currentStep - 1)
    }
  }

  const getPricingMode = useCallback(
    (value: PricingMode | null | undefined): PricingMode => value ?? 'day',
    []
  )

  const getPricingUnitLabel = useCallback(
    (mode: PricingMode) => {
      if (mode === 'hour') return t('perHour')
      if (mode === 'week') return t('perWeek')
      return t('perDay')
    },
    [t]
  )

  const getDurationLabel = useCallback(
    (mode: PricingMode, count: number) => {
      if (mode === 'hour') return tCommon('hourUnit', { count })
      if (mode === 'week') return tCommon('weekUnit', { count })
      return tCommon('dayUnit', { count })
    },
    [tCommon]
  )

  return (
    <>
      <form.AppForm>
        <form.Form className="space-y-6">
        {/* Stepper */}
        <Card>
          <CardContent className="pt-6">
            <Stepper
              steps={STEPS}
              currentStep={currentStep}
              onStepClick={(step) => {
                if (step < currentStep) {
                  setStepDirection('backward')
                  setCurrentStep(step)
                }
              }}
            />
          </CardContent>
        </Card>

        {/* Step 1: Customer */}
        {currentStep === 0 && (
          <StepContent direction={stepDirection}>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <User className="h-5 w-5" />
                  {t('customer')}
                </CardTitle>
                <CardDescription>{t('customerStepDescription')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <form.Field name="customerType">
                  {(field) => (
                    <RadioGroup
                      onValueChange={(value) => field.handleChange(value as 'existing' | 'new')}
                      defaultValue={field.state.value}
                      className="grid grid-cols-1 sm:grid-cols-2 gap-4"
                    >
                      <label
                        htmlFor="existing"
                        className={cn(
                          'flex items-center space-x-4 rounded-lg border p-4 cursor-pointer transition-colors',
                          field.state.value === 'existing'
                            ? 'border-primary bg-primary/5'
                            : 'hover:bg-muted/50',
                          customers.length === 0 && 'opacity-50 cursor-not-allowed'
                        )}
                      >
                        <RadioGroupItem
                          value="existing"
                          id="existing"
                          disabled={customers.length === 0}
                        />
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <User className="h-4 w-4" />
                            <span className="font-medium">{t('existingCustomer')}</span>
                          </div>
                          <p className="text-sm text-muted-foreground mt-1">
                            {t('existingCustomerDescription')}
                          </p>
                        </div>
                      </label>

                      <label
                        htmlFor="new"
                        className={cn(
                          'flex items-center space-x-4 rounded-lg border p-4 cursor-pointer transition-colors',
                          field.state.value === 'new'
                            ? 'border-primary bg-primary/5'
                            : 'hover:bg-muted/50'
                        )}
                      >
                        <RadioGroupItem value="new" id="new" />
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <UserPlus className="h-4 w-4" />
                            <span className="font-medium">{t('newCustomer')}</span>
                          </div>
                          <p className="text-sm text-muted-foreground mt-1">
                            {t('newCustomerDescription')}
                          </p>
                        </div>
                      </label>
                    </RadioGroup>
                  )}
                </form.Field>

                {watchCustomerType === 'existing' && customers.length > 0 && (
                  <form.Field name="customerId">
                    {(field) => (
                      <div className="space-y-2">
                        <Label>{t('selectCustomer')}</Label>
                        <CustomerCombobox
                          customers={customers}
                          value={field.state.value}
                          onValueChange={(value) => {
                            field.handleChange(value)
                            clearStepFieldError('customerId')
                          }}
                        />
                        {field.state.meta.errors.length > 0 && (
                          <p className="text-sm font-medium text-destructive">
                            {getFieldErrorMessage(field.state.meta.errors[0])}
                          </p>
                        )}
                      </div>
                    )}
                  </form.Field>
                )}

                {watchCustomerType === 'new' && (
                  <div className="space-y-4">
                    <form.AppField name="email">
                      {(field) => <field.Input label={`${t('email')} *`} type="email" placeholder={t('emailPlaceholder')} />}
                    </form.AppField>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <form.AppField name="firstName">
                        {(field) => <field.Input label={`${t('firstName')} *`} placeholder={t('firstNamePlaceholder')} />}
                      </form.AppField>
                      <form.AppField name="lastName">
                        {(field) => <field.Input label={`${t('lastName')} *`} placeholder={t('lastNamePlaceholder')} />}
                      </form.AppField>
                    </div>
                    <form.AppField name="phone">
                      {(field) => <field.Input label={t('phone')} placeholder={t('phonePlaceholder')} />}
                    </form.AppField>
                  </div>
                )}
              </CardContent>
            </Card>
          </StepContent>
        )}

        {/* Step 2: Period */}
        {currentStep === 1 && (
          <StepContent direction={stepDirection}>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Calendar className="h-5 w-5" />
                  {t('period')}
                </CardTitle>
                <CardDescription>{t('periodStepDescription')}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-6 sm:grid-cols-2">
                  <form.Field name="startDate">
                    {(field) => {
                      const timeSlots = getTimeSlotsForDate(field.state.value)
                      return (
                        <div className="flex flex-col space-y-2">
                          <Label>{t('startDate')}</Label>
                          <DateTimePicker
                            date={field.state.value}
                            setDate={(date) => {
                              field.handleChange(date)
                              clearStepFieldError('startDate')
                            }}
                            placeholder={t('pickDate')}
                            showTime={true}
                            minTime={timeSlots.minTime}
                            maxTime={timeSlots.maxTime}
                          />
                          {field.state.meta.errors.length > 0 && (
                            <p className="text-sm font-medium text-destructive">
                              {getFieldErrorMessage(field.state.meta.errors[0])}
                            </p>
                          )}
                        </div>
                      )
                    }}
                  </form.Field>
                  <form.Field name="endDate">
                    {(field) => {
                      const timeSlots = getTimeSlotsForDate(field.state.value)
                      return (
                        <div className="flex flex-col space-y-2">
                          <Label>{t('endDate')}</Label>
                          <DateTimePicker
                            date={field.state.value}
                            setDate={(date) => {
                              field.handleChange(date)
                              clearStepFieldError('endDate')
                            }}
                            placeholder={t('pickDate')}
                            disabledDates={(date) => {
                              // Only block dates before start date (logical constraint)
                              if (watchStartDate) {
                                const startDay = new Date(watchStartDate)
                                startDay.setHours(0, 0, 0, 0)
                                return date < startDay
                              }
                              return false
                            }}
                            showTime={true}
                            minTime={timeSlots.minTime}
                            maxTime={timeSlots.maxTime}
                          />
                          {field.state.meta.errors.length > 0 && (
                            <p className="text-sm font-medium text-destructive">
                              {getFieldErrorMessage(field.state.meta.errors[0])}
                            </p>
                          )}
                        </div>
                      )
                    }}
                  </form.Field>
                </div>

                {watchStartDate && watchEndDate && duration > 0 && (
                  <div className="mt-6 p-4 rounded-lg bg-primary/5 border border-primary/20">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                          <Calendar className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                          <p className="text-sm font-medium">{t('duration')}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatStoreDate(watchStartDate, timezone, "d MMMM yyyy HH:mm")}
                            {' '}&rarr;{' '}
                            {formatStoreDate(watchEndDate, timezone, "d MMMM yyyy HH:mm")}
                          </p>
                          {/* Show detailed breakdown for transparency */}
                          {detailedDuration && (
                            <p className="text-xs text-muted-foreground mt-1">
                              {detailedDuration.days > 0 && detailedDuration.hours > 0
                                ? `(${detailedDuration.days}j ${detailedDuration.hours}h ${t('exact')})`
                                : detailedDuration.days === 0
                                  ? `(${detailedDuration.totalHours}h ${t('exact')})`
                                  : null}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-2xl font-bold text-primary">
                          {duration}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {tCommon('dayUnit', { count: duration })}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Period Warnings - Shown when dates are outside normal business conditions */}
                {periodWarnings.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {periodWarnings.map((warning, index) => (
                      <Alert
                        key={`${warning.type}-${warning.field}-${index}`}
                        className="border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30"
                      >
                        <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-500" />
                        <AlertDescription className="ml-2">
                          <div className="flex flex-col gap-0.5">
                            <span className="font-medium text-amber-800 dark:text-amber-200">
                              {warning.message}
                            </span>
                            {warning.details && (
                              <span className="text-sm text-amber-700 dark:text-amber-300">
                                {warning.details}
                              </span>
                            )}
                          </div>
                        </AlertDescription>
                      </Alert>
                    ))}
                    <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {t('warnings.canContinue')}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </StepContent>
        )}

        {/* Step 3: Products */}
        {currentStep === 2 && (
          <StepContent direction={stepDirection}>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Package className="h-5 w-5" />
                  {t('products')}
                </CardTitle>
                <CardDescription>{t('productsDescription')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* All products grid */}
                <div className="grid gap-3 sm:grid-cols-2">
                  {products.map((product) => {
                    const selectedItem = selectedProducts.find((sp) => sp.productId === product.id)
                    const selectedQuantity = selectedItem?.quantity || 0
                    const isOutOfStock = product.quantity === 0
                    const remainingStock = product.quantity - selectedQuantity
                    const canAddMore = remainingStock > 0
                    const productPricingMode = getPricingMode(product.pricingMode)
                    const productDuration =
                      watchStartDate && watchEndDate
                        ? calculateDurationForMode(
                            watchStartDate,
                            watchEndDate,
                            productPricingMode
                          )
                        : 0

                    // Convert pricing tiers to the format expected by pricing utils
                    const productTiers: PricingTier[] = product.pricingTiers.map((tier) => ({
                      id: tier.id,
                      minDuration: tier.minDuration,
                      discountPercent: parseFloat(tier.discountPercent),
                      displayOrder: tier.displayOrder || 0,
                    }))

                    // Find applicable tier based on product-specific duration
                    const applicableTier = productDuration > 0
                      ? findApplicableTier(productTiers, productDuration)
                      : null
                    const basePrice = parseFloat(product.price)
                    const hasDiscount = applicableTier && applicableTier.discountPercent > 0

                    // Calculate price per unit (with tier discount if applicable)
                    const calculatedPrice = hasDiscount
                      ? basePrice * (1 - applicableTier.discountPercent / 100)
                      : basePrice

                    // Check for price override
                    const hasPriceOverride = !!selectedItem?.priceOverride
                    const effectivePrice = hasPriceOverride
                      ? selectedItem.priceOverride!.unitPrice
                      : calculatedPrice

                    return (
                      <div
                        key={product.id}
                        className={cn(
                          'rounded-lg border p-4 transition-colors',
                          isOutOfStock && 'opacity-60 bg-muted/30',
                          selectedQuantity > 0 && 'border-primary bg-primary/5'
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-start gap-3 min-w-0">
                            {/* Product thumbnail */}
                            <div className="relative h-12 w-12 rounded-md overflow-hidden bg-muted shrink-0">
                              {product.images && product.images.length > 0 ? (
                                <img
                                  src={product.images[0]}
                                  alt={product.name}
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                <div className="h-full w-full flex items-center justify-center">
                                  <ImageIcon className="h-4 w-4 text-muted-foreground" />
                                </div>
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-medium truncate">{product.name}</p>
                            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                              {hasPriceOverride ? (
                                <>
                                  <span className="text-sm text-muted-foreground line-through">
                                    {formatCurrency(calculatedPrice)}/{getPricingUnitLabel(productPricingMode)}
                                  </span>
                                  <span className={cn(
                                    'text-sm font-medium',
                                    effectivePrice < calculatedPrice ? 'text-green-600' : 'text-orange-600'
                                  )}>
                                    {formatCurrency(effectivePrice)}/{getPricingUnitLabel(productPricingMode)}
                                  </span>
                                  <Badge variant="secondary" className={cn(
                                    'text-xs',
                                    effectivePrice < calculatedPrice
                                      ? 'bg-green-100 text-green-700'
                                      : 'bg-orange-100 text-orange-700'
                                  )}>
                                    {t('priceOverride.modified')}
                                  </Badge>
                                </>
                              ) : hasDiscount ? (
                                <>
                                  <span className="text-sm text-muted-foreground line-through">
                                    {formatCurrency(basePrice)}/{getPricingUnitLabel(productPricingMode)}
                                  </span>
                                  <span className="text-sm font-medium text-green-600">
                                    {formatCurrency(effectivePrice)}/{getPricingUnitLabel(productPricingMode)}
                                  </span>
                                  <Badge variant="secondary" className="text-xs bg-green-100 text-green-700">
                                    -{applicableTier.discountPercent}%
                                  </Badge>
                                </>
                              ) : (
                                <span className="text-sm text-muted-foreground">
                                  {formatCurrency(basePrice)}/{getPricingUnitLabel(productPricingMode)}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 mt-1">
                              {isOutOfStock ? (
                                <Badge variant="error" className="text-xs">
                                  {t('outOfStock')}
                                </Badge>
                              ) : (
                                <span className={cn(
                                  'text-xs',
                                  remainingStock <= 2 ? 'text-orange-600' : 'text-muted-foreground'
                                )}>
                                  {remainingStock} {t('available')}
                                </span>
                              )}
                              {productTiers.length > 0 && !hasDiscount && (
                                <span className="text-xs text-muted-foreground">
                                  • {t('tieredPricing')}
                                </span>
                              )}
                            </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {selectedQuantity > 0 ? (
                              <>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => updateQuantity(product.id, -1)}
                                >
                                  <Minus className="h-3 w-3" />
                                </Button>
                                <span className="w-8 text-center font-medium">
                                  {selectedQuantity}
                                </span>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => updateQuantity(product.id, 1)}
                                  disabled={!canAddMore}
                                >
                                  <Plus className="h-3 w-3" />
                                </Button>
                              </>
                            ) : (
                              <Button
                                type="button"
                                variant={isOutOfStock ? 'ghost' : 'outline'}
                                onClick={() => addProduct(product.id)}
                                disabled={isOutOfStock}
                              >
                                <Plus className="h-4 w-4 mr-1" />
                                {t('add')}
                              </Button>
                            )}
                          </div>
                        </div>
                        {selectedQuantity > 0 && productDuration > 0 && (
                          <div className="mt-3 pt-3 border-t">
                            <div className="flex justify-between items-center text-sm">
                              <div className="flex items-center gap-2">
                                <span className="text-muted-foreground">
                                  {selectedQuantity} × {productDuration} {getDurationLabel(productPricingMode, productDuration)}
                                </span>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                                  onClick={() =>
                                    openPriceOverrideDialog(
                                      product.id,
                                      calculatedPrice,
                                      productPricingMode,
                                      productDuration
                                    )
                                  }
                                >
                                  <PenLine className="h-3 w-3" />
                                </Button>
                              </div>
                              <div className="text-right">
                                {hasPriceOverride ? (
                                  <div className="flex items-center gap-2">
                                    <span className="text-muted-foreground line-through text-xs">
                                      {formatCurrency(calculatedPrice * selectedQuantity * productDuration)}
                                    </span>
                                    <span className={cn(
                                      'font-medium',
                                      effectivePrice < calculatedPrice ? 'text-green-600' : 'text-orange-600'
                                    )}>
                                      {formatCurrency(effectivePrice * selectedQuantity * productDuration)}
                                    </span>
                                  </div>
                                ) : hasDiscount ? (
                                  <div className="flex items-center gap-2">
                                    <span className="text-muted-foreground line-through text-xs">
                                      {formatCurrency(basePrice * selectedQuantity * productDuration)}
                                    </span>
                                    <span className="font-medium text-green-600">
                                      {formatCurrency(effectivePrice * selectedQuantity * productDuration)}
                                    </span>
                                  </div>
                                ) : (
                                  <span className="font-medium">
                                    {formatCurrency(basePrice * selectedQuantity * productDuration)}
                                  </span>
                                )}
                              </div>
                            </div>
                            {(hasDiscount || hasPriceOverride) && (
                              <div className="flex justify-end mt-1">
                                <span className={cn(
                                  'text-xs',
                                  effectivePrice < calculatedPrice || effectivePrice < basePrice
                                    ? 'text-green-600'
                                    : 'text-orange-600'
                                )}>
                                  {effectivePrice < (hasPriceOverride ? calculatedPrice : basePrice)
                                    ? `${t('savings')}: ${formatCurrency(((hasPriceOverride ? calculatedPrice : basePrice) - effectivePrice) * selectedQuantity * productDuration)}`
                                    : `+${formatCurrency((effectivePrice - calculatedPrice) * selectedQuantity * productDuration)}`
                                  }
                                </span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>

                {/* Empty state if no products exist */}
                {products.length === 0 && customItems.length === 0 && (
                  <div className="text-center py-8">
                    <ShoppingCart className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                    <p className="text-muted-foreground">{t('noProducts')}</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      {t('noProductsHint')}
                    </p>
                  </div>
                )}

                {/* Custom Items Section */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-medium flex items-center gap-2">
                      <PenLine className="h-4 w-4" />
                      {t('customItem.title')}
                    </h4>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setShowCustomItemDialog(true)}
                    >
                      <Plus className="h-4 w-4 mr-1" />
                      {t('customItem.add')}
                    </Button>
                  </div>

                  {customItems.length > 0 && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {customItems.map((item) => (
                        <div
                          key={item.id}
                          className="rounded-lg border border-dashed border-primary/30 bg-primary/5 p-4"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="font-medium truncate">{item.name}</p>
                                <Badge variant="secondary" className="text-xs">
                                  {t('customItem.badge')}
                                </Badge>
                              </div>
                              <p className="text-sm text-muted-foreground mt-0.5">
                                {formatCurrency(item.unitPrice)}
                                /
                                {item.pricingMode === 'hour'
                                  ? t('perHour')
                                  : item.pricingMode === 'week'
                                    ? 'week'
                                    : t('perDay')}
                              </p>
                              {item.description && (
                                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                                  {item.description}
                                </p>
                              )}
                            </div>
                            <div className="flex items-center gap-1">
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => updateCustomItemQuantity(item.id, -1)}
                              >
                                <Minus className="h-3 w-3" />
                              </Button>
                              <span className="w-8 text-center font-medium">
                                {item.quantity}
                              </span>
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => updateCustomItemQuantity(item.id, 1)}
                              >
                                <Plus className="h-3 w-3" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive hover:text-destructive"
                                onClick={() => removeCustomItem(item.id)}
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>
                          {watchStartDate && watchEndDate && (
                            <div className="mt-3 pt-3 border-t border-border flex justify-between items-center text-sm">
                              <span className="text-muted-foreground">
                                {item.quantity} × {calculateDurationForMode(watchStartDate, watchEndDate, item.pricingMode)}{' '}
                                {item.pricingMode === 'hour' ? 'h' : item.pricingMode === 'week' ? 'sem' : 'j'}
                              </span>
                              <span className="font-medium">
                                {formatCurrency(
                                  item.unitPrice *
                                    item.quantity *
                                    calculateDurationForMode(
                                      watchStartDate,
                                      watchEndDate,
                                      item.pricingMode
                                    )
                                )}
                              </span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {customItems.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-4 border border-dashed rounded-lg">
                      {t('customItem.empty')}
                    </p>
                  )}
                </div>

                {/* Availability Warnings - Shown when products conflict with existing reservations */}
                {availabilityWarnings.length > 0 && (
                  <div className="space-y-2">
                    {availabilityWarnings.map((warning) => (
                      <Alert
                        key={warning.productId}
                        className="border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30"
                      >
                        <PackageX className="h-4 w-4 text-amber-600 dark:text-amber-500" />
                        <AlertDescription className="ml-2">
                          <div className="flex flex-col gap-0.5">
                            <span className="font-medium text-amber-800 dark:text-amber-200">
                              {t('warnings.productConflict', { name: warning.productName })}
                            </span>
                            <span className="text-sm text-amber-700 dark:text-amber-300">
                              {t('warnings.productConflictDetails', {
                                requested: warning.requestedQuantity,
                                available: warning.availableQuantity,
                              })}
                            </span>
                          </div>
                        </AlertDescription>
                      </Alert>
                    ))}
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      {t('warnings.conflictCanContinue')}
                    </p>
                  </div>
                )}

                {/* Summary */}
                {hasItems && (
                  <div className="rounded-lg bg-muted/50 p-4 space-y-2">
                    {totalSavings > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">{t('originalPrice')}</span>
                        <span className="text-muted-foreground line-through">
                          {formatCurrency(originalSubtotal)}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{t('subtotal')}</span>
                      <span className={totalSavings > 0 ? 'text-green-600 font-medium' : ''}>
                        {formatCurrency(subtotal)}
                      </span>
                    </div>
                    {totalSavings > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-green-600">{t('totalSavings')}</span>
                        <span className="text-green-600 font-medium">
                          -{formatCurrency(totalSavings)}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{t('deposit')}</span>
                      <span>{formatCurrency(deposit)}</span>
                    </div>
                    <Separator className="my-2" />
                    <div className="flex justify-between font-medium">
                      <span>{t('total')}</span>
                      <span>{formatCurrency(subtotal)}</span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </StepContent>
        )}

        {/* Step 4: Confirmation */}
        {currentStep === 3 && (
          <StepContent direction={stepDirection}>
            <div className="grid gap-6 lg:grid-cols-2">
              {/* Reservation Summary */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Check className="h-5 w-5" />
                    {t('confirmTitle')}
                  </CardTitle>
                  <CardDescription>{t('confirmDescription')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Customer info */}
                  <div>
                    <h4 className="text-sm font-medium mb-2">{t('customer')}</h4>
                    <div className="rounded-lg border p-3">
                      {watchCustomerType === 'existing' && selectedCustomer ? (
                        <div>
                          <p className="font-medium">
                            {selectedCustomer.firstName} {selectedCustomer.lastName}
                          </p>
                          <p className="text-sm text-muted-foreground">{selectedCustomer.email}</p>
                          {selectedCustomer.phone && (
                            <p className="text-sm text-muted-foreground">{selectedCustomer.phone}</p>
                          )}
                        </div>
                      ) : (
                        <div>
                          <p className="font-medium">
                            {watchedValues.firstName} {watchedValues.lastName}
                          </p>
                          <p className="text-sm text-muted-foreground">{watchedValues.email}</p>
                          {watchedValues.phone && (
                            <p className="text-sm text-muted-foreground">{watchedValues.phone}</p>
                          )}
                          <Badge variant="secondary" className="mt-2">{t('newCustomerBadge')}</Badge>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Period info */}
                  <div>
                    <h4 className="text-sm font-medium mb-2">{t('period')}</h4>
                    <div className="rounded-lg border p-3">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">{t('startDate')}</span>
                        <span>
                          {watchStartDate && format(
                            watchStartDate,
                            locale === 'fr' ? "PPP 'à' HH:mm" : "PPP 'at' HH:mm",
                            { locale: dateLocale }
                          )}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm mt-1">
                        <span className="text-muted-foreground">{t('endDate')}</span>
                        <span>
                          {watchEndDate && format(
                            watchEndDate,
                            locale === 'fr' ? "PPP 'à' HH:mm" : "PPP 'at' HH:mm",
                            { locale: dateLocale }
                          )}
                        </span>
                      </div>
                      <Separator className="my-2" />
                      <div className="flex justify-between text-sm font-medium">
                        <span>{t('duration')}</span>
                        <span>
                          {t('durationDays', { count: duration })}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Products info */}
                  <div>
                    <h4 className="text-sm font-medium mb-2">
                      {t('products')} ({selectedProducts.length + customItems.length})
                    </h4>
                    <div className="rounded-lg border divide-y">
                      {selectedProducts.map((item) => {
                        const product = products.find((p) => p.id === item.productId)
                        if (!product) return null

                        // Calculate price with tier discount
                        const basePrice = parseFloat(product.price)
                        const productTiers: PricingTier[] = product.pricingTiers.map((tier) => ({
                          id: tier.id,
                          minDuration: tier.minDuration,
                          discountPercent: parseFloat(tier.discountPercent),
                          displayOrder: tier.displayOrder || 0,
                        }))
                        const productPricingMode = getPricingMode(product.pricingMode)
                        const productDuration =
                          watchStartDate && watchEndDate
                            ? calculateDurationForMode(
                                watchStartDate,
                                watchEndDate,
                                productPricingMode
                              )
                            : 0
                        const applicableTier = productDuration > 0
                          ? findApplicableTier(productTiers, productDuration)
                          : null
                        const calculatedPrice = applicableTier
                          ? basePrice * (1 - applicableTier.discountPercent / 100)
                          : basePrice

                        const hasPriceOverride = !!item.priceOverride
                        const effectivePrice = hasPriceOverride
                          ? item.priceOverride!.unitPrice
                          : calculatedPrice

                        return (
                          <div key={item.productId} className="p-3 flex justify-between text-sm">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{product.name}</span>
                              {hasPriceOverride && (
                                <Badge variant="secondary" className={cn(
                                  'text-xs',
                                  effectivePrice < calculatedPrice
                                    ? 'bg-green-100 text-green-700'
                                    : 'bg-orange-100 text-orange-700'
                                )}>
                                  {t('priceOverride.modified')}
                                </Badge>
                              )}
                              <span className="text-muted-foreground">× {item.quantity}</span>
                            </div>
                            <span className={hasPriceOverride ? (effectivePrice < calculatedPrice ? 'text-green-600' : 'text-orange-600') : ''}>
                              {formatCurrency(effectivePrice * item.quantity * productDuration)}
                            </span>
                          </div>
                        )
                      })}
                      {customItems.map((item) => (
                        <div key={item.id} className="p-3 flex justify-between text-sm bg-muted/30">
                          <div>
                            <span className="font-medium">{item.name}</span>
                            <Badge variant="secondary" className="ml-2 text-xs">
                              {t('customItem.badge')}
                            </Badge>
                            <span className="text-muted-foreground ml-2">× {item.quantity}</span>
                          </div>
                          <span>
                            {watchStartDate && watchEndDate
                              ? formatCurrency(
                                  item.unitPrice *
                                    item.quantity *
                                    calculateDurationForMode(
                                      watchStartDate,
                                      watchEndDate,
                                      item.pricingMode
                                    )
                                )
                              : formatCurrency(0)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Notes & Total */}
              <div className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle>{t('internalNotes')}</CardTitle>
                    <CardDescription>{t('notesHint')}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <form.AppField name="internalNotes">
                      {(field) => <field.Textarea placeholder={t('notesPlaceholder')} className="min-h-[120px] resize-none" />}
                    </form.AppField>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>{t('summary')}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t('subtotal')}</span>
                      <span>{formatCurrency(subtotal)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t('deposit')}</span>
                      <span>{formatCurrency(deposit)}</span>
                    </div>
                    <Separator />
                    <div className="flex justify-between text-lg font-bold">
                      <span>{t('total')}</span>
                      <span>{formatCurrency(subtotal)}</span>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </StepContent>
        )}

        {/* Navigation */}
        <StepActions>
          <div>
            {currentStep > 0 ? (
              <Button type="button" variant="outline" onClick={goToPreviousStep}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                {tCommon('previous')}
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push('/dashboard/reservations')}
              >
                {tCommon('cancel')}
              </Button>
            )}
          </div>

          <div className="flex items-center gap-3">
            {currentStep < STEPS.length - 1 ? (
              <Button type="button" onClick={goToNextStep}>
                {tCommon('next')}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            ) : (
              <>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="sendConfirmationEmail"
                    checked={sendConfirmationEmail}
                    onCheckedChange={(checked) => setSendConfirmationEmail(checked === true)}
                  />
                  <label
                    htmlFor="sendConfirmationEmail"
                    className="text-sm text-muted-foreground cursor-pointer"
                  >
                    {t('sendConfirmationEmail')}
                  </label>
                </div>
                <Button type="submit" disabled={isSaving}>
                  {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  <Check className="mr-2 h-4 w-4" />
                  {t('create')}
                </Button>
              </>
            )}
          </div>
        </StepActions>
        </form.Form>
      </form.AppForm>

      {/* Custom Item Dialog */}
      <Dialog open={showCustomItemDialog} onOpenChange={setShowCustomItemDialog}>
        <DialogPopup className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PenLine className="h-5 w-5" />
              {t('customItem.dialogTitle')}
            </DialogTitle>
            <DialogDescription>
              {t('customItem.dialogDescription')}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="custom-name">{t('customItem.name')} *</Label>
              <Input
                id="custom-name"
                placeholder={t('customItem.namePlaceholder')}
                value={customItemForm.name}
                onChange={(e) => setCustomItemForm({ ...customItemForm, name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="custom-description">{t('customItem.description')}</Label>
              <Textarea
                id="custom-description"
                placeholder={t('customItem.descriptionPlaceholder')}
                value={customItemForm.description}
                onChange={(e) => setCustomItemForm({ ...customItemForm, description: e.target.value })}
                className="resize-none"
                rows={2}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="custom-quantity">{t('customItem.quantity')}</Label>
                <Input
                  id="custom-quantity"
                  type="number"
                  min="1"
                  value={customItemForm.quantity}
                  onChange={(e) => handleCustomItemQuantityChange(e.target.value)}
                  className="w-full"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="custom-deposit">{t('customItem.deposit')}</Label>
                <div className="relative">
                  <Input
                    id="custom-deposit"
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    value={customItemForm.deposit}
                    onChange={(e) => setCustomItemForm({ ...customItemForm, deposit: e.target.value })}
                    className="pr-8"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    €
                  </span>
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="custom-pricing-mode">{t('customItem.pricingPeriod')}</Label>
              <Select
                value={customItemForm.pricingMode}
                onValueChange={(value) =>
                  setCustomItemForm({
                    ...customItemForm,
                    pricingMode: value as PricingMode,
                  })
                }
              >
                <SelectTrigger id="custom-pricing-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="hour">{t('perHour')}</SelectItem>
                  <SelectItem value="day">{t('perDay')}</SelectItem>
                  <SelectItem value="week">week</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {customItemDuration > 0 && (
              <div className="rounded-lg border bg-muted/30 p-3 space-y-3">
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <span>{t('customItem.pricingPeriod')}</span>
                  <span className="font-medium text-foreground">
                    {customItemDuration}{' '}
                    {customItemForm.pricingMode === 'hour'
                      ? 'h'
                      : customItemForm.pricingMode === 'week'
                        ? 'sem'
                        : 'j'} × {customItemForm.quantity || 1} unité(s)
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="custom-total" className="text-xs">{t('customItem.totalPrice')} *</Label>
                    <div className="relative">
                      <Input
                        id="custom-total"
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        value={customItemForm.totalPrice}
                        onChange={(e) => handleTotalPriceChange(e.target.value)}
                        onFocus={() => setPriceInputMode('total')}
                        className="pr-8"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                        €
                      </span>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="custom-unit" className="text-xs">{t('customItem.unitPrice')}</Label>
                    <div className="relative">
                      <Input
                        id="custom-unit"
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        value={customItemForm.unitPrice}
                        onChange={(e) => handleUnitPriceChange(e.target.value)}
                        onFocus={() => setPriceInputMode('unit')}
                        className="pr-12"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                        €/
                        {customItemForm.pricingMode === 'hour'
                          ? t('perHour')
                          : customItemForm.pricingMode === 'week'
                            ? 'week'
                            : t('perDay')}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}
            {customItemDuration === 0 && (
              <p className="text-sm text-amber-600 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
                {t('customItem.selectPeriodFirst')}
              </p>
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
            <Button type="button" onClick={handleAddCustomItem}>
              <Plus className="h-4 w-4 mr-1" />
              {t('customItem.addButton')}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>

      {/* Price Override Dialog */}
      <Dialog open={priceOverrideDialog.isOpen} onOpenChange={(open) => !open && closePriceOverrideDialog()}>
        <DialogPopup className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PenLine className="h-5 w-5" />
              {t('priceOverride.dialogTitle')}
            </DialogTitle>
            <DialogDescription>
              {t('priceOverride.dialogDescription')}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
          <div className="space-y-4">
            {/* Display calculated price for reference */}
            <div className="rounded-lg bg-muted/50 p-3">
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">{t('priceOverride.calculatedPrice')}</span>
                <span className="font-medium">
                  {formatCurrency(priceOverrideDialog.currentPrice)}/
                  {getPricingUnitLabel(priceOverrideDialog.pricingMode)}
                </span>
              </div>
            </div>

            {/* New price input */}
            <div className="space-y-2">
              <Label htmlFor="override-price">{t('priceOverride.newPrice')} *</Label>
              <div className="relative">
                <Input
                  id="override-price"
                  type="number"
                  step="0.01"
                  placeholder={t('priceOverride.newPricePlaceholder')}
                  value={priceOverrideDialog.newPrice}
                  onChange={(e) => setPriceOverrideDialog({ ...priceOverrideDialog, newPrice: e.target.value })}
                  className="pr-12"
                  autoFocus
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  €/{getPricingUnitLabel(priceOverrideDialog.pricingMode)}
                </span>
              </div>
            </div>

            {/* Total preview */}
            {priceOverrideDialog.duration > 0 && priceOverrideDialog.newPrice && (
              <div className="rounded-lg border p-3">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground">{t('priceOverride.totalForPeriod')}</span>
                  <span className="font-medium">
                    {formatCurrency(
                      parseFloat(priceOverrideDialog.newPrice || '0') *
                        priceOverrideDialog.duration
                    )}
                  </span>
                </div>
                {priceOverrideDialog.currentPrice !== parseFloat(priceOverrideDialog.newPrice || '0') && (
                  <div className="flex justify-between items-center text-xs mt-1">
                    <span className="text-muted-foreground">
                      vs.{' '}
                      {formatCurrency(
                        priceOverrideDialog.currentPrice * priceOverrideDialog.duration
                      )}
                    </span>
                    <span className={cn(
                      parseFloat(priceOverrideDialog.newPrice || '0') < priceOverrideDialog.currentPrice
                        ? 'text-green-600'
                        : 'text-orange-600'
                    )}>
                      {parseFloat(priceOverrideDialog.newPrice || '0') < priceOverrideDialog.currentPrice
                        ? `-${formatCurrency((priceOverrideDialog.currentPrice - parseFloat(priceOverrideDialog.newPrice || '0')) * priceOverrideDialog.duration)}`
                        : `+${formatCurrency((parseFloat(priceOverrideDialog.newPrice || '0') - priceOverrideDialog.currentPrice) * priceOverrideDialog.duration)}`
                      }
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
          </DialogPanel>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setPriceOverrideDialog({
                  ...priceOverrideDialog,
                  newPrice: priceOverrideDialog.currentPrice.toString(),
                })
              }}
              className="sm:mr-auto"
            >
              {t('priceOverride.reset')}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={closePriceOverrideDialog}
            >
              {tCommon('cancel')}
            </Button>
            <Button type="button" onClick={applyPriceOverride}>
              {t('priceOverride.apply')}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  )
}
