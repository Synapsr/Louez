'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Package, Loader2, Upload, X, ImageIcon } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
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

import { firstProductSchema, type FirstProductInput } from '@/lib/validations/onboarding'
import { createFirstProduct } from '../actions'

export default function OnboardingProductPage() {
  const router = useRouter()
  const t = useTranslations('onboarding.product')
  const tCommon = useTranslations('common')
  const tErrors = useTranslations('errors')
  const [isLoading, setIsLoading] = useState(false)
  const [imagesPreviews, setImagesPreviews] = useState<string[]>([])

  const form = useForm<FirstProductInput>({
    resolver: zodResolver(firstProductSchema),
    defaultValues: {
      name: '',
      description: '',
      price: '',
      deposit: '',
      quantity: '1',
      images: [],
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
          toast.error(t('photoError'))
          continue
        }

        if (file.size > 5 * 1024 * 1024) {
          toast.error(t('photoSizeError'))
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
            form.setValue('images', [...imagesPreviews, ...newPreviews])
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
    form.setValue('images', newPreviews)
  }

  async function onSubmit(data: FirstProductInput) {
    setIsLoading(true)
    try {
      const result = await createFirstProduct(data)
      if (result.error) {
        toast.error(result.error)
        return
      }
      router.push('/onboarding/stripe')
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
          <Package className="text-primary h-6 w-6" />
        </div>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>
          {t('description')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* Images */}
            <FormField
              control={form.control}
              name="images"
              render={() => (
                <FormItem>
                  <FormLabel>{t('photos')}</FormLabel>
                  <FormControl>
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
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Name */}
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('name')}</FormLabel>
                  <FormControl>
                    <Input placeholder={t('namePlaceholder')} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Description */}
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('productDescription')}</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder={t('productDescriptionPlaceholder')}
                      className="resize-none"
                      rows={3}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Price and Deposit */}
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="price"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('price')}</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Input
                          placeholder={t('pricePlaceholder')}
                          className="pr-8"
                          {...field}
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                          €
                        </span>
                      </div>
                    </FormControl>
                    <FormDescription>{t('priceHelp')}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="deposit"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('deposit')}</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Input
                          placeholder={t('depositPlaceholder')}
                          className="pr-8"
                          {...field}
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                          €
                        </span>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Quantity */}
            <FormField
              control={form.control}
              name="quantity"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('quantity')}</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min="1"
                      placeholder="1"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    {t('quantityHelp')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

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
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}
