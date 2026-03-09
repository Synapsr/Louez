'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { Copy, Check, ExternalLink, Code, Eye } from 'lucide-react'

import { Button } from '@louez/ui'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@louez/ui'

interface EmbedCodeSectionProps {
  embedUrl: string
  storeName: string
}

export function EmbedCodeSection({ embedUrl, storeName }: EmbedCodeSectionProps) {
  const t = useTranslations('dashboard.settings.embed')
  const [copied, setCopied] = useState(false)
  const previewIframeRef = useRef<HTMLIFrameElement>(null)

  // Auto-resize preview iframe via postMessage from embed
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'louez-embed-resize' && previewIframeRef.current) {
        previewIframeRef.current.style.height = `${event.data.height}px`
      }
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [])

  const embedSnippet = `<div id="louez-embed">
  <iframe
    src="${embedUrl}"
    width="100%"
    height="210"
    frameborder="0"
    style="border: none; border-radius: 16px; transition: height 0.3s ease;"
    title="${t('iframeTitle', { storeName })}"
    allow="popups"
  ></iframe>
</div>
<script>
  window.addEventListener("message", function(e) {
    if (e.data && e.data.type === "louez-embed-resize") {
      var iframe = document.querySelector("#louez-embed iframe");
      if (iframe) iframe.style.height = e.data.height + "px";
    }
  });
</script>`

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(embedSnippet)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [embedSnippet])

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
              ref={previewIframeRef}
              src={embedUrl}
              width="100%"
              height="210"
              style={{ border: 'none', borderRadius: '16px', maxWidth: '600px', transition: 'height 0.3s ease' }}
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
          {/* Code block */}
          <div className="relative">
            <pre className="rounded-lg bg-zinc-950 p-4 text-sm text-zinc-300 overflow-x-auto">
              <code>{embedSnippet}</code>
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
