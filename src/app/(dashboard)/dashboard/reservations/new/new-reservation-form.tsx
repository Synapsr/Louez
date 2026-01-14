'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { format } from 'date-fns'
import { fr, enUS } from 'date-fns/locale'
import { useLocale } from 'next-intl'
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
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { DateTimePicker } from '@/components/ui/date-time-picker'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { Stepper, StepContent, StepActions } from '@/components/ui/stepper'
import { CustomerCombobox } from '@/components/dashboard/customer-combobox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'

import { cn, formatCurrency } from '@/lib/utils'
import { isDateAvailable, getAvailableTimeSlots } from '@/lib/utils/business-hours'
import { getDetailedDuration } from '@/lib/utils/duration'
import { findApplicableTier, calculateRentalPrice } from '@/lib/pricing/calculate'
import { createManualReservation } from '../actions'
import type { BusinessHours } from '@/types/store'
import type { PricingTier } from '@/types/store'

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
  pricingTiers: ProductPricingTier[]
}

interface SelectedProduct {
  productId: string
  quantity: number
}

interface CustomItem {
  id: string // Temporary ID for UI
  name: string
  description: string
  unitPrice: number
  deposit: number
  quantity: number
}

interface NewReservationFormProps {
  customers: Customer[]
  products: Product[]
  pricingMode: 'day' | 'hour' | 'week'
  businessHours?: BusinessHours
}

interface FormData {
  customerType: 'existing' | 'new'
  customerId: string
  email: string
  firstName: string
  lastName: string
  phone: string
  startDate: Date | undefined
  endDate: Date | undefined
  internalNotes: string
}

