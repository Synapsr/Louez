'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import {
  Loader2,
  ImageIcon,
  ShoppingCart,
  CreditCard,
  Send,
  User,
  MapPin,
  Check,
  ChevronRight,
  ChevronLeft,
  ArrowRight,
  Truck,
  Store,
} from 'lucide-react'
import { toast } from 'sonner'
import { useTranslations, useLocale } from 'next-intl'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { PhoneInput } from '@/components/ui/phone-input'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Card, CardContent } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { cn, formatCurrency } from '@/lib/utils'
import { useCart } from '@/contexts/cart-context'
import { useStoreCurrency } from '@/contexts/store-context'
import { useStorefrontUrl } from '@/hooks/use-storefront-url'
import { getDetailedDuration } from '@/lib/utils/duration'
import { calculateRentalPrice, type ProductPricing } from '@/lib/pricing'
import { createReservation } from './actions'
import type { TaxSettings, DeliverySettings } from '@/types/store'
import { AddressInput } from '@/components/ui/address-input'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { calculateHaversineDistance, calculateDeliveryFee, validateDelivery, isFreeDelivery } from '@/lib/utils/geo'

interface CheckoutFormProps {
  storeSlug: string
  storeId: string
  pricingMode: 'day' | 'hour' | 'week'
  reservationMode: 'payment' | 'request'
  requireCustomerAddress: boolean
  cgv: string | null
  taxSettings?: TaxSettings
  depositPercentage?: number
  deliverySettings?: DeliverySettings
  storeAddress?: string | null
  storeLatitude?: number | null
  storeLongitude?: number | null
}

/**
 * Calculate duration for pricing
 * Uses Math.ceil (round up) - industry standard: any partial period = full period billed
 */
function calculateDuration(
  startDate: string,
  endDate: string,
  pricingMode: 'day' | 'hour' | 'week'
): number {
  const start = new Date(startDate)
  const end = new Date(endDate)
  const diffMs = end.getTime() - start.getTime()

  switch (pricingMode) {
    case 'hour':
      return Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60)))
    case 'week':
      return Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24 * 7)))
    default:
      return Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)))
  }
}

type StepId = 'contact' | 'delivery' | 'address' | 'confirm'

interface Step {
  id: StepId
  icon: React.ComponentType<{ className?: string }>
}

interface DeliveryAddress {
  address: string
  city: string
  postalCode: string
  country: string
  latitude: number | null
  longitude: number | null
}

