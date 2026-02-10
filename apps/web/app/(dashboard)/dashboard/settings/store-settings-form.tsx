'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { z } from 'zod'
import { ExternalLink, Pencil, CreditCard, ArrowRight, Info } from 'lucide-react'
import Link from 'next/link'
import { toastManager } from '@louez/ui'
import { env } from '@/env'

import { Button } from '@louez/ui'
import { Input } from '@louez/ui'
import { Switch } from '@louez/ui'
import { Slider } from '@louez/ui'
import { Checkbox } from '@louez/ui'
import { Label } from '@louez/ui'
import { AddressInput } from '@/components/ui/address-input'
import { RichTextEditor } from '@/components/ui/rich-text-editor'
import { SlugChangeModal } from './slug-change-modal'
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
import {
  Dialog,
  DialogContent,
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
import { updateStoreSettings } from './actions'
import { FloatingSaveBar } from '@/components/dashboard/floating-save-bar'
import type { StoreSettings } from '@louez/types'
import { getCountriesSortedByName, getTimezoneForCountry, getCountryFlag, getCountryName } from '@/lib/utils/countries'
import { SUPPORTED_CURRENCIES, getDefaultCurrencyForCountry, getCurrencyByCode, type CurrencyCode } from '@/lib/utils/currency'
import { getMinRentalHours, getMaxRentalHours } from '@/lib/utils/rental-duration'
import { useStore } from '@tanstack/react-form'
import { useAppForm } from '@/hooks/form/form'
import { RootError } from '@/components/form/root-error'

const createStoreSettingsSchema = (t: (key: string, params?: Record<string, string | number | Date>) => string) => z.object({
  name: z.string().min(2, t('minLength', { min: 2 })).max(255),
  description: z.string(),
  email: z.string().email(t('email')).or(z.literal('')),
  phone: z.string(),
  address: z.string(),
  country: z.string().length(2),
  currency: z.string().min(3).max(3),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),

  // Billing address
  billingAddressSameAsStore: z.boolean(),
  billingAddress: z.string(),
  billingCity: z.string(),
  billingPostalCode: z.string(),
  billingCountry: z.string(),

  // Settings
  pricingMode: z.enum(['day', 'hour', 'week']),
  reservationMode: z.enum(['payment', 'request']),
  pendingBlocksAvailability: z.boolean(),
  onlinePaymentDepositPercentage: z.number().int().min(10).max(100),
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
  const [rootError, setRootError] = useState<string | null>(null)
  const minRentalHoursInit = getMinRentalHours(store.settings as StoreSettings | null)
  const advanceNoticeInit = (store.settings as StoreSettings | null)?.advanceNotice ?? 0
  const [minDurationUnit, setMinDurationUnit] = useState<'hours' | 'days'>(
    minRentalHoursInit > 0 && minRentalHoursInit % 24 === 0 ? 'days' : 'hours'
  )
  const [advanceNoticeUnit, setAdvanceNoticeUnit] = useState<'hours' | 'days'>(
    advanceNoticeInit > 0 && advanceNoticeInit % 24 === 0 ? 'days' : 'hours'
  )
  const t = useTranslations('dashboard.settings')

  const domain = env.NEXT_PUBLIC_APP_DOMAIN
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

  const form = useAppForm({
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
      onlinePaymentDepositPercentage: settings.onlinePaymentDepositPercentage ?? 100,
      minRentalHours: getMinRentalHours(settings as StoreSettings),
      maxRentalHours: getMaxRentalHours(settings as StoreSettings),
      advanceNotice: settings.advanceNotice,
      requireCustomerAddress: settings.requireCustomerAddress ?? false,
    },
    validators: { onSubmit: storeSettingsSchema },
    onSubmit: async ({ value }) => {
      setRootError(null)
      startTransition(async () => {
        const result = await updateStoreSettings(value)
        if (result.error) {
          setRootError(result.error)
          return
        }
        toastManager.add({ title: t('settingsSaved'), type: 'success' })
        form.reset()
        router.refresh()
      })
    },
  })

  const isDirty = useStore(form.store, (s) => s.isDirty)
  const billingAddressSameAsStore = useStore(form.store, (s) => s.values.billingAddressSameAsStore)
  const reservationMode = useStore(form.store, (s) => s.values.reservationMode)
  const latitude = useStore(form.store, (s) => s.values.latitude)
  const longitude = useStore(form.store, (s) => s.values.longitude)
  const billingAddressValue = useStore(form.store, (s) => s.values.billingAddress)
  const billingCity = useStore(form.store, (s) => s.values.billingCity)
  const billingPostalCode = useStore(form.store, (s) => s.values.billingPostalCode)
  const billingCountry = useStore(form.store, (s) => s.values.billingCountry)

  // Auto-update currency when country changes (only if user hasn't manually changed it)
  const handleCountryChange = (newCountry: string, fieldOnChange: (value: string) => void) => {
    fieldOnChange(newCountry)
    // Automatically set the default currency for this country
    const newDefaultCurrency = getDefaultCurrencyForCountry(newCountry)
    form.setFieldValue('currency', newDefaultCurrency)
  }

  return (
    <div className="space-y-6">
      <form onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); form.handleSubmit() }} className="space-y-6">
        <RootError error={rootError} />

        {/* Store Info */}
        <Card>
          <CardHeader>
            <CardTitle>{t('storeSettings.generalInfo')}</CardTitle>
            <CardDescription>
              {t('storeSettings.generalInfoDescription')}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <form.Field name="name">
              {(field) => (
                <div className="grid gap-2">
                  <Label htmlFor={field.name}>{t('storeSettings.name')} *</Label>
                  <Input
                    id={field.name}
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                  />
                  {field.state.meta.errors.length > 0 && (
                    <p className="text-destructive text-sm">{String(field.state.meta.errors[0])}</p>
                  )}
                </div>
              )}
            </form.Field>

            <form.Field name="description">
              {(field) => (
                <div className="grid gap-2">
                  <Label htmlFor={field.name}>{t('storeSettings.descriptionLabel')}</Label>
                  <RichTextEditor
                    value={field.state.value || ''}
                    onChange={(value) => field.handleChange(value)}
                    placeholder={t('storeSettings.descriptionPlaceholder')}
                  />
                  {field.state.meta.errors.length > 0 && (
                    <p className="text-destructive text-sm">{String(field.state.meta.errors[0])}</p>
                  )}
                </div>
              )}
            </form.Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <form.Field name="email">
                {(field) => (
                  <div className="grid gap-2">
                    <Label htmlFor={field.name}>{t('storeSettings.email')}</Label>
                    <Input
                      id={field.name}
                      type="email"
                      placeholder="contact@example.com"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                    />
                    {field.state.meta.errors.length > 0 && (
                      <p className="text-destructive text-sm">{String(field.state.meta.errors[0])}</p>
                    )}
                  </div>
                )}
              </form.Field>

              <form.Field name="phone">
                {(field) => (
                  <div className="grid gap-2">
                    <Label htmlFor={field.name}>{t('storeSettings.phone')}</Label>
                    <Input
                      id={field.name}
                      placeholder="01 23 45 67 89"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                    />
                    {field.state.meta.errors.length > 0 && (
                      <p className="text-destructive text-sm">{String(field.state.meta.errors[0])}</p>
                    )}
                  </div>
                )}
              </form.Field>
            </div>

            <form.Field name="address">
              {(field) => (
                <div className="grid gap-2">
                  <Label htmlFor={field.name}>{t('storeSettings.address')}</Label>
                  <AddressInput
                    value={field.state.value || ''}
                    latitude={latitude}
                    longitude={longitude}
                    onChange={(address, lat, lng, displayAddr) => {
                      // Use displayAddress if provided, otherwise use the raw address
                      field.handleChange(displayAddr || address)
                      form.setFieldValue('latitude', lat)
                      form.setFieldValue('longitude', lng)
                    }}
                    placeholder={t('storeSettings.addressPlaceholder')}
                  />
                  {field.state.meta.errors.length > 0 && (
                    <p className="text-destructive text-sm">{String(field.state.meta.errors[0])}</p>
                  )}
                </div>
              )}
            </form.Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <form.Field name="country">
                {(field) => (
                  <div className="grid gap-2">
                    <Label htmlFor={field.name}>{t('storeSettings.country')}</Label>
                    <Select
                      onValueChange={(value) => { if (value !== null) handleCountryChange(value, field.handleChange) }}
                      value={field.state.value}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue>
                          {field.state.value && (
                            <span className="flex items-center gap-2">
                              <span>{getCountryFlag(field.state.value)}</span>
                              <span>{getCountryName(field.state.value)}</span>
                            </span>
                          )}
                        </SelectValue>
                      </SelectTrigger>
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
                    {field.state.meta.errors.length > 0 && (
                      <p className="text-destructive text-sm">{String(field.state.meta.errors[0])}</p>
                    )}
                  </div>
                )}
              </form.Field>

              <form.Field name="currency">
                {(field) => (
                  <div className="grid gap-2">
                    <Label htmlFor={field.name}>{t('storeSettings.currency')}</Label>
                    <Select
                      onValueChange={(value) => { if (value !== null) field.handleChange(value) }}
                      value={field.state.value}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue>
                          {field.state.value && (
                            <span className="flex items-center gap-2">
                              <span>{getCurrencyByCode(field.state.value as CurrencyCode)?.symbol || field.state.value}</span>
                              <span>{getCurrencyByCode(field.state.value as CurrencyCode)?.name || field.state.value}</span>
                            </span>
                          )}
                        </SelectValue>
                      </SelectTrigger>
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
                    {field.state.meta.errors.length > 0 && (
                      <p className="text-destructive text-sm">{String(field.state.meta.errors[0])}</p>
                    )}
                  </div>
                )}
              </form.Field>
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
            <form.Field name="billingAddressSameAsStore">
              {(field) => (
                <div className="flex flex-row items-start space-x-3 space-y-0 rounded-lg border p-4">
                  <Checkbox
                    checked={field.state.value}
                    onCheckedChange={(checked) => field.handleChange(checked)}
                  />
                  <div className="space-y-1 leading-none">
                    <Label htmlFor={field.name} className="text-base cursor-pointer">
                      {t('billingAddress.sameAsStore')}
                    </Label>
                    <p className="text-muted-foreground text-sm">
                      {t('billingAddress.sameAsStoreDescription')}
                    </p>
                  </div>
                </div>
              )}
            </form.Field>

            {/* Conditional billing address fields */}
            {!billingAddressSameAsStore && (
              <div className="space-y-4 animate-in fade-in-0 slide-in-from-top-2 duration-200">
                <form.Field name="billingAddress">
                  {(field) => (
                    <div className="grid gap-2">
                      <Label htmlFor={field.name}>{t('billingAddress.address')}</Label>
                      <Input
                        id={field.name}
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                        onBlur={field.handleBlur}
                        placeholder={t('billingAddress.addressPlaceholder')}
                      />
                      {field.state.meta.errors.length > 0 && (
                        <p className="text-destructive text-sm">{String(field.state.meta.errors[0])}</p>
                      )}
                    </div>
                  )}
                </form.Field>

                <div className="grid gap-4 sm:grid-cols-2">
                  <form.Field name="billingPostalCode">
                    {(field) => (
                      <div className="grid gap-2">
                        <Label htmlFor={field.name}>{t('billingAddress.postalCode')}</Label>
                        <Input
                          id={field.name}
                          value={field.state.value}
                          onChange={(e) => field.handleChange(e.target.value)}
                          onBlur={field.handleBlur}
                          placeholder={t('billingAddress.postalCodePlaceholder')}
                        />
                        {field.state.meta.errors.length > 0 && (
                          <p className="text-destructive text-sm">{String(field.state.meta.errors[0])}</p>
                        )}
                      </div>
                    )}
                  </form.Field>

                  <form.Field name="billingCity">
                    {(field) => (
                      <div className="grid gap-2">
                        <Label htmlFor={field.name}>{t('billingAddress.city')}</Label>
                        <Input
                          id={field.name}
                          value={field.state.value}
                          onChange={(e) => field.handleChange(e.target.value)}
                          onBlur={field.handleBlur}
                          placeholder={t('billingAddress.cityPlaceholder')}
                        />
                        {field.state.meta.errors.length > 0 && (
                          <p className="text-destructive text-sm">{String(field.state.meta.errors[0])}</p>
                        )}
                      </div>
                    )}
                  </form.Field>
                </div>

                <form.Field name="billingCountry">
                  {(field) => (
                    <div className="grid gap-2">
                      <Label htmlFor={field.name}>{t('billingAddress.country')}</Label>
                      <Select
                        onValueChange={(value) => { if (value !== null) field.handleChange(value) }}
                        value={field.state.value}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue>
                            {field.state.value && (
                              <span className="flex items-center gap-2">
                                <span>{getCountryFlag(field.state.value)}</span>
                                <span>{getCountryName(field.state.value)}</span>
                              </span>
                            )}
                          </SelectValue>
                        </SelectTrigger>
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
                      {field.state.meta.errors.length > 0 && (
                        <p className="text-destructive text-sm">{String(field.state.meta.errors[0])}</p>
                      )}
                    </div>
                  )}
                </form.Field>

                {/* Preview of billing address */}
                {(billingAddressValue || billingCity) && (
                  <div className="rounded-lg bg-muted/50 p-4 text-sm">
                    <p className="font-medium text-muted-foreground mb-1">
                      {t('billingAddress.preview')}
                    </p>
                    <p>{billingAddressValue}</p>
                    {(billingPostalCode || billingCity) && (
                      <p>
                        {billingPostalCode} {billingCity}
                      </p>
                    )}
                    {billingCountry && (
                      <p>{getCountryName(billingCountry)}</p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Info about what address will be shown on contracts */}
            <div className="rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/50 p-4 text-sm">
              <p className="text-blue-800 dark:text-blue-200">
                {billingAddressSameAsStore
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
              <form.Field name="reservationMode">
                {(field) => (
                  <div className="grid gap-2">
                    <Label htmlFor={field.name}>{t('reservationSettings.mode')}</Label>
                    <Select
                      onValueChange={(value) => {
                        if (value === null) return
                        if (value === 'payment' && !stripeChargesEnabled) {
                          setIsStripeRequiredDialogOpen(true)
                          return
                        }
                        field.handleChange(value)
                      }}
                      value={field.state.value}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="payment">
                          {t('reservationSettings.modePayment')}
                        </SelectItem>
                        <SelectItem value="request">
                          {t('reservationSettings.modeRequest')}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-muted-foreground text-sm">
                      {field.state.value === 'payment'
                        ? t('reservationSettings.modePaymentDescription')
                        : t('reservationSettings.modeRequestDescription')}
                    </p>
                    {field.state.meta.errors.length > 0 && (
                      <p className="text-destructive text-sm">{String(field.state.meta.errors[0])}</p>
                    )}
                  </div>
                )}
              </form.Field>

              <form.Field name="pricingMode">
                {(field) => (
                  <div className="grid gap-2">
                    <Label htmlFor={field.name}>{t('reservationSettings.pricingMode')}</Label>
                    <Select
                      onValueChange={(value) => { if (value !== null) field.handleChange(value) }}
                      value={field.state.value}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="day">{t('reservationSettings.pricingDay')}</SelectItem>
                        <SelectItem value="hour">{t('reservationSettings.pricingHour')}</SelectItem>
                        <SelectItem value="week">{t('reservationSettings.pricingWeek')}</SelectItem>
                      </SelectContent>
                    </Select>
                    {field.state.meta.errors.length > 0 && (
                      <p className="text-destructive text-sm">{String(field.state.meta.errors[0])}</p>
                    )}
                  </div>
                )}
              </form.Field>
            </div>

            {/* Pending blocks availability - only shown in request mode */}
            {reservationMode === 'request' && (
              <form.Field name="pendingBlocksAvailability">
                {(field) => (
                  <div className="flex flex-row items-center justify-between rounded-lg border p-4">
                    <div className="space-y-0.5">
                      <Label htmlFor={field.name} className="text-base">
                        {t('reservationSettings.pendingBlocksAvailability')}
                      </Label>
                      <p className="text-muted-foreground text-sm">
                        {t('reservationSettings.pendingBlocksAvailabilityDescription')}
                      </p>
                    </div>
                    <Switch
                      checked={field.state.value}
                      onCheckedChange={(checked) => field.handleChange(checked)}
                    />
                  </div>
                )}
              </form.Field>
            )}

            {/* Online payment deposit percentage - only shown in payment mode */}
            {reservationMode === 'payment' && (
              <form.Field name="onlinePaymentDepositPercentage">
                {(field) => (
                  <div className="rounded-lg border p-4">
                    <div className="flex flex-row items-center justify-between">
                      <div className="space-y-0.5">
                        <Label htmlFor={field.name} className="text-base">
                          {t('reservationSettings.depositPercentage')}
                        </Label>
                        <p className="text-muted-foreground text-sm">
                          {field.state.value === 100
                            ? t('reservationSettings.depositPercentageFull')
                            : t('reservationSettings.depositPercentagePartial', { percentage: field.state.value })}
                        </p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <Slider
                          value={field.state.value}
                          onValueChange={(v) => field.handleChange(Array.isArray(v) ? v[0] : v)}
                          min={10}
                          max={100}
                          step={5}
                          className="w-28"
                        />
                        <span className="w-12 text-right font-medium tabular-nums text-sm">
                          {field.state.value}%
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </form.Field>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <form.Field name="minRentalHours">
                {(field) => {
                  const displayValue = minDurationUnit === 'days'
                    ? Math.round(field.state.value / 24)
                    : field.state.value
                  return (
                    <div className="grid gap-2">
                      <div className="flex items-center gap-1.5">
                        <Label htmlFor={field.name}>{t('reservationSettings.minRentalHours')}</Label>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger render={<Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />} />
                            <TooltipContent side="top" className="max-w-xs">
                              <p>{t('reservationSettings.minRentalHoursHelp')}</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                      <div className="flex h-9 rounded-md border border-input bg-transparent shadow-xs dark:bg-input/30 has-[:focus]:border-ring has-[:focus]:ring-ring/50 has-[:focus]:ring-[3px]">
                        <input
                          type="number"
                          min={0}
                          step={1}
                          className="flex-1 min-w-0 rounded-l-md bg-transparent px-3 text-base outline-none md:text-sm [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                          value={displayValue || ''}
                          onChange={(e) => {
                            if (e.target.value === '') {
                              field.handleChange(0)
                              return
                            }
                            const raw = parseInt(e.target.value)
                            if (!isNaN(raw)) {
                              field.handleChange(minDurationUnit === 'days' ? raw * 24 : raw)
                            }
                          }}
                        />
                        <select
                          className="h-full border-l border-input bg-muted/50 rounded-r-md px-2.5 text-sm text-muted-foreground outline-none cursor-pointer"
                          value={minDurationUnit}
                          onChange={(e) => {
                            const unit = e.target.value as 'hours' | 'days'
                            if (unit === 'days') {
                              const days = Math.round(field.state.value / 24)
                              field.handleChange(days * 24)
                            }
                            setMinDurationUnit(unit)
                          }}
                        >
                          <option value="hours">{tCommon('hourUnit', { count: 2 })}</option>
                          <option value="days">{tCommon('dayUnit', { count: 2 })}</option>
                        </select>
                      </div>
                      {field.state.meta.errors.length > 0 && (
                        <p className="text-destructive text-sm">{String(field.state.meta.errors[0])}</p>
                      )}
                    </div>
                  )
                }}
              </form.Field>

              <form.Field name="advanceNotice">
                {(field) => {
                  const displayValue = advanceNoticeUnit === 'days'
                    ? Math.round(field.state.value / 24)
                    : field.state.value
                  return (
                    <div className="grid gap-2">
                      <div className="flex items-center gap-1.5">
                        <Label htmlFor={field.name}>{t('reservationSettings.leadTime')}</Label>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger render={<Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />} />
                            <TooltipContent side="top" className="max-w-xs">
                              <p>{t('reservationSettings.leadTimeHelp')}</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                      <div className="flex h-9 rounded-md border border-input bg-transparent shadow-xs dark:bg-input/30 has-[:focus]:border-ring has-[:focus]:ring-ring/50 has-[:focus]:ring-[3px]">
                        <input
                          type="number"
                          min={0}
                          step={1}
                          className="flex-1 min-w-0 rounded-l-md bg-transparent px-3 text-base outline-none md:text-sm [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                          value={displayValue || ''}
                          onChange={(e) => {
                            if (e.target.value === '') {
                              field.handleChange(0)
                              return
                            }
                            const raw = parseInt(e.target.value)
                            if (!isNaN(raw)) {
                              field.handleChange(advanceNoticeUnit === 'days' ? raw * 24 : raw)
                            }
                          }}
                        />
                        <select
                          className="h-full border-l border-input bg-muted/50 rounded-r-md px-2.5 text-sm text-muted-foreground outline-none cursor-pointer"
                          value={advanceNoticeUnit}
                          onChange={(e) => {
                            const unit = e.target.value as 'hours' | 'days'
                            if (unit === 'days') {
                              const days = Math.round(field.state.value / 24)
                              field.handleChange(days * 24)
                            }
                            setAdvanceNoticeUnit(unit)
                          }}
                        >
                          <option value="hours">{tCommon('hourUnit', { count: 2 })}</option>
                          <option value="days">{tCommon('dayUnit', { count: 2 })}</option>
                        </select>
                      </div>
                      {field.state.meta.errors.length > 0 && (
                        <p className="text-destructive text-sm">{String(field.state.meta.errors[0])}</p>
                      )}
                    </div>
                  )
                }}
              </form.Field>
            </div>

            <form.Field name="requireCustomerAddress">
              {(field) => (
                <div className="flex flex-row items-center justify-between rounded-lg border p-4">
                  <div className="space-y-0.5">
                    <Label htmlFor={field.name} className="text-base">
                      {t('reservationSettings.requireAddress')}
                    </Label>
                    <p className="text-muted-foreground text-sm">
                      {t('reservationSettings.requireAddressDescription')}
                    </p>
                  </div>
                  <Switch
                    checked={field.state.value}
                    onCheckedChange={(checked) => field.handleChange(checked)}
                  />
                </div>
              )}
            </form.Field>
          </CardContent>
        </Card>

        <FloatingSaveBar
          isDirty={isDirty}
          isLoading={isPending}
          onReset={() => form.reset()}
        />
      </form>

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
            <Button render={<Link href="/dashboard/settings/payments" />} className="w-full">
                {t('reservationSettings.stripeRequired.configureStripe')}
                <ArrowRight className="ml-2 h-4 w-4" />
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
