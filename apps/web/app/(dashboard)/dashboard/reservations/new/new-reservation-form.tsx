'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useStore } from '@tanstack/react-form'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { fr, enUS } from 'date-fns/locale'
import { useLocale, useTranslations } from 'next-intl'
import { formatStoreDate } from '@/lib/utils/store-date'
import { useStoreTimezone } from '@/contexts/store-context'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Calendar,
  Check,
  Clock,
  Loader2,
  Plus,
  PenLine,
} from 'lucide-react'
import { toastManager } from '@louez/ui'

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
import { DateTimePicker } from '@/components/ui/date-time-picker'
import { Stepper, StepContent, StepActions } from '@louez/ui'
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
import { Alert, AlertDescription } from '@louez/ui'
import type { PricingMode, UnitAttributes } from '@louez/types'
import { useAppForm } from '@/hooks/form/form'
import { orpc } from '@/lib/orpc/react'
import { invalidateReservationList } from '@/lib/orpc/invalidation'
import { NewReservationStepCustomer } from './components/new-reservation-step-customer'
import { NewReservationStepProducts } from './components/new-reservation-step-products'
import { NewReservationStepReview } from './components/new-reservation-step-review'
import { useNewReservationPricing } from './hooks/use-new-reservation-pricing'
import { useNewReservationStepFlow } from './hooks/use-new-reservation-step-flow'
import { useNewReservationWarnings } from './hooks/use-new-reservation-warnings'
import { getLineQuantityConstraints } from './utils/variant-lines'
import type {
  CustomItem,
  NewReservationFormComponentApi,
  NewReservationFormProps,
  NewReservationFormValues,
  SelectedProduct,
  StepFieldName,
} from './types'

