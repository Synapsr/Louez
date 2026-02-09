'use client'

import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import {
  ArrowLeft,
  Download,
  Camera,
  CheckCircle2,
  AlertCircle,
  PenLine,
  Clock,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { cn } from '@louez/utils'
import { Button } from '@louez/ui'
import { Badge } from '@louez/ui'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@louez/ui'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@louez/ui'
import { formatStoreDate } from '@/lib/utils/store-date'
import { useStoreTimezone } from '@/contexts/store-context'
import type { ConditionRating, InspectionStatus, InspectionType } from '@louez/types'

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

interface InspectionViewProps {
  inspection: {
    id: string
    type: InspectionType
    status: InspectionStatus
    hasDamage: boolean
    notes: string | null
    performedByName: string | null
    createdAt: Date
    signedAt: Date | null
    customerSignature: string | null
    items: InspectionItem[]
  }
  reservationId: string
  reservationNumber: string
  customerName: string
}

const conditionColors: Record<ConditionRating, string> = {
  excellent: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  good: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  fair: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  damaged: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
}

const statusConfig: Record<InspectionStatus, { icon: typeof CheckCircle2; color: string }> = {
  draft: { icon: Clock, color: 'text-amber-600' },
  completed: { icon: CheckCircle2, color: 'text-emerald-600' },
  signed: { icon: PenLine, color: 'text-emerald-600' },
}

export function InspectionView({
  inspection,
  reservationId,
  reservationNumber,
  customerName,
}: InspectionViewProps) {
  const router = useRouter()
  const t = useTranslations('dashboard.settings.inspection')
  const timezone = useStoreTimezone()
  const [previewPhoto, setPreviewPhoto] = useState<InspectionPhoto | null>(null)

  const StatusIcon = statusConfig[inspection.status].icon
  const totalPhotos = inspection.items.reduce((sum, item) => sum + item.photos.length, 0)

  return (
    <div className="-mx-4 -mt-6 -mb-6 sm:-mx-6 lg:-mx-8 flex min-h-[calc(100dvh-3.5rem)] flex-col lg:min-h-dvh">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto max-w-2xl px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={() => router.push(`/dashboard/reservations/${reservationId}`)}
              >
                <ArrowLeft className="h-4 w-4" />
                <span className="sr-only">{t('wizard.back')}</span>
              </Button>
              <div>
                <h1 className="text-sm font-semibold">
                  {t(`wizard.${inspection.type}Inspection`)}
                </h1>
                <p className="text-xs text-muted-foreground">
                  {t('wizard.reservation')} #{reservationNumber}
                </p>
              </div>
            </div>
            <Button variant="outline" size="sm" render={<a href={`/api/inspections/${inspection.id}/report`} download />}>
                <Download className="mr-2 h-4 w-4" />
                {t('card.downloadPdf')}
            </Button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6 lg:px-8 space-y-6">
          {/* Status Card */}
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className={cn(
                      'flex h-10 w-10 items-center justify-center rounded-full',
                      inspection.hasDamage
                        ? 'bg-red-100 dark:bg-red-900/30'
                        : 'bg-emerald-100 dark:bg-emerald-900/30'
                    )}
                  >
                    {inspection.hasDamage ? (
                      <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
                    ) : (
                      <StatusIcon
                        className={cn('h-5 w-5', statusConfig[inspection.status].color)}
                      />
                    )}
                  </div>
                  <div>
                    <p className="font-medium">
                      {inspection.hasDamage
                        ? t('wizard.damageDetected')
                        : t(`status.${inspection.status}`)}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {formatStoreDate(new Date(inspection.createdAt), timezone, 'DATE_AT_TIME')}
                    </p>
                  </div>
                </div>
                <Badge
                  variant={inspection.hasDamage ? 'error' : 'default'}
                  className="ml-auto"
                >
                  {t(`status.${inspection.status}`)}
                </Badge>
              </div>
            </CardContent>
          </Card>

          {/* Summary Stats */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border p-3 text-center">
              <p className="text-2xl font-bold text-primary">{inspection.items.length}</p>
              <p className="text-xs text-muted-foreground">{t('summary.totalItems')}</p>
            </div>
            <div className="rounded-xl border p-3 text-center">
              <p className="text-2xl font-bold text-primary">{totalPhotos}</p>
              <p className="text-xs text-muted-foreground">{t('summary.photos')}</p>
            </div>
            <div
              className={cn(
                'rounded-xl border p-3 text-center',
                inspection.hasDamage && 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/30'
              )}
            >
              <p
                className={cn(
                  'text-2xl font-bold',
                  inspection.hasDamage ? 'text-red-600' : 'text-emerald-600'
                )}
              >
                {inspection.hasDamage ? '!' : '✓'}
              </p>
              <p
                className={cn(
                  'text-xs',
                  inspection.hasDamage ? 'text-red-600' : 'text-muted-foreground'
                )}
              >
                {inspection.hasDamage ? t('summary.damageDetected') : t('summary.noDamage')}
              </p>
            </div>
          </div>

          {/* Details */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{t('sections.inspectionDetails')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">{t('parties.customer')}</p>
                  <p className="font-medium">{customerName}</p>
                </div>
                {inspection.performedByName && (
                  <div>
                    <p className="text-muted-foreground">{t('period.performedBy')}</p>
                    <p className="font-medium">{inspection.performedByName}</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Items */}
          <div className="space-y-3">
            <h3 className="font-semibold">{t('sections.equipment')}</h3>
            {inspection.items.map((item) => (
              <Card key={item.id}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-medium">{item.productName}</span>
                    <Badge className={conditionColors[item.condition]}>
                      {t(`conditions.${item.condition}`)}
                    </Badge>
                  </div>

                  {item.notes && (
                    <p className="text-sm text-muted-foreground mb-3">{item.notes}</p>
                  )}

                  {item.photos.length > 0 && (
                    <div className="grid grid-cols-4 gap-2">
                      {item.photos.map((photo) => (
                        <button
                          key={photo.id}
                          type="button"
                          onClick={() => setPreviewPhoto(photo)}
                          className="aspect-square rounded-lg overflow-hidden border hover:ring-2 hover:ring-primary transition-all"
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
                      <Camera className="h-3 w-3" />
                      {t('comparison.noPhotos')}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Global Notes */}
          {inspection.notes && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{t('sections.notes')}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm">{inspection.notes}</p>
              </CardContent>
            </Card>
          )}

          {/* Signature */}
          {inspection.customerSignature && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{t('sections.signature')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="rounded-lg border bg-white p-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={inspection.customerSignature}
                    alt="Signature"
                    className="max-h-24 mx-auto"
                  />
                </div>
                {inspection.signedAt && (
                  <p className="text-xs text-muted-foreground text-center">
                    {t('signature.signedAt')}:{' '}
                    {formatStoreDate(new Date(inspection.signedAt), timezone, "d MMM yyyy 'à' HH:mm:ss")}
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </div>
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