export function NewReservationForm({
  customers,
  products,
  pricingMode,
  businessHours,
}: NewReservationFormProps) {
  const router = useRouter()
  const locale = useLocale()
  const t = useTranslations('dashboard.reservations.manualForm')
  const tCommon = useTranslations('common')
  const tErrors = useTranslations('errors')

  const dateLocale = locale === 'fr' ? fr : enUS

  // Helper to check if a date is disabled (not open)
  const isDateDisabled = (date: Date): boolean => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    if (date < today) return true

    // Check if store is open on this day
    if (businessHours?.enabled) {
      const { available } = isDateAvailable(date, businessHours)
      return !available
    }
    return false
  }

  // Get time slots for a specific date based on business hours
  const getTimeSlotsForDate = (date: Date | undefined): { minTime: string; maxTime: string } => {
    if (!date || !businessHours?.enabled) {
      return { minTime: '07:00', maxTime: '21:00' }
    }

    const slots = getAvailableTimeSlots(date, businessHours, 30)
    if (slots.length === 0) {
      return { minTime: '07:00', maxTime: '21:00' }
    }

    return {
      minTime: slots[0],
      maxTime: slots[slots.length - 1],
    }
  }

  const STEPS = useMemo(() => [
    { id: 'customer', title: t('steps.customer'), description: t('steps.customerDescription') },
    { id: 'period', title: t('steps.period'), description: t('steps.periodDescription') },
    { id: 'products', title: t('steps.products'), description: t('steps.productsDescription') },
    { id: 'confirm', title: t('steps.confirm'), description: t('steps.confirmDescription') },
  ], [t])

  const [currentStep, setCurrentStep] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
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
  })
  const [priceInputMode, setPriceInputMode] = useState<'unit' | 'total'>('total')
  const [sendConfirmationEmail, setSendConfirmationEmail] = useState(true)

  const form = useForm<FormData>({
    defaultValues: {
      customerType: customers.length > 0 ? 'existing' : 'new',
      customerId: '',
      email: '',
      firstName: '',
      lastName: '',
      phone: '',
      startDate: undefined,
      endDate: undefined,
      internalNotes: '',
    },
  })

  const watchCustomerType = form.watch('customerType')
  const watchCustomerId = form.watch('customerId')
  const watchStartDate = form.watch('startDate')
  const watchEndDate = form.watch('endDate')
  const watchedValues = form.watch()

  // Get selected customer details
  const selectedCustomer = customers.find((c) => c.id === watchCustomerId)

  // Calculate duration based on pricing mode
  // Uses Math.ceil (round up) - industry standard: any partial period = full period billed
  const { duration, durationUnit } = useMemo(() => {
    if (!watchStartDate || !watchEndDate) {
      return { duration: 0, durationUnit: 'days' as const }
    }

    const diffMs = watchEndDate.getTime() - watchStartDate.getTime()

    let durationCount: number
    let unit: 'hours' | 'days' | 'weeks'

    if (pricingMode === 'hour') {
      durationCount = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60)))
      unit = 'hours'
    } else if (pricingMode === 'week') {
      durationCount = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24 * 7)))
      unit = 'weeks'
    } else {
      durationCount = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)))
      unit = 'days'
    }

    return { duration: durationCount, durationUnit: unit }
  }, [watchStartDate, watchEndDate, pricingMode])

  // Get detailed duration breakdown for transparency
  const detailedDuration = useMemo(() => {
    if (!watchStartDate || !watchEndDate) return null
    return getDetailedDuration(watchStartDate, watchEndDate)
  }, [watchStartDate, watchEndDate])

  // Check if there are any items (products or custom)
  const hasItems = selectedProducts.length > 0 || customItems.length > 0

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

        // Find applicable tier
        const applicableTier = findApplicableTier(productTiers, duration)
        const effectivePrice = applicableTier
          ? basePrice * (1 - applicableTier.discountPercent / 100)
          : basePrice

        originalAmount += basePrice * duration * item.quantity
        subtotalAmount += effectivePrice * duration * item.quantity
        depositAmount += productDeposit * item.quantity
      }
    }

    // Calculate for custom items (no tiered pricing)
    for (const item of customItems) {
      const itemTotal = item.unitPrice * duration * item.quantity
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
  }, [watchStartDate, watchEndDate, selectedProducts, customItems, products, duration, hasItems])

  // Backward compatibility alias
  const days = duration

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
    })
  }

  // Calculate unit price from total price
  const calculateUnitPriceFromTotal = (totalPrice: string, qty: string) => {
    const total = parseFloat(totalPrice)
    const quantity = parseInt(qty) || 1
    if (isNaN(total) || total <= 0 || duration <= 0) return ''
    return (total / (quantity * duration)).toFixed(2)
  }

  // Calculate total price from unit price
  const calculateTotalFromUnitPrice = (unitPrice: string, qty: string) => {
    const unit = parseFloat(unitPrice)
    const quantity = parseInt(qty) || 1
    if (isNaN(unit) || unit <= 0 || duration <= 0) return ''
    return (unit * quantity * duration).toFixed(2)
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
        toast.error(t('customItem.priceRequired'))
        return
      }
      unitPrice = totalPrice / (quantity * duration)
    } else {
      unitPrice = parseFloat(customItemForm.unitPrice)
      if (isNaN(unitPrice) || unitPrice <= 0) {
        toast.error(t('customItem.priceRequired'))
        return
      }
    }

    const deposit = parseFloat(customItemForm.deposit) || 0
    const quantity = parseInt(customItemForm.quantity) || 1

    if (!customItemForm.name.trim()) {
      toast.error(t('customItem.nameRequired'))
      return
    }

    const newItem: CustomItem = {
      id: `custom-${Date.now()}`,
      name: customItemForm.name.trim(),
      description: customItemForm.description.trim(),
      unitPrice,
      deposit,
      quantity,
    }

    setCustomItems([...customItems, newItem])
    resetCustomItemForm()
    setShowCustomItemDialog(false)
    toast.success(t('customItem.added'))
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

  const validateCurrentStep = (): boolean => {
    switch (currentStep) {
      case 0: // Customer
        if (watchCustomerType === 'existing') {
          if (!watchCustomerId) {
            toast.error(t('selectCustomerError'))
            return false
          }
        } else {
          const { email, firstName, lastName } = watchedValues
          if (!email || !firstName || !lastName) {
            toast.error(t('fillCustomerInfoError'))
            return false
          }
        }
        return true
      case 1: // Period
        if (!watchStartDate || !watchEndDate) {
          toast.error(t('selectDatesError'))
          return false
        }
        return true
      case 2: // Products
        if (selectedProducts.length === 0 && customItems.length === 0) {
          toast.error(t('addProductError'))
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
      setCurrentStep(currentStep + 1)
    }
  }

  const goToPreviousStep = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1)
    }
  }

  async function onSubmit(data: FormData) {
    // Ensure we're on the confirmation step before submitting
    if (currentStep !== STEPS.length - 1) {
      return
    }

    if (!validateCurrentStep()) return

    setIsLoading(true)
    try {
      const result = await createManualReservation({
        customerId: data.customerType === 'existing' ? data.customerId : undefined,
        newCustomer:
          data.customerType === 'new'
            ? {
                email: data.email,
                firstName: data.firstName,
                lastName: data.lastName,
                phone: data.phone || undefined,
              }
            : undefined,
        startDate: data.startDate!,
        endDate: data.endDate!,
        items: selectedProducts,
        customItems: customItems.map((item) => ({
          name: item.name,
          description: item.description,
          unitPrice: item.unitPrice,
          deposit: item.deposit,
          quantity: item.quantity,
        })),
        internalNotes: data.internalNotes || undefined,
        sendConfirmationEmail,
      })

      if (result.error) {
        toast.error(result.error)
        return
      }

      toast.success(t('reservationCreated'))
      router.push(`/dashboard/reservations/${result.reservationId}`)
    } catch {
      toast.error(tErrors('generic'))
    } finally {
      setIsLoading(false)
    }
  }

  const availableProducts = products.filter(
    (p) => !selectedProducts.find((sp) => sp.productId === p.id)
  )

  const pricingUnit = pricingMode === 'hour' ? t('perHour') : t('perDay')

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {/* Stepper */}
        <Card>
          <CardContent className="pt-6">
            <Stepper
              steps={STEPS}
              currentStep={currentStep}
              onStepClick={(step) => {
                if (step < currentStep) {
                  setCurrentStep(step)
                }
              }}
            />
          </CardContent>
        </Card>

        {/* Step 1: Customer */}
        {currentStep === 0 && (
          <StepContent>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <User className="h-5 w-5" />
                  {t('customer')}
                </CardTitle>
                <CardDescription>{t('customerStepDescription')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <FormField
                  control={form.control}
                  name="customerType"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <RadioGroup
                          onValueChange={field.onChange}
                          defaultValue={field.value}
                          className="grid grid-cols-1 sm:grid-cols-2 gap-4"
                        >
                          <label
                            htmlFor="existing"
                            className={cn(
                              'flex items-center space-x-4 rounded-lg border p-4 cursor-pointer transition-colors',
                              field.value === 'existing'
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
                              field.value === 'new'
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
                      </FormControl>
                    </FormItem>
                  )}
                />

                {watchCustomerType === 'existing' && customers.length > 0 && (
                  <FormField
                    control={form.control}
                    name="customerId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('selectCustomer')}</FormLabel>
                        <FormControl>
                          <CustomerCombobox
                            customers={customers}
                            value={field.value}
                            onValueChange={field.onChange}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

                {watchCustomerType === 'new' && (
                  <div className="space-y-4">
                    <FormField
                      control={form.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('email')} *</FormLabel>
                          <FormControl>
                            <Input
                              type="email"
                              placeholder={t('emailPlaceholder')}
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <div className="grid gap-4 sm:grid-cols-2">
                      <FormField
                        control={form.control}
                        name="firstName"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t('firstName')} *</FormLabel>
                            <FormControl>
                              <Input placeholder={t('firstNamePlaceholder')} {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="lastName"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t('lastName')} *</FormLabel>
                            <FormControl>
                              <Input placeholder={t('lastNamePlaceholder')} {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    <FormField
                      control={form.control}
                      name="phone"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('phone')}</FormLabel>
                          <FormControl>
                            <Input placeholder={t('phonePlaceholder')} {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          </StepContent>
        )}

        {/* Step 2: Period */}
        {currentStep === 1 && (
          <StepContent>
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
                  <FormField
                    control={form.control}
                    name="startDate"
                    render={({ field }) => {
                      const timeSlots = getTimeSlotsForDate(field.value)
                      return (
                        <FormItem className="flex flex-col">
                          <FormLabel>{t('startDate')}</FormLabel>
                          <FormControl>
                            <DateTimePicker
                              date={field.value}
                              setDate={field.onChange}
                              placeholder={t('pickDate')}
                              disabledDates={isDateDisabled}
                              showTime={true}
                              minTime={timeSlots.minTime}
                              maxTime={timeSlots.maxTime}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )
                    }}
                  />
                  <FormField
                    control={form.control}
                    name="endDate"
                    render={({ field }) => {
                      const timeSlots = getTimeSlotsForDate(field.value)
                      return (
                        <FormItem className="flex flex-col">
                          <FormLabel>{t('endDate')}</FormLabel>
                          <FormControl>
                            <DateTimePicker
                              date={field.value}
                              setDate={field.onChange}
                              placeholder={t('pickDate')}
                              disabledDates={(date) => {
                                // First check if store is open
                                if (isDateDisabled(date)) return true
                                // Then check if it's after start date
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
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )
                    }}
                  />
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
                            {format(watchStartDate, 'PPP HH:mm', { locale: dateLocale })}
                            {' '}&rarr;{' '}
                            {format(watchEndDate, 'PPP HH:mm', { locale: dateLocale })}
                          </p>
                          {/* Show detailed breakdown for transparency */}
                          {detailedDuration && pricingMode === 'day' && (
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
                          {durationUnit === 'hours'
                            ? tCommon('hourUnit', { count: duration })
                            : durationUnit === 'weeks'
                              ? tCommon('weekUnit', { count: duration })
                              : tCommon('dayUnit', { count: duration })}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </StepContent>
        )}

        {/* Step 3: Products */}
        {currentStep === 2 && (
          <StepContent>
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

                    // Convert pricing tiers to the format expected by pricing utils
                    const productTiers: PricingTier[] = product.pricingTiers.map((tier) => ({
                      id: tier.id,
                      minDuration: tier.minDuration,
                      discountPercent: parseFloat(tier.discountPercent),
                      displayOrder: tier.displayOrder || 0,
                    }))

                    // Find applicable tier based on duration
                    const applicableTier = duration > 0 ? findApplicableTier(productTiers, duration) : null
                    const basePrice = parseFloat(product.price)
                    const hasDiscount = applicableTier && applicableTier.discountPercent > 0

                    // Calculate effective price per unit
                    const effectivePrice = hasDiscount
                      ? basePrice * (1 - applicableTier.discountPercent / 100)
                      : basePrice

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
                          <div className="flex-1 min-w-0">
                            <p className="font-medium truncate">{product.name}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              {hasDiscount ? (
                                <>
                                  <span className="text-sm text-muted-foreground line-through">
                                    {formatCurrency(basePrice)}/{pricingUnit}
                                  </span>
                                  <span className="text-sm font-medium text-green-600">
                                    {formatCurrency(effectivePrice)}/{pricingUnit}
                                  </span>
                                  <Badge variant="secondary" className="text-xs bg-green-100 text-green-700">
                                    -{applicableTier.discountPercent}%
                                  </Badge>
                                </>
                              ) : (
                                <span className="text-sm text-muted-foreground">
                                  {formatCurrency(basePrice)}/{pricingUnit}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 mt-1">
                              {isOutOfStock ? (
                                <Badge variant="destructive" className="text-xs">
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
                          <div className="flex items-center gap-1">
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
                                size="sm"
                                onClick={() => addProduct(product.id)}
                                disabled={isOutOfStock}
                              >
                                <Plus className="h-4 w-4 mr-1" />
                                {t('add')}
                              </Button>
                            )}
                          </div>
                        </div>
                        {selectedQuantity > 0 && duration > 0 && (
                          <div className="mt-3 pt-3 border-t">
                            <div className="flex justify-between items-center text-sm">
                              <span className="text-muted-foreground">
                                {selectedQuantity} × {duration} {durationUnit === 'hours' ? 'h' : durationUnit === 'weeks' ? 'sem' : 'j'}
                              </span>
                              <div className="text-right">
                                {hasDiscount ? (
                                  <div className="flex items-center gap-2">
                                    <span className="text-muted-foreground line-through text-xs">
                                      {formatCurrency(basePrice * selectedQuantity * duration)}
                                    </span>
                                    <span className="font-medium text-green-600">
                                      {formatCurrency(effectivePrice * selectedQuantity * duration)}
                                    </span>
                                  </div>
                                ) : (
                                  <span className="font-medium">
                                    {formatCurrency(basePrice * selectedQuantity * duration)}
                                  </span>
                                )}
                              </div>
                            </div>
                            {hasDiscount && (
                              <div className="flex justify-end mt-1">
                                <span className="text-xs text-green-600">
                                  {t('savings')}: {formatCurrency((basePrice - effectivePrice) * selectedQuantity * duration)}
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
                      size="sm"
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
                                {formatCurrency(item.unitPrice)}/{pricingUnit}
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
                          {duration > 0 && (
                            <div className="mt-3 pt-3 border-t border-border flex justify-between items-center text-sm">
                              <span className="text-muted-foreground">
                                {item.quantity} × {duration} {durationUnit === 'hours' ? 'h' : durationUnit === 'weeks' ? 'sem' : 'j'}
                              </span>
                              <span className="font-medium">
                                {formatCurrency(item.unitPrice * item.quantity * duration)}
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
          <StepContent>
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
                          {durationUnit === 'hours'
                            ? t('durationHours', { count: duration })
                            : durationUnit === 'weeks'
                              ? t('durationWeeks', { count: duration })
                              : t('durationDays', { count: duration })}
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
                        return (
                          <div key={item.productId} className="p-3 flex justify-between text-sm">
                            <div>
                              <span className="font-medium">{product.name}</span>
                              <span className="text-muted-foreground ml-2">× {item.quantity}</span>
                            </div>
                            <span>{formatCurrency(parseFloat(product.price) * item.quantity * days)}</span>
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
                          <span>{formatCurrency(item.unitPrice * item.quantity * duration)}</span>
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
                    <FormField
                      control={form.control}
                      name="internalNotes"
                      render={({ field }) => (
                        <FormItem>
                          <FormControl>
                            <Textarea
                              placeholder={t('notesPlaceholder')}
                              className="min-h-[120px] resize-none"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
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
                <Button type="submit" disabled={isLoading}>
                  {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  <Check className="mr-2 h-4 w-4" />
                  {t('create')}
                </Button>
              </>
            )}
          </div>
        </StepActions>
      </form>

      {/* Custom Item Dialog */}
      <Dialog open={showCustomItemDialog} onOpenChange={setShowCustomItemDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PenLine className="h-5 w-5" />
              {t('customItem.dialogTitle')}
            </DialogTitle>
            <DialogDescription>
              {t('customItem.dialogDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
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
            {duration > 0 && (
              <div className="rounded-lg border bg-muted/30 p-3 space-y-3">
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <span>{t('customItem.pricingPeriod')}</span>
                  <span className="font-medium text-foreground">
                    {duration} {durationUnit === 'hours' ? 'h' : durationUnit === 'weeks' ? 'sem' : 'j'} × {customItemForm.quantity || 1} unité(s)
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
                        €/{pricingUnit}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}
            {duration === 0 && (
              <p className="text-sm text-amber-600 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
                {t('customItem.selectPeriodFirst')}
              </p>
            )}
          </div>
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
        </DialogContent>
      </Dialog>
    </Form>
  )
}