function createLineId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `line_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

function pricingModeToBasePeriodMinutes(mode: PricingMode): number {
  if (mode === 'hour') return 60
  if (mode === 'week') return 10080
  return 1440
}

export function NewReservationForm({
  customers,
  products,
  businessHours,
  advanceNoticeMinutes = 0,
  existingReservations = [],
}: NewReservationFormProps) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const locale = useLocale()
  const timezone = useStoreTimezone()
  const t = useTranslations('dashboard.reservations.manualForm')
  const tCommon = useTranslations('common')
  const tErrors = useTranslations('errors')
  const tValidation = useTranslations('validation')

  const dateLocale = locale === 'fr' ? fr : enUS
  const getTimeSlotsForDate = (date: Date | undefined): { minTime: string; maxTime: string } => {
    void date
    return { minTime: '00:00', maxTime: '23:30' }
  }

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
    lineId: string | null
    currentPrice: number
    newPrice: string
    pricingMode: PricingMode
    duration: number
  }>({
    isOpen: false,
    lineId: null,
    currentPrice: 0,
    newPrice: '',
    pricingMode: 'day',
    duration: 0,
  })

  const createReservationMutation = useMutation({
    ...orpc.dashboard.reservations.createManualReservation.mutationOptions({
      onSuccess: async () => {
        await invalidateReservationList(queryClient)
      },
    }),
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

  function validateCurrentStep(): boolean {
    let isValid = true

    switch (currentStep) {
      case 0:
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
      case 1:
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
      case 2:
        if (selectedProducts.length === 0 && customItems.length === 0) {
          toastManager.add({ title: t('addProductError'), type: 'error' })
          return false
        }
        return true
      case 3:
        return true
      default:
        return true
    }
  }

  const {
    steps,
    currentStep,
    stepDirection,
    goToNextStep,
    goToPreviousStep,
    goToStep,
  } = useNewReservationStepFlow({
    validateCurrentStep,
  })

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
      if (currentStep !== steps.length - 1) {
        return
      }

      if (!validateCurrentStep()) return

      try {
        const result = await createReservationMutation.mutateAsync({
          payload: {
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
          },
        })

        toastManager.add({ title: t('reservationCreated'), type: 'success' })
        router.push(`/dashboard/reservations/${result.reservationId}`)
      } catch (error) {
        toastManager.add({ title: getActionErrorMessage(error), type: 'error' })
      }
    },
  })

  const watchCustomerType = useStore(form.store, (s) => s.values.customerType as NewReservationFormValues['customerType'])
  const watchCustomerId = useStore(form.store, (s) => s.values.customerId)
  const watchStartDate = useStore(form.store, (s) => s.values.startDate as Date | undefined)
  const watchEndDate = useStore(form.store, (s) => s.values.endDate as Date | undefined)
  const watchedValues = useStore(form.store, (s) => s.values as NewReservationFormValues)
  const isSaving = createReservationMutation.isPending

  const selectedCustomer = customers.find((c) => c.id === watchCustomerId)

  const { periodWarnings, availabilityWarnings } = useNewReservationWarnings({
    startDate: watchStartDate,
    endDate: watchEndDate,
    selectedProducts,
    products,
    businessHours,
    advanceNoticeMinutes,
    existingReservations,
  })

  const {
    calculateDurationForMode,
    duration,
    detailedDuration,
    hasItems,
    subtotal,
    originalSubtotal,
    deposit,
    totalSavings,
    getProductPricingDetails,
    getCustomItemTotal,
  } = useNewReservationPricing({
    startDate: watchStartDate,
    endDate: watchEndDate,
    selectedProducts,
    customItems,
    products,
  })

  const addProduct = (productId: string) => {
    const product = products.find((item) => item.id === productId)
    if (!product) {
      return
    }

    const bookingAttributeAxes = product.bookingAttributeAxes || []
    const supportsOptionLines = product.trackUnits && bookingAttributeAxes.length > 0

    setSelectedProducts((prev) => {
      if (supportsOptionLines) {
        const nextLine: SelectedProduct = {
          lineId: createLineId(),
          productId,
          quantity: 1,
        }
        const productLines = [...prev.filter((line) => line.productId === productId), nextLine]
        const constraints = getLineQuantityConstraints(product, nextLine, productLines)
        if (constraints.lineMaxQuantity <= 0) {
          return prev
        }

        return [
          ...prev,
          nextLine,
        ]
      }

      const existingLine = prev.find((line) => line.productId === productId)
      if (!existingLine) {
        const nextLine: SelectedProduct = {
          lineId: createLineId(),
          productId,
          quantity: 1,
        }
        const constraints = getLineQuantityConstraints(product, nextLine, [nextLine])
        if (constraints.lineMaxQuantity <= 0) {
          return prev
        }

        return [
          ...prev,
          nextLine,
        ]
      }

      const productLines = prev.filter((line) => line.productId === productId)
      const constraints = getLineQuantityConstraints(product, existingLine, productLines)
      const nextQuantity = Math.min(
        existingLine.quantity + 1,
        Math.max(existingLine.quantity, constraints.lineMaxQuantity),
      )

      return prev.map((line) => {
        if (line.lineId !== existingLine.lineId) {
          return line
        }

        return {
          ...line,
          quantity: nextQuantity,
        }
      })
    })
  }

  const updateQuantity = (lineId: string, delta: number) => {
    setSelectedProducts((prev) => {
      const currentLine = prev.find((line) => line.lineId === lineId)
      if (!currentLine) {
        return prev
      }

      if (delta < 0 && currentLine.quantity + delta <= 0) {
        return prev.filter((line) => line.lineId !== lineId)
      }

      const product = products.find((item) => item.id === currentLine.productId)
      if (!product) {
        return prev
      }

      const productLines = prev.filter((line) => line.productId === currentLine.productId)
      const constraints = getLineQuantityConstraints(product, currentLine, productLines)
      const nextQuantity = Math.max(
        1,
        Math.min(currentLine.quantity + delta, Math.max(1, constraints.lineMaxQuantity)),
      )

      if (nextQuantity === currentLine.quantity) {
        return prev
      }

      return prev.map((line) => {
        if (line.lineId !== lineId) {
          return line
        }

        return {
          ...line,
          quantity: nextQuantity,
        }
      })
    })
  }

  const updateSelectedAttributes = (
    lineId: string,
    axisKey: string,
    value: string | undefined
  ) => {
    setSelectedProducts((prev) => {
      const currentLine = prev.find((line) => line.lineId === lineId)
      if (!currentLine) {
        return prev
      }

      const product = products.find((item) => item.id === currentLine.productId)
      if (!product) {
        return prev
      }

      const nextAttributes: UnitAttributes = {
        ...(currentLine.selectedAttributes || {}),
      }

      if (!value || value === '__none__') {
        delete nextAttributes[axisKey]
      } else {
        nextAttributes[axisKey] = value
      }

      const nextLine: SelectedProduct = {
        ...currentLine,
        selectedAttributes: Object.keys(nextAttributes).length > 0 ? nextAttributes : undefined,
      }

      const productLines = prev
        .filter((line) => line.productId === currentLine.productId)
        .map((line) => (line.lineId === lineId ? nextLine : line))
      const constraints = getLineQuantityConstraints(product, nextLine, productLines)
      const nextQuantity = Math.min(nextLine.quantity, constraints.lineMaxQuantity)

      const normalizedLine: SelectedProduct =
        nextQuantity > 0
          ? {
              ...nextLine,
              quantity: Math.max(1, nextQuantity),
            }
          : {
              ...nextLine,
              quantity: 0,
            }

      return prev
        .map((line) => (line.lineId === lineId ? normalizedLine : line))
        .filter((line) => line.quantity > 0)
    })
  }

  const removeSelectedProductLine = (lineId: string) => {
    setSelectedProducts((prev) => prev.filter((line) => line.lineId !== lineId))
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

  const customItemDuration =
    watchStartDate && watchEndDate
      ? calculateDurationForMode(watchStartDate, watchEndDate, customItemForm.pricingMode)
      : 0

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
      basePeriodMinutes: pricingModeToBasePeriodMinutes(customItemForm.pricingMode),
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
    lineId: string,
    calculatedPrice: number,
    pricingMode: PricingMode,
    duration: number
  ) => {
    const existingOverride = selectedProducts.find((line) => line.lineId === lineId)?.priceOverride
    setPriceOverrideDialog({
      isOpen: true,
      lineId,
      currentPrice: calculatedPrice,
      newPrice: existingOverride ? existingOverride.unitPrice.toString() : calculatedPrice.toString(),
      pricingMode,
      duration,
    })
  }

  const closePriceOverrideDialog = () => {
    setPriceOverrideDialog({
      isOpen: false,
      lineId: null,
      currentPrice: 0,
      newPrice: '',
      pricingMode: 'day',
      duration: 0,
    })
  }

  const applyPriceOverride = () => {
    if (!priceOverrideDialog.lineId) return

    const newPrice = parseFloat(priceOverrideDialog.newPrice)
    if (isNaN(newPrice)) {
      toastManager.add({ title: t('customItem.priceRequired'), type: 'error' })
      return
    }

    setSelectedProducts((prev) =>
      prev.map((line) => {
        if (line.lineId === priceOverrideDialog.lineId) {
          // Si le nouveau prix est égal au prix calculé, on supprime l'override
          if (Math.abs(newPrice - priceOverrideDialog.currentPrice) < 0.01) {
            const nextLine = { ...line }
            delete nextLine.priceOverride
            return nextLine
          }
          return { ...line, priceOverride: { unitPrice: newPrice } }
        }
        return line
      })
    )

    toastManager.add({ title: t('priceOverride.priceUpdated'), type: 'success' })
    closePriceOverrideDialog()
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

  const getPricingUnitLabel = useCallback(
    (mode: PricingMode) => {
      if (mode === 'hour') return t('perHour')
      if (mode === 'week') return t('perWeek')
      return t('perDay')
    },
    [t]
  )

  return (
    <>
      <form.AppForm>
        <form.Form className="space-y-6">
        {/* Stepper */}
        <Card>
          <CardContent className="pt-6">
            <Stepper
              steps={steps}
              currentStep={currentStep}
              onStepClick={goToStep}
            />
          </CardContent>
        </Card>

        {/* Step 1: Customer */}
        {currentStep === 0 && (
          <StepContent direction={stepDirection}>
            <NewReservationStepCustomer
              form={form as unknown as NewReservationFormComponentApi}
              customers={customers}
              customerType={watchCustomerType}
              clearStepFieldError={clearStepFieldError}
              getFieldErrorMessage={getFieldErrorMessage}
            />
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
            <NewReservationStepProducts
              products={products}
              selectedProducts={selectedProducts}
              customItems={customItems}
              startDate={watchStartDate}
              endDate={watchEndDate}
              availabilityWarnings={availabilityWarnings}
              hasItems={hasItems}
              subtotal={subtotal}
              originalSubtotal={originalSubtotal}
              totalSavings={totalSavings}
              deposit={deposit}
              addProduct={addProduct}
              updateQuantity={updateQuantity}
              updateSelectedAttributes={updateSelectedAttributes}
              removeSelectedProductLine={removeSelectedProductLine}
              onOpenCustomItemDialog={() => setShowCustomItemDialog(true)}
              updateCustomItemQuantity={updateCustomItemQuantity}
              removeCustomItem={removeCustomItem}
              openPriceOverrideDialog={openPriceOverrideDialog}
              calculateDurationForMode={calculateDurationForMode}
              getProductPricingDetails={getProductPricingDetails}
              getCustomItemTotal={getCustomItemTotal}
            />
          </StepContent>
        )}

        {/* Step 4: Confirmation */}
        {currentStep === 3 && (
          <StepContent direction={stepDirection}>
            <NewReservationStepReview
              form={form as unknown as NewReservationFormComponentApi}
              customerType={watchCustomerType}
              selectedCustomer={selectedCustomer}
              values={watchedValues}
              startDate={watchStartDate}
              endDate={watchEndDate}
              duration={duration}
              locale={locale}
              dateLocale={dateLocale}
              selectedProducts={selectedProducts}
              customItems={customItems}
              products={products}
              subtotal={subtotal}
              deposit={deposit}
              getProductPricingDetails={getProductPricingDetails}
              getCustomItemTotal={getCustomItemTotal}
            />
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
            {currentStep < steps.length - 1 ? (
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
                  <SelectValue>
                    {customItemForm.pricingMode === 'hour' && t('perHour')}
                    {customItemForm.pricingMode === 'day' && t('perDay')}
                    {customItemForm.pricingMode === 'week' && 'week'}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="hour" label={t('perHour')}>{t('perHour')}</SelectItem>
                  <SelectItem value="day" label={t('perDay')}>{t('perDay')}</SelectItem>
                  <SelectItem value="week" label="week">week</SelectItem>
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
