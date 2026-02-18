'use client'

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
  Separator,
} from '@louez/ui'

import { AccessoriesSelector } from '@/components/dashboard/accessories-selector'
import { RatesEditor } from '@/components/dashboard/rates-editor'
import { UnitTrackingEditor } from '@/components/dashboard/unit-tracking-editor'
import {
  PriceDurationInput,
  type PriceDurationValue,
} from '@/components/ui/price-duration-input'

import { getFieldError } from '@/hooks/form/form-context'

import type {
  AvailableAccessory,
  ProductFormComponentApi,
  ProductFormValues,
} from '../types'

interface ProductFormStepPricingProps {
  form: ProductFormComponentApi
  watchedValues: ProductFormValues
  currency: string
  currencySymbol: string
  isSaving: boolean
  storeTaxSettings?: TaxSettings
  availableAccessories: AvailableAccessory[]
  showAccessories: boolean
  showUnitValidationErrors?: boolean
}

function toLegacyPricingMode(unit: PriceDurationValue['unit']): PricingMode {
  if (unit === 'week') return 'week'
  if (unit === 'day') return 'day'
  return 'hour'
}

export function ProductFormStepPricing({
  form,
  watchedValues,
  currency,
  currencySymbol,
  isSaving,
  storeTaxSettings,
  availableAccessories,
  showAccessories,
  showUnitValidationErrors = false,
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
          <form.Field name="basePriceDuration">
            {(field) => (
              <div className="space-y-2">
                <Label>{t('baseRate')}</Label>
                <PriceDurationInput
                  value={
                    field.state.value ?? {
                      price: watchedValues.price || '',
                      duration: 1,
                      unit: watchedValues.pricingMode === 'week'
                        ? 'week'
                        : watchedValues.pricingMode === 'hour'
                          ? 'hour'
                          : 'day',
                    }
                  }
                  onChange={(next) => {
                    field.handleChange(next)
                    // Temporary bridge while legacy fields are still present elsewhere.
                    form.setFieldValue('price', next.price)
                    form.setFieldValue('pricingMode', toLegacyPricingMode(next.unit))
                  }}
                  currency={currency}
                  disabled={isSaving}
                />
                <p className="text-muted-foreground text-sm">
                  {t('baseRateDescription')}
                </p>
                {field.state.meta.errors.length > 0 && (
                  <p className="text-destructive text-sm font-medium">
                    {getFieldError(field.state.meta.errors[0])}
                  </p>
                )}
              </div>
            )}
          </form.Field>

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
                                  : undefined,
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
          <Separator />

          <form.Field name="rateTiers">
            {(field) => (
              <div>
                <RatesEditor
                  basePriceDuration={watchedValues.basePriceDuration}
                  rates={field.state.value || []}
                  onChange={field.handleChange}
                  enforceStrictTiers={watchedValues.enforceStrictTiers || false}
                  onEnforceStrictTiersChange={(value) =>
                    form.setFieldValue('enforceStrictTiers', value)
                  }
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

          <Separator />

          <div className="grid items-start gap-4 sm:grid-cols-2">
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
            onTrackUnitsChange={(value) =>
              form.setFieldValue('trackUnits', value)
            }
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
            showValidationErrors={showUnitValidationErrors}
          />
        </CardContent>
      </Card>
    </div>
  )

  if (showAccessories) {
    return (
      <>
        {pricingAndStock}
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
                <p className="text-sm font-medium">
                  {t('noAccessoriesAvailable')}
                </p>
                <p className="text-muted-foreground mt-1 max-w-[260px] text-sm">
                  {t('noAccessoriesHint')}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </>
    )
  }

  return pricingAndStock
}
