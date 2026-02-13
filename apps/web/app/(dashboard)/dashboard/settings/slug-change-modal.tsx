'use client'

import { useDebounce } from '@/hooks/use-debounce'
import { AlertTriangle, Check, Link2, Loader2, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState, useTransition } from 'react'

import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  Input,
  Label,
} from '@louez/ui'
import { checkSlugAvailability, updateStoreSlug } from './actions'

interface SlugChangeModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentSlug: string
  domain: string
}

type AvailabilityStatus = 'idle' | 'checking' | 'available' | 'unavailable' | 'invalid' | 'same'

export function SlugChangeModal({
  open,
  onOpenChange,
  currentSlug,
  domain,
}: SlugChangeModalProps) {
  const router = useRouter()
  const t = useTranslations('dashboard.settings.slugChange')
  const tCommon = useTranslations('common')
  const [isPending, startTransition] = useTransition()

  const [slug, setSlug] = useState(currentSlug)
  const [status, setStatus] = useState<AvailabilityStatus>('idle')
  const [showConfirmation, setShowConfirmation] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const debouncedSlug = useDebounce(slug, 400)

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setSlug(currentSlug)
      setStatus('idle')
      setShowConfirmation(false)
      setError(null)
    }
  }, [open, currentSlug])

  // Check availability when slug changes
  const checkAvailability = useCallback(async (slugToCheck: string) => {
    // Same as current
    if (slugToCheck === currentSlug) {
      setStatus('same')
      return
    }

    // Validate format locally first
    const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
    if (!slugToCheck || slugToCheck.length < 3 || slugToCheck.length > 50 || !slugRegex.test(slugToCheck)) {
      setStatus('invalid')
      return
    }

    setStatus('checking')
    const result = await checkSlugAvailability(slugToCheck)

    if (result.error) {
      setStatus('invalid')
    } else {
      setStatus(result.available ? 'available' : 'unavailable')
    }
  }, [currentSlug])

  useEffect(() => {
    if (debouncedSlug && debouncedSlug !== currentSlug) {
      checkAvailability(debouncedSlug)
    } else if (debouncedSlug === currentSlug) {
      setStatus('same')
    }
  }, [debouncedSlug, currentSlug, checkAvailability])

  const handleSlugChange = (value: string) => {
    // Normalize: lowercase, replace spaces with hyphens, remove invalid chars
    const normalized = value
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')

    setSlug(normalized)
    setStatus('idle')
    setError(null)
    setShowConfirmation(false)
  }

  const handleSubmit = () => {
    if (status !== 'available') return
    setShowConfirmation(true)
  }

  const handleConfirm = () => {
    startTransition(async () => {
      const result = await updateStoreSlug(slug)

      if (result.error) {
        setError(result.error)
        setShowConfirmation(false)
        return
      }

      if (result.success) {
        onOpenChange(false)
        router.refresh()
      }
    })
  }

  const getStatusIcon = () => {
    switch (status) {
      case 'checking':
        return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      case 'available':
        return <Check className="h-4 w-4 text-green-600" />
      case 'unavailable':
        return <X className="h-4 w-4 text-destructive" />
      case 'invalid':
        return <X className="h-4 w-4 text-destructive" />
      default:
        return null
    }
  }

  const getStatusMessage = () => {
    switch (status) {
      case 'checking':
        return t('checking')
      case 'available':
        return t('available')
      case 'unavailable':
        return t('unavailable')
      case 'invalid':
        return t('invalid')
      case 'same':
        return t('same')
      default:
        return null
    }
  }

  const canSubmit = status === 'available' && !isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5" />
            {t('title')}
          </DialogTitle>
          <DialogDescription>
            {t('description')}
          </DialogDescription>
        </DialogHeader>

        <DialogPanel>
          {!showConfirmation ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="slug">{t('label')}</Label>
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Input
                      id="slug"
                      value={slug}
                      onChange={(e) => handleSlugChange(e.target.value)}
                      placeholder={t('placeholder')}
                      className="pr-10"
                      autoComplete="off"
                    />
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      {getStatusIcon()}
                    </div>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">
                  {slug ? `${slug}.${domain}` : `votre-boutique.${domain}`}
                </p>
                {status !== 'idle' && status !== 'checking' && (
                  <p className={`text-sm ${
                    status === 'available'
                      ? 'text-green-600'
                      : status === 'same'
                      ? 'text-muted-foreground'
                      : 'text-destructive'
                  }`}>
                    {getStatusMessage()}
                  </p>
                )}
              </div>

              <div className="rounded-lg border border-muted bg-muted/30 p-3">
                <p className="text-sm text-muted-foreground">
                  {t('formatHelp')}
                </p>
              </div>

              {error && (
                <Alert variant="error">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
            </>
          ) : (
            <div className="flex flex-col gap-2">
              <Alert variant="warning">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription className="ml-2">
                  <p className="font-medium">{t('warning.title')}</p>
                  <ul className="mt-2 list-disc pl-4 space-y-1 text-sm">
                    <li>{t('warning.point1')}</li>
                    <li>{t('warning.point2')}</li>
                    <li>{t('warning.point3')}</li>
                  </ul>
                </AlertDescription>
              </Alert>

              <div className="rounded-lg border bg-muted/50 p-4 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{t('currentUrl')}</span>
                  <span className="font-mono line-through text-muted-foreground">
                    {currentSlug}.{domain}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{t('newUrl')}</span>
                  <span className="font-mono font-medium text-foreground">
                    {slug}.{domain}
                  </span>
                </div>
              </div>
            </div>
          )}
        </DialogPanel>

        <DialogFooter>
          {!showConfirmation ? (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                {tCommon('cancel')}
              </Button>
              <Button
                type="button"
                onClick={handleSubmit}
                disabled={!canSubmit}
              >
                {t('continue')}
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowConfirmation(false)}
                disabled={isPending}
              >
                {tCommon('back')}
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={handleConfirm}
                disabled={isPending}
              >
                {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t('confirmChange')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  )
}
