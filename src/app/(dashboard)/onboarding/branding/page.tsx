'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Palette, Loader2, Upload, X } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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

import { brandingSchema, type BrandingInput } from '@/lib/validations/onboarding'
import { updateBranding } from '../actions'

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
  const [isLoading, setIsLoading] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [logoPreview, setLogoPreview] = useState<string | null>(null)

  const form = useForm<BrandingInput>({
    resolver: zodResolver(brandingSchema),
    defaultValues: {
      logoUrl: '',
      primaryColor: '#0066FF',
      theme: 'light',
    },
  })

  const handleLogoUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return

      if (!file.type.startsWith('image/')) {
        toast.error(t('logoError'))
        return
      }

      if (file.size > 2 * 1024 * 1024) {
        toast.error(t('logoSizeError'))
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
          form.setValue('logoUrl', url)
          setLogoPreview(url)
        } catch (error) {
          console.error('Logo upload error:', error)
          toast.error(t('logoUploadError'))
          setLogoPreview(null)
          form.setValue('logoUrl', '')
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
    form.setValue('logoUrl', '')
  }

  async function onSubmit(data: BrandingInput) {
    setIsLoading(true)
    try {
      const result = await updateBranding(data)
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
          <Palette className="text-primary h-6 w-6" />
        </div>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>
          {t('description')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* Logo Upload */}
            <FormField
              control={form.control}
              name="logoUrl"
              render={() => (
                <FormItem>
                  <FormLabel>{t('logo')}</FormLabel>
                  <FormControl>
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
                  </FormControl>
                  <FormDescription className="text-center">
                    {t('logoHelp')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Primary Color */}
            <FormField
              control={form.control}
              name="primaryColor"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('primaryColor')}</FormLabel>
                  <FormControl>
                    <div className="space-y-3">
                      <div className="flex flex-wrap gap-2">
                        {PRESET_COLORS.map((color) => (
                          <button
                            key={color}
                            type="button"
                            className={`h-8 w-8 rounded-full transition-all ${
                              field.value === color
                                ? 'ring-2 ring-offset-2 ring-primary'
                                : 'hover:scale-110'
                            }`}
                            style={{ backgroundColor: color }}
                            onClick={() => form.setValue('primaryColor', color)}
                          />
                        ))}
                      </div>
                      <div className="flex items-center gap-2">
                        <div
                          className="h-9 w-9 rounded-md border"
                          style={{ backgroundColor: field.value }}
                        />
                        <Input
                          {...field}
                          placeholder="#0066FF"
                          className="font-mono"
                        />
                      </div>
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Theme */}
            <FormField
              control={form.control}
              name="theme"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('theme')}</FormLabel>
                  <FormControl>
                    <RadioGroup
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                      className="grid grid-cols-3 gap-4"
                    >
                      <div>
                        <RadioGroupItem
                          value="light"
                          id="light"
                          className="peer sr-only"
                        />
                        <Label
                          htmlFor="light"
                          className="border-muted bg-popover hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary flex cursor-pointer flex-col items-center justify-center rounded-md border-2 p-3"
                        >
                          <div className="mb-2 h-6 w-10 rounded bg-white border" />
                          <span className="text-sm">{t('themeLight')}</span>
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
                          className="border-muted bg-popover hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary flex cursor-pointer flex-col items-center justify-center rounded-md border-2 p-3"
                        >
                          <div className="mb-2 h-6 w-10 rounded bg-zinc-900 border" />
                          <span className="text-sm">{t('themeDark')}</span>
                        </Label>
                      </div>
                      <div>
                        <RadioGroupItem
                          value="system"
                          id="system"
                          className="peer sr-only"
                        />
                        <Label
                          htmlFor="system"
                          className="border-muted bg-popover hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary flex cursor-pointer flex-col items-center justify-center rounded-md border-2 p-3"
                        >
                          <div className="mb-2 flex h-6 w-10 overflow-hidden rounded border">
                            <div className="w-1/2 bg-white" />
                            <div className="w-1/2 bg-zinc-900" />
                          </div>
                          <span className="text-sm">{t('themeAuto')}</span>
                        </Label>
                      </div>
                    </RadioGroup>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

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
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}
