'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { z } from 'zod'
import { Loader2, ExternalLink, Pencil, CreditCard, ArrowRight, Info } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { AddressInput } from '@/components/ui/address-input'
import { RichTextEditor } from '@/components/ui/rich-text-editor'
import { SlugChangeModal } from './slug-change-modal'
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
  FormDescription,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { updateStoreSettings } from './actions'
import type { StoreSettings } from '@/types'
import { getCountriesSortedByName, getTimezoneForCountry, getCountryFlag, getCountryName } from '@/lib/utils/countries'
import { SUPPORTED_CURRENCIES, getDefaultCurrencyForCountry, getCurrencyByCode, type CurrencyCode } from '@/lib/utils/currency'
import { getMinRentalHours, getMaxRentalHours } from '@/lib/utils/rental-duration'

const createStoreSettingsSchema = (t: (key: string, params?: Record<string, string | number | Date>) => string) => z.object({
  name: z.string().min(2, t('minLength', { min: 2 })).max(255),
  description: z.string().optional(),
  email: z.string().email(t('email')).optional().or(z.literal('')),
  phone: z.string().optional(),
  address: z.string().optional(),
  country: z.string().length(2),
  currency: z.string().min(3).max(3),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),

  // Billing address
  billingAddressSameAsStore: z.boolean(),
  billingAddress: z.string().optional(),
  billingCity: z.string().optional(),
  billingPostalCode: z.string().optional(),
  billingCountry: z.string().optional(),

  // Settings
  pricingMode: z.enum(['day', 'hour', 'week']),
  reservationMode: z.enum(['payment', 'request']),
  pendingBlocksAvailability: z.boolean(),
  minRentalHours: z.number().int().min(0),
  maxRentalHours: z.number().int().min(1).nullable(),
  advanceNotice: z.number().min(0),
  requireCustomerAddress: z.boolean(),
})

type StoreSettingsInput = z.infer<ReturnType<typeof createStoreSettingsSchema>>

interface Store {
  id: string
  name: string
  slug: string
  description: string | null
  email: string | null
  phone: string | null
  address: string | null
  latitude: string | null
  longitude: string | null
  settings: StoreSettings | null
}

interface StoreSettingsFormProps {
  store: Store
  stripeChargesEnabled: boolean
}

