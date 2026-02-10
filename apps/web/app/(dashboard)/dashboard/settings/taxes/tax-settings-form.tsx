'use client'

import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTransition, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { z } from 'zod'
import { Info, Receipt } from 'lucide-react'
import { toastManager } from '@louez/ui'

import { Button } from '@louez/ui'
import { Input } from '@louez/ui'
import { Switch } from '@louez/ui'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@louez/ui'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@louez/ui'
import {
  RadioGroup,
  RadioGroupItem,
} from '@louez/ui'
import { updateTaxSettings } from './actions'
import { FloatingSaveBar } from '@/components/dashboard/floating-save-bar'
import type { StoreSettings, TaxSettings } from '@louez/types'

const createTaxSettingsSchema = (t: (key: string, params?: Record<string, string | number | Date>) => string) => z.object({
  enabled: z.boolean(),
  defaultRate: z.number().min(0, t('minValue', { min: 0 })).max(100, t('maxValue', { max: 100 })),
  displayMode: z.enum(['inclusive', 'exclusive']),
  taxLabel: z.string().max(20).optional(),
  taxNumber: z.string().max(30).optional(),
})

type TaxSettingsInput = z.infer<ReturnType<typeof createTaxSettingsSchema>>

interface Store {
  id: string
  settings: StoreSettings | null
}

interface TaxSettingsFormProps {
  store: Store
}