export function CheckoutForm({
  storeSlug,
  storeId,
  pricingMode,
  reservationMode,
  requireCustomerAddress,
  cgv,
  taxSettings,
  depositPercentage = 100,
  deliverySettings,
  storeAddress,
  storeLatitude,
  storeLongitude,
}: CheckoutFormProps) {
  const router = useRouter()
  const locale = useLocale() as 'fr' | 'en'
  const t = useTranslations('storefront.checkout')
  const tProduct = useTranslations('storefront.product')
  const tCart = useTranslations('storefront.cart')
  const tErrors = useTranslations('errors')
  const currency = useStoreCurrency()
  const { getUrl } = useStorefrontUrl(storeSlug)
  const { items, clearCart, getSubtotal, getTotalDeposit, getTotal, globalStartDate, globalEndDate, getTotalSavings, getOriginalSubtotal } = useCart()
  const [currentStep, setCurrentStep] = useState<StepId>('contact')
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Delivery state
  const isDeliveryEnabled = deliverySettings?.enabled && storeLatitude && storeLongitude
  const deliveryMode = deliverySettings?.mode || 'optional'
  // If mode is 'required' or 'included', force delivery option
  const isDeliveryForced = deliveryMode === 'required' || deliveryMode === 'included'
  // If mode is 'included', delivery is always free
  const isDeliveryIncluded = deliveryMode === 'included'
  const [deliveryOption, setDeliveryOption] = useState<'pickup' | 'delivery'>(
    isDeliveryForced ? 'delivery' : 'pickup'
  )
  const [deliveryAddress, setDeliveryAddress] = useState<DeliveryAddress>({
    address: '',
    city: '',
    postalCode: '',
    country: 'FR',
    latitude: null,
    longitude: null,
  })
  const [deliveryDistance, setDeliveryDistance] = useState<number | null>(null)
  const [deliveryFee, setDeliveryFee] = useState<number>(0)
  const [deliveryError, setDeliveryError] = useState<string | null>(null)

  // Calculate delivery when address changes
  const handleDeliveryAddressChange = (
    address: string,
    latitude: number | null,
    longitude: number | null
  ) => {
    setDeliveryAddress(prev => ({ ...prev, address, latitude, longitude }))
    setDeliveryError(null)

    if (latitude && longitude && storeLatitude && storeLongitude && deliverySettings) {
      const distance = calculateHaversineDistance(
        storeLatitude,
        storeLongitude,
        latitude,
        longitude
      )
      setDeliveryDistance(distance)

      // Validate distance
      const validation = validateDelivery(distance, deliverySettings)
      if (!validation.valid) {
        setDeliveryError(t('deliveryTooFar', { maxKm: deliverySettings.maximumDistance ?? 0 }))
        setDeliveryFee(0)
        return
      }

      // Calculate fee (always 0 if delivery is included)
      const fee = isDeliveryIncluded ? 0 : calculateDeliveryFee(distance, deliverySettings, getSubtotal())
      setDeliveryFee(fee)
    } else {
      setDeliveryDistance(null)
      setDeliveryFee(0)
    }
  }

  // Build steps array based on settings
  const steps: Step[] = (() => {
    const result: Step[] = [{ id: 'contact', icon: User }]

    // Add delivery step if enabled
    if (isDeliveryEnabled) {
      result.push({ id: 'delivery', icon: Truck })
    }

    // Add address step if:
    // 1. Delivery is selected (need delivery address details), OR
    // 2. Store requires customer address
    if (deliveryOption === 'delivery' || requireCustomerAddress) {
      result.push({ id: 'address', icon: MapPin })
    }

    result.push({ id: 'confirm', icon: Check })
    return result
  })()

  const checkoutSchema = z.object({
    email: z.string().email(t('errors.invalidEmail')),
    firstName: z.string().min(1, t('errors.firstNameRequired')),
    lastName: z.string().min(1, t('errors.lastNameRequired')),
    phone: z.string()
      .min(1, t('errors.phoneRequired'))
      .regex(/^\+[1-9]\d{6,14}$/, t('errors.invalidPhone')),
    isBusinessCustomer: z.boolean(),
    companyName: z.string().optional(),
    address: z.string().optional(),
    city: z.string().optional(),
    postalCode: z.string().optional(),
    notes: z.string().optional(),
    acceptCgv: z.boolean(),
  }).superRefine((data, ctx) => {
    // If business customer, company name is required
    if (data.isBusinessCustomer && (!data.companyName || data.companyName.trim().length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: t('errors.companyNameRequired'),
        path: ['companyName'],
      })
    }
    // CGV must be accepted
    if (!data.acceptCgv) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: t('errors.acceptCgv'),
        path: ['acceptCgv'],
      })
    }
  })

  type CheckoutFormData = z.infer<typeof checkoutSchema>

  const form = useForm<CheckoutFormData>({
    resolver: zodResolver(checkoutSchema),
    defaultValues: {
      email: '',
      firstName: '',
      lastName: '',
      phone: '',
      isBusinessCustomer: false,
      companyName: '',
      address: '',
      city: '',
      postalCode: '',
      notes: '',
      acceptCgv: false,
    },
  })

  const isBusinessCustomer = form.watch('isBusinessCustomer')

  const currentStepIndex = steps.findIndex((s) => s.id === currentStep)

  const validateCurrentStep = async (): Promise<boolean> => {
    if (currentStep === 'contact') {
      const fieldsToValidate: (keyof CheckoutFormData)[] = ['firstName', 'lastName', 'email', 'phone']
      if (form.getValues('isBusinessCustomer')) {
        fieldsToValidate.push('companyName')
      }
      return form.trigger(fieldsToValidate)
    }
    if (currentStep === 'address') {
      return true // All optional
    }
    if (currentStep === 'confirm') {
      return form.trigger('acceptCgv')
    }
    return true
  }

  const goToNextStep = async () => {
    const isValid = await validateCurrentStep()
    if (!isValid) return

    const nextIndex = currentStepIndex + 1
    if (nextIndex < steps.length) {
      setCurrentStep(steps[nextIndex].id)
    }
  }

  const goToPreviousStep = () => {
    const prevIndex = currentStepIndex - 1
    if (prevIndex >= 0) {
      setCurrentStep(steps[prevIndex].id)
    }
  }

  const onSubmit = async (data: CheckoutFormData) => {
    if (items.length === 0) {
      toast.error(t('emptyCart'))
      return
    }

    setIsSubmitting(true)

    try {
      // Calculate total with delivery fee
      const totalWithDelivery = getTotal() + (deliveryOption === 'delivery' ? deliveryFee : 0)

      const result = await createReservation({
        storeId,
        customer: {
          email: data.email,
          firstName: data.firstName,
          lastName: data.lastName,
          phone: data.phone,
          customerType: data.isBusinessCustomer ? 'business' : 'individual',
          companyName: data.isBusinessCustomer ? data.companyName : undefined,
          address: data.address,
          city: data.city,
          postalCode: data.postalCode,
        },
        items: items.map((item) => {
          // Calculate effective unit price with tiered pricing
          const itemPricingMode = item.productPricingMode || pricingMode
          const duration = calculateDuration(item.startDate, item.endDate, itemPricingMode)

          let effectiveUnitPrice = item.price
          if (item.pricingTiers && item.pricingTiers.length > 0) {
            const pricing: ProductPricing = {
              basePrice: item.price,
              deposit: item.deposit,
              pricingMode: itemPricingMode,
              tiers: item.pricingTiers.map((t, i) => ({
                ...t,
                displayOrder: i,
              })),
            }
            const result = calculateRentalPrice(pricing, duration, item.quantity)
            effectiveUnitPrice = result.effectivePricePerUnit
          }

          return {
            productId: item.productId,
            quantity: item.quantity,
            startDate: item.startDate,
            endDate: item.endDate,
            unitPrice: effectiveUnitPrice,
            depositPerUnit: item.deposit,
            productSnapshot: {
              name: item.productName,
              description: null,
              images: item.productImage ? [item.productImage] : [],
            },
          }
        }),
        customerNotes: data.notes,
        subtotalAmount: getSubtotal(),
        depositAmount: getTotalDeposit(),
        totalAmount: totalWithDelivery,
        locale,
        // Delivery data
        delivery: deliveryOption === 'delivery' && deliveryAddress.latitude && deliveryAddress.longitude
          ? {
              option: 'delivery',
              address: deliveryAddress.address,
              city: deliveryAddress.city,
              postalCode: deliveryAddress.postalCode,
              country: deliveryAddress.country,
              latitude: deliveryAddress.latitude,
              longitude: deliveryAddress.longitude,
            }
          : { option: 'pickup' },
      })

      if (result.error) {
        // Translate the error message if it's an i18n key
        let errorMessage = result.error
        if (result.error.startsWith('errors.')) {
          const errorKey = result.error.replace('errors.', '')
          // Filter out undefined/null values from errorParams for translation
          const params: Record<string, string | number> = {}
          if (result.errorParams) {
            for (const [key, value] of Object.entries(result.errorParams)) {
              if (value !== undefined && value !== null && (typeof value === 'string' || typeof value === 'number')) {
                params[key] = value
              }
            }
          }
          errorMessage = tErrors(errorKey, params)
        }
        toast.error(errorMessage)
        return
      }

      clearCart()

      if (reservationMode === 'payment' && result.paymentUrl) {
        window.location.href = result.paymentUrl
      } else {
        toast.success(t('requestSent'))
        router.push(getUrl(`/confirmation/${result.reservationId}`))
      }
    } catch {
      toast.error(tErrors('generic'))
    } finally {
      setIsSubmitting(false)
    }
  }

  // Duration label
  const durationLabel = (() => {
    if (!globalStartDate || !globalEndDate) return ''
    const { days, hours } = getDetailedDuration(globalStartDate, globalEndDate)
    if (pricingMode === 'hour') return `${days * 24 + hours}h`
    if (days === 0) return `${hours}h`
    if (hours === 0) return `${days}j`
    return `${days}j ${hours}h`
  })()

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <ShoppingCart className="h-16 w-16 text-muted-foreground mb-4" />
        <h2 className="text-xl font-semibold mb-2">{t('emptyCart')}</h2>
        <p className="text-muted-foreground mb-6">{t('emptyCartDescription')}</p>
        <Button asChild>
          <Link href={getUrl('/catalog')}>{tCart('viewCatalog')}</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Stepper */}
      <div className="mb-8">
        <div className="flex items-center justify-center">
          {steps.map((step, index) => {
            const isActive = step.id === currentStep
            const isCompleted = index < currentStepIndex
            const Icon = step.icon

            return (
              <div key={step.id} className="flex items-center">
                <button
                  type="button"
                  onClick={() => {
                    if (isCompleted) setCurrentStep(step.id)
                  }}
                  disabled={!isCompleted && !isActive}
                  className={cn(
                    'flex items-center gap-2 px-4 py-2 rounded-full transition-all',
                    isActive && 'bg-primary text-primary-foreground',
                    isCompleted && 'bg-primary/10 text-primary cursor-pointer hover:bg-primary/20',
                    !isActive && !isCompleted && 'text-muted-foreground'
                  )}
                >
                  <div
                    className={cn(
                      'flex items-center justify-center h-8 w-8 rounded-full text-sm font-medium',
                      isActive && 'bg-primary-foreground/20',
                      isCompleted && 'bg-primary text-primary-foreground',
                      !isActive && !isCompleted && 'bg-muted'
                    )}
                  >
                    {isCompleted ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                  </div>
                  <span className="hidden sm:inline font-medium">
                    {t(`steps.${step.id}`)}
                  </span>
                </button>
                {index < steps.length - 1 && (
                  <ChevronRight className="h-5 w-5 mx-2 text-muted-foreground" />
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="grid lg:grid-cols-5 gap-6">
        {/* Form */}
        <div className="lg:col-span-3">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)}>
              {/* Step 1: Contact */}
              {currentStep === 'contact' && (
                <Card>
                  <CardContent className="pt-6 space-y-4">
                    <div className="mb-4">
                      <h2 className="text-lg font-semibold">{t('steps.contact')}</h2>
                      <p className="text-sm text-muted-foreground">{t('contactDescription')}</p>
                    </div>

                    <div className="grid sm:grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="firstName"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t('firstName')}</FormLabel>
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
                            <FormLabel>{t('lastName')}</FormLabel>
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
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('email')}</FormLabel>
                          <FormControl>
                            <Input type="email" placeholder={t('emailPlaceholder')} {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="phone"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('phone')}</FormLabel>
                          <FormControl>
                            <PhoneInput
                              value={field.value}
                              onChange={field.onChange}
                              placeholder={t('phonePlaceholder')}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {/* Business customer checkbox - simple inline style */}
                    <FormField
                      control={form.control}
                      name="isBusinessCustomer"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-center space-x-2 space-y-0">
                          <FormControl>
                            <Checkbox
                              checked={field.value}
                              onCheckedChange={(checked) => {
                                field.onChange(checked)
                                if (!checked) {
                                  form.setValue('companyName', '')
                                }
                              }}
                            />
                          </FormControl>
                          <FormLabel className="text-sm font-normal cursor-pointer">
                            {t('isBusinessCustomer')}
                          </FormLabel>
                        </FormItem>
                      )}
                    />

                    {/* Company name - only shown for business customers */}
                    {isBusinessCustomer && (
                      <FormField
                        control={form.control}
                        name="companyName"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t('companyName')} *</FormLabel>
                            <FormControl>
                              <Input placeholder={t('companyNamePlaceholder')} {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}

                    <div className="pt-4">
                      <Button type="button" onClick={goToNextStep} className="w-full" size="lg">
                        {t('continue')}
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Step: Delivery (when enabled) */}
              {currentStep === 'delivery' && isDeliveryEnabled && deliverySettings && (
                <Card>
                  <CardContent className="pt-6 space-y-6">
                    <div className="mb-4">
                      <h2 className="text-lg font-semibold">{t('steps.delivery')}</h2>
                      <p className="text-sm text-muted-foreground">
                        {isDeliveryForced
                          ? (isDeliveryIncluded ? t('deliveryIncludedDescription') : t('deliveryRequiredDescription'))
                          : t('deliveryDescription')
                        }
                      </p>
                    </div>

                    {/* Pickup vs Delivery Selection - Only in optional mode */}
                    {!isDeliveryForced && (
                      <RadioGroup
                        value={deliveryOption}
                        onValueChange={(value) => {
                          setDeliveryOption(value as 'pickup' | 'delivery')
                          if (value === 'pickup') {
                            setDeliveryFee(0)
                            setDeliveryDistance(null)
                            setDeliveryError(null)
                          }
                        }}
                        className="grid gap-3"
                      >
                        {/* Pickup Option */}
                        <label
                          className={cn(
                            'flex items-start gap-4 rounded-lg border p-4 cursor-pointer transition-colors',
                            deliveryOption === 'pickup'
                              ? 'border-primary bg-primary/5'
                              : 'hover:bg-muted/50'
                          )}
                        >
                          <RadioGroupItem value="pickup" id="pickup" className="mt-1" />
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <Store className="h-4 w-4" />
                              <span className="font-medium">{t('pickupOption')}</span>
                              <Badge variant="secondary">{t('free')}</Badge>
                            </div>
                            {storeAddress && (
                              <p className="text-sm text-muted-foreground mt-1">
                                {storeAddress}
                              </p>
                            )}
                          </div>
                        </label>

                        {/* Delivery Option */}
                        <label
                          className={cn(
                            'flex items-start gap-4 rounded-lg border p-4 cursor-pointer transition-colors',
                            deliveryOption === 'delivery'
                              ? 'border-primary bg-primary/5'
                              : 'hover:bg-muted/50'
                          )}
                        >
                          <RadioGroupItem value="delivery" id="delivery" className="mt-1" />
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <Truck className="h-4 w-4" />
                              <span className="font-medium">{t('deliveryOption')}</span>
                            </div>
                            <p className="text-sm text-muted-foreground mt-1">
                              {t('deliveryOptionDescription', {
                                pricePerKm: formatCurrency(deliverySettings.pricePerKm, currency),
                              })}
                            </p>
                            {deliverySettings.freeDeliveryThreshold &&
                              isFreeDelivery(getSubtotal(), deliverySettings) && (
                                <p className="text-sm text-green-600 mt-1">
                                  {t('freeDeliveryApplied')}
                                </p>
                              )}
                            {deliverySettings.freeDeliveryThreshold &&
                              !isFreeDelivery(getSubtotal(), deliverySettings) && (
                                <p className="text-sm text-muted-foreground mt-1">
                                  {t('freeDeliveryAbove', {
                                    amount: formatCurrency(
                                      deliverySettings.freeDeliveryThreshold,
                                      currency
                                    ),
                                  })}
                                </p>
                              )}
                          </div>
                        </label>
                      </RadioGroup>
                    )}

                    {/* Forced delivery info banner (required or included mode) */}
                    {isDeliveryForced && (
                      <div className={cn(
                        'flex items-start gap-3 rounded-lg p-4',
                        isDeliveryIncluded
                          ? 'bg-green-50 dark:bg-green-950/30'
                          : 'bg-blue-50 dark:bg-blue-950/30'
                      )}>
                        <Truck className={cn(
                          'h-5 w-5 mt-0.5 shrink-0',
                          isDeliveryIncluded
                            ? 'text-green-600 dark:text-green-400'
                            : 'text-blue-600 dark:text-blue-400'
                        )} />
                        <div>
                          <p className={cn(
                            'font-medium',
                            isDeliveryIncluded
                              ? 'text-green-700 dark:text-green-300'
                              : 'text-blue-700 dark:text-blue-300'
                          )}>
                            {isDeliveryIncluded ? t('deliveryIncludedBanner') : t('deliveryRequiredBanner')}
                          </p>
                          <p className={cn(
                            'text-sm mt-0.5',
                            isDeliveryIncluded
                              ? 'text-green-600 dark:text-green-400'
                              : 'text-blue-600 dark:text-blue-400'
                          )}>
                            {isDeliveryIncluded ? t('deliveryIncludedNote') : t('deliveryRequiredNote')}
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Delivery Address Input (shown when delivery selected or forced) */}
                    {(deliveryOption === 'delivery' || isDeliveryForced) && (
                      <div className={cn('space-y-4', !isDeliveryForced && 'border-t pt-6')}>
                        <div>
                          <label className="text-sm font-medium">{t('deliveryAddress')}</label>
                          <div className="mt-2">
                            <AddressInput
                              value={deliveryAddress.address}
                              latitude={deliveryAddress.latitude}
                              longitude={deliveryAddress.longitude}
                              onChange={(address, lat, lng) =>
                                handleDeliveryAddressChange(address, lat, lng)
                              }
                              placeholder={t('deliveryAddressPlaceholder')}
                            />
                          </div>
                        </div>

                        {/* Delivery Cost Preview */}
                        {deliveryDistance !== null && !deliveryError && (
                          <div className="rounded-lg bg-muted/50 p-4">
                            <div className="flex justify-between text-sm">
                              <span>{t('deliveryDistance')}</span>
                              <span>{deliveryDistance.toFixed(1)} km</span>
                            </div>
                            {!isDeliveryIncluded && (
                              <div className="flex justify-between font-medium mt-2">
                                <span>{t('deliveryFee')}</span>
                                <span className={deliveryFee === 0 ? 'text-green-600' : ''}>
                                  {deliveryFee === 0 ? t('free') : formatCurrency(deliveryFee, currency)}
                                </span>
                              </div>
                            )}
                            {isDeliveryIncluded && (
                              <div className="flex justify-between font-medium mt-2 text-green-600">
                                <span>{t('deliveryFee')}</span>
                                <span>{t('included')}</span>
                              </div>
                            )}
                            {deliveryFee === 0 && !isDeliveryIncluded && deliverySettings.freeDeliveryThreshold && (
                              <p className="text-xs text-green-600 mt-1">
                                {t('freeDeliveryApplied')}
                              </p>
                            )}
                            {deliverySettings.roundTrip && !isDeliveryIncluded && (
                              <p className="text-xs text-muted-foreground mt-2">
                                {t('roundTripNote', {
                                  distance: deliveryDistance.toFixed(1),
                                  total: (deliveryDistance * 2).toFixed(1),
                                })}
                              </p>
                            )}
                          </div>
                        )}

                        {/* Maximum Distance Error */}
                        {deliveryError && (
                          <div className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive">
                            {deliveryError}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Navigation */}
                    <div className="pt-4 flex gap-3">
                      <Button type="button" variant="outline" onClick={goToPreviousStep}>
                        <ChevronLeft className="mr-2 h-4 w-4" />
                        {t('back')}
                      </Button>
                      <Button
                        type="button"
                        onClick={goToNextStep}
                        className="flex-1"
                        disabled={
                          deliveryOption === 'delivery' &&
                          (!deliveryAddress.latitude || !!deliveryError)
                        }
                      >
                        {t('continue')}
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Step: Address (Optional or required for delivery) */}
              {currentStep === 'address' && (
                <Card>
                  <CardContent className="pt-6 space-y-4">
                    <div className="mb-4">
                      <h2 className="text-lg font-semibold">{t('steps.address')}</h2>
                      <p className="text-sm text-muted-foreground">{t('addressDescription')}</p>
                    </div>

                    <FormField
                      control={form.control}
                      name="address"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('address')}</FormLabel>
                          <FormControl>
                            <Input placeholder={t('addressPlaceholder')} {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="grid sm:grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="postalCode"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t('postalCode')}</FormLabel>
                            <FormControl>
                              <Input placeholder={t('postalCodePlaceholder')} {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="city"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t('city')}</FormLabel>
                            <FormControl>
                              <Input placeholder={t('cityPlaceholder')} {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <FormField
                      control={form.control}
                      name="notes"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('notes')}</FormLabel>
                          <FormControl>
                            <Textarea placeholder={t('notesPlaceholder')} rows={3} {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="pt-4 flex gap-3">
                      <Button type="button" variant="outline" onClick={goToPreviousStep} className="flex-1">
                        <ChevronLeft className="mr-2 h-4 w-4" />
                        {t('back')}
                      </Button>
                      <Button type="button" onClick={goToNextStep} className="flex-1">
                        {t('continue')}
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Step 3: Confirmation */}
              {currentStep === 'confirm' && (
                <Card>
                  <CardContent className="pt-6 space-y-6">
                    <div className="mb-4">
                      <h2 className="text-lg font-semibold">{t('steps.confirm')}</h2>
                      <p className="text-sm text-muted-foreground">{t('confirmDescription')}</p>
                    </div>

                    {/* Customer summary */}
                    <div className="rounded-lg bg-muted/50 p-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">{t('customerInfo')}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setCurrentStep('contact')}
                        >
                          {t('modify')}
                        </Button>
                      </div>
                      {form.getValues('isBusinessCustomer') && form.getValues('companyName') && (
                        <p className="text-sm font-medium">{form.getValues('companyName')}</p>
                      )}
                      <p className="text-sm">
                        {form.getValues('firstName')} {form.getValues('lastName')}
                        {form.getValues('isBusinessCustomer') && (
                          <span className="text-muted-foreground"> ({t('contact')})</span>
                        )}
                      </p>
                      <p className="text-sm text-muted-foreground">{form.getValues('email')}</p>
                      <p className="text-sm text-muted-foreground">{form.getValues('phone')}</p>
                      {form.getValues('address') && (
                        <p className="text-sm text-muted-foreground">
                          {form.getValues('address')}, {form.getValues('postalCode')} {form.getValues('city')}
                        </p>
                      )}
                    </div>

                    {/* CGV */}
                    <div className="space-y-3">
                      {cgv && (
                        <div className="max-h-32 overflow-y-auto rounded-lg border p-3 text-xs">
                          <div
                            className="prose prose-xs dark:prose-invert max-w-none prose-headings:text-sm prose-headings:font-semibold prose-headings:my-1 prose-p:my-1 prose-p:text-muted-foreground prose-a:text-primary"
                            dangerouslySetInnerHTML={{ __html: cgv }}
                          />
                        </div>
                      )}

                      <FormField
                        control={form.control}
                        name="acceptCgv"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-lg border p-4">
                            <FormControl>
                              <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                            </FormControl>
                            <div className="space-y-1 leading-none">
                              <FormLabel className="cursor-pointer">{t('acceptCgv')}</FormLabel>
                              <FormMessage />
                            </div>
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="pt-2 flex gap-3">
                      <Button type="button" variant="outline" onClick={goToPreviousStep}>
                        <ChevronLeft className="mr-2 h-4 w-4" />
                        {t('back')}
                      </Button>
                      <Button type="submit" size="lg" className="flex-1" disabled={isSubmitting}>
                        {isSubmitting ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            {t('processing')}
                          </>
                        ) : reservationMode === 'payment' ? (
                          <>
                            <CreditCard className="mr-2 h-4 w-4" />
                            {depositPercentage < 100
                              ? t('payDeposit', { amount: formatCurrency(Math.round(getSubtotal() * depositPercentage) / 100, currency) })
                              : `${t('pay')} ${formatCurrency(getTotal() + (deliveryOption === 'delivery' ? deliveryFee : 0), currency)}`}
                          </>
                        ) : (
                          <>
                            <Send className="mr-2 h-4 w-4" />
                            {t('submitRequest')}
                          </>
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}
            </form>
          </Form>
        </div>

        {/* Order Summary - Always visible */}
        <div className="lg:col-span-2">
          <Card className="sticky top-4">
            <CardContent className="pt-6 space-y-4">
              <h3 className="font-semibold">{t('summary')}</h3>

              {/* Dates */}
              {globalStartDate && globalEndDate && (
                <div className="flex items-center justify-between text-sm bg-muted/50 rounded-lg px-3 py-2">
                  <span className="text-muted-foreground">
                    {format(new Date(globalStartDate), 'dd MMM', { locale: fr })} →{' '}
                    {format(new Date(globalEndDate), 'dd MMM', { locale: fr })}
                  </span>
                  <Badge variant="secondary">{durationLabel}</Badge>
                </div>
              )}

              {/* Items */}
              <div className="space-y-3">
                {items.map((item) => {
                  const duration = calculateDuration(item.startDate, item.endDate, item.pricingMode)
                  const itemPricingMode = item.productPricingMode || pricingMode

                  // Calculate with tiered pricing if available
                  let itemTotal: number
                  let itemSavings = 0
                  let discountPercent: number | null = null

                  if (item.pricingTiers && item.pricingTiers.length > 0) {
                    const pricing: ProductPricing = {
                      basePrice: item.price,
                      deposit: item.deposit,
                      pricingMode: itemPricingMode,
                      tiers: item.pricingTiers.map((t, i) => ({
                        ...t,
                        displayOrder: i,
                      })),
                    }
                    const result = calculateRentalPrice(pricing, duration, item.quantity)
                    itemTotal = result.subtotal
                    itemSavings = result.savings
                    discountPercent = result.discountPercent
                  } else {
                    itemTotal = item.price * item.quantity * duration
                  }

                  return (
                    <div key={item.productId} className="flex gap-3">
                      <div className="relative h-14 w-14 flex-shrink-0 rounded-lg overflow-hidden bg-muted">
                        {item.productImage ? (
                          <Image
                            src={item.productImage}
                            alt={item.productName}
                            fill
                            className="object-cover"
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center">
                            <ImageIcon className="h-5 w-5 text-muted-foreground" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{item.productName}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.quantity} × {formatCurrency(item.price, currency)} × {duration}
                        </p>
                        {discountPercent && (
                          <Badge variant="secondary" className="mt-1 text-xs bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300">
                            -{discountPercent}%
                          </Badge>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="font-medium text-sm">{formatCurrency(itemTotal, currency)}</p>
                        {itemSavings > 0 && (
                          <p className="text-xs text-green-600">-{formatCurrency(itemSavings, currency)}</p>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>

              <Separator />

              {/* Totals */}
              <div className="space-y-2">
                {/* Show original price and discount if applicable */}
                {getTotalSavings() > 0 && (
                  <>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{tCart('subtotal')}</span>
                      <span className="line-through text-muted-foreground">{formatCurrency(getOriginalSubtotal(), currency)}</span>
                    </div>
                    <div className="flex justify-between text-sm text-green-600">
                      <span>{t('pricing.discount')}</span>
                      <span>-{formatCurrency(getTotalSavings(), currency)}</span>
                    </div>
                  </>
                )}

                {/* Delivery fee (if applicable) */}
                {deliveryOption === 'delivery' && deliveryDistance !== null && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground flex items-center gap-1.5">
                      <Truck className="h-3.5 w-3.5" />
                      {t('deliveryFee')}
                    </span>
                    <span className={deliveryFee === 0 ? 'text-green-600 font-medium' : ''}>
                      {deliveryFee === 0 ? t('free') : formatCurrency(deliveryFee, currency)}
                    </span>
                  </div>
                )}

                <Separator />
                <div className="flex justify-between font-semibold text-lg">
                  <span>{tCart('total')}</span>
                  <span className="text-primary">
                    {formatCurrency(getTotal() + (deliveryOption === 'delivery' ? deliveryFee : 0), currency)}
                  </span>
                </div>
                {/* Partial payment info - only in payment mode with deposit < 100% */}
                {reservationMode === 'payment' && depositPercentage < 100 && (
                  <div className="pt-2 space-y-1.5">
                    <div className="flex justify-between text-base font-semibold">
                      <span>{t('toPayNow')}</span>
                      <span className="text-primary">
                        {formatCurrency(Math.round(getSubtotal() * depositPercentage) / 100, currency)}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t('remainingAtPickup', {
                        amount: formatCurrency(Math.round(getSubtotal() * (100 - depositPercentage)) / 100, currency)
                      })}
                    </p>
                  </div>
                )}
                {taxSettings?.enabled && (
                  <p className="text-xs text-muted-foreground text-center pt-2">
                    {taxSettings.displayMode === 'inclusive' ? tCart('pricesIncludeTax') : tCart('pricesExcludeTax')}
                  </p>
                )}
              </div>

              {/* Savings banner */}
              {getTotalSavings() > 0 && (
                <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3 text-sm text-green-700 dark:text-green-300">
                  {t('pricing.savingsBanner', { amount: formatCurrency(getTotalSavings(), currency) })}
                </div>
              )}

              {/* Deposit info - explains authorization hold */}
              {getTotalDeposit() > 0 && reservationMode === 'payment' && (
                <div className="border-t pt-3 mt-2 space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{t('depositLabel')}</span>
                    <span className="font-medium">{formatCurrency(getTotalDeposit(), currency)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t('depositAuthorizationInfo')}
                  </p>
                </div>
              )}
              {getTotalDeposit() > 0 && reservationMode !== 'payment' && (
                <div className="text-xs text-muted-foreground border-t pt-3 mt-2">
                  <p>{t('depositInfo', { amount: formatCurrency(getTotalDeposit(), currency) })}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
