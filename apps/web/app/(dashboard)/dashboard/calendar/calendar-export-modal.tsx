'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Copy, Check, RefreshCw, ExternalLink } from 'lucide-react'
import { Button } from '@louez/ui'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@louez/ui'
import { Input } from '@louez/ui'
import { Label } from '@louez/ui'
import { getIcsToken, regenerateIcsToken } from './actions'

interface CalendarExportModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  storeId: string
}

export function CalendarExportModal({
  open,
  onOpenChange,
  storeId,
}: CalendarExportModalProps) {
  const t = useTranslations('dashboard.calendar.export')
  const [token, setToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [regenerating, setRegenerating] = useState(false)

  // Fetch token when modal opens
  useEffect(() => {
    const fetchToken = async () => {
      setLoading(true)
      const result = await getIcsToken()
      if (result.success && result.token) {
        setToken(result.token)
      }
      setLoading(false)
    }

    if (open && !token) {
      fetchToken()
    }
  }, [open, token])

  const handleRegenerate = async () => {
    setRegenerating(true)
    const result = await regenerateIcsToken()
    if (result.success && result.token) {
      setToken(result.token)
    }
    setRegenerating(false)
  }

  const getIcsUrl = () => {
    const baseUrl = typeof window !== 'undefined' ? window.location.origin : ''
    return `${baseUrl}/api/calendar/ics?store=${storeId}&token=${token}`
  }

  const handleCopy = async () => {
    if (!token) return
    try {
      await navigator.clipboard.writeText(getIcsUrl())
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback for browsers that don't support clipboard API
      const input = document.querySelector<HTMLInputElement>('#ics-url-input')
      if (input) {
        input.select()
        document.execCommand('copy')
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* ICS URL */}
          <div className="space-y-2">
            <Label htmlFor="ics-url-input">{t('urlLabel')}</Label>
            <div className="flex gap-2">
              <Input
                id="ics-url-input"
                value={loading ? t('loading') : token ? getIcsUrl() : ''}
                readOnly
                className="font-mono text-xs"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={handleCopy}
                disabled={!token || loading}
              >
                {copied ? (
                  <Check className="h-4 w-4 text-green-500" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>

          {/* Instructions */}
          <div className="space-y-4">
            <h4 className="text-sm font-medium">{t('instructions.title')}</h4>

            {/* Google Calendar */}
            <div className="rounded-lg border p-3 space-y-2">
              <div className="flex items-center gap-2">
                <div className="flex h-6 w-6 items-center justify-center rounded bg-[#4285F4] text-white text-xs font-bold">
                  G
                </div>
                <span className="font-medium text-sm">Google Calendar</span>
              </div>
              <ol className="text-xs text-muted-foreground space-y-1 pl-8 list-decimal">
                <li>{t('instructions.google.step1')}</li>
                <li>{t('instructions.google.step2')}</li>
                <li>{t('instructions.google.step3')}</li>
              </ol>
              <a
                href="https://calendar.google.com/calendar/r/settings/addbyurl"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline pl-8"
              >
                {t('instructions.google.openLink')}
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>

            {/* Apple Calendar */}
            <div className="rounded-lg border p-3 space-y-2">
              <div className="flex items-center gap-2">
                <div className="flex h-6 w-6 items-center justify-center rounded bg-gradient-to-br from-red-500 to-orange-500 text-white text-xs font-bold">
                  A
                </div>
                <span className="font-medium text-sm">Apple Calendar</span>
              </div>
              <ol className="text-xs text-muted-foreground space-y-1 pl-8 list-decimal">
                <li>{t('instructions.apple.step1')}</li>
                <li>{t('instructions.apple.step2')}</li>
                <li>{t('instructions.apple.step3')}</li>
              </ol>
            </div>

            {/* Outlook */}
            <div className="rounded-lg border p-3 space-y-2">
              <div className="flex items-center gap-2">
                <div className="flex h-6 w-6 items-center justify-center rounded bg-[#0078D4] text-white text-xs font-bold">
                  O
                </div>
                <span className="font-medium text-sm">Outlook</span>
              </div>
              <ol className="text-xs text-muted-foreground space-y-1 pl-8 list-decimal">
                <li>{t('instructions.outlook.step1')}</li>
                <li>{t('instructions.outlook.step2')}</li>
                <li>{t('instructions.outlook.step3')}</li>
              </ol>
            </div>
          </div>

          {/* Regenerate token */}
          <div className="flex items-center justify-between pt-2 border-t">
            <p className="text-xs text-muted-foreground">{t('regenerateHint')}</p>
            <Button
              variant="ghost"
              onClick={handleRegenerate}
              disabled={regenerating}
            >
              <RefreshCw
                className={`mr-2 h-4 w-4 ${regenerating ? 'animate-spin' : ''}`}
              />
              {t('regenerate')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
