'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Package, Loader2, Upload, X, ImageIcon } from 'lucide-react'
import { toastManager, Label } from '@louez/ui'
import { useTranslations } from 'next-intl'

import { Button } from '@louez/ui'
import { Input } from '@louez/ui'
import { Textarea } from '@louez/ui'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@louez/ui'

import { firstProductSchema, type FirstProductInput } from '@louez/validations'
import { createFirstProduct } from '../actions'
import { useAppForm } from '@/hooks/form/form'

export default function OnboardingProductPage() {
  const router = useRouter()
  const t = useTranslations('onboarding.product')
  const tCommon = useTranslations('common')
  const tErrors = useTranslations('errors')
  const [isLoading, setIsLoading] = useState(false)
  const [imagesPreviews, setImagesPreviews] = useState<string[]>([])

  const form = useAppForm({
    defaultValues: {
      name: '',
      description: '',
      price: '',
      deposit: '',
      quantity: '1',
      images: [] as string[],
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    validators: { onSubmit: firstProductSchema as any },
    onSubmit: async ({ value }) => {
      setIsLoading(true)
      try {
        const result = await createFirstProduct(value)
        if (result.error) {
          toastManager.add({ title: tErrors(result.error.replace('errors.', '')), type: 'error' })
          return
        }
        router.push('/onboarding/stripe')
      } catch {
        toastManager.add({ title: tErrors('generic'), type: 'error' })
      } finally {
        setIsLoading(false)
      }
    },
  })

  const handleImageUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files
      if (!files) return

      const newPreviews: string[] = []

      for (let i = 0; i < files.length; i++) {
        const file = files[i]

        if (!file.type.startsWith('image/')) {
          toastManager.add({ title: t('photoError'), type: 'error' })
          continue
        }

        if (file.size > 5 * 1024 * 1024) {
          toastManager.add({ title: t('photoSizeError'), type: 'error' })
          continue
        }

        // For now, create local previews
        // TODO: Implement actual file upload to S3
        const reader = new FileReader()
        reader.onload = (event) => {
          const url = event.target?.result as string
          newPreviews.push(url)

          if (newPreviews.length === files.length) {
            setImagesPreviews((prev) => [...prev, ...newPreviews])
            form.setFieldValue('images', [...imagesPreviews, ...newPreviews])
          }
        }
        reader.readAsDataURL(file)
      }
    },
    [form, imagesPreviews, t]
  )

  const removeImage = (index: number) => {
    const newPreviews = imagesPreviews.filter((_, i) => i !== index)
    setImagesPreviews(newPreviews)
    form.setFieldValue('images', newPreviews)
  }

  return (
    <Card>
      <CardHeader className="text-center">
        <div className="bg-primary/10 mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full">
          <Package className="text-primary h-6 w-6" />
        </div>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>
          {t('description')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form.AppForm>
          <form.Form className="space-y-6">
          {/* Images */}
          <form.Field name="images">
            {(field) => (
              <div className="space-y-2">
                <Label>{t('photos')}</Label>
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-3">
                    {imagesPreviews.map((preview, index) => (
                      <div key={index} className="relative">
                        <img
                          src={preview}
                          alt={`Product image ${index + 1}`}
                          className="h-20 w-20 rounded-lg object-cover border"
                        />
                        <Button
                          type="button"
                          variant="destructive"
                          size="icon"
                          className="absolute -right-2 -top-2 h-5 w-5"
                          onClick={() => removeImage(index)}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                    {imagesPreviews.length < 5 && (
                      <label className="flex h-20 w-20 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/25 hover:border-muted-foreground/50 transition-colors">
                        <Upload className="h-6 w-6 text-muted-foreground" />
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          className="sr-only"
                          onChange={handleImageUpload}
                        />
                      </label>
                    )}
                  </div>
                  {imagesPreviews.length === 0 && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <ImageIcon className="h-4 w-4" />
                      <span>{t('photosHelp')}</span>
                    </div>
                  )}
                </div>
                {field.state.meta.errors.length > 0 && (
                  <p className="text-sm font-medium text-destructive">
                    {field.state.meta.errors.join(', ')}
                  </p>
                )}
              </div>
            )}
          </form.Field>

          {/* Name */}
          <form.AppField name="name">
            {(field) => <field.Input label={t('name')} placeholder={t('namePlaceholder')} />}
          </form.AppField>

          {/* Description */}
          <form.AppField name="description">
            {(field) => <field.Textarea label={t('productDescription')} placeholder={t('productDescriptionPlaceholder')} rows={3} />}
          </form.AppField>

          {/* Price and Deposit */}
          <div className="grid grid-cols-2 gap-4">
            <form.AppField name="price">
              {(field) => (
                <>
                  <field.Input label={t('price')} placeholder={t('pricePlaceholder')} suffix="€" />
                  <p className="text-sm text-muted-foreground">{t('priceHelp')}</p>
                </>
              )}
            </form.AppField>

            <form.AppField name="deposit">
              {(field) => <field.Input label={t('deposit')} placeholder={t('depositPlaceholder')} suffix="€" />}
            </form.AppField>
          </div>

          {/* Quantity */}
          <form.AppField name="quantity">
            {(field) => (
              <>
                <field.Input label={t('quantity')} type="number" min="1" placeholder="1" />
                <p className="text-sm text-muted-foreground">
                  {t('quantityHelp')}
                </p>
              </>
            )}
          </form.AppField>

          <div className="flex gap-3">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => router.push('/onboarding/branding')}
            >
              {tCommon('back')}
            </Button>
            <Button type="submit" className="flex-1" disabled={isLoading}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {tCommon('next')}
            </Button>
          </div>
          </form.Form>
        </form.AppForm>
      </CardContent>
    </Card>
  )
}
