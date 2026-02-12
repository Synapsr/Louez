'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toastManager } from '@louez/ui'
import { useTranslations } from 'next-intl'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { Button } from '@louez/ui'
import { Textarea } from '@louez/ui'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@louez/ui'

import { orpc } from '@/lib/orpc/react'
import { invalidateReservationAll } from '@/lib/orpc/invalidation'

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
  const queryClient = useQueryClient()

  useEffect(() => {
    // Keep in sync with server updates unless the user has unsaved edits.
    if (!hasChanges) {
      setNotes(initialNotes)
    }
  }, [initialNotes, hasChanges])

  const updateNotesMutation = useMutation(
    orpc.dashboard.reservations.updateNotes.mutationOptions({
      onMutate: async (input) => {
        await queryClient.cancelQueries({
          queryKey: orpc.dashboard.reservations.getById.key({
            input: { reservationId: input.reservationId },
          }),
        })

        const previous = queryClient.getQueryData(
          orpc.dashboard.reservations.getById.key({
            input: { reservationId: input.reservationId },
          }),
        )

        queryClient.setQueryData(
          orpc.dashboard.reservations.getById.key({
            input: { reservationId: input.reservationId },
          }),
          (current: any) =>
            current ? { ...current, internalNotes: input.notes } : current,
        )

        return { previous }
      },
      onError: (_error, input, ctx) => {
        if (ctx?.previous) {
          queryClient.setQueryData(
            orpc.dashboard.reservations.getById.key({
              input: { reservationId: input.reservationId },
            }),
            ctx.previous,
          )
        }
      },
      onSuccess: async (_result, input) => {
        setHasChanges(false)
        await invalidateReservationAll(queryClient, input.reservationId)
      },
    }),
  )

  const handleChange = (value: string) => {
    setNotes(value)
    setHasChanges(value !== initialNotes)
  }

  const handleSave = async () => {
    setIsLoading(true)
    try {
      await updateNotesMutation.mutateAsync({ reservationId, notes })
      toastManager.add({ title: t('notes.saved'), type: 'success' })
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
