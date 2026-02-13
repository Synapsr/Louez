'use client'

import type { ChangeEvent } from 'react'

import { Link2, Puzzle } from 'lucide-react'
import { useTranslations } from 'next-intl'

import type { PricingMode, TaxSettings } from '@louez/types'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
} from '@louez/ui'

import { AccessoriesSelector } from '@/components/dashboard/accessories-selector'
import { PricingTiersEditor } from '@/components/dashboard/pricing-tiers-editor'
import { UnitTrackingEditor } from '@/components/dashboard/unit-tracking-editor'
import { getFieldError } from '@/hooks/form/form-context'

import type {
  AvailableAccessory,
  ProductFormComponentApi,
  ProductFormValues,
} from '../types'

interface ProductFormStepPricingProps {
  form: ProductFormComponentApi
  watchedValues: ProductFormValues
  priceLabel: string
  currency: string
  currencySymbol: string
  isSaving: boolean
  storeTaxSettings?: TaxSettings
  availableAccessories: AvailableAccessory[]
  basePrice: number
  effectivePricingMode: PricingMode
  showAccessories: boolean
}

export function ProductFormStepPricing({
  form,
  watchedValues,
  priceLabel,
  currency,
  currencySymbol,
  isSaving,
  storeTaxSettings,
  availableAccessories,
  basePrice,
  effectivePricingMode,
  showAccessories,
}: ProductFormStepPricingProps) {
  const t = useTranslations('dashboard.products.form')

  const pricingAndStock = (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>{t('pricing')}</CardTitle>
          <CardDescription>{t('pricingDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <form.Field name="pricingMode">
            {(field) => (
              <div className="space-y-2">
                <Label>{t('pricingModeLabel')}</Label>
                <Select
                  onValueChange={(value) => {
                    if (value !== null) field.handleChange(value as PricingMode)
                  }}
                  value={field.state.value}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t('pricingModeLabel')}>
                      {t(`pricingModes.${field.state.value}`)}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hour" label={t('pricingModes.hour')}>
                      {t('pricingModes.hour')}
                    </SelectItem>
                    <SelectItem value="day" label={t('pricingModes.day')}>
                      {t('pricingModes.day')}
                    </SelectItem>
                    <SelectItem value="week" label={t('pricingModes.week')}>
                      {t('pricingModes.week')}
                    </SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-muted-foreground text-sm">{t('pricingModeHelp')}</p>
                {field.state.meta.errors.length > 0 && (
                  <p className="text-destructive text-sm font-medium">
                    {getFieldError(field.state.meta.errors[0])}
                  </p>
                )}
              </div>
            )}
          </form.Field>

          <Separator />

          <div className="grid items-start gap-4 sm:grid-cols-2">
            <form.AppField name="price">
              {(field) => (
                <field.Input
                  label={priceLabel}
                  suffix={currencySymbol}
                  placeholder={t('pricePlaceholder')}
                  className="text-lg font-semibold"
                  onChange={(event: ChangeEvent<HTMLInputElement>) => {
                    form.setFieldMeta('price', (prev: any) => ({
                      ...prev,
                      errorMap: { ...prev?.errorMap, onSubmit: undefined },
                    }))
                    field.handleChange(event.target.value)
                  }}
                />
              )}
            </form.AppField>

            <form.AppField name="deposit">
              {(field) => (
                <field.Input
                  label={t('deposit')}
                  suffix={currencySymbol}
                  placeholder={t('depositPlaceholder')}
                  description={t('depositHelp')}
                />
              )}
            </form.AppField>
          </div>

          {storeTaxSettings?.enabled && (
            <>
              <Separator />
              <div className="space-y-4">
                <form.AppField name="taxSettings.inheritFromStore">
                  {(field) => (
                    <field.Switch
                      label={t('inheritTax')}
                      description={t('inheritTaxDescription', {
                        rate: storeTaxSettings.defaultRate,
                      })}
                    />
                  )}
                </form.AppField>

                {!watchedValues.taxSettings?.inheritFromStore && (
                  <form.Field name="taxSettings.customRate">
                    {(field) => (
                      <div className="space-y-2">
                        <Label>{t('customTaxRate')}</Label>
                        <div className="relative w-32">
                          <Input
                            type="number"
                            min="0"
                            max="100"
                            step="0.01"
                            placeholder="20"
                            className="pr-8"
                            value={field.state.value ?? ''}
                            onChange={(event) =>
                              field.handleChange(
                                event.target.value
                                  ? parseFloat(event.target.value)
                                  : undefined
                              )
                            }
                            onBlur={field.handleBlur}
                          />
                          <span className="text-muted-foreground pointer-events-none absolute inset-y-0 right-3 flex items-center">
                            %
                          </span>
                        </div>
                        <p className="text-muted-foreground text-sm">
                          {t('customTaxRateDescription')}
                        </p>
                        {field.state.meta.errors.length > 0 && (
                          <p className="text-destructive text-sm font-medium">
                            {getFieldError(field.state.meta.errors[0])}
                          </p>
                        )}
                      </div>
                    )}
                  </form.Field>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('stock')}</CardTitle>
          <CardDescription>{t('quantityHelp')}</CardDescription>
        </CardHeader>
        <CardContent>
          <UnitTrackingEditor
            trackUnits={watchedValues.trackUnits || false}
            onTrackUnitsChange={(value) => form.setFieldValue('trackUnits', value)}
            bookingAttributeAxes={watchedValues.bookingAttributeAxes || []}
            onBookingAttributeAxesChange={(axes) =>
              form.setFieldValue('bookingAttributeAxes', axes)
            }
            units={watchedValues.units || []}
            onChange={(units) => form.setFieldValue('units', units)}
            quantity={watchedValues.quantity || '1'}
            onQuantityChange={(value) => {
              form.setFieldMeta('quantity', (prev: any) => ({
                ...prev,
                errorMap: { ...prev?.errorMap, onSubmit: undefined },
              }))
              form.setFieldValue('quantity', value)
            }}
            disabled={isSaving}
          />
        </CardContent>
      </Card>
    </div>
  )

  const pricingTiers = (
    <Card>
      <CardContent className="pt-6">
        <form.Field name="pricingTiers">
          {(field) => (
            <div>
              <PricingTiersEditor
                basePrice={basePrice}
                pricingMode={effectivePricingMode}
                tiers={field.state.value || []}
                onChange={field.handleChange}
                enforceStrictTiers={watchedValues.enforceStrictTiers || false}
                onEnforceStrictTiersChange={(value) =>
                  form.setFieldValue('enforceStrictTiers', value)
                }
                disabled={isSaving}
              />
              {field.state.meta.errors.length > 0 && (
                <p className="text-destructive text-sm font-medium">
                  {getFieldError(field.state.meta.errors[0])}
                </p>
              )}
            </div>
          )}
        </form.Field>
      </CardContent>
    </Card>
  )

  if (showAccessories) {
    return (
      <>
        {pricingAndStock}
        <div className="grid gap-6 xl:grid-cols-2">
          {pricingTiers}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Link2 className="h-5 w-5" />
                {t('accessories')}
              </CardTitle>
              <CardDescription>{t('accessoriesDescription')}</CardDescription>
            </CardHeader>
            <CardContent>
              {availableAccessories.length > 0 ? (
                <form.Field name="accessoryIds">
                  {(field) => (
                    <div>
                      <AccessoriesSelector
                        availableProducts={availableAccessories}
                        selectedIds={field.state.value || []}
                        onChange={field.handleChange}
                        currency={currency}
                        disabled={isSaving}
                      />
                      {field.state.meta.errors.length > 0 && (
                        <p className="text-destructive text-sm font-medium">
                          {getFieldError(field.state.meta.errors[0])}
                        </p>
                      )}
                    </div>
                  )}
                </form.Field>
              ) : (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <div className="bg-muted mb-3 rounded-full p-3">
                    <Puzzle className="text-muted-foreground h-6 w-6" />
                  </div>
                  <p className="text-sm font-medium">{t('noAccessoriesAvailable')}</p>
                  <p className="text-muted-foreground mt-1 max-w-[260px] text-sm">
                    {t('noAccessoriesHint')}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </>
    )
  }

  return (
    <div className="space-y-6">
      {pricingAndStock}
      {pricingTiers}
    </div>
  )
}
