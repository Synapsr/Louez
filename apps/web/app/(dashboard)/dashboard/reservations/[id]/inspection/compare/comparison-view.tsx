'use client'

import { useState } from 'react'
import Link from 'next/link'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { useTranslations } from 'next-intl'
import {
  ArrowLeft,
  CheckCircle,
  AlertTriangle,
  FileText,
  ImageIcon,
  ChevronLeft,
  ChevronRight,
  X,
} from 'lucide-react'
import { cn } from '@louez/utils'
import { Button } from '@louez/ui'
import { Badge } from '@louez/ui'
import { Card, CardContent, CardHeader, CardTitle } from '@louez/ui'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@louez/ui'
import type { ConditionRating } from '@louez/types'

interface InspectionPhoto {
  id: string
  url: string
  thumbnailUrl: string | null
  caption: string | null
}

interface InspectionItem {
  id: string
  productName: string
  condition: ConditionRating
  notes: string | null
  photos: InspectionPhoto[]
}

interface InspectionData {
  id: string
  type: 'departure' | 'return'
  status: 'draft' | 'completed' | 'signed'
  hasDamage: boolean
  notes: string | null
  createdAt: Date
  signedAt: Date | null
  hasSignature: boolean
  items: InspectionItem[]
}

interface ComparisonViewProps {
  reservationId: string
  reservationNumber: string
  customerName: string
  departure: InspectionData | null
  return_: InspectionData | null
}

const conditionColors: Record<ConditionRating, string> = {
  excellent: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  good: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  fair: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  damaged: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
}

