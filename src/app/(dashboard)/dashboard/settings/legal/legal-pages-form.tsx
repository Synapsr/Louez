'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations, useLocale } from 'next-intl'
import { FileText, Sparkles, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { RichTextEditor } from '@/components/ui/rich-text-editor'
import { toast } from 'sonner'
import Link from 'next/link'
import { getCgvTemplate, getLegalNoticeTemplate } from '@/lib/legal-templates'

interface Store {
  id: string
  name: string
  slug: string
  cgv: string | null
  legalNotice: string | null
}

interface LegalPagesFormProps {
  store: Store
}

export function LegalPagesForm({ store }: LegalPagesFormProps) {
  const router = useRouter()
  const locale = useLocale()
  const t = useTranslations('dashboard.settings.legalSettings')
  const tCommon = useTranslations('common')
  const tErrors = useTranslations('errors')
  const [isLoading, setIsLoading] = useState(false)
  const [cgv, setCgv] = useState(store.cgv || '')
  const [legalNotice, setLegalNotice] = useState(store.legalNotice || '')
  const [activeTab, setActiveTab] = useState('cgv')

  const handleUseTemplate = (type: 'cgv' | 'legal') => {
    if (type === 'cgv') {
      setCgv(getCgvTemplate(locale))
      setActiveTab('cgv')
    } else {
      setLegalNotice(getLegalNoticeTemplate(locale))
      setActiveTab('legal')
    }
    toast.success(t('templateApplied'))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)

    try {
      const response = await fetch('/api/stores/legal', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cgv, legalNotice }),
      })

      if (!response.ok) {
        throw new Error('Failed to update legal pages')
      }

      toast.success(t('updated'))
      router.refresh()
    } catch {
      toast.error(tErrors('generic'))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            {t('templates')}
          </CardTitle>
          <CardDescription>
            {t('templatesDescription')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleUseTemplate('cgv')}
            >
              <FileText className="mr-2 h-4 w-4" />
              {t('cgvTemplate')}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleUseTemplate('legal')}
            >
              <FileText className="mr-2 h-4 w-4" />
              {t('legalNoticeTemplate')}
            </Button>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            {t('templatesDisclaimer')}
          </p>
        </CardContent>
      </Card>

      {/* Editor */}
      <Card>
        <CardHeader>
          <CardTitle>{t('editor')}</CardTitle>
          <CardDescription>
            {t('editorDescription')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="mb-4">
              <TabsTrigger value="cgv">
                {t('cgv')}
              </TabsTrigger>
              <TabsTrigger value="legal">
                {t('legalNotice')}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="cgv" className="space-y-4">
              <RichTextEditor
                value={cgv}
                onChange={setCgv}
                placeholder={t('cgvPlaceholder')}
                className="min-h-[400px]"
              />
              <div className="flex items-center justify-end">
                {store.slug && (
                  <Button type="button" variant="ghost" size="sm" asChild>
                    <Link
                      href={`/${store.slug}/terms`}
                      target="_blank"
                      className="flex items-center gap-1"
                    >
                      <ExternalLink className="h-4 w-4" />
                      {t('viewOnStore')}
                    </Link>
                  </Button>
                )}
              </div>
            </TabsContent>

            <TabsContent value="legal" className="space-y-4">
              <RichTextEditor
                value={legalNotice}
                onChange={setLegalNotice}
                placeholder={t('legalNoticePlaceholder')}
                className="min-h-[400px]"
              />
              <div className="flex items-center justify-end">
                {store.slug && (
                  <Button type="button" variant="ghost" size="sm" asChild>
                    <Link
                      href={`/${store.slug}/legal`}
                      target="_blank"
                      className="flex items-center gap-1"
                    >
                      <ExternalLink className="h-4 w-4" />
                      {t('viewOnStore')}
                    </Link>
                  </Button>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Tips */}
      <Card>
        <CardHeader>
          <CardTitle>{t('tips')}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="list-disc list-inside space-y-2 text-sm text-muted-foreground">
            <li>{t('tip1')}</li>
            <li>{t('tip2')}</li>
            <li>{t('tip3')}</li>
            <li>{t('tip4')}</li>
            <li>{t('tip5')}</li>
          </ul>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex justify-end gap-3">
        <Button type="button" variant="outline" onClick={() => router.back()}>
          {tCommon('cancel')}
        </Button>
        <Button type="submit" disabled={isLoading}>
          {isLoading ? tCommon('loading') : tCommon('save')}
        </Button>
      </div>
    </form>
  )
}
