'use client'

import { useState, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations, useLocale } from 'next-intl'
import { useMutation } from '@tanstack/react-query'
import { FileText, Sparkles, ExternalLink } from 'lucide-react'
import { env } from '@/env'
import { Button, Switch } from '@louez/ui'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@louez/ui'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@louez/ui'
import { RichTextEditor } from '@/components/ui/rich-text-editor'
import { toastManager } from '@louez/ui'
import { getCgvTemplate, getLegalNoticeTemplate } from '@/lib/legal-templates'
import { FloatingSaveBar } from '@/components/dashboard/floating-save-bar'
import { orpc } from '@/lib/orpc/react'

interface Store {
  id: string
  name: string
  slug: string
  cgv: string | null
  legalNotice: string | null
  includeCgvInContract: boolean
}

interface LegalPagesFormProps {
  store: Store
}

export function LegalPagesForm({ store }: LegalPagesFormProps) {
  const router = useRouter()
  const locale = useLocale()
  const t = useTranslations('dashboard.settings.legalSettings')
  const tErrors = useTranslations('errors')
  const [cgv, setCgv] = useState(store.cgv || '')
  const [legalNotice, setLegalNotice] = useState(store.legalNotice || '')
  const [includeFullCgvInContract, setIncludeFullCgvInContract] = useState(
    store.includeCgvInContract ?? false,
  )
  const [activeTab, setActiveTab] = useState('cgv')

  const updateLegalMutation = useMutation(
    orpc.dashboard.settings.updateLegal.mutationOptions(),
  )

  // Track initial values for dirty state detection
  const initialCgv = useMemo(() => store.cgv || '', [store.cgv])
  const initialLegalNotice = useMemo(() => store.legalNotice || '', [store.legalNotice])
  const initialIncludeFullCgvInContract = useMemo(
    () => store.includeCgvInContract ?? false,
    [store.includeCgvInContract],
  )

  const isDirty = useMemo(() => {
    return (
      cgv !== initialCgv ||
      legalNotice !== initialLegalNotice ||
      includeFullCgvInContract !== initialIncludeFullCgvInContract
    )
  }, [
    cgv,
    legalNotice,
    includeFullCgvInContract,
    initialCgv,
    initialLegalNotice,
    initialIncludeFullCgvInContract,
  ])

  const handleReset = useCallback(() => {
    setCgv(initialCgv)
    setLegalNotice(initialLegalNotice)
    setIncludeFullCgvInContract(initialIncludeFullCgvInContract)
  }, [initialCgv, initialLegalNotice, initialIncludeFullCgvInContract])

  const handleUseTemplate = (type: 'cgv' | 'legal') => {
    if (type === 'cgv') {
      setCgv(getCgvTemplate(locale))
      setActiveTab('cgv')
    } else {
      setLegalNotice(getLegalNoticeTemplate(locale))
      setActiveTab('legal')
    }
    toastManager.add({ title: t('templateApplied'), type: 'success' })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    try {
      await updateLegalMutation.mutateAsync({
        cgv,
        legalNotice,
        includeFullCgvInContract,
      })

      toastManager.add({ title: t('updated'), type: 'success' })
      router.refresh()
    } catch {
      toastManager.add({ title: tErrors('generic'), type: 'error' })
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
                  <Button type="button" variant="ghost" render={<a href={`https://${store.slug}.${env.NEXT_PUBLIC_APP_DOMAIN}/terms`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1" />}>
                      <ExternalLink className="h-4 w-4" />
                      {t('viewOnStore')}
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
                  <Button type="button" variant="ghost" render={<a href={`https://${store.slug}.${env.NEXT_PUBLIC_APP_DOMAIN}/legal`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1" />}>
                      <ExternalLink className="h-4 w-4" />
                      {t('viewOnStore')}
                  </Button>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('contractPdfSettingsTitle')}</CardTitle>
          <CardDescription>{t('contractPdfSettingsDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="space-y-0.5">
              <p className="text-sm font-medium">{t('includeFullCgvInContract')}</p>
              <p className="text-sm text-muted-foreground">
                {t('includeFullCgvInContractHelp')}
              </p>
            </div>
            <Switch
              checked={includeFullCgvInContract}
              onCheckedChange={setIncludeFullCgvInContract}
            />
          </div>
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

      <FloatingSaveBar
        isDirty={isDirty}
        isLoading={updateLegalMutation.isPending}
        onReset={handleReset}
      />
    </form>
  )
}
