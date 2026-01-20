'use client'

import { useState, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { QRCodeSVG } from 'qrcode.react'
import {
  Copy,
  Check,
  Mail,
  MessageCircle,
  QrCode,
  Link2,
  Smartphone,
  Download,
  ChevronDown,
  ChevronUp,
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
  const qrRef = useRef<HTMLDivElement>(null)

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

  const handleDownloadQR = () => {
    if (!qrRef.current) return

    const svg = qrRef.current.querySelector('svg')
    if (!svg) return

    // Create a canvas to convert SVG to PNG
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    const svgData = new XMLSerializer().serializeToString(svg)
    const img = new Image()

    // Set canvas size with padding
    const size = 400
    const padding = 40
    canvas.width = size + padding * 2
    canvas.height = size + padding * 2

    img.onload = () => {
      if (!ctx) return

      // White background
      ctx.fillStyle = 'white'
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      // Draw QR code centered
      ctx.drawImage(img, padding, padding, size, size)

      // Download
      const link = document.createElement('a')
      link.download = 'qr-code.png'
      link.href = canvas.toDataURL('image/png')
      link.click()
    }

    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)))
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
              <div className="min-w-0 flex-1 text-left">
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
          {showQR ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </button>

        {showQR && (
          <div className="animate-in fade-in slide-in-from-top-2 duration-200">
            <div className="flex flex-col items-center gap-4 rounded-xl border bg-white p-6 dark:bg-muted/30">
              {/* QR Code */}
              <div
                ref={qrRef}
                className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-black/5"
              >
                <QRCodeSVG
                  value={storeUrl}
                  size={160}
                  level="H"
                  includeMargin={false}
                  bgColor="white"
                  fgColor="black"
                />
              </div>

              {/* Description */}
              <p className="text-center text-xs text-muted-foreground">
                {t('qrDescription')}
              </p>

              {/* Download Button */}
              <button
                onClick={handleDownloadQR}
                className="action-btn action-btn--primary gap-2"
              >
                <Download className="h-4 w-4" />
                {t('downloadQR')}
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
