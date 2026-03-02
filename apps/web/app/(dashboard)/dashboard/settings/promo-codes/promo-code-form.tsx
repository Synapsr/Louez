'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Loader2, Shuffle, Percent, Banknote } from 'lucide-react'
import { nanoid } from 'nanoid'
import { cn, formatCurrency } from '@louez/utils'
import {
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
  Switch,
  toastManager,
} from '@louez/ui'

import { createPromoCode, updatePromoCode } from './actions'

interface PromoCode {
  id: string
  code: string
  description: string | null
  type: 'percentage' | 'fixed'
  value: string
  minimumAmount: string | null
  maxUsageCount: number | null
  currentUsageCount: number
  startsAt: Date | null
  expiresAt: Date | null
  isActive: boolean
}

interface PromoCodeFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  editingCode: PromoCode | null
  currency: string
}

function generateCode(): string {
  return nanoid(8).toUpperCase().replace(/[^A-Z0-9]/g, 'X')
}

function formatDateForInput(date: Date | null): string {
  if (!date) return ''
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseDateInput(value: string): Date | null {
  if (!value) return null
  const date = new Date(value + 'T00:00:00')
  return isNaN(date.getTime()) ? null : date
}

export function PromoCodeFormDialog({
  open,
  onOpenChange,
  editingCode,
  currency,
}: PromoCodeFormDialogProps) {
  const router = useRouter()
  const t = useTranslations('dashboard.settings.promoCodes')
  const tCommon = useTranslations('common')
  const tErrors = useTranslations('errors')
  const [isLoading, setIsLoading] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Form state
  const [code, setCode] = useState('')
  const [description, setDescription] = useState('')
  const [type, setType] = useState<'percentage' | 'fixed'>('percentage')
  const [value, setValue] = useState('')
  const [minimumAmount, setMinimumAmount] = useState('')
  const [maxUsageCount, setMaxUsageCount] = useState('')
  const [startsAt, setStartsAt] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [isActive, setIsActive] = useState(true)

  // Reset form when dialog opens/closes or editingCode changes
  useEffect(() => {
    if (open) {
      if (editingCode) {
        setCode(editingCode.code)
        setDescription(editingCode.description ?? '')
        setType(editingCode.type)
        setValue(String(parseFloat(editingCode.value)))
        setMinimumAmount(
          editingCode.minimumAmount ? String(parseFloat(editingCode.minimumAmount)) : ''
        )
        setMaxUsageCount(
          editingCode.maxUsageCount !== null ? String(editingCode.maxUsageCount) : ''
        )
        setStartsAt(formatDateForInput(editingCode.startsAt))
        setExpiresAt(formatDateForInput(editingCode.expiresAt))
        setIsActive(editingCode.isActive)
      } else {
        setCode('')
        setDescription('')
        setType('percentage')
        setValue('')
        setMinimumAmount('')
        setMaxUsageCount('')
        setStartsAt('')
        setExpiresAt('')
        setIsActive(true)
      }
      setErrors({})
    }
  }, [open, editingCode])

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {}

    if (code.trim().length < 2) {
      newErrors.code = t('validation.codeRequired')
    } else if (!/^[A-Z0-9_-]+$/i.test(code.trim())) {
      newErrors.code = t('validation.codeFormat')
    }

    const numValue = parseFloat(value)
    if (!value || isNaN(numValue) || numValue <= 0) {
      newErrors.value = t('validation.valueRequired')
    } else if (type === 'percentage' && numValue > 100) {
      newErrors.value = t('validation.maxPercentage')
    }

    if (startsAt && expiresAt) {
      const start = parseDateInput(startsAt)
      const end = parseDateInput(expiresAt)
      if (start && end && end <= start) {
        newErrors.expiresAt = t('validation.expiresAfterStarts')
      }
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async () => {
    if (!validate()) return

    setIsLoading(true)
    try {
      const data = {
        code: code.trim().toUpperCase(),
        description: description.trim() || undefined,
        type,
        value: parseFloat(value),
        minimumAmount: minimumAmount ? parseFloat(minimumAmount) : null,
        maxUsageCount: maxUsageCount ? parseInt(maxUsageCount) : null,
        startsAt: parseDateInput(startsAt),
        expiresAt: parseDateInput(expiresAt),
        isActive,
      }

      const result = editingCode
        ? await updatePromoCode(editingCode.id, data)
        : await createPromoCode(data)

      if (result.error) {
        const errorKey = result.error.replace('errors.', '')
        toastManager.add({ title: tErrors(errorKey), type: 'error' })
      } else {
        toastManager.add({ title: t('saved'), type: 'success' })
        onOpenChange(false)
        router.refresh()
      }
    } catch {
      toastManager.add({ title: tErrors('generic'), type: 'error' })
    } finally {
      setIsLoading(false)
    }
  }

  const isEditing = !!editingCode
  const currencySymbol = currency === 'EUR' ? '\u20ac' : currency

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? t('editCode') : t('createCode')}
          </DialogTitle>
          <DialogDescription>
            {isEditing ? t('editDescription') : t('createDescription')}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-5">
          {/* Code */}
          <div className="space-y-2">
            <Label htmlFor="promo-code">{t('code')}</Label>
            <div className="flex gap-2">
              <Input
                id="promo-code"
                placeholder={t('codePlaceholder')}
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                className="flex-1 font-mono uppercase"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setCode(generateCode())}
                title={t('generateRandom')}
              >
                <Shuffle className="h-4 w-4" />
              </Button>
            </div>
            {errors.code && (
              <p className="text-sm text-destructive">{errors.code}</p>
            )}
          </div>

          {/* Type selector */}
          <div className="space-y-2">
            <Label>{t('type')}</Label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setType('percentage')}
                className={cn(
                  'flex items-center gap-3 rounded-lg border p-3 text-left transition-colors',
                  type === 'percentage'
                    ? 'border-primary bg-primary/5 ring-1 ring-primary'
                    : 'hover:bg-muted/50'
                )}
              >
                <Percent className="h-5 w-5 shrink-0" />
                <div>
                  <p className="text-sm font-medium">{t('percentage')}</p>
                  <p className="text-xs text-muted-foreground">
                    {t('percentageDescription')}
                  </p>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setType('fixed')}
                className={cn(
                  'flex items-center gap-3 rounded-lg border p-3 text-left transition-colors',
                  type === 'fixed'
                    ? 'border-primary bg-primary/5 ring-1 ring-primary'
                    : 'hover:bg-muted/50'
                )}
              >
                <Banknote className="h-5 w-5 shrink-0" />
                <div>
                  <p className="text-sm font-medium">{t('fixedAmount')}</p>
                  <p className="text-xs text-muted-foreground">
                    {t('fixedAmountDescription', { currency: currencySymbol })}
                  </p>
                </div>
              </button>
            </div>
          </div>

          {/* Value */}
          <div className="space-y-2">
            <Label htmlFor="promo-value">{t('value')}</Label>
            <div className="relative">
              <Input
                id="promo-value"
                type="number"
                step={type === 'percentage' ? '1' : '0.01'}
                min="0.01"
                max={type === 'percentage' ? '100' : undefined}
                placeholder={type === 'percentage' ? '20' : '10.00'}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="pr-10"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                {type === 'percentage' ? '%' : currencySymbol}
              </span>
            </div>
            {errors.value && (
              <p className="text-sm text-destructive">{errors.value}</p>
            )}
          </div>

          {/* Minimum amount */}
          <div className="space-y-2">
            <Label htmlFor="promo-min-amount">{t('minimumAmount')}</Label>
            <div className="relative">
              <Input
                id="promo-min-amount"
                type="number"
                step="0.01"
                min="0"
                placeholder={t('minimumAmountPlaceholder')}
                value={minimumAmount}
                onChange={(e) => setMinimumAmount(e.target.value)}
                className="pr-10"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                {currencySymbol}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {t('minimumAmountDescription')}
            </p>
          </div>

          {/* Max usage count */}
          <div className="space-y-2">
            <Label htmlFor="promo-max-usage">{t('maxUsage')}</Label>
            <Input
              id="promo-max-usage"
              type="number"
              step="1"
              min="1"
              placeholder={t('unlimited')}
              value={maxUsageCount}
              onChange={(e) => setMaxUsageCount(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {t('maxUsageDescription')}
            </p>
          </div>

          {/* Date range */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="promo-starts-at">{t('startsAt')}</Label>
              <Input
                id="promo-starts-at"
                type="date"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="promo-expires-at">{t('expiresAt')}</Label>
              <Input
                id="promo-expires-at"
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
              />
              {errors.expiresAt && (
                <p className="text-sm text-destructive">{errors.expiresAt}</p>
              )}
            </div>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="promo-description">{t('descriptionLabel')}</Label>
            <Input
              id="promo-description"
              placeholder={t('descriptionPlaceholder')}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {/* Active toggle */}
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">{t('activeToggle')}</p>
              <p className="text-xs text-muted-foreground">
                {t('activeToggleDescription')}
              </p>
            </div>
            <Switch checked={isActive} onCheckedChange={setIsActive} />
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {tCommon('cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={isLoading}>
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEditing ? tCommon('save') : tCommon('create')}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  )
}
