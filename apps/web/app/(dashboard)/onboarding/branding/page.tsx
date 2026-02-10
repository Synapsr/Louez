'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Palette, Loader2, Upload, X } from 'lucide-react'
import { toastManager } from '@louez/ui'
import { useTranslations } from 'next-intl'

import { Button } from '@louez/ui'
import { Input } from '@louez/ui'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@louez/ui'
import { RadioGroup, RadioGroupItem } from '@louez/ui'
import { Label } from '@louez/ui'

import { createBrandingSchema, type BrandingInput } from '@louez/validations'
import { updateBranding } from '../actions'
import { useAppForm } from '@/hooks/form/form'

const PRESET_COLORS = [
  '#0066FF',
  '#10B981',
  '#F59E0B',
  '#EF4444',
  '#8B5CF6',
  '#EC4899',
  '#06B6D4',
  '#84CC16',
]

export default function OnboardingBrandingPage() {
  const router = useRouter()
  const t = useTranslations('onboarding.branding')
  const tCommon = useTranslations('common')
  const tErrors = useTranslations('errors')
  const tValidation = useTranslations('validation')
  const [isLoading, setIsLoading] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [logoPreview, setLogoPreview] = useState<string | null>(null)

  const brandingSchema = createBrandingSchema(tValidation)

  const form = useAppForm({
    defaultValues: {
      logoUrl: '',
      primaryColor: '#0066FF',
      theme: 'light' as 'light' | 'dark',
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    validators: { onSubmit: brandingSchema as any },
    onSubmit: async ({ value }) => {
      setIsLoading(true)
      try {
        const result = await updateBranding(value)
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

  const handleLogoUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return

      if (!file.type.startsWith('image/')) {
        toastManager.add({ title: t('logoError'), type: 'error' })
        return
      }

      if (file.size > 2 * 1024 * 1024) {
        toastManager.add({ title: t('logoSizeError'), type: 'error' })
        return
      }

      // Convert to base64 for upload
      const reader = new FileReader()
      reader.onload = async (event) => {
        const dataUri = event.target?.result as string
        setLogoPreview(dataUri)
        setIsUploading(true)

        try {
          const response = await fetch('/api/upload/image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              image: dataUri,
              type: 'logo',
              filename: 'store-logo',
            }),
          })

          if (!response.ok) {
            const error = await response.json()
            throw new Error(error.error || 'Upload failed')
          }

          const { url } = await response.json()
          form.setFieldValue('logoUrl', url)
          setLogoPreview(url)
        } catch (error) {
          console.error('Logo upload error:', error)
          toastManager.add({ title: t('logoUploadError'), type: 'error' })
          setLogoPreview(null)
          form.setFieldValue('logoUrl', '')
        } finally {
          setIsUploading(false)
        }
      }
      reader.readAsDataURL(file)
    },
    [form, t]
  )

  const removeLogo = () => {
    setLogoPreview(null)
    form.setFieldValue('logoUrl', '')
  }

  return (
    <Card>
      <CardHeader className="text-center">
        <div className="bg-primary/10 mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full">
          <Palette className="text-primary h-6 w-6" />
        </div>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>
          {t('description')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form.AppForm>
          <form.Form className="space-y-6">
          {/* Logo Upload */}
          <form.Field name="logoUrl">
            {() => (
              <div className="space-y-2">
                <Label>{t('logo')}</Label>
                <div className="flex flex-col items-center gap-4">
                  {logoPreview ? (
                    <div className="relative">
                      <img
                        src={logoPreview}
                        alt="Logo preview"
                        className="h-24 w-24 rounded-lg object-contain border"
                      />
                      {isUploading && (
                        <div className="absolute inset-0 flex items-center justify-center bg-background/80 rounded-lg">
                          <Loader2 className="h-6 w-6 animate-spin text-primary" />
                        </div>
                      )}
                      {!isUploading && (
                        <Button
                          type="button"
                          variant="destructive"
                          size="icon"
                          className="absolute -right-2 -top-2 h-6 w-6"
                          onClick={removeLogo}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  ) : (
                    <label className="flex h-24 w-24 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/25 hover:border-muted-foreground/50 transition-colors">
                      <Upload className="h-8 w-8 text-muted-foreground" />
                      <span className="mt-1 text-xs text-muted-foreground">
                        {t('logoAdd')}
                      </span>
                      <input
                        type="file"
                        accept="image/*"
                        className="sr-only"
                        onChange={handleLogoUpload}
                      />
                    </label>
                  )}
                </div>
                <p className="text-sm text-muted-foreground text-center">
                  {t('logoHelp')}
                </p>
              </div>
            )}
          </form.Field>

          {/* Primary Color */}
          <form.Field name="primaryColor">
            {(field) => (
              <div className="space-y-2">
                <Label>{t('primaryColor')}</Label>
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    {PRESET_COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        className={`h-8 w-8 rounded-full transition-all ${
                          field.state.value === color
                            ? 'ring-2 ring-offset-2 ring-primary'
                            : 'hover:scale-110'
                        }`}
                        style={{ backgroundColor: color }}
                        onClick={() => form.setFieldValue('primaryColor', color)}
                      />
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <div
                      className="h-9 w-9 rounded-md border"
                      style={{ backgroundColor: field.state.value }}
                    />
                    <Input
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                      placeholder="#0066FF"
                      className="font-mono"
                    />
                  </div>
                </div>
                {field.state.meta.errors && field.state.meta.errors.length > 0 && (
                  <p className="text-sm font-medium text-destructive">
                    {field.state.meta.errors[0]}
                  </p>
                )}
              </div>
            )}
          </form.Field>

          {/* Theme */}
          <form.Field name="theme">
            {(field) => (
              <div className="space-y-2">
                <Label>{t('theme')}</Label>
                <RadioGroup
                  onValueChange={(value) => field.handleChange(value as 'light' | 'dark')}
                  defaultValue={field.state.value}
                  className="grid grid-cols-2 gap-4"
                >
                  <div>
                    <RadioGroupItem
                      value="light"
                      id="light"
                      className="peer sr-only"
                    />
                    <Label
                      htmlFor="light"
                      className="border-muted bg-popover hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary flex cursor-pointer flex-col items-center justify-center rounded-md border-2 p-4"
                    >
                      <div className="mb-2 h-8 w-12 rounded bg-white border" />
                      <span className="text-sm font-medium">{t('themeLight')}</span>
                    </Label>
                  </div>
                  <div>
                    <RadioGroupItem
                      value="dark"
                      id="dark"
                      className="peer sr-only"
                    />
                    <Label
                      htmlFor="dark"
                      className="border-muted bg-popover hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary flex cursor-pointer flex-col items-center justify-center rounded-md border-2 p-4"
                    >
                      <div className="mb-2 h-8 w-12 rounded bg-zinc-900 border" />
                      <span className="text-sm font-medium">{t('themeDark')}</span>
                    </Label>
                  </div>
                </RadioGroup>
                {field.state.meta.errors && field.state.meta.errors.length > 0 && (
                  <p className="text-sm font-medium text-destructive">
                    {field.state.meta.errors[0]}
                  </p>
                )}
              </div>
            )}
          </form.Field>

          <div className="flex gap-3">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => router.push('/onboarding')}
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