export function StoreSettingsForm({ store, stripeChargesEnabled }: StoreSettingsFormProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [isSlugModalOpen, setIsSlugModalOpen] = useState(false)
  const [isStripeRequiredDialogOpen, setIsStripeRequiredDialogOpen] = useState(false)
  const minRentalHoursInit = getMinRentalHours(store.settings as StoreSettings | null)
  const advanceNoticeInit = (store.settings as StoreSettings | null)?.advanceNotice ?? 0
  const [minDurationUnit, setMinDurationUnit] = useState<'hours' | 'days'>(
    minRentalHoursInit > 0 && minRentalHoursInit % 24 === 0 ? 'days' : 'hours'
  )
  const [advanceNoticeUnit, setAdvanceNoticeUnit] = useState<'hours' | 'days'>(
    advanceNoticeInit > 0 && advanceNoticeInit % 24 === 0 ? 'days' : 'hours'
  )
  const t = useTranslations('dashboard.settings')

  const domain = process.env.NEXT_PUBLIC_APP_DOMAIN || 'localhost'
  const tCommon = useTranslations('common')
  const tValidation = useTranslations('validation')

  const storeSettingsSchema = createStoreSettingsSchema(tValidation)

  const settings = store.settings || {
    pricingMode: 'day',
    reservationMode: 'payment',
    minRentalHours: 1,
    maxRentalHours: null,
    advanceNotice: 24,
  }

  const defaultCountry = settings.country || 'FR'
  const defaultCurrency = settings.currency || getDefaultCurrencyForCountry(defaultCountry)

  const billingAddress = settings.billingAddress || { useSameAsStore: true }

  const form = useForm<StoreSettingsInput>({
    resolver: zodResolver(storeSettingsSchema),
    defaultValues: {
      name: store.name,
      description: store.description || '',
      email: store.email || '',
      phone: store.phone || '',
      address: store.address || '',
      country: defaultCountry,
      currency: defaultCurrency,
      latitude: store.latitude ? parseFloat(store.latitude) : null,
      longitude: store.longitude ? parseFloat(store.longitude) : null,
      billingAddressSameAsStore: billingAddress.useSameAsStore,
      billingAddress: billingAddress.address || '',
      billingCity: billingAddress.city || '',
      billingPostalCode: billingAddress.postalCode || '',
      billingCountry: billingAddress.country || defaultCountry,
      pricingMode: settings.pricingMode,
      reservationMode: settings.reservationMode,
      pendingBlocksAvailability: settings.pendingBlocksAvailability ?? true,
      minRentalHours: getMinRentalHours(settings as StoreSettings),
      maxRentalHours: getMaxRentalHours(settings as StoreSettings),
      advanceNotice: settings.advanceNotice,
      requireCustomerAddress: settings.requireCustomerAddress ?? false,
    },
  })

  // Auto-update currency when country changes (only if user hasn't manually changed it)
  const handleCountryChange = (newCountry: string, onChange: (value: string) => void) => {
    onChange(newCountry)
    // Automatically set the default currency for this country
    const newDefaultCurrency = getDefaultCurrencyForCountry(newCountry)
    form.setValue('currency', newDefaultCurrency)
  }

  const onSubmit = (data: StoreSettingsInput) => {
    startTransition(async () => {
      const result = await updateStoreSettings(data)
      if (result.error) {
        form.setError('root', { message: result.error })
        return
      }
      toast.success(t('settingsSaved'))
      router.refresh()
    })
  }

  return (
    <div className="space-y-6">
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          {form.formState.errors.root && (
            <div className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive">
              {form.formState.errors.root.message}
            </div>
          )}

          {/* Store Info */}
          <Card>
            <CardHeader>
              <CardTitle>{t('storeSettings.generalInfo')}</CardTitle>
              <CardDescription>
                {t('storeSettings.generalInfoDescription')}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('storeSettings.name')} *</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('storeSettings.descriptionLabel')}</FormLabel>
                    <FormControl>
                      <RichTextEditor
                        value={field.value || ''}
                        onChange={field.onChange}
                        placeholder={t('storeSettings.descriptionPlaceholder')}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('storeSettings.email')}</FormLabel>
                      <FormControl>
                        <Input type="email" placeholder="contact@example.com" {...field} />
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
                      <FormLabel>{t('storeSettings.phone')}</FormLabel>
                      <FormControl>
                        <Input placeholder="01 23 45 67 89" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="address"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('storeSettings.address')}</FormLabel>
                    <FormControl>
                      <AddressInput
                        value={field.value || ''}
                        latitude={form.watch('latitude')}
                        longitude={form.watch('longitude')}
                        onChange={(address, lat, lng, displayAddr) => {
                          // Use displayAddress if provided, otherwise use the raw address
                          field.onChange(displayAddr || address)
                          form.setValue('latitude', lat)
                          form.setValue('longitude', lng)
                        }}
                        placeholder={t('storeSettings.addressPlaceholder')}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="country"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('storeSettings.country')}</FormLabel>
                      <Select
                        onValueChange={(value) => handleCountryChange(value, field.onChange)}
                        defaultValue={field.value}
                      >
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue>
                              {field.value && (
                                <span className="flex items-center gap-2">
                                  <span>{getCountryFlag(field.value)}</span>
                                  <span>{getCountryName(field.value)}</span>
                                </span>
                              )}
                            </SelectValue>
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent className="max-h-[300px]">
                          {getCountriesSortedByName().map((country) => (
                            <SelectItem key={country.code} value={country.code}>
                              <span className="flex items-center gap-2">
                                <span>{country.flag}</span>
                                <span>{getCountryName(country.code)}</span>
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="currency"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('storeSettings.currency')}</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                      >
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue>
                              {field.value && (
                                <span className="flex items-center gap-2">
                                  <span>{getCurrencyByCode(field.value as CurrencyCode)?.symbol || field.value}</span>
                                  <span>{getCurrencyByCode(field.value as CurrencyCode)?.name || field.value}</span>
                                </span>
                              )}
                            </SelectValue>
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent className="max-h-[300px]">
                          {SUPPORTED_CURRENCIES.map((currency) => (
                            <SelectItem key={currency.code} value={currency.code}>
                              <span className="flex items-center gap-2">
                                <span className="w-8 text-center">{currency.symbol}</span>
                                <span>{currency.name} ({currency.code})</span>
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="flex items-center justify-between rounded-lg border p-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm text-muted-foreground shrink-0">
                    {t('storeSettings.storeUrl')}
                  </span>
                  <code className="font-mono text-sm truncate">
                    {store.slug}.{domain}
                  </code>
                  <a
                    href={`https://${store.slug}.${domain}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsSlugModalOpen(true)}
                  className="shrink-0 ml-2"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Billing Address */}
          <Card>
            <CardHeader>
              <CardTitle>{t('billingAddress.title')}</CardTitle>
              <CardDescription>
                {t('billingAddress.description')}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <FormField
                control={form.control}
                name="billingAddressSameAsStore"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-lg border p-4">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                    <div className="space-y-1 leading-none">
                      <FormLabel className="text-base cursor-pointer">
                        {t('billingAddress.sameAsStore')}
                      </FormLabel>
                      <FormDescription>
                        {t('billingAddress.sameAsStoreDescription')}
                      </FormDescription>
                    </div>
                  </FormItem>
                )}
              />

              {/* Conditional billing address fields */}
              {!form.watch('billingAddressSameAsStore') && (
                <div className="space-y-4 animate-in fade-in-0 slide-in-from-top-2 duration-200">
                  <FormField
                    control={form.control}
                    name="billingAddress"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('billingAddress.address')}</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            placeholder={t('billingAddress.addressPlaceholder')}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField
                      control={form.control}
                      name="billingPostalCode"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('billingAddress.postalCode')}</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              placeholder={t('billingAddress.postalCodePlaceholder')}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="billingCity"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('billingAddress.city')}</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              placeholder={t('billingAddress.cityPlaceholder')}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={form.control}
                    name="billingCountry"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('billingAddress.country')}</FormLabel>
                        <Select
                          onValueChange={field.onChange}
                          value={field.value}
                        >
                          <FormControl>
                            <SelectTrigger className="w-full">
                              <SelectValue>
                                {field.value && (
                                  <span className="flex items-center gap-2">
                                    <span>{getCountryFlag(field.value)}</span>
                                    <span>{getCountryName(field.value)}</span>
                                  </span>
                                )}
                              </SelectValue>
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent className="max-h-[300px]">
                            {getCountriesSortedByName().map((country) => (
                              <SelectItem key={country.code} value={country.code}>
                                <span className="flex items-center gap-2">
                                  <span>{country.flag}</span>
                                  <span>{getCountryName(country.code)}</span>
                                </span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Preview of billing address */}
                  {(form.watch('billingAddress') || form.watch('billingCity')) && (
                    <div className="rounded-lg bg-muted/50 p-4 text-sm">
                      <p className="font-medium text-muted-foreground mb-1">
                        {t('billingAddress.preview')}
                      </p>
                      <p>{form.watch('billingAddress')}</p>
                      {(form.watch('billingPostalCode') || form.watch('billingCity')) && (
                        <p>
                          {form.watch('billingPostalCode')} {form.watch('billingCity')}
                        </p>
                      )}
                      {form.watch('billingCountry') && (
                        <p>{getCountryName(form.watch('billingCountry') || '')}</p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Info about what address will be shown on contracts */}
              <div className="rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/50 p-4 text-sm">
                <p className="text-blue-800 dark:text-blue-200">
                  {form.watch('billingAddressSameAsStore')
                    ? t('billingAddress.infoSameAddress')
                    : t('billingAddress.infoDifferentAddress')}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Reservation Settings */}
          <Card>
            <CardHeader>
              <CardTitle>{t('reservationSettings.title')}</CardTitle>
              <CardDescription>
                {t('reservationSettings.description')}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="reservationMode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('reservationSettings.mode')}</FormLabel>
                      <Select
                        onValueChange={(value) => {
                          if (value === 'payment' && !stripeChargesEnabled) {
                            setIsStripeRequiredDialogOpen(true)
                            return
                          }
                          field.onChange(value)
                        }}
                        value={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="payment">
                            {t('reservationSettings.modePayment')}
                          </SelectItem>
                          <SelectItem value="request">
                            {t('reservationSettings.modeRequest')}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <FormDescription>
                        {field.value === 'payment'
                          ? t('reservationSettings.modePaymentDescription')
                          : t('reservationSettings.modeRequestDescription')}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="pricingMode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('reservationSettings.pricingMode')}</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="day">{t('reservationSettings.pricingDay')}</SelectItem>
                          <SelectItem value="hour">{t('reservationSettings.pricingHour')}</SelectItem>
                          <SelectItem value="week">{t('reservationSettings.pricingWeek')}</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Pending blocks availability - only shown in request mode */}
              {form.watch('reservationMode') === 'request' && (
                <FormField
                  control={form.control}
                  name="pendingBlocksAvailability"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <FormLabel className="text-base">
                          {t('reservationSettings.pendingBlocksAvailability')}
                        </FormLabel>
                        <FormDescription>
                          {t('reservationSettings.pendingBlocksAvailabilityDescription')}
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="minRentalHours"
                  render={({ field }) => {
                    const displayValue = minDurationUnit === 'days'
                      ? Math.round(field.value / 24)
                      : field.value
                    return (
                      <FormItem>
                        <div className="flex items-center gap-1.5">
                          <FormLabel>{t('reservationSettings.minRentalHours')}</FormLabel>
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-xs">
                                <p>{t('reservationSettings.minRentalHoursHelp')}</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                        <div className="flex h-9 rounded-md border border-input bg-transparent shadow-xs dark:bg-input/30 has-[:focus]:border-ring has-[:focus]:ring-ring/50 has-[:focus]:ring-[3px]">
                          <FormControl>
                            <input
                              type="number"
                              min={0}
                              step={1}
                              className="flex-1 min-w-0 rounded-l-md bg-transparent px-3 text-base outline-none md:text-sm [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                              value={displayValue || ''}
                              onChange={(e) => {
                                if (e.target.value === '') {
                                  field.onChange(0)
                                  return
                                }
                                const raw = parseInt(e.target.value)
                                if (!isNaN(raw)) {
                                  field.onChange(minDurationUnit === 'days' ? raw * 24 : raw)
                                }
                              }}
                            />
                          </FormControl>
                          <select
                            className="h-full border-l border-input bg-muted/50 rounded-r-md px-2.5 text-sm text-muted-foreground outline-none cursor-pointer"
                            value={minDurationUnit}
                            onChange={(e) => {
                              const unit = e.target.value as 'hours' | 'days'
                              if (unit === 'days') {
                                const days = Math.round(field.value / 24)
                                field.onChange(days * 24)
                              }
                              setMinDurationUnit(unit)
                            }}
                          >
                            <option value="hours">{tCommon('hourUnit', { count: 2 })}</option>
                            <option value="days">{tCommon('dayUnit', { count: 2 })}</option>
                          </select>
                        </div>
                        <FormMessage />
                      </FormItem>
                    )
                  }}
                />

                <FormField
                  control={form.control}
                  name="advanceNotice"
                  render={({ field }) => {
                    const displayValue = advanceNoticeUnit === 'days'
                      ? Math.round(field.value / 24)
                      : field.value
                    return (
                      <FormItem>
                        <div className="flex items-center gap-1.5">
                          <FormLabel>{t('reservationSettings.leadTime')}</FormLabel>
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-xs">
                                <p>{t('reservationSettings.leadTimeHelp')}</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                        <div className="flex h-9 rounded-md border border-input bg-transparent shadow-xs dark:bg-input/30 has-[:focus]:border-ring has-[:focus]:ring-ring/50 has-[:focus]:ring-[3px]">
                          <FormControl>
                            <input
                              type="number"
                              min={0}
                              step={1}
                              className="flex-1 min-w-0 rounded-l-md bg-transparent px-3 text-base outline-none md:text-sm [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                              value={displayValue || ''}
                              onChange={(e) => {
                                if (e.target.value === '') {
                                  field.onChange(0)
                                  return
                                }
                                const raw = parseInt(e.target.value)
                                if (!isNaN(raw)) {
                                  field.onChange(advanceNoticeUnit === 'days' ? raw * 24 : raw)
                                }
                              }}
                            />
                          </FormControl>
                          <select
                            className="h-full border-l border-input bg-muted/50 rounded-r-md px-2.5 text-sm text-muted-foreground outline-none cursor-pointer"
                            value={advanceNoticeUnit}
                            onChange={(e) => {
                              const unit = e.target.value as 'hours' | 'days'
                              if (unit === 'days') {
                                const days = Math.round(field.value / 24)
                                field.onChange(days * 24)
                              }
                              setAdvanceNoticeUnit(unit)
                            }}
                          >
                            <option value="hours">{tCommon('hourUnit', { count: 2 })}</option>
                            <option value="days">{tCommon('dayUnit', { count: 2 })}</option>
                          </select>
                        </div>
                        <FormMessage />
                      </FormItem>
                    )
                  }}
                />
              </div>

              <FormField
                control={form.control}
                name="requireCustomerAddress"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                    <div className="space-y-0.5">
                      <FormLabel className="text-base">
                        {t('reservationSettings.requireAddress')}
                      </FormLabel>
                      <FormDescription>
                        {t('reservationSettings.requireAddressDescription')}
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('saveChanges')}
            </Button>
          </div>
        </form>
      </Form>

      <SlugChangeModal
        open={isSlugModalOpen}
        onOpenChange={setIsSlugModalOpen}
        currentSlug={store.slug}
        domain={domain}
      />

      {/* Stripe Required Dialog */}
      <Dialog open={isStripeRequiredDialogOpen} onOpenChange={setIsStripeRequiredDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader className="space-y-4">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
              <CreditCard className="h-7 w-7 text-primary" />
            </div>
            <div className="space-y-2 text-center">
              <DialogTitle>
                {t('reservationSettings.stripeRequired.title')}
              </DialogTitle>
              <DialogDescription>
                {t('reservationSettings.stripeRequired.description')}
              </DialogDescription>
            </div>
          </DialogHeader>
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
            <p className="text-sm text-muted-foreground">
              {t('reservationSettings.stripeRequired.benefits')}
            </p>
          </div>
          <DialogFooter className="flex-col gap-2 sm:flex-col">
            <Button asChild className="w-full">
              <Link href="/dashboard/settings/payments">
                {t('reservationSettings.stripeRequired.configureStripe')}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button
              variant="ghost"
              className="w-full text-muted-foreground"
              onClick={() => setIsStripeRequiredDialogOpen(false)}
            >
              {t('reservationSettings.stripeRequired.keepRequest')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
