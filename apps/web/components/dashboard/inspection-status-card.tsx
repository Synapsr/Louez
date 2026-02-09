'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import {
  ClipboardCheck,
  ClipboardX,
  ArrowRight,
  Camera,
  CheckCircle2,
  AlertCircle,
  Clock,
  PenLine,
  Download,
  MoreVertical,
  Eye,
} from 'lucide-react'
import { cn } from '@louez/utils'
import { Button } from '@louez/ui'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@louez/ui'
import { Badge } from '@louez/ui'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@louez/ui'
import type { InspectionStatus, InspectionType } from '@louez/types'

interface InspectionData {
  id: string
  type: InspectionType
  status: InspectionStatus
  hasDamage: boolean
  itemCount: number
  photoCount: number
  createdAt: Date
  signedAt?: Date | null
}

interface InspectionStatusCardProps {
  reservationId: string
  reservationStatus: string
  departureInspection?: InspectionData | null
  returnInspection?: InspectionData | null
  inspectionEnabled: boolean
  inspectionMode: 'optional' | 'recommended' | 'required'
  className?: string
}

function getStatusConfig(status: InspectionStatus | null, hasDamage?: boolean) {
  if (!status) {
    return {
      icon: Clock,
      color: 'text-muted-foreground',
      bgColor: 'bg-muted',
      badgeVariant: 'secondary' as const,
    }
  }

  switch (status) {
    case 'draft':
      return {
        icon: Clock,
        color: 'text-amber-600 dark:text-amber-400',
        bgColor: 'bg-amber-50 dark:bg-amber-950/30',
        badgeVariant: 'secondary' as const,
      }
    case 'completed':
      if (hasDamage) {
        return {
          icon: AlertCircle,
          color: 'text-red-600 dark:text-red-400',
          bgColor: 'bg-red-50 dark:bg-red-950/30',
          badgeVariant: 'destructive' as const,
        }
      }
      return {
        icon: CheckCircle2,
        color: 'text-emerald-600 dark:text-emerald-400',
        bgColor: 'bg-emerald-50 dark:bg-emerald-950/30',
        badgeVariant: 'default' as const,
      }
    case 'signed':
      if (hasDamage) {
        return {
          icon: AlertCircle,
          color: 'text-red-600 dark:text-red-400',
          bgColor: 'bg-red-50 dark:bg-red-950/30',
          badgeVariant: 'destructive' as const,
        }
      }
      return {
        icon: PenLine,
        color: 'text-emerald-600 dark:text-emerald-400',
        bgColor: 'bg-emerald-50 dark:bg-emerald-950/30',
        badgeVariant: 'default' as const,
      }
    default:
      return {
        icon: ClipboardX,
        color: 'text-muted-foreground',
        bgColor: 'bg-muted',
        badgeVariant: 'secondary' as const,
      }
  }
}

function InspectionSlot({
  type,
  inspection,
  reservationId,
  reservationStatus,
  canStart,
}: {
  type: InspectionType
  inspection?: InspectionData | null
  reservationId: string
  reservationStatus: string
  canStart: boolean
}) {
  const t = useTranslations('dashboard.settings.inspection')

  const status = inspection?.status || null
  const config = getStatusConfig(status, inspection?.hasDamage)
  const Icon = config.icon

  const showStartButton =
    canStart &&
    !inspection &&
    ((type === 'departure' && reservationStatus === 'confirmed') ||
      (type === 'return' && reservationStatus === 'ongoing'))

  const showViewButton = !!inspection

  return (
    <div
      className={cn(
        'flex items-center justify-between rounded-xl border p-4',
        inspection && config.bgColor
      )}
    >
      <div className="flex items-center gap-3">
        <div
          className={cn(
            'flex h-10 w-10 items-center justify-center rounded-full',
            inspection ? config.bgColor : 'bg-muted'
          )}
        >
          <Icon
            className={cn(
              'h-5 w-5',
              inspection ? config.color : 'text-muted-foreground'
            )}
          />
        </div>
        <div>
          <p className="font-medium">{t(`types.${type}`)}</p>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            {inspection ? (
              <>
                <Badge variant={config.badgeVariant} className="text-xs">
                  {t(`status.${inspection.status}`)}
                </Badge>
                {inspection.photoCount > 0 && (
                  <span className="flex items-center gap-1">
                    <Camera className="h-3 w-3" />
                    {inspection.photoCount}
                  </span>
                )}
              </>
            ) : (
              <span>{t('status.notStarted')}</span>
            )}
          </div>
        </div>
      </div>

      {showStartButton && (
        <Button size="sm" render={<Link href={`/dashboard/reservations/${reservationId}/inspection/${type}`} />}>
            {t('card.start')}
            <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      )}

      {showViewButton && (
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" render={<Link href={`/dashboard/reservations/${reservationId}/inspection/${type}`} />}>
              {t('card.view')}
          </Button>
          {(inspection?.status === 'completed' || inspection?.status === 'signed') && (
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="h-8 w-8" />}>
                  <MoreVertical className="h-4 w-4" />
                  <span className="sr-only">{t('card.moreActions')}</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem render={<a href={`/api/inspections/${inspection.id}/report`} download className="flex items-center" />}>
                    <Download className="mr-2 h-4 w-4" />
                    {t('card.downloadPdf')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )}
    </div>
  )
}

export function InspectionStatusCard({
  reservationId,
  reservationStatus,
  departureInspection,
  returnInspection,
  inspectionEnabled,
  inspectionMode,
  className,
}: InspectionStatusCardProps) {
  const t = useTranslations('dashboard.settings.inspection')

  // Don't show if inspections are disabled
  if (!inspectionEnabled) {
    return null
  }

  // Determine if we should show the card based on status
  const showCard =
    ['confirmed', 'ongoing', 'completed'].includes(reservationStatus) ||
    departureInspection ||
    returnInspection

  if (!showCard) {
    return null
  }

  const hasAnyInspection = departureInspection || returnInspection
  const hasBothInspections = departureInspection && returnInspection
  const showCompareButton =
    hasBothInspections &&
    departureInspection.status !== 'draft' &&
    returnInspection.status !== 'draft'

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">{t('card.title')}</CardTitle>
          </div>
          {inspectionMode !== 'optional' && (
            <Badge variant="outline" className="text-xs">
              {t(`mode${inspectionMode.charAt(0).toUpperCase() + inspectionMode.slice(1)}`)}
            </Badge>
          )}
        </div>
        {!hasAnyInspection && (
          <CardDescription>
            {reservationStatus === 'confirmed'
              ? t('card.availableAtDeparture')
              : t('description')}
          </CardDescription>
        )}
      </CardHeader>

      <CardContent className="space-y-3">
        <InspectionSlot
          type="departure"
          inspection={departureInspection}
          reservationId={reservationId}
          reservationStatus={reservationStatus}
          canStart={inspectionEnabled}
        />

        <InspectionSlot
          type="return"
          inspection={returnInspection}
          reservationId={reservationId}
          reservationStatus={reservationStatus}
          canStart={inspectionEnabled}
        />

        {showCompareButton && (
          <Button variant="outline" className="w-full" render={<Link href={`/dashboard/reservations/${reservationId}/inspection/compare`} />}>
              {t('card.compare')}
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
