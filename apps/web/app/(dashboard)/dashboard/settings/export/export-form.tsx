'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Download, Receipt, CalendarRange, Package } from 'lucide-react'

import { Button } from '@louez/ui'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@louez/ui'
import { RadioGroup, RadioGroupItem } from '@louez/ui'
import { Label } from '@louez/ui'
import { toastManager } from '@louez/ui'
import { DateTimePicker } from '@/components/ui/date-time-picker'
import type { ExportFormat, ExportType } from '@/lib/export/types'

interface ExportFormProps {
  storeSlug: string
}

export function ExportForm({ storeSlug }: ExportFormProps) {
  const t = useTranslations('dashboard.settings.export')

  return (
    <div className="space-y-6">
      <ExportCard
        type="payments"
        icon={Receipt}
        title={t('payments.title')}
        description={t('payments.description')}
        buttonLabel={t('payments.button')}
        storeSlug={storeSlug}
        showDateRange
      />

      <ExportCard
        type="reservations"
        icon={CalendarRange}
        title={t('reservations.title')}
        description={t('reservations.description')}
        buttonLabel={t('reservations.button')}
        storeSlug={storeSlug}
        showDateRange
      />

      <ExportCard
        type="products"
        icon={Package}
        title={t('products.title')}
        description={t('products.description')}
        buttonLabel={t('products.button')}
        storeSlug={storeSlug}
        showDateRange={false}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// ExportCard
// ---------------------------------------------------------------------------

interface ExportCardProps {
  type: ExportType
  icon: React.ElementType
  title: string
  description: string
  buttonLabel: string
  storeSlug: string
  showDateRange: boolean
}

function ExportCard({
  type,
  icon: Icon,
  title,
  description,
  buttonLabel,
  showDateRange,
}: ExportCardProps) {
  const t = useTranslations('dashboard.settings.export')
  const [format, setFormat] = useState<ExportFormat>('csv')
  const [startDate, setStartDate] = useState<Date | undefined>(undefined)
  const [endDate, setEndDate] = useState<Date | undefined>(undefined)
  const [isExporting, setIsExporting] = useState(false)

  const handleExport = async () => {
    if (showDateRange && (!startDate || !endDate)) {
      toastManager.add({ title: t('errors.dateRequired'), type: 'error' })
      return
    }

    if (showDateRange && startDate && endDate && endDate < startDate) {
      toastManager.add({ title: t('errors.invalidDateRange'), type: 'error' })
      return
    }

    if (showDateRange && startDate && endDate) {
      const diffMs = endDate.getTime() - startDate.getTime()
      const oneYearMs = 365 * 24 * 60 * 60 * 1000
      if (diffMs > oneYearMs) {
        toastManager.add({ title: t('errors.maxRange'), type: 'error' })
        return
      }
    }

    setIsExporting(true)

    try {
      const params = new URLSearchParams({ type, format })
      if (startDate) params.set('startDate', startDate.toISOString())
      if (endDate) params.set('endDate', endDate.toISOString())

      const response = await fetch(`/api/export?${params.toString()}`)

      if (!response.ok) {
        throw new Error(response.statusText)
      }

      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download =
        response.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] ??
        `export.${format}`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch {
      toastManager.add({ title: t('errors.exportFailed'), type: 'error' })
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <div>
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {showDateRange && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-xs">{t('dateRange.startDate')}</Label>
              <DateTimePicker
                date={startDate}
                setDate={setStartDate}
                showTime={false}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">{t('dateRange.endDate')}</Label>
              <DateTimePicker
                date={endDate}
                setDate={setEndDate}
                showTime={false}
              />
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-4">
          <div className="space-y-2">
            <Label className="text-xs">{t('format.label')}</Label>
            <RadioGroup
              value={format}
              onValueChange={(value) => setFormat(value as ExportFormat)}
              className="flex gap-4"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="csv" id={`${type}-csv`} />
                <Label htmlFor={`${type}-csv`} className="cursor-pointer font-normal">
                  {t('format.csv')}
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="json" id={`${type}-json`} />
                <Label htmlFor={`${type}-json`} className="cursor-pointer font-normal">
                  {t('format.json')}
                </Label>
              </div>
            </RadioGroup>
          </div>

          <Button onClick={handleExport} disabled={isExporting} className="shrink-0">
            <Download className="mr-2 h-4 w-4" />
            {isExporting ? t('exporting') : buttonLabel}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
