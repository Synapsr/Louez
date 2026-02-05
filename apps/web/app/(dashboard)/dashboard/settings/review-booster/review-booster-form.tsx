'use client'

import { useState, useTransition, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import {
  Star,
  Lock,
  Zap,
  ArrowRight,
  Eye,
  MessageSquare,
  Mail,
  Phone,
  ExternalLink,
  Pencil,
} from 'lucide-react'

import { Button } from '@louez/ui'
import { Switch } from '@louez/ui'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@louez/ui'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@louez/ui'
import { Badge } from '@louez/ui'
import { cn } from '@louez/utils'
import { FloatingSaveBar } from '@/components/dashboard/floating-save-bar'
import { GooglePlaceSearch } from './google-place-search'
import { NotificationTemplateSheet } from '@/components/dashboard/notification-template-sheet'
import { updateReviewBoosterSettings, updateReviewBoosterTemplate, getReviewBoosterTemplate } from './actions'
import { defaultReviewBoosterSettings } from '@louez/validations'
import type { ReviewBoosterSettings, StoreTheme, CustomerNotificationTemplate } from '@louez/types'
import type { EmailLocale } from '@/lib/email/i18n'

interface Store {
  id: string
  slug: string
  name: string
  logoUrl?: string | null
  darkLogoUrl?: string | null
  email?: string | null
  phone?: string | null
  address?: string | null
  theme?: StoreTheme | null
  reviewBoosterSettings: ReviewBoosterSettings | null
}

interface ReviewBoosterFormProps {
  store: Store
  hasFeatureAccess: boolean
  planSlug: string
  storeLocale: EmailLocale
}

const DELAY_OPTIONS = [
  { value: 1, label: '1h' },
  { value: 6, label: '6h' },
  { value: 12, label: '12h' },
  { value: 24, label: '24h' },
  { value: 48, label: '48h' },
  { value: 72, label: '72h' },
]

export function ReviewBoosterForm({
  store,
  hasFeatureAccess,
  planSlug,
  storeLocale,
}: ReviewBoosterFormProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const t = useTranslations('dashboard.settings.reviewBooster')
  const tCommon = useTranslations('common')

  const initialSettingsRef = useMemo(
    () => store.reviewBoosterSettings || defaultReviewBoosterSettings,
    [store.reviewBoosterSettings]
  )

  const [settings, setSettings] = useState<ReviewBoosterSettings>(initialSettingsRef)

  // Deep comparison for dirty state
  const isDirty = useMemo(() => {
    return JSON.stringify(settings) !== JSON.stringify(initialSettingsRef)
  }, [settings, initialSettingsRef])

  const handleReset = useCallback(() => {
    setSettings(initialSettingsRef)
  }, [initialSettingsRef])

  // Template customization state
  const [templateSheetOpen, setTemplateSheetOpen] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<CustomerNotificationTemplate | null>(null)

  const updateSetting = <K extends keyof ReviewBoosterSettings>(
    key: K,
    value: ReviewBoosterSettings[K]
  ) => {
    setSettings((prev) => ({ ...prev, [key]: value }))
  }

  const handlePlaceSelect = (place: {
    placeId: string
    name: string
    address: string
    rating: number | null
    reviewCount: number | null
  }) => {
    setSettings((prev) => ({
      ...prev,
      googlePlaceId: place.placeId,
      googlePlaceName: place.name,
      googlePlaceAddress: place.address,
      googleRating: place.rating,
      googleReviewCount: place.reviewCount,
      enabled: true,
    }))
  }

  const handlePlaceClear = () => {
    setSettings((prev) => ({
      ...prev,
      googlePlaceId: null,
      googlePlaceName: null,
      googlePlaceAddress: null,
      googleRating: null,
      googleReviewCount: null,
      enabled: false,
      displayReviewsOnStorefront: false,
      showReviewPromptInPortal: false,
    }))
  }

  const onSubmit = () => {
    startTransition(async () => {
      const result = await updateReviewBoosterSettings(settings)
      if (result.error) {
        toast.error(t('error'))
        return
      }
      toast.success(t('saved'))
      router.refresh()
    })
  }

  const handleUpgrade = () => {
    router.push('/dashboard/subscription')
  }

  const handleOpenTemplateSheet = async () => {
    const result = await getReviewBoosterTemplate()
    if (!result.error) {
      setEditingTemplate(result.template || {})
    }
    setTemplateSheetOpen(true)
  }

  const handleSaveTemplate = async (template: CustomerNotificationTemplate) => {
    const result = await updateReviewBoosterTemplate(template)
    if (result.error) {
      toast.error(t('error'))
    } else {
      toast.success(t('templateSaved'))
    }
    setTemplateSheetOpen(false)
    setEditingTemplate(null)
  }

  // Store info for preview
  const storeInfo = {
    name: store.name,
    logoUrl: store.logoUrl,
    darkLogoUrl: store.darkLogoUrl,
    email: store.email,
    phone: store.phone,
    address: store.address,
    theme: store.theme,
  }

  // Locked state for Start plan
  if (!hasFeatureAccess) {
    return (
      <div className="space-y-6">
        {/* Locked Banner */}
        <Card className="border-primary/20 bg-gradient-to-br from-primary/5 via-transparent to-transparent">
          <CardContent className="p-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 flex-shrink-0">
                  <Star className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold text-lg">{t('locked.title')}</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    {t('locked.description')}
                  </p>
                </div>
              </div>
              <Button onClick={handleUpgrade} className="gap-2 flex-shrink-0">
                <Zap className="h-4 w-4" />
                {t('locked.upgrade')}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Preview of features (locked) */}
        <Card className="relative overflow-hidden">
          <div className="absolute inset-0 bg-background/80 backdrop-blur-[2px] z-10 flex items-center justify-center">
            <div className="text-center p-6">
              <Lock className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
              <p className="font-medium">{t('locked.featureLocked')}</p>
              <p className="text-sm text-muted-foreground mt-1">
                {t('locked.upgradeToUnlock')}
              </p>
            </div>
          </div>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Star className="h-5 w-5" />
              {t('searchPlace')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 opacity-50 pointer-events-none">
            <div className="h-10 rounded-md border bg-muted/50" />
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 rounded-lg border">
                <span className="text-sm">{t('displayOnStorefront')}</span>
                <Switch disabled />
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg border">
                <span className="text-sm">{t('showPromptInPortal')}</span>
                <Switch disabled />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Full access for Pro/Ultra plans
  return (
    <div className="space-y-6">
      {/* Google Place Search */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Star className="h-5 w-5" />
            {t('searchPlace')}
          </CardTitle>
          <CardDescription>{t('searchPlaceDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <GooglePlaceSearch
            selectedPlace={{
              placeId: settings.googlePlaceId,
              name: settings.googlePlaceName,
              address: settings.googlePlaceAddress,
              rating: settings.googleRating,
              reviewCount: settings.googleReviewCount,
            }}
            onPlaceSelect={handlePlaceSelect}
            onPlaceClear={handlePlaceClear}
            disabled={isPending}
          />
        </CardContent>
      </Card>

      {/* Feature Toggles - Only show if a place is selected */}
      {settings.googlePlaceId && (
        <>
          {/* Display Settings */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Eye className="h-5 w-5" />
                {t('displaySettings')}
              </CardTitle>
              <CardDescription>{t('displaySettingsDescription')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Display on Storefront */}
              <div
                className={cn(
                  'flex flex-row items-center justify-between rounded-lg border p-4 transition-colors',
                  settings.displayReviewsOnStorefront && 'border-primary/50 bg-primary/5'
                )}
              >
                <div className="space-y-0.5">
                  <label className="text-sm font-medium leading-none cursor-pointer">
                    {t('displayOnStorefront')}
                  </label>
                  <p className="text-sm text-muted-foreground">
                    {t('displayOnStorefrontDesc')}
                  </p>
                </div>
                <Switch
                  checked={settings.displayReviewsOnStorefront}
                  onCheckedChange={(checked) =>
                    updateSetting('displayReviewsOnStorefront', checked)
                  }
                  disabled={isPending}
                />
              </div>

              {/* Show Prompt in Portal */}
              <div
                className={cn(
                  'flex flex-row items-center justify-between rounded-lg border p-4 transition-colors',
                  settings.showReviewPromptInPortal && 'border-primary/50 bg-primary/5'
                )}
              >
                <div className="space-y-0.5">
                  <label className="text-sm font-medium leading-none cursor-pointer">
                    {t('showPromptInPortal')}
                  </label>
                  <p className="text-sm text-muted-foreground">
                    {t('showPromptInPortalDesc')}
                  </p>
                </div>
                <Switch
                  checked={settings.showReviewPromptInPortal}
                  onCheckedChange={(checked) =>
                    updateSetting('showReviewPromptInPortal', checked)
                  }
                  disabled={isPending}
                />
              </div>

              {/* Preview link */}
              {settings.displayReviewsOnStorefront && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <ExternalLink className="h-4 w-4" />
                  <a
                    href={`/${store.slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:underline"
                  >
                    {t('previewOnStorefront')}
                  </a>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Automation Settings */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="h-5 w-5" />
                {t('automationSettings')}
              </CardTitle>
              <CardDescription>{t('automationSettingsDescription')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Auto Email */}
              <div
                className={cn(
                  'rounded-lg border p-4 transition-colors',
                  settings.autoSendThankYouEmail && 'border-primary/50 bg-primary/5'
                )}
              >
                <div className="flex flex-row items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
                      <Mail className="h-4 w-4" />
                    </div>
                    <div className="space-y-0.5">
                      <label className="text-sm font-medium leading-none cursor-pointer">
                        {t('autoEmail')}
                      </label>
                      <p className="text-sm text-muted-foreground">
                        {t('autoEmailDesc')}
                      </p>
                    </div>
                  </div>
                  <Switch
                    checked={settings.autoSendThankYouEmail}
                    onCheckedChange={(checked) =>
                      updateSetting('autoSendThankYouEmail', checked)
                    }
                    disabled={isPending}
                  />
                </div>
                {settings.autoSendThankYouEmail && (
                  <div className="mt-4 pt-4 border-t space-y-3">
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-muted-foreground">
                        {t('delayHours')}
                      </span>
                      <Select
                        value={settings.emailDelayHours.toString()}
                        onValueChange={(value) =>
                          updateSetting('emailDelayHours', parseInt(value))
                        }
                        disabled={isPending}
                      >
                        <SelectTrigger className="w-24">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {DELAY_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value.toString()}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <span className="text-sm text-muted-foreground">
                        {t('afterReturn')}
                      </span>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleOpenTemplateSheet}
                      className="gap-2"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      {t('customizeTemplate')}
                    </Button>
                  </div>
                )}
              </div>

              {/* Auto SMS */}
              <div
                className={cn(
                  'rounded-lg border p-4 transition-colors',
                  settings.autoSendThankYouSms && 'border-primary/50 bg-primary/5'
                )}
              >
                <div className="flex flex-row items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
                      <Phone className="h-4 w-4" />
                    </div>
                    <div className="space-y-0.5">
                      <label className="text-sm font-medium leading-none cursor-pointer">
                        {t('autoSms')}
                      </label>
                      <p className="text-sm text-muted-foreground">
                        {t('autoSmsDesc')}
                      </p>
                    </div>
                  </div>
                  <Switch
                    checked={settings.autoSendThankYouSms}
                    onCheckedChange={(checked) =>
                      updateSetting('autoSendThankYouSms', checked)
                    }
                    disabled={isPending}
                  />
                </div>
                {settings.autoSendThankYouSms && (
                  <div className="mt-4 pt-4 border-t space-y-3">
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-muted-foreground">
                        {t('delayHours')}
                      </span>
                      <Select
                        value={settings.smsDelayHours.toString()}
                        onValueChange={(value) =>
                          updateSetting('smsDelayHours', parseInt(value))
                        }
                        disabled={isPending}
                      >
                        <SelectTrigger className="w-24">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {DELAY_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value.toString()}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <span className="text-sm text-muted-foreground">
                        {t('afterReturn')}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t('smsLimitNote')}
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleOpenTemplateSheet}
                      className="gap-2"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      {t('customizeTemplate')}
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </>
      )}

      <FloatingSaveBar
        isDirty={isDirty}
        isLoading={isPending}
        onReset={handleReset}
        onSubmit={onSubmit}
      />

      {/* Template Sheet */}
      <NotificationTemplateSheet
        open={templateSheetOpen}
        onOpenChange={setTemplateSheetOpen}
        eventType="thank_you_review"
        template={editingTemplate || undefined}
        onSave={handleSaveTemplate}
        locale={storeLocale}
        store={storeInfo}
      />
    </div>
  )
}
