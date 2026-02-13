'use client'

import { Eye, Package } from 'lucide-react'
import { useTranslations } from 'next-intl'

import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  RadioGroup,
  RadioGroupItem,
  Separator,
} from '@louez/ui'
import { formatCurrency } from '@louez/utils'

import type { Category, ProductFormComponentApi, ProductFormValues } from '../types'

interface ProductFormStepPreviewProps {
  form: ProductFormComponentApi
  watchedValues: ProductFormValues
  imagesPreviews: string[]
  selectedCategory: Category | undefined
  priceLabel: string
}

export function ProductFormStepPreview({
  form,
  watchedValues,
  imagesPreviews,
  selectedCategory,
  priceLabel,
}: ProductFormStepPreviewProps) {
  const t = useTranslations('dashboard.products.form')

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Eye className="h-5 w-5" />
            {t('previewTitle')}
          </CardTitle>
          <CardDescription>{t('previewDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="overflow-hidden rounded-lg border">
              {imagesPreviews.length > 0 ? (
                <div className="bg-muted relative aspect-[4/3]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={imagesPreviews[0]}
                    alt={watchedValues.name}
                    className="h-full w-full object-cover"
                  />
                </div>
              ) : (
                <div className="bg-muted flex aspect-[4/3] items-center justify-center">
                  <Package className="text-muted-foreground h-12 w-12" />
                </div>
              )}
              <div className="space-y-2 p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold">{watchedValues.name || t('noName')}</h3>
                    {selectedCategory && (
                      <Badge variant="secondary" className="mt-1">
                        {selectedCategory.name}
                      </Badge>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold">
                      {formatCurrency(parseFloat(watchedValues.price) || 0)}
                    </p>
                    <p className="text-muted-foreground text-xs">{priceLabel}</p>
                  </div>
                </div>
                {watchedValues.description && (
                  <div
                    className="text-muted-foreground prose prose-sm line-clamp-3 max-w-none text-sm"
                    dangerouslySetInnerHTML={{
                      __html: watchedValues.description,
                    }}
                  />
                )}
              </div>
            </div>

            <Separator />

            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('deposit')}</span>
                <span>{formatCurrency(parseFloat(watchedValues.deposit || '0') || 0)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('quantity')}</span>
                <span>
                  {watchedValues.quantity} {t('units')}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('photos')}</span>
                <span>{imagesPreviews.length} / 5</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('publication')}</CardTitle>
          <CardDescription>{t('publicationDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form.Field name="status">
            {(field) => (
              <div>
                <RadioGroup
                  onValueChange={(value) =>
                    field.handleChange(value as ProductFormValues['status'])
                  }
                  defaultValue={field.state.value}
                  className="space-y-4"
                >
                  <label
                    htmlFor="active"
                    className={`flex cursor-pointer items-start space-x-4 rounded-lg border p-4 transition-colors ${
                      field.state.value === 'active'
                        ? 'border-primary bg-primary/5'
                        : 'hover:bg-muted/50'
                    }`}
                  >
                    <RadioGroupItem value="active" id="active" className="mt-1" />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{t('statusActive')}</span>
                        <Badge variant="default" className="text-xs">
                          {t('recommended')}
                        </Badge>
                      </div>
                      <p className="text-muted-foreground mt-1 text-sm">
                        {t('statusActiveDescription')}
                      </p>
                    </div>
                  </label>

                  <label
                    htmlFor="draft"
                    className={`flex cursor-pointer items-start space-x-4 rounded-lg border p-4 transition-colors ${
                      field.state.value === 'draft'
                        ? 'border-primary bg-primary/5'
                        : 'hover:bg-muted/50'
                    }`}
                  >
                    <RadioGroupItem value="draft" id="draft" className="mt-1" />
                    <div className="flex-1">
                      <span className="font-medium">{t('statusDraft')}</span>
                      <p className="text-muted-foreground mt-1 text-sm">
                        {t('statusDraftDescription')}
                      </p>
                    </div>
                  </label>

                  <label
                    htmlFor="archived"
                    className={`flex cursor-pointer items-start space-x-4 rounded-lg border p-4 transition-colors ${
                      field.state.value === 'archived'
                        ? 'border-primary bg-primary/5'
                        : 'hover:bg-muted/50'
                    }`}
                  >
                    <RadioGroupItem value="archived" id="archived" className="mt-1" />
                    <div className="flex-1">
                      <span className="font-medium">{t('statusArchived')}</span>
                      <p className="text-muted-foreground mt-1 text-sm">
                        {t('statusArchivedDescription')}
                      </p>
                    </div>
                  </label>
                </RadioGroup>
                {field.state.meta.errors.length > 0 && (
                  <p className="text-destructive text-sm font-medium">
                    {String(field.state.meta.errors[0])}
                  </p>
                )}
              </div>
            )}
          </form.Field>
        </CardContent>
      </Card>
    </div>
  )
}
