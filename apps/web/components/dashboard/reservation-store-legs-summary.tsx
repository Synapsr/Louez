'use client'

import { Store } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Button } from '@louez/ui'

import {
  isSameStoreLegLocation,
  type StoreLegLocation,
} from './util.reservation-store-legs'

interface ReservationStoreLegsSummaryProps {
  pickupLocation: StoreLegLocation
  returnLocation: StoreLegLocation
  onEdit?: () => void
}

export const ReservationStoreLegsSummary = ({
  pickupLocation,
  returnLocation,
  onEdit,
}: ReservationStoreLegsSummaryProps) => {
  const t = useTranslations('dashboard.reservations.storeLegsSummary')
  const isSameLocation = isSameStoreLegLocation(pickupLocation, returnLocation)

  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-2">
        <Store className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        {isSameLocation ? (
          <div className="min-w-0">
            <p className="text-sm font-medium">{t('sameLocation')}</p>
            <p className="break-words text-xs text-muted-foreground">
              {[pickupLocation.name, pickupLocation.address].filter(Boolean).join(' · ')}
            </p>
          </div>
        ) : (
          <div className="min-w-0 space-y-1 text-sm">
            <p className="break-words">
              <span className="font-medium">{t('pickup')}</span>
              <span className="text-muted-foreground">
                {' · '}
                {[pickupLocation.name, pickupLocation.address].filter(Boolean).join(', ')}
              </span>
            </p>
            <p className="break-words">
              <span className="font-medium">{t('return')}</span>
              <span className="text-muted-foreground">
                {' · '}
                {[returnLocation.name, returnLocation.address].filter(Boolean).join(', ')}
              </span>
            </p>
          </div>
        )}
      </div>
      {onEdit && (
        <Button type="button" variant="outline" size="sm" onClick={onEdit}>
          {t('edit')}
        </Button>
      )}
    </div>
  )
}
