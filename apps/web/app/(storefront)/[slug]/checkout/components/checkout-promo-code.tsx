'use client'

import { useState, useCallback } from 'react'
import { Loader2, Tag, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { formatCurrency } from '@louez/utils'
import { Badge, Button, Input } from '@louez/ui'

import { validatePromoCode, type ValidatedPromo } from '../promo-actions'

interface CheckoutPromoCodeProps {
  storeId: string
  subtotal: number
  currency: string
  appliedPromo: ValidatedPromo | null
  onApply: (promo: ValidatedPromo) => void
  onRemove: () => void
}

export function CheckoutPromoCode({
  storeId,
  subtotal,
  currency,
  appliedPromo,
  onApply,
  onRemove,
}: CheckoutPromoCodeProps) {
  const t = useTranslations('storefront.checkout.promoCode')
  const [isExpanded, setIsExpanded] = useState(false)
  const [code, setCode] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleApply = useCallback(async () => {
    if (!code.trim()) return

    setIsLoading(true)
    setError(null)

    try {
      const result = await validatePromoCode(storeId, code.trim(), subtotal)

      if (!result.success || !result.promo) {
        const errorKey = result.error || 'invalidCode'
        setError(t(errorKey, result.errorParams))
        return
      }

      onApply(result.promo)
      setCode('')
      setIsExpanded(false)
    } catch {
      setError(t('invalidCode'))
    } finally {
      setIsLoading(false)
    }
  }, [code, storeId, subtotal, onApply, t])

  // Applied state
  if (appliedPromo) {
    return (
      <div className="flex items-center justify-between rounded-lg bg-green-50 p-2.5 dark:bg-green-900/20">
        <div className="flex items-center gap-2 min-w-0">
          <Tag className="h-3.5 w-3.5 shrink-0 text-green-600 dark:text-green-400" />
          <Badge
            variant="secondary"
            className="bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300"
          >
            {appliedPromo.code}
          </Badge>
          <span className="text-sm font-medium text-green-600 dark:text-green-400">
            -{formatCurrency(appliedPromo.discountAmount, currency)}
          </span>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="shrink-0 rounded-full p-1 text-green-600 transition-colors hover:bg-green-100 dark:text-green-400 dark:hover:bg-green-900/50"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    )
  }

  // Collapsed state
  if (!isExpanded) {
    return (
      <button
        type="button"
        onClick={() => setIsExpanded(true)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <Tag className="h-3 w-3" />
        {t('haveCode')}
      </button>
    )
  }

  // Expanded input state
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          placeholder={t('placeholder')}
          value={code}
          onChange={(e) => {
            setCode(e.target.value.toUpperCase())
            setError(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              handleApply()
            }
          }}
          className="h-8 flex-1 font-mono text-xs uppercase"
          disabled={isLoading}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={handleApply}
          disabled={isLoading || !code.trim()}
          className="h-8 shrink-0"
        >
          {isLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            t('apply')
          )}
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
