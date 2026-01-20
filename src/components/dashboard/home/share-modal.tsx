'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  Copy,
  Check,
  Mail,
  MessageCircle,
  QrCode,
  Link2,
  Smartphone,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface ShareModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  storeUrl: string
  storeName?: string
}

export function ShareModal({
  open,
  onOpenChange,
  storeUrl,
  storeName,
}: ShareModalProps) {
  const t = useTranslations('dashboard.home.share')
  const [copied, setCopied] = useState(false)
  const [showQR, setShowQR] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(storeUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  const handleWhatsApp = () => {
    const message = t('whatsappMessage', { url: storeUrl })
    window.open(
      `https://wa.me/?text=${encodeURIComponent(message)}`,
      '_blank'
    )
    onOpenChange(false)
  }

  const handleEmail = () => {
    const subject = t('emailSubject')
    const body = t('emailBody', { url: storeUrl })
    window.open(
      `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
      '_blank'
    )
    onOpenChange(false)
  }

  const handleSMS = () => {
    const message = t('smsMessage', { url: storeUrl })
    window.open(`sms:?body=${encodeURIComponent(message)}`, '_blank')
    onOpenChange(false)
  }

  const shareOptions = [
    {
      key: 'copy',
      icon: copied ? Check : Copy,
      iconClass: 'share-option-icon--copy',
      label: copied ? t('copied') : t('copyLink'),
      description: t('copyLinkDescription'),
      onClick: handleCopy,
      success: copied,
    },
    {
      key: 'whatsapp',
      icon: MessageCircle,
      iconClass: 'share-option-icon--whatsapp',
      label: 'WhatsApp',
      description: t('whatsappDescription'),
      onClick: handleWhatsApp,
    },
    {
      key: 'email',
      icon: Mail,
      iconClass: 'share-option-icon--email',
      label: t('email'),
      description: t('emailDescription'),
      onClick: handleEmail,
    },
    {
      key: 'sms',
      icon: Smartphone,
      iconClass: 'share-option-icon--sms',
      label: 'SMS',
      description: t('smsDescription'),
      onClick: handleSMS,
    },
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        {/* URL Preview */}
        <div className="flex items-center gap-3 rounded-xl border bg-muted/30 p-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Link2 className="h-4 w-4 text-primary" />
          </div>
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            {storeUrl}
          </span>
        </div>

        {/* Share Options */}
        <div className="space-y-1">
          {shareOptions.map((option) => (
            <button
              key={option.key}
              className={cn(
                'share-option',
                option.success && 'bg-emerald-50 dark:bg-emerald-900/20'
              )}
              onClick={option.onClick}
            >
              <div className={cn('share-option-icon', option.iconClass)}>
                <option.icon className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    'font-medium',
                    option.success && 'text-emerald-700 dark:text-emerald-400'
                  )}
                >
                  {option.label}
                </p>
                <p className="text-sm text-muted-foreground">
                  {option.description}
                </p>
              </div>
            </button>
          ))}
        </div>

        {/* QR Code Section */}
        <button
          className="share-option mt-2 justify-center border border-dashed"
          onClick={() => setShowQR(!showQR)}
        >
          <QrCode className="h-5 w-5 text-muted-foreground" />
          <span className="text-sm font-medium">
            {showQR ? t('hideQR') : t('showQR')}
          </span>
        </button>

        {showQR && (
          <div className="flex flex-col items-center gap-3 rounded-xl border bg-white p-6 dark:bg-muted/30">
            {/* Simple QR placeholder - in real app you'd use a QR library */}
            <div className="flex h-32 w-32 items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/20">
              <QrCode className="h-12 w-12 text-muted-foreground/40" />
            </div>
            <p className="text-center text-xs text-muted-foreground">
              {t('qrDescription')}
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
