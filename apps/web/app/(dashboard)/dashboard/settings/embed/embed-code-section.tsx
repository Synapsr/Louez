'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Copy, Check, ExternalLink, Code, Eye } from 'lucide-react'

import { Button } from '@louez/ui'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@louez/ui'
import { Label } from '@louez/ui'
import { Input } from '@louez/ui'

interface EmbedCodeSectionProps {
  embedUrl: string
  storeName: string
}

export function EmbedCodeSection({ embedUrl, storeName }: EmbedCodeSectionProps) {
  const t = useTranslations('dashboard.settings.embed')
  const [copied, setCopied] = useState(false)
  const [height, setHeight] = useState('220')

  const iframeCode = `<iframe
  src="${embedUrl}"
  width="100%"
  height="${height}"
  frameborder="0"
  style="border: none; border-radius: 16px; max-width: 600px;"
  title="${t('iframeTitle', { storeName })}"
  allow="popups"
></iframe>`

  const handleCopy = async () => {
    await navigator.clipboard.writeText(iframeCode)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-6">
      {/* Preview */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Eye className="h-5 w-5" />
            {t('preview')}
          </CardTitle>
          <CardDescription>{t('previewDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-xl border bg-muted/30 p-6 flex justify-center">
            <iframe
              src={embedUrl}
              width="100%"
              height={height}
              style={{ border: 'none', borderRadius: '16px', maxWidth: '600px' }}
              title={t('iframeTitle', { storeName })}
            />
          </div>
        </CardContent>
      </Card>

      {/* Code */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Code className="h-5 w-5" />
            {t('code')}
          </CardTitle>
          <CardDescription>{t('codeDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Height setting */}
          <div className="flex items-center gap-3">
            <Label htmlFor="embed-height" className="shrink-0">
              {t('height')}
            </Label>
            <Input
              id="embed-height"
              type="number"
              value={height}
              onChange={(e) => setHeight(e.target.value)}
              className="w-24"
              min="180"
              max="400"
            />
            <span className="text-sm text-muted-foreground">px</span>
          </div>

          {/* Code block */}
          <div className="relative">
            <pre className="rounded-lg bg-zinc-950 p-4 text-sm text-zinc-300 overflow-x-auto">
              <code>{iframeCode}</code>
            </pre>
            <Button
              size="sm"
              variant="secondary"
              className="absolute top-2 right-2"
              onClick={handleCopy}
            >
              {copied ? (
                <>
                  <Check className="h-4 w-4 mr-1" />
                  {t('copied')}
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4 mr-1" />
                  {t('copy')}
                </>
              )}
            </Button>
          </div>

          {/* Direct link */}
          <div className="flex items-center gap-2 pt-2">
            <span className="text-sm text-muted-foreground">{t('directLink')}</span>
            <a
              href={embedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-primary hover:underline inline-flex items-center gap-1"
            >
              {embedUrl}
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
