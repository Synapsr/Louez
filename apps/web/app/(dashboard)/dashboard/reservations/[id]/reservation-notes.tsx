'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toastManager } from '@louez/ui'
import { useTranslations } from 'next-intl'

import { Button } from '@louez/ui'
import { Textarea } from '@louez/ui'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@louez/ui'

import { updateReservationNotes } from '../actions'

interface ReservationNotesProps {
  reservationId: string
  initialNotes: string
}

export function ReservationNotes({
  reservationId,
  initialNotes,
}: ReservationNotesProps) {
  const t = useTranslations('dashboard.reservations')
  const tCommon = useTranslations('common')
  const [notes, setNotes] = useState(initialNotes)
  const [isLoading, setIsLoading] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)

  const handleChange = (value: string) => {
    setNotes(value)
    setHasChanges(value !== initialNotes)
  }

  const handleSave = async () => {
    setIsLoading(true)
    try {
      const result = await updateReservationNotes(reservationId, notes)
      if (result.error) {
        toastManager.add({ title: t(result.error, type: 'error' }))
      } else {
        toastManager.add({ title: t('notes.saved'), type: 'success' })
        setHasChanges(false)
      }
    } catch {
      toastManager.add({ title: t('notes.error'), type: 'error' })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t('notes.title')}</CardTitle>
        <CardDescription>
          {t('notes.description')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea
          value={notes}
          onChange={(e) => handleChange(e.target.value)}
          placeholder={t('notes.placeholder')}
          className="min-h-[100px] resize-none"
        />
        {hasChanges && (
          <Button
            onClick={handleSave}
            disabled={isLoading}
            size="sm"
            className="w-full"
          >
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {tCommon('save')}
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
