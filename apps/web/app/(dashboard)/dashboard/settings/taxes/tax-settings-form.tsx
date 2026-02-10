'use client'

import { useRouter } from 'next/navigation'
import { useStore } from '@tanstack/react-form'
import { useTransition, useState } from 'react'
import { useTranslations } from 'next-intl'
import { z } from 'zod'
import { Info, Receipt } from 'lucide-react'
import { toastManager } from '@louez/ui'

import { Button } from '@louez/ui'
import { Input } from '@louez/ui'
import { Switch } from '@louez/ui'
import { Label } from '@louez/ui'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@louez/ui'
import {
  RadioGroup,
  RadioGroupItem,
} from '@louez/ui'
import { updateTaxSettings } from './actions'
import { FloatingSaveBar } from '@/components/dashboard/floating-save-bar'
import type { StoreSettings, TaxSettings } from '@louez/types'
import { useAppForm } from '@/hooks/form/form'
import { RootError } from '@/components/form/root-error'

const createTaxSettingsSchema = (t: (key: string, params?: Record<string, string | number | Date>) => string) => z.object({
  enabled: z.boolean(),
  defaultRate: z.number().min(0, t('minValue', { min: 0 })).max(100, t('maxValue', { max: 100 })),
  displayMode: z.enum(['inclusive', 'exclusive']),
  taxLabel: z.string().max(20),
  taxNumber: z.string().max(30),
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

  const [rootError, setRootError] = useState<string | null>(null)
  const form = useAppForm({
    defaultValues: {
      enabled: currentTax.enabled,
      defaultRate: currentTax.defaultRate,
      displayMode: currentTax.displayMode,
      taxLabel: currentTax.taxLabel || '',
      taxNumber: currentTax.taxNumber || '',
    },
    validators: { onSubmit: taxSettingsSchema },
    onSubmit: async ({ value }) => {
      setRootError(null)
      startTransition(async () => {
        const result = await updateTaxSettings(value)
        if (result.error) {
          setRootError(result.error)
          return
        }
        toastManager.add({ title: t('saved'), type: 'success' })
        router.refresh()
      })
    },
  })

  const isDirty = useStore(form.store, (s) => s.isDirty)
  const isEnabled = useStore(form.store, (s) => s.values.enabled)
  const displayMode = useStore(form.store, (s) => s.values.displayMode)
  const defaultRate = useStore(form.store, (s) => s.values.defaultRate)

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
    <form onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); form.handleSubmit() }} className="space-y-6">
      <RootError error={rootError} />

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
          <form.Field name="enabled">
            {(field) => (
              <div className="flex flex-row items-center justify-between rounded-lg border p-4">
                <div className="space-y-0.5">
                  <Label htmlFor={field.name} className="text-base">
                    {t('enabled')}
                  </Label>
                  <p className="text-muted-foreground text-sm">
                    {t('enabledDescription')}
                  </p>
                </div>
                <Switch
                  id={field.name}
                  checked={field.state.value}
                  onCheckedChange={(checked) => field.handleChange(checked)}
                  onBlur={field.handleBlur}
                />
              </div>
            )}
          </form.Field>

          {/* Configuration - Only when enabled */}
          {isEnabled && (
            <div className="space-y-6 border-t pt-6">
              {/* Rate + Display Mode */}
              <div className="grid gap-6 lg:grid-cols-2">
                {/* Default Rate */}
                <form.Field name="defaultRate">
                  {(field) => (
                    <div className="grid gap-2">
                      <Label htmlFor={field.name}>{t('defaultRate')}</Label>
                      <div className="flex items-center gap-2">
                        <Input
                          id={field.name}
                          type="number"
                          min={0}
                          max={100}
                          step={0.1}
                          value={field.state.value}
                          onChange={(e) => field.handleChange(parseFloat(e.target.value) || 0)}
                          onBlur={field.handleBlur}
                          className="w-24"
                        />
                        <span className="text-sm text-muted-foreground">%</span>
                      </div>
                      <p className="text-muted-foreground text-sm">
                        {t('defaultRateDescription')}
                      </p>
                      {field.state.meta.errors.length > 0 && (
                        <p className="text-destructive text-sm">{String(field.state.meta.errors[0])}</p>
                      )}
                    </div>
                  )}
                </form.Field>

                {/* Display Mode */}
                <form.Field name="displayMode">
                  {(field) => (
                    <div className="grid gap-2">
                      <Label htmlFor={field.name}>{t('displayModeSection')}</Label>
                      <RadioGroup
                        onValueChange={(val) => field.handleChange(val)}
                        value={field.state.value}
                        className="grid gap-2"
                      >
                        <label
                          htmlFor="inclusive"
                          className={`flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                            field.state.value === 'inclusive'
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
                            field.state.value === 'exclusive'
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
                      {field.state.meta.errors.length > 0 && (
                        <p className="text-destructive text-sm">{String(field.state.meta.errors[0])}</p>
                      )}
                    </div>
                  )}
                </form.Field>
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
                  <form.Field name="taxLabel">
                    {(field) => (
                      <div className="grid gap-2">
                        <Label htmlFor={field.name} className="flex items-center gap-2">
                          {t('taxLabel')}
                          <span className="text-xs text-muted-foreground font-normal">
                            ({tCommon('optional')})
                          </span>
                        </Label>
                        <Input
                          id={field.name}
                          placeholder={t('taxLabelPlaceholder')}
                          value={field.state.value}
                          onChange={(e) => field.handleChange(e.target.value)}
                          onBlur={field.handleBlur}
                        />
                        <p className="text-muted-foreground text-sm">
                          {t('taxLabelDescription')}
                        </p>
                        {field.state.meta.errors.length > 0 && (
                          <p className="text-destructive text-sm">{String(field.state.meta.errors[0])}</p>
                        )}
                      </div>
                    )}
                  </form.Field>

                  <form.Field name="taxNumber">
                    {(field) => (
                      <div className="grid gap-2">
                        <Label htmlFor={field.name} className="flex items-center gap-2">
                          {t('taxNumber')}
                          <span className="text-xs text-muted-foreground font-normal">
                            ({tCommon('optional')})
                          </span>
                        </Label>
                        <Input
                          id={field.name}
                          placeholder={t('taxNumberPlaceholder')}
                          value={field.state.value}
                          onChange={(e) => field.handleChange(e.target.value)}
                          onBlur={field.handleBlur}
                        />
                        <p className="text-muted-foreground text-sm">
                          {t('taxNumberDescription')}
                        </p>
                        {field.state.meta.errors.length > 0 && (
                          <p className="text-destructive text-sm">{String(field.state.meta.errors[0])}</p>
                        )}
                      </div>
                    )}
                  </form.Field>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <FloatingSaveBar
        isDirty={isDirty}
        isLoading={isPending}
        onReset={() => form.reset()}
      />
    </form>
  )
}