export function ComparisonView({
  reservationId,
  reservationNumber,
  customerName,
  departure,
  return_,
}: ComparisonViewProps) {
  const t = useTranslations('dashboard.settings.inspection')
  const [activeTab, setActiveTab] = useState<'departure' | 'return'>(
    departure ? 'departure' : 'return'
  )
  const [previewPhoto, setPreviewPhoto] = useState<InspectionPhoto | null>(null)

  // Find condition changes between departure and return
  const getConditionChanges = () => {
    if (!departure || !return_) return []

    const changes: Array<{
      productName: string
      departureCondition: ConditionRating
      returnCondition: ConditionRating
    }> = []

    for (const returnItem of return_.items) {
      const departureItem = departure.items.find(
        (d) => d.productName === returnItem.productName
      )
      if (departureItem && departureItem.condition !== returnItem.condition) {
        changes.push({
          productName: returnItem.productName,
          departureCondition: departureItem.condition,
          returnCondition: returnItem.condition,
        })
      }
    }

    return changes
  }

  const conditionChanges = getConditionChanges()
  const hasChanges = conditionChanges.length > 0 || return_?.hasDamage

  const renderInspectionCard = (inspection: InspectionData | null, type: 'departure' | 'return') => {
    if (!inspection) {
      return (
        <Card className="h-full">
          <CardContent className="flex flex-col items-center justify-center h-64 text-center">
            <FileText className="h-12 w-12 text-muted-foreground/30 mb-4" />
            <p className="text-sm text-muted-foreground">
              {type === 'departure'
                ? t('comparison.noDepartureInspection')
                : t('comparison.noReturnInspection')}
            </p>
          </CardContent>
        </Card>
      )
    }

    return (
      <Card className="h-full">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">
              {type === 'departure' ? t('comparison.departure') : t('comparison.return')}
            </CardTitle>
            <Badge
              variant="secondary"
              className={cn(
                inspection.status === 'signed' && 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
                inspection.hasDamage && 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
              )}
            >
              {inspection.hasDamage
                ? t('wizard.damageDetected')
                : t(`status.${inspection.status}`)}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {format(new Date(inspection.createdAt), "d MMM yyyy 'à' HH:mm", { locale: fr })}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {inspection.items.map((item) => {
            const hasConditionChange = type === 'return' && departure &&
              departure.items.find(d => d.productName === item.productName)?.condition !== item.condition

            return (
              <div
                key={item.id}
                className={cn(
                  'p-3 rounded-lg border',
                  hasConditionChange && 'border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20'
                )}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-sm">{item.productName}</span>
                  <Badge className={conditionColors[item.condition]}>
                    {t(`conditions.${item.condition}`)}
                  </Badge>
                </div>

                {hasConditionChange && (
                  <div className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 mb-2">
                    <AlertTriangle className="h-3 w-3" />
                    {t('comparison.conditionChanged')}
                  </div>
                )}

                {item.notes && (
                  <p className="text-xs text-muted-foreground mb-2">{item.notes}</p>
                )}

                {item.photos.length > 0 && (
                  <div className="grid grid-cols-4 gap-1.5">
                    {item.photos.map((photo) => (
                      <button
                        key={photo.id}
                        type="button"
                        onClick={() => setPreviewPhoto(photo)}
                        className="aspect-square rounded-md overflow-hidden border hover:ring-2 hover:ring-primary transition-all"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={photo.thumbnailUrl || photo.url}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      </button>
                    ))}
                  </div>
                )}

                {item.photos.length === 0 && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <ImageIcon className="h-3 w-3" />
                    {t('comparison.noPhotos')}
                  </div>
                )}
              </div>
            )
          })}

          {inspection.notes && (
            <div className="p-3 rounded-lg bg-muted/50">
              <p className="text-xs font-medium mb-1">{t('wizard.globalNotes')}</p>
              <p className="text-xs text-muted-foreground">{inspection.notes}</p>
            </div>
          )}

          {inspection.hasSignature && (
            <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400">
              <CheckCircle className="h-3.5 w-3.5" />
              {t('wizard.signatureComplete')}
            </div>
          )}
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href={`/dashboard/reservations/${reservationId}`}>
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-xl font-semibold">{t('comparison.title')}</h1>
            <p className="text-sm text-muted-foreground">
              {t('wizard.reservation')} #{reservationNumber} • {customerName}
            </p>
          </div>
        </div>
      </div>

      {/* Changes Summary */}
      {hasChanges && (
        <Card className="border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              <span className="font-medium text-amber-800 dark:text-amber-300">
                {t('comparison.changes')}
              </span>
            </div>
            {conditionChanges.length > 0 && (
              <ul className="mt-2 space-y-1">
                {conditionChanges.map((change, i) => (
                  <li key={i} className="text-sm text-amber-700 dark:text-amber-400">
                    {change.productName}: {t(`conditions.${change.departureCondition}`)} → {t(`conditions.${change.returnCondition}`)}
                  </li>
                ))}
              </ul>
            )}
            {return_?.hasDamage && (
              <p className="mt-2 text-sm text-red-600 dark:text-red-400">
                {t('wizard.damageDetected')}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Desktop: Side by Side */}
      <div className="hidden md:grid md:grid-cols-2 gap-6">
        {renderInspectionCard(departure, 'departure')}
        {renderInspectionCard(return_, 'return')}
      </div>

      {/* Mobile: Tabs */}
      <div className="md:hidden space-y-4">
        <div className="flex items-center justify-center gap-2 p-1 bg-muted rounded-lg">
          <button
            onClick={() => setActiveTab('departure')}
            className={cn(
              'flex-1 py-2 px-4 text-sm font-medium rounded-md transition-colors',
              activeTab === 'departure'
                ? 'bg-background shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {t('comparison.departure')}
          </button>
          <button
            onClick={() => setActiveTab('return')}
            className={cn(
              'flex-1 py-2 px-4 text-sm font-medium rounded-md transition-colors',
              activeTab === 'return'
                ? 'bg-background shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {t('comparison.return')}
          </button>
        </div>

        {/* Swipe hint */}
        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <ChevronLeft className="h-3 w-3" />
          {t('comparison.swipeHint')}
          <ChevronRight className="h-3 w-3" />
        </div>

        {activeTab === 'departure' && renderInspectionCard(departure, 'departure')}
        {activeTab === 'return' && renderInspectionCard(return_, 'return')}
      </div>

      {/* Photo Preview Dialog */}
      <Dialog open={!!previewPhoto} onOpenChange={() => setPreviewPhoto(null)}>
        <DialogContent className="max-w-2xl p-0">
          <DialogHeader className="sr-only">
            <DialogTitle>{t('wizard.photoPreview')}</DialogTitle>
          </DialogHeader>
          {previewPhoto && (
            <div className="relative">
              <div className="relative aspect-[4/3] w-full bg-black">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={previewPhoto.url}
                  alt=""
                  className="h-full w-full object-contain"
                />
              </div>
              {previewPhoto.caption && (
                <div className="p-4 bg-background">
                  <p className="text-sm text-muted-foreground">{previewPhoto.caption}</p>
                </div>
              )}
              <button
                type="button"
                onClick={() => setPreviewPhoto(null)}
                className="absolute right-4 top-4 rounded-full bg-black/50 p-2 text-white transition-colors hover:bg-black/70"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
