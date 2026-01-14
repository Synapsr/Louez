'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Store, Loader2, MapPin, Mail, Phone } from 'lucide-react'
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

import { storeInfoSchema, type StoreInfoInput } from '@/lib/validations/onboarding'
import { createStore } from './actions'

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')
}

export default function OnboardingStorePage() {
  const router = useRouter()
  const t = useTranslations('onboarding.store')
  const tCommon = useTranslations('common')
  const tErrors = useTranslations('errors')
  const [isLoading, setIsLoading] = useState(false)

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

  const watchName = form.watch('name')

  const handleNameChange = (value: string) => {
    form.setValue('name', value)
    const currentSlug = form.getValues('slug')
    const expectedSlug = slugify(form.getValues('name').slice(0, -1) || '')
    if (currentSlug === '' || currentSlug === expectedSlug) {
      form.setValue('slug', slugify(value))
    }
  }

  async function onSubmit(data: StoreInfoInput) {
    setIsLoading(true)
    try {
      const result = await createStore(data)
      if (result.error) {
        toast.error(result.error)
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
                      onChange={(e) => handleNameChange(e.target.value)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="slug"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('slug')}</FormLabel>
                  <FormControl>
                    <div className="flex items-center">
                      <Input
                        placeholder={t('slugPlaceholder')}
                        className="rounded-r-none"
                        {...field}
                      />
                      <span className="bg-muted text-muted-foreground flex h-9 items-center rounded-r-md border border-l-0 px-3 text-sm">
                        .{process.env.NEXT_PUBLIC_APP_DOMAIN || 'louez.io'}
                      </span>
                    </div>
                  </FormControl>
                  <FormDescription>
                    {t('slugHelp', { slug: field.value || t('slugDefault') })}
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
