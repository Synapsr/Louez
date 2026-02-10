'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useStore } from '@tanstack/react-form'
import { Store, Loader2, Globe, Mail, Phone, Pencil, Check, X } from 'lucide-react'
import { toastManager } from '@louez/ui'
import { useTranslations } from 'next-intl'
import { env } from '@/env'

import { Button } from '@louez/ui'
import { Input } from '@louez/ui'
import { AddressInput } from '@/components/ui/address-input'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@louez/ui'
import { RadioGroup, RadioGroupItem } from '@louez/ui'
import { Label } from '@louez/ui'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@louez/ui'
import { cn } from '@louez/utils'
import { getCountriesSortedByName, getCountryName, getCountryByCode } from '@/lib/utils/countries'
import { SUPPORTED_CURRENCIES, getDefaultCurrencyForCountry } from '@/lib/utils/currency'

import { createStoreInfoSchema, type StoreInfoInput } from '@louez/validations'
import { createStore } from './actions'
import { useAppForm } from '@/hooks/form/form'

/**
 * Detect the user's country from browser locale (e.g. "fr-FR" -> "FR")
 */
function detectCountryFromBrowser(): string {
  if (typeof navigator === 'undefined') return 'FR'
  const locale = navigator.language || 'en'
  const parts = locale.split('-')
  const regionCode = parts.length > 1 ? parts[1].toUpperCase() : null
  if (regionCode && getCountryByCode(regionCode)) return regionCode
  const langToCountry: Record<string, string> = {
    fr: 'FR', en: 'US', de: 'DE', es: 'ES',
    it: 'IT', nl: 'NL', pl: 'PL', pt: 'PT',
    ja: 'JP', zh: 'CN', ko: 'KR',
  }
  return langToCountry[parts[0].toLowerCase()] || 'FR'
}

/**
 * Convert store name to a valid URL slug
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove accents
    .replace(/[^a-z0-9\s-]/g, '')    // Remove invalid characters
    .replace(/\s+/g, '-')            // Replace spaces with hyphens
    .replace(/-+/g, '-')             // Collapse multiple hyphens
    .replace(/^-|-$/g, '')           // Remove leading/trailing hyphens
}

/**
 * Sanitize slug input - only valid characters
 */
function sanitizeSlug(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-/, '')
}

