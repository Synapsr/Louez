'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Store, Loader2, MapPin, Mail, Phone, Pencil, Check, X } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AddressInput } from '@/components/ui/address-input'
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

import { createStoreInfoSchema, type StoreInfoInput } from '@/lib/validations/onboarding'
import { createStore } from './actions'

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

  const form = useForm<StoreInfoInput>({
    resolver: zodResolver(storeInfoSchema),
    defaultValues: {
      name: '',
      slug: '',
      pricingMode: 'day',
      address: '',
      latitude: null,
      longitude: null,
      email: '',
      phone: '',
    },
  })

  const currentSlug = form.watch('slug')
  const domain = process.env.NEXT_PUBLIC_APP_DOMAIN || 'localhost'

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
      form.setValue('slug', slugify(value), { shouldValidate: true })
    }
  }

  /**
   * Handle slug edit - sanitize and mark as manually edited
   */
  const handleSlugEdit = (value: string) => {
    form.setValue('slug', sanitizeSlug(value), { shouldValidate: true })
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
    const currentName = form.getValues('name')
    form.setValue('slug', slugify(currentName), { shouldValidate: true })
  }

  async function onSubmit(data: StoreInfoInput) {
    setIsLoading(true)
    try {
      const result = await createStore(data)
      if (result.error) {
        toast.error(tErrors(result.error.replace('errors.', '')))
        return
      }
      router.push('/onboarding/branding')
    } catch {
      toast.error(tErrors('generic'))
    } finally {
      setIsLoading(false)
    }
  }

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
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* Store Name with inline URL preview */}
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('name')}</FormLabel>
                  <FormControl>
                    <Input
                      placeholder={t('namePlaceholder')}
                      {...field}
                      onChange={(e) => handleNameChange(e.target.value, field.onChange)}
                    />
                  </FormControl>

                  {/* URL Preview - appears when name has content */}
                  {(currentSlug || field.value) && (
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
                              {currentSlug || slugify(field.value) || t('slugDefault')}
                            </span>
                            <span>.{domain}</span>
                          </span>
                          <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                      )}
                    </div>
                  )}

                  <FormMessage />

                  {/* Hidden slug field for form validation */}
                  <FormField
                    control={form.control}
                    name="slug"
                    render={({ field: slugField }) => (
                      <input type="hidden" {...slugField} />
                    )}
                  />
                  {form.formState.errors.slug && (
                    <p className="text-sm font-medium text-destructive">
                      {form.formState.errors.slug.message}
                    </p>
                  )}
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="pricingMode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('pricingMode')}</FormLabel>
                  <FormControl>
                    <RadioGroup
                      onValueChange={field.onChange}
                      defaultValue={field.value}
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
                  </FormControl>
                  <FormDescription>
                    {t('pricingModeHelp')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Contact & Address Section */}
            <div className="space-y-4 pt-4 border-t">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <MapPin className="h-4 w-4" />
                {t('contactSection')}
              </div>

              <FormField
                control={form.control}
                name="address"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('address')}</FormLabel>
                    <FormControl>
                      <AddressInput
                        value={field.value || ''}
                        latitude={form.watch('latitude')}
                        longitude={form.watch('longitude')}
                        onChange={(address, lat, lng) => {
                          field.onChange(address)
                          form.setValue('latitude', lat)
                          form.setValue('longitude', lng)
                        }}
                        placeholder={t('addressPlaceholder')}
                      />
                    </FormControl>
                    <FormDescription>
                      {t('addressHelp')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-2">
                        <Mail className="h-3.5 w-3.5" />
                        {t('contactEmail')}
                      </FormLabel>
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

                <FormField
                  control={form.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-2">
                        <Phone className="h-3.5 w-3.5" />
                        {t('contactPhone')}
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="tel"
                          placeholder={t('phonePlaceholder')}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {tCommon('next')}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}
