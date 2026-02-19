'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Loader2 } from 'lucide-react'

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  toastManager,
} from '@louez/ui'

import { invalidateReservationAll } from '@/lib/orpc/invalidation'
import { orpc } from '@/lib/orpc/react'
import type { Reservation, ReservationStatus } from './reservations-types'

interface UseReservationActionsReturn {
  loadingAction: string | null
  handleStatusChange: (e: React.MouseEvent, reservation: Reservation, newStatus: ReservationStatus) => Promise<void>
  openRejectDialog: (e: React.MouseEvent, reservation: Reservation) => void
  openCancelDialog: (e: React.MouseEvent, reservation: Reservation) => void
  confirmDialogsProps: ConfirmDialogsProps
}

interface ConfirmDialogsProps {
  rejectDialogOpen: boolean
  setRejectDialogOpen: (open: boolean) => void
  cancelDialogOpen: boolean
  setCancelDialogOpen: (open: boolean) => void
  handleReject: () => Promise<void>
  handleCancel: () => Promise<void>
  loadingAction: string | null
}

export function useReservationActions(): UseReservationActionsReturn {
  const t = useTranslations('dashboard.reservations')
  const tCommon = useTranslations('common')
  const tErrors = useTranslations('errors')
  const queryClient = useQueryClient()

  const [loadingAction, setLoadingAction] = useState<string | null>(null)
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false)
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false)
  const [selectedReservation, setSelectedReservation] = useState<Reservation | null>(null)

  const updateStatusMutation = useMutation(
    orpc.dashboard.reservations.updateStatus.mutationOptions({
      onMutate: async (input) => {
        await queryClient.cancelQueries({
          queryKey: orpc.dashboard.reservations.list.key(),
        })

        const previous = queryClient.getQueriesData({
          queryKey: orpc.dashboard.reservations.list.key(),
        })

        queryClient.setQueriesData(
          { queryKey: orpc.dashboard.reservations.list.key() },
          (current: any) => {
            if (!current?.reservations) return current
            return {
              ...current,
              reservations: current.reservations.map((r: Reservation) =>
                r.id === input.reservationId ? { ...r, status: input.status } : r,
              ),
            }
          },
        )

        return { previous }
      },
      onError: (_error, _input, ctx) => {
        if (ctx?.previous) {
          for (const [key, data] of ctx.previous) {
            queryClient.setQueryData(key, data)
          }
        }
      },
    }),
  )

  const cancelMutation = useMutation(
    orpc.dashboard.reservations.cancel.mutationOptions({
      onMutate: async (input) => {
        await queryClient.cancelQueries({
          queryKey: orpc.dashboard.reservations.list.key(),
        })

        const previous = queryClient.getQueriesData({
          queryKey: orpc.dashboard.reservations.list.key(),
        })

        queryClient.setQueriesData(
          { queryKey: orpc.dashboard.reservations.list.key() },
          (current: any) => {
            if (!current?.reservations) return current
            return {
              ...current,
              reservations: current.reservations.map((r: Reservation) =>
                r.id === input.reservationId ? { ...r, status: 'cancelled' } : r,
              ),
            }
          },
        )

        return { previous }
      },
      onError: (_error, _input, ctx) => {
        if (ctx?.previous) {
          for (const [key, data] of ctx.previous) {
            queryClient.setQueryData(key, data)
          }
        }
      },
    }),
  )

  const handleStatusChange = async (
    e: React.MouseEvent,
    reservation: Reservation,
    newStatus: ReservationStatus
  ) => {
    e.preventDefault()
    e.stopPropagation()

    setLoadingAction(`${reservation.id}-${newStatus}`)
    try {
      const result = await updateStatusMutation.mutateAsync({
        reservationId: reservation.id,
        status: newStatus,
      })

      const warnings = result && typeof result === 'object' && 'warnings' in result ? (result as any).warnings : undefined
      if (warnings && warnings.length > 0) {
        const warningMessage = warnings
          .map((warning: { key: string; params?: Record<string, string | number> }) => {
            const key = warning.key.replace('errors.', '')
            return tErrors(key, warning.params || {})
          })
          .join(' • ')
        toastManager.add({ title: warningMessage, type: 'warning' })
      }

      toastManager.add({ title: t('statusUpdated'), type: 'success' })
      await invalidateReservationAll(queryClient, reservation.id)
    } catch {
      toastManager.add({ title: tErrors('generic'), type: 'error' })
    } finally {
      setLoadingAction(null)
    }
  }

  const handleReject = async () => {
    if (!selectedReservation) return

    setLoadingAction(`${selectedReservation.id}-reject`)
    try {
      const result = await updateStatusMutation.mutateAsync({
        reservationId: selectedReservation.id,
        status: 'rejected',
      })

      const warnings = result && typeof result === 'object' && 'warnings' in result ? (result as any).warnings : undefined
      if (warnings && warnings.length > 0) {
        const warningMessage = warnings
          .map((warning: { key: string; params?: Record<string, string | number> }) => {
            const key = warning.key.replace('errors.', '')
            return tErrors(key, warning.params || {})
          })
          .join(' • ')
        toastManager.add({ title: warningMessage, type: 'warning' })
      }

      toastManager.add({ title: t('reservationRejected'), type: 'success' })
      await invalidateReservationAll(queryClient, selectedReservation.id)
    } catch {
      toastManager.add({ title: tErrors('generic'), type: 'error' })
    } finally {
      setLoadingAction(null)
      setRejectDialogOpen(false)
      setSelectedReservation(null)
    }
  }

  const handleCancel = async () => {
    if (!selectedReservation) return

    setLoadingAction(`${selectedReservation.id}-cancel`)
    try {
      await cancelMutation.mutateAsync({ reservationId: selectedReservation.id })
      toastManager.add({ title: t('reservationCancelled'), type: 'success' })
      await invalidateReservationAll(queryClient, selectedReservation.id)
    } catch {
      toastManager.add({ title: tErrors('generic'), type: 'error' })
    } finally {
      setLoadingAction(null)
      setCancelDialogOpen(false)
      setSelectedReservation(null)
    }
  }

  const openRejectDialog = (e: React.MouseEvent, reservation: Reservation) => {
    e.preventDefault()
    e.stopPropagation()
    setSelectedReservation(reservation)
    setRejectDialogOpen(true)
  }

  const openCancelDialog = (e: React.MouseEvent, reservation: Reservation) => {
    e.preventDefault()
    e.stopPropagation()
    setSelectedReservation(reservation)
    setCancelDialogOpen(true)
  }

  return {
    loadingAction,
    handleStatusChange,
    openRejectDialog,
    openCancelDialog,
    confirmDialogsProps: {
      rejectDialogOpen,
      setRejectDialogOpen,
      cancelDialogOpen,
      setCancelDialogOpen,
      handleReject,
      handleCancel,
      loadingAction,
    },
  }
}

export function ReservationConfirmDialogs({
  rejectDialogOpen,
  setRejectDialogOpen,
  cancelDialogOpen,
  setCancelDialogOpen,
  handleReject,
  handleCancel,
  loadingAction,
}: ConfirmDialogsProps) {
  const t = useTranslations('dashboard.reservations')
  const tCommon = useTranslations('common')

  return (
    <>
      {/* Reject Dialog */}
      <AlertDialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('rejectConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('rejectConfirmDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>{tCommon('back')}</AlertDialogClose>
            <AlertDialogClose
              render={<Button variant="destructive" />}
              onClick={handleReject}
            >
              {loadingAction?.includes('reject') ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              {t('rejectRequest')}
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cancel Dialog */}
      <AlertDialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('cancelConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('cancelConfirmDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>{tCommon('back')}</AlertDialogClose>
            <AlertDialogClose
              render={<Button variant="destructive" />}
              onClick={handleCancel}
            >
              {loadingAction?.includes('cancel') ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              {t('cancelReservation')}
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