export default function OnboardingStorePage() {
  const router = useRouter()
  const t = useTranslations('onboarding.store')
  const tCommon = useTranslations('common')
  const tErrors = useTranslations('errors')
  const tValidation = useTranslations('validation')
  const [isLoading, setIsLoading] = useState(false)
  const [isEditingSlug, setIsEditingSlug] = useState(false)
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false)
  const slugInputRef = useRef<HTMLInputElement>(null)

  const storeInfoSchema = createStoreInfoSchema(tValidation)

  const detectedCountry = detectCountryFromBrowser()
  const form = useAppForm({
    defaultValues: {
      name: '',
      slug: '',
      pricingMode: 'day' as 'day' | 'hour',
      country: detectedCountry,
      currency: getDefaultCurrencyForCountry(detectedCountry),
      address: '',
      latitude: null as number | null,
      longitude: null as number | null,
      email: '',
      phone: '',
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    validators: { onSubmit: storeInfoSchema as any },
    onSubmit: async ({ value }) => {
      setIsLoading(true)
      try {
        const result = await createStore(value)
        if (result.error) {
          toastManager.add({ title: tErrors(result.error.replace('errors.', '')), type: 'error' })
          return
        }
        router.push('/onboarding/branding')
      } catch {
        toastManager.add({ title: tErrors('generic'), type: 'error' })
      } finally {
        setIsLoading(false)
      }
    },
  })

  const currentSlug = useStore(form.store, (s) => s.values.slug)
  const domain = env.NEXT_PUBLIC_APP_DOMAIN

  /**
   * Auto-focus slug input when entering edit mode
   */
  useEffect(() => {
    if (isEditingSlug && slugInputRef.current) {
      slugInputRef.current.focus()
      slugInputRef.current.select()
    }
  }, [isEditingSlug])

  /**
   * Handle store name change - auto-generate slug if not manually edited
   */
  const handleNameChange = (value: string, onChange: (value: string) => void) => {
    onChange(value)
    if (!slugManuallyEdited) {
      form.setFieldValue('slug', slugify(value))
    }
  }

  /**
   * Handle slug edit - sanitize and mark as manually edited
   */
  const handleSlugEdit = (value: string) => {
    form.setFieldValue('slug', sanitizeSlug(value))
    setSlugManuallyEdited(true)
  }

  /**
   * Confirm slug edit
   */
  const confirmSlugEdit = () => {
    setIsEditingSlug(false)
  }

  /**
   * Cancel slug edit - revert to auto-generated
   */
  const cancelSlugEdit = () => {
    setIsEditingSlug(false)
    setSlugManuallyEdited(false)
    const currentName = form.getFieldValue('name')
    form.setFieldValue('slug', slugify(currentName))
  }

  const handleCountryChange = (newCountry: string, onChange: (value: string) => void) => {
    onChange(newCountry)
    form.setFieldValue('currency', getDefaultCurrencyForCountry(newCountry))
  }

  const locale = typeof navigator !== 'undefined' ? navigator.language.split('-')[0] : 'fr'
  const sortedCountries = getCountriesSortedByName(locale)
  const sortedCurrencies = SUPPORTED_CURRENCIES.slice().sort((a, b) => a.name.localeCompare(b.name))

  return (
    <Card>
      <CardHeader className="text-center">
        <div className="bg-primary/10 mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full">
          <Store className="text-primary h-6 w-6" />
        </div>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>
          {t('description')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form.AppForm>
          <form.Form className="space-y-6">
          {/* Store Name with inline URL preview */}
          <form.Field name="name">
            {(field) => (
              <div className="grid gap-2">
                <Label htmlFor="name">{t('name')}</Label>
                <Input
                  id="name"
                  placeholder={t('namePlaceholder')}
                  value={field.state.value}
                  onChange={(e) => handleNameChange(e.target.value, field.handleChange)}
                  onBlur={field.handleBlur}
                />

                {/* URL Preview - appears when name has content */}
                {(currentSlug || field.state.value) && (
                  <div className="pt-1">
                    {isEditingSlug ? (
                      /* Edit mode - inline slug input */
                      <div className="flex items-center gap-2">
                        <div className="flex items-center flex-1 rounded-md border bg-muted/50 px-3 py-1.5">
                          <input
                            ref={slugInputRef}
                            type="text"
                            value={currentSlug}
                            onChange={(e) => handleSlugEdit(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault()
                                confirmSlugEdit()
                              }
                              if (e.key === 'Escape') {
                                cancelSlugEdit()
                              }
                            }}
                            className="bg-transparent text-sm font-medium outline-none min-w-0 flex-1"
                            placeholder={t('slugPlaceholder')}
                          />
                          <span className="text-muted-foreground text-sm">.{domain}</span>
                        </div>
                        <button
                          type="button"
                          onClick={confirmSlugEdit}
                          className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                          aria-label={tCommon('confirm')}
                        >
                          <Check className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={cancelSlugEdit}
                          className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                          aria-label={tCommon('cancel')}
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ) : (
                      /* Display mode - URL preview with edit button on hover */
                      <div
                        className="group flex items-center gap-2 cursor-pointer"
                        onClick={() => setIsEditingSlug(true)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            setIsEditingSlug(true)
                          }
                        }}
                      >
                        <span className="text-sm text-muted-foreground">
                          <span className={cn(
                            "font-medium transition-colors",
                            "group-hover:text-primary"
                          )}>
                            {currentSlug || slugify(field.state.value) || t('slugDefault')}
                          </span>
                          <span>.{domain}</span>
                        </span>
                        <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    )}
                  </div>
                )}

                {field.state.meta.errors.length > 0 && (
                  <p className="text-destructive text-sm">
                    {String(field.state.meta.errors[0])}
                  </p>
                )}
              </div>
            )}
          </form.Field>

          {/* Hidden slug field for form validation */}
          <form.Field name="slug">
            {(field) => (
              <div>
                <input type="hidden" value={field.state.value} />
                {field.state.meta.errors.length > 0 && (
                  <p className="text-sm font-medium text-destructive">
                    {String(field.state.meta.errors[0])}
                  </p>
                )}
              </div>
            )}
          </form.Field>

          <form.Field name="pricingMode">
            {(field) => (
              <div className="grid gap-2">
                <Label>{t('pricingMode')}</Label>
                <RadioGroup
                  onValueChange={(value) => field.handleChange(value)}
                  defaultValue={field.state.value}
                  className="grid grid-cols-2 gap-4"
                >
                  <div>
                    <RadioGroupItem
                      value="day"
                      id="day"
                      className="peer sr-only"
                    />
                    <Label
                      htmlFor="day"
                      className="border-muted bg-popover hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary flex cursor-pointer flex-col items-center justify-between rounded-md border-2 p-4"
                    >
                      <span className="text-lg font-semibold">{t('pricingDay')}</span>
                      <span className="text-muted-foreground text-sm">
                        {t('pricingDayDesc')}
                      </span>
                    </Label>
                  </div>
                  <div>
                    <RadioGroupItem
                      value="hour"
                      id="hour"
                      className="peer sr-only"
                    />
                    <Label
                      htmlFor="hour"
                      className="border-muted bg-popover hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary flex cursor-pointer flex-col items-center justify-between rounded-md border-2 p-4"
                    >
                      <span className="text-lg font-semibold">{t('pricingHour')}</span>
                      <span className="text-muted-foreground text-sm">
                        {t('pricingHourDesc')}
                      </span>
                    </Label>
                  </div>
                </RadioGroup>
                <p className="text-muted-foreground text-sm">
                  {t('pricingModeHelp')}
                </p>
                {field.state.meta.errors.length > 0 && (
                  <p className="text-destructive text-sm">
                    {String(field.state.meta.errors[0])}
                  </p>
                )}
              </div>
            )}
          </form.Field>

          {/* Location & Contact Section */}
          <div className="space-y-4 pt-4 border-t">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Globe className="h-4 w-4" />
              {t('locationSection')}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <form.Field name="country">
                {(field) => (
                  <div className="grid gap-2">
                    <Label htmlFor="country">{t('country')}</Label>
                    <Select
                      value={field.state.value}
                      onValueChange={(value) => {
                        if (value !== null) handleCountryChange(value, (v: string) => field.handleChange(v))
                      }}
                    >
                      <SelectTrigger id="country">
                        <SelectValue placeholder={t('countryPlaceholder')} />
                      </SelectTrigger>
                      <SelectContent>
                        {sortedCountries.map((country) => (
                          <SelectItem key={country.code} value={country.code}>
                            {country.flag} {getCountryName(country.code, locale)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {field.state.meta.errors.length > 0 && (
                      <p className="text-destructive text-sm">
                        {String(field.state.meta.errors[0])}
                      </p>
                    )}
                  </div>
                )}
              </form.Field>

              <form.Field name="currency">
                {(field) => (
                  <div className="grid gap-2">
                    <Label htmlFor="currency">{t('currency')}</Label>
                    <Select
                      value={field.state.value}
                      onValueChange={(value) => {
                        if (value !== null) field.handleChange(value)
                      }}
                    >
                      <SelectTrigger id="currency">
                        <SelectValue placeholder={t('currencyPlaceholder')} />
                      </SelectTrigger>
                      <SelectContent>
                        {sortedCurrencies.map((currency) => (
                          <SelectItem key={currency.code} value={currency.code}>
                            {currency.symbol} {currency.name} ({currency.code})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {field.state.meta.errors.length > 0 && (
                      <p className="text-destructive text-sm">
                        {String(field.state.meta.errors[0])}
                      </p>
                    )}
                  </div>
                )}
              </form.Field>
            </div>

            <form.Field name="address">
              {(field) => {
                const latitude = useStore(form.store, (s) => s.values.latitude)
                const longitude = useStore(form.store, (s) => s.values.longitude)

                return (
                  <div className="grid gap-2">
                    <Label htmlFor="address">{t('address')}</Label>
                    <AddressInput
                      value={field.state.value || ''}
                      latitude={latitude}
                      longitude={longitude}
                      onChange={(address, lat, lng) => {
                        field.handleChange(address)
                        form.setFieldValue('latitude', lat)
                        form.setFieldValue('longitude', lng)
                      }}
                      placeholder={t('addressPlaceholder')}
                    />
                    <p className="text-muted-foreground text-sm">
                      {t('addressHelp')}
                    </p>
                    {field.state.meta.errors.length > 0 && (
                      <p className="text-destructive text-sm">
                        {String(field.state.meta.errors[0])}
                      </p>
                    )}
                  </div>
                )
              }}
            </form.Field>

            <div className="grid grid-cols-2 gap-4">
              <form.AppField name="email">
                {(field) => <field.Input label={t('contactEmail')} type="email" placeholder={t('emailPlaceholder')} />}
              </form.AppField>

              <form.AppField name="phone">
                {(field) => <field.Input label={t('contactPhone')} type="tel" placeholder={t('phonePlaceholder')} />}
              </form.AppField>
            </div>
          </div>

          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {tCommon('next')}
          </Button>
          </form.Form>
        </form.AppForm>
      </CardContent>
    </Card>
  )
}
