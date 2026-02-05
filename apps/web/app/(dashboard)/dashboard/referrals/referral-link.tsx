'use client'

import { useState } from 'react'
import { Button } from '@louez/ui'
import { Input } from '@louez/ui'
import { Copy, Check, Gift, Crown } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

interface ReferralLinkProps {
  referralUrl: string
}

export function ReferralLink({ referralUrl }: ReferralLinkProps) {
  const t = useTranslations('dashboard.referrals.link')
  const [copied, setCopied] = useState(false)

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(referralUrl)
    setCopied(true)
    toast.success(t('linkCopied'))
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="relative overflow-hidden rounded-xl border border-primary/20 bg-primary/5 p-6 md:p-8">
      {/* Decorative background elements */}
      <div className="absolute top-0 right-0 h-40 w-40 translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/10 blur-3xl" />
      <div className="absolute bottom-0 left-0 h-24 w-24 -translate-x-1/2 translate-y-1/2 rounded-full bg-primary/5 blur-2xl" />

      <div className="relative flex flex-col gap-6">
        {/* Header */}
        <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:gap-5">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary shadow-lg">
            <Gift className="h-7 w-7 text-primary-foreground" />
          </div>
          <div className="space-y-1">
            <h2 className="text-xl font-semibold tracking-tight">{t('title')}</h2>
            <p className="text-sm text-muted-foreground">{t('description')}</p>
          </div>
        </div>

        {/* Reward highlight */}
        <div className="flex items-center gap-3 rounded-lg border border-amber-500/20 bg-amber-500/10 px-4 py-3">
          <Crown className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
            {t('reward')}
          </p>
        </div>

        {/* Referral link */}
        <div className="flex gap-2">
          <Input
            value={referralUrl}
            readOnly
            className="border-primary/20 bg-background text-sm"
          />
          <Button
            onClick={copyToClipboard}
            className="shrink-0 gap-2 shadow-sm shadow-primary/20"
          >
            {copied ? (
              <Check className="h-4 w-4" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
            {t('copyLink')}
          </Button>
        </div>
      </div>
    </div>
  )
}