export function TaxSettingsForm({ store }: TaxSettingsFormProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const t = useTranslations('dashboard.settings.taxes')
  const tValidation = useTranslations('validation')
  const tCommon = useTranslations('common')

  const taxSettingsSchema = createTaxSettingsSchema(tValidation)

  const currentTax: TaxSettings = store.settings?.tax || {
    enabled: false,
    defaultRate: 20,
    displayMode: 'inclusive',
    taxLabel: '',
    taxNumber: '',
  }

  const form = useForm<TaxSettingsInput>({
    resolver: zodResolver(taxSettingsSchema),
    defaultValues: {
      enabled: currentTax.enabled,
      defaultRate: currentTax.defaultRate,
      displayMode: currentTax.displayMode,
      taxLabel: currentTax.taxLabel || '',
      taxNumber: currentTax.taxNumber || '',
    },
  })

  const { isDirty } = form.formState

  const handleReset = useCallback(() => {
    form.reset()
  }, [form])

  const isEnabled = form.watch('enabled')
  const displayMode = form.watch('displayMode')
  const defaultRate = form.watch('defaultRate')

  const onSubmit = (data: TaxSettingsInput) => {
    startTransition(async () => {
      const result = await updateTaxSettings(data)
      if (result.error) {
        form.setError('root', { message: result.error })
        return
      }
      toastManager.add({ title: t('saved'), type: 'success' })
      router.refresh()
    })
  }

  // Calculate example values for the hint
  const getExample = () => {
    const rate = defaultRate || 20
    if (displayMode === 'inclusive') {
      const ht = (100 / (1 + rate / 100)).toFixed(2)
      const tva = (100 - parseFloat(ht)).toFixed(2)
      return { price: '100', ht, tva, ttc: '100' }
    } else {
      const tva = (100 * rate / 100).toFixed(2)
      const ttc = (100 + parseFloat(tva)).toFixed(2)
      return { price: '100', ht: '100', tva, ttc }
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {form.formState.errors.root && (
          <div className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive">
            {form.formState.errors.root.message}
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Receipt className="h-5 w-5" />
              {t('enableSection')}
            </CardTitle>
            <CardDescription>
              {t('enableSectionDescription')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Enable Switch */}
            <FormField
              control={form.control}
              name="enabled"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                  <div className="space-y-0.5">
                    <FormLabel className="text-base">
                      {t('enabled')}
                    </FormLabel>
                    <FormDescription>
                      {t('enabledDescription')}
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

            {/* Configuration - Only when enabled */}
            {isEnabled && (
              <div className="space-y-6 border-t pt-6">
                {/* Rate + Display Mode */}
                <div className="grid gap-6 lg:grid-cols-2">
                  {/* Default Rate */}
                  <FormField
                    control={form.control}
                    name="defaultRate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('defaultRate')}</FormLabel>
                        <FormControl>
                          <div className="flex items-center gap-2">
                            <Input
                              type="number"
                              min={0}
                              max={100}
                              step={0.1}
                              {...field}
                              onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                              className="w-24"
                            />
                            <span className="text-sm text-muted-foreground">%</span>
                          </div>
                        </FormControl>
                        <FormDescription>
                          {t('defaultRateDescription')}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Display Mode */}
                  <FormField
                    control={form.control}
                    name="displayMode"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('displayModeSection')}</FormLabel>
                        <FormControl>
                          <RadioGroup
                            onValueChange={field.onChange}
                            defaultValue={field.value}
                            className="grid gap-2"
                          >
                            <label
                              htmlFor="inclusive"
                              className={`flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                                field.value === 'inclusive'
                                  ? 'border-primary bg-primary/5'
                                  : 'hover:bg-muted/50'
                              }`}
                            >
                              <RadioGroupItem value="inclusive" id="inclusive" />
                              <div className="grid gap-0.5">
                                <span className="font-medium text-sm">
                                  {t('displayModeInclusive')}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  {t('displayModeInclusiveDescription')}
                                </span>
                              </div>
                            </label>
                            <label
                              htmlFor="exclusive"
                              className={`flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                                field.value === 'exclusive'
                                  ? 'border-primary bg-primary/5'
                                  : 'hover:bg-muted/50'
                              }`}
                            >
                              <RadioGroupItem value="exclusive" id="exclusive" />
                              <div className="grid gap-0.5">
                                <span className="font-medium text-sm">
                                  {t('displayModeExclusive')}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  {t('displayModeExclusiveDescription')}
                                </span>
                              </div>
                            </label>
                          </RadioGroup>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {/* Example calculation */}
                <div className="flex items-start gap-3 rounded-lg bg-muted/50 p-4 text-sm">
                  <Info className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                  <div className="text-muted-foreground">
                    <p>
                      {displayMode === 'inclusive'
                        ? t('exampleInclusive', {
                            price: getExample().price,
                            ht: getExample().ht,
                            tva: getExample().tva,
                            rate: defaultRate || 20,
                          })
                        : t('exampleExclusive', {
                            price: getExample().price,
                            tva: getExample().tva,
                            ttc: getExample().ttc,
                            rate: defaultRate || 20,
                          })}
                    </p>
                    <p className="text-xs mt-1 opacity-75">
                      {t('depositNoTaxInfo')}
                    </p>
                  </div>
                </div>

                {/* Optional Settings */}
                <div className="border-t pt-6">
                  <p className="text-sm font-medium mb-4 text-muted-foreground">
                    {t('optionalSection')}
                  </p>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField
                      control={form.control}
                      name="taxLabel"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="flex items-center gap-2">
                            {t('taxLabel')}
                            <span className="text-xs text-muted-foreground font-normal">
                              ({tCommon('optional')})
                            </span>
                          </FormLabel>
                          <FormControl>
                            <Input
                              placeholder={t('taxLabelPlaceholder')}
                              {...field}
                            />
                          </FormControl>
                          <FormDescription>
                            {t('taxLabelDescription')}
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="taxNumber"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="flex items-center gap-2">
                            {t('taxNumber')}
                            <span className="text-xs text-muted-foreground font-normal">
                              ({tCommon('optional')})
                            </span>
                          </FormLabel>
                          <FormControl>
                            <Input
                              placeholder={t('taxNumberPlaceholder')}
                              {...field}
                            />
                          </FormControl>
                          <FormDescription>
                            {t('taxNumberDescription')}
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <FloatingSaveBar
          isDirty={isDirty}
          isLoading={isPending}
          onReset={handleReset}
        />
      </form>
    </Form>
  )
}
