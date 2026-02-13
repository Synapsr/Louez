import {
  dashboardReservationPollInputSchema,
  dashboardReservationAssignUnitsInputSchema,
  dashboardReservationCancelInputSchema,
  dashboardReservationGetAvailableUnitsInputSchema,
  dashboardReservationGetByIdInputSchema,
  dashboardReservationGetPaymentMethodInputSchema,
  dashboardReservationRequestPaymentInputSchema,
  dashboardReservationsListInputSchema,
  reservationSignInputSchema,
  dashboardReservationUpdateNotesInputSchema,
  dashboardReservationUpdateStatusInputSchema,
  dashboardReservationCreateManualReservationInputSchema,
  dashboardReservationUpdateReservationInputSchema,
  dashboardReservationRecordPaymentInputSchema,
  dashboardReservationDeletePaymentInputSchema,
  dashboardReservationReturnDepositInputSchema,
  dashboardReservationRecordDamageInputSchema,
  dashboardReservationCreateDepositHoldInputSchema,
  dashboardReservationCaptureDepositHoldInputSchema,
  dashboardReservationReleaseDepositHoldInputSchema,
  dashboardReservationSendReservationEmailInputSchema,
  dashboardReservationSendAccessLinkInputSchema,
  dashboardReservationSendAccessLinkSmsInputSchema,
} from '@louez/validations'
import { dashboardProcedure, requirePermission } from '../../procedures'
import {
  getDashboardReservationById,
  getDashboardReservationsList,
  getReservationPollData,
  signReservationAsAdmin,
} from '../../services'
import { toORPCError } from '../../utils/orpc-error'
import { db, reservations } from '@louez/db'
import { and, eq } from 'drizzle-orm'
import { ORPCError } from '@orpc/server'

function toDate(value: string | Date | undefined): Date | undefined {
  if (!value) return undefined
  return value instanceof Date ? value : new Date(value)
}

const poll = dashboardProcedure
  .input(dashboardReservationPollInputSchema)
  .handler(async ({ context }) => {
    try {
      return await getReservationPollData({
        storeId: context.store.id,
      })
    } catch (error) {
      throw toORPCError(error)
    }
  })

const list = dashboardProcedure
  .input(dashboardReservationsListInputSchema)
  .handler(async ({ context, input }) => {
    try {
      return await getDashboardReservationsList({
        storeId: context.store.id,
        status: input.status,
        period: input.period,
        limit: input.limit ?? 100,
      })
    } catch (error) {
      throw toORPCError(error)
    }
  })

const getById = dashboardProcedure
  .input(dashboardReservationGetByIdInputSchema)
  .handler(async ({ context, input }) => {
    try {
      return await getDashboardReservationById({
        reservationId: input.reservationId,
        storeId: context.store.id,
      })
    } catch (error) {
      throw toORPCError(error)
    }
  })

const getPaymentMethod = dashboardProcedure
  .input(dashboardReservationGetPaymentMethodInputSchema)
  .handler(async ({ context, input }) => {
    try {
      const fn = context.dashboardReservationActions?.getReservationPaymentMethod
      if (!fn) {
        throw new ORPCError('INTERNAL_SERVER_ERROR', {
          message: 'dashboardReservationActions.getReservationPaymentMethod not provided',
        })
      }
      return await fn(input.reservationId)
    } catch (error) {
      throw toORPCError(error)
    }
  })

const getAvailableUnitsForItem = dashboardProcedure
  .input(dashboardReservationGetAvailableUnitsInputSchema)
  .handler(async ({ context, input }) => {
    try {
      const fn = context.dashboardReservationActions?.getAvailableUnitsForReservationItem
      if (!fn) {
        throw new ORPCError('INTERNAL_SERVER_ERROR', {
          message: 'dashboardReservationActions.getAvailableUnitsForReservationItem not provided',
        })
      }
      const result = await fn(input.reservationItemId)
      if (result.error) {
        throw new ORPCError('BAD_REQUEST', { message: result.error })
      }
      return { units: result.units || [], assigned: result.assigned || [] }
    } catch (error) {
      throw toORPCError(error)
    }
  })

const createManualReservation = requirePermission('write')
  .input(dashboardReservationCreateManualReservationInputSchema)
  .handler(async ({ context, input }) => {
    try {
      const fn = context.dashboardReservationActions?.createManualReservation
      if (!fn) {
        throw new ORPCError('INTERNAL_SERVER_ERROR', {
          message: 'dashboardReservationActions.createManualReservation not provided',
        })
      }

      const payload = input.payload
      const result = await fn({
        ...payload,
        startDate: toDate(payload.startDate)!,
        endDate: toDate(payload.endDate)!,
      })
      if (result.error) {
        throw new ORPCError('BAD_REQUEST', { message: result.error })
      }
      return result
    } catch (error) {
      throw toORPCError(error)
    }
  })

const updateReservation = requirePermission('write')
  .input(dashboardReservationUpdateReservationInputSchema)
  .handler(async ({ context, input }) => {
    try {
      const fn = context.dashboardReservationActions?.updateReservation
      if (!fn) {
        throw new ORPCError('INTERNAL_SERVER_ERROR', {
          message: 'dashboardReservationActions.updateReservation not provided',
        })
      }

      const payload = input.payload
      const result = await fn(input.reservationId, {
        ...payload,
        startDate: toDate(payload.startDate),
        endDate: toDate(payload.endDate),
      })

      if ('error' in result && result.error) {
        throw new ORPCError('BAD_REQUEST', { message: result.error as string })
      }
      return result
    } catch (error) {
      throw toORPCError(error)
    }
  })

const updateNotes = requirePermission('write')
  .input(dashboardReservationUpdateNotesInputSchema)
  .handler(async ({ context, input }) => {
    try {
      const updatedAt = new Date()
      const result = await db
        .update(reservations)
        .set({ internalNotes: input.notes, updatedAt })
        .where(and(eq(reservations.id, input.reservationId), eq(reservations.storeId, context.store.id)))

      // Drizzle update() return type varies; existence is validated by follow-up read in UI invalidation.
      void result
      return { success: true as const }
    } catch (error) {
      throw toORPCError(error)
    }
  })

const updateStatus = requirePermission('write')
  .input(dashboardReservationUpdateStatusInputSchema)
  .handler(async ({ context, input }) => {
    try {
      const fn = context.dashboardReservationActions?.updateReservationStatus
      if (!fn) {
        throw new ORPCError('INTERNAL_SERVER_ERROR', {
          message: 'dashboardReservationActions.updateReservationStatus not provided',
        })
      }
      const result = await fn(input.reservationId, input.status, input.rejectionReason)
      if ('error' in result && result.error) {
        throw new ORPCError('BAD_REQUEST', { message: result.error })
      }
      return result
    } catch (error) {
      throw toORPCError(error)
    }
  })

const cancel = requirePermission('write')
  .input(dashboardReservationCancelInputSchema)
  .handler(async ({ context, input }) => {
    try {
      const fn = context.dashboardReservationActions?.cancelReservation
      if (!fn) {
        throw new ORPCError('INTERNAL_SERVER_ERROR', {
          message: 'dashboardReservationActions.cancelReservation not provided',
        })
      }
      const result = await fn(input.reservationId)
      if (result.error) {
        throw new ORPCError('BAD_REQUEST', { message: result.error })
      }
      return { success: true as const }
    } catch (error) {
      throw toORPCError(error)
    }
  })

const recordPayment = requirePermission('write')
  .input(dashboardReservationRecordPaymentInputSchema)
  .handler(async ({ context, input }) => {
    try {
      const fn = context.dashboardReservationActions?.recordPayment
      if (!fn) {
        throw new ORPCError('INTERNAL_SERVER_ERROR', {
          message: 'dashboardReservationActions.recordPayment not provided',
        })
      }
      const result = await fn(input.reservationId, {
        ...input.payload,
        paidAt: toDate(input.payload.paidAt),
      })
      if (result.error) {
        throw new ORPCError('BAD_REQUEST', { message: result.error })
      }
      return result
    } catch (error) {
      throw toORPCError(error)
    }
  })

const deletePayment = requirePermission('write')
  .input(dashboardReservationDeletePaymentInputSchema)
  .handler(async ({ context, input }) => {
    try {
      const fn = context.dashboardReservationActions?.deletePayment
      if (!fn) {
        throw new ORPCError('INTERNAL_SERVER_ERROR', {
          message: 'dashboardReservationActions.deletePayment not provided',
        })
      }
      const result = await fn(input.paymentId)
      if (result.error) {
        throw new ORPCError('BAD_REQUEST', { message: result.error })
      }
      return { success: true as const }
    } catch (error) {
      throw toORPCError(error)
    }
  })

const returnDeposit = requirePermission('write')
  .input(dashboardReservationReturnDepositInputSchema)
  .handler(async ({ context, input }) => {
    try {
      const fn = context.dashboardReservationActions?.returnDeposit
      if (!fn) {
        throw new ORPCError('INTERNAL_SERVER_ERROR', {
          message: 'dashboardReservationActions.returnDeposit not provided',
        })
      }
      const result = await fn(input.reservationId, input.payload)
      if (result.error) {
        throw new ORPCError('BAD_REQUEST', { message: result.error })
      }
      return result
    } catch (error) {
      throw toORPCError(error)
    }
  })

const recordDamage = requirePermission('write')
  .input(dashboardReservationRecordDamageInputSchema)
  .handler(async ({ context, input }) => {
    try {
      const fn = context.dashboardReservationActions?.recordDamage
      if (!fn) {
        throw new ORPCError('INTERNAL_SERVER_ERROR', {
          message: 'dashboardReservationActions.recordDamage not provided',
        })
      }
      const result = await fn(input.reservationId, input.payload)
      if (result.error) {
        throw new ORPCError('BAD_REQUEST', { message: result.error })
      }
      return result
    } catch (error) {
      throw toORPCError(error)
    }
  })

const createDepositHold = requirePermission('write')
  .input(dashboardReservationCreateDepositHoldInputSchema)
  .handler(async ({ context, input }) => {
    try {
      const fn = context.dashboardReservationActions?.createDepositHold
      if (!fn) {
        throw new ORPCError('INTERNAL_SERVER_ERROR', {
          message: 'dashboardReservationActions.createDepositHold not provided',
        })
      }
      const result = await fn(input.reservationId)
      if ('error' in result && result.error) {
        throw new ORPCError('BAD_REQUEST', { message: result.error as string })
      }
      return result
    } catch (error) {
      throw toORPCError(error)
    }
  })

const captureDepositHold = requirePermission('write')
  .input(dashboardReservationCaptureDepositHoldInputSchema)
  .handler(async ({ context, input }) => {
    try {
      const fn = context.dashboardReservationActions?.captureDepositHold
      if (!fn) {
        throw new ORPCError('INTERNAL_SERVER_ERROR', {
          message: 'dashboardReservationActions.captureDepositHold not provided',
        })
      }
      const result = await fn(input.reservationId, input.payload)
      if ('error' in result && result.error) {
        throw new ORPCError('BAD_REQUEST', { message: result.error as string })
      }
      return result
    } catch (error) {
      throw toORPCError(error)
    }
  })

const releaseDepositHold = requirePermission('write')
  .input(dashboardReservationReleaseDepositHoldInputSchema)
  .handler(async ({ context, input }) => {
    try {
      const fn = context.dashboardReservationActions?.releaseDepositHold
      if (!fn) {
        throw new ORPCError('INTERNAL_SERVER_ERROR', {
          message: 'dashboardReservationActions.releaseDepositHold not provided',
        })
      }
      const result = await fn(input.reservationId)
      if ('error' in result && result.error) {
        throw new ORPCError('BAD_REQUEST', { message: result.error as string })
      }
      return result
    } catch (error) {
      throw toORPCError(error)
    }
  })

const assignUnitsToItem = requirePermission('write')
  .input(dashboardReservationAssignUnitsInputSchema)
  .handler(async ({ context, input }) => {
    try {
      const fn = context.dashboardReservationActions?.assignUnitsToReservationItem
      if (!fn) {
        throw new ORPCError('INTERNAL_SERVER_ERROR', {
          message: 'dashboardReservationActions.assignUnitsToReservationItem not provided',
        })
      }
      const result = await fn(input.reservationItemId, input.unitIds)
      if (result.error) {
        throw new ORPCError('BAD_REQUEST', { message: result.error })
      }
      return { success: true as const }
    } catch (error) {
      throw toORPCError(error)
    }
  })

const sendReservationEmail = requirePermission('write')
  .input(dashboardReservationSendReservationEmailInputSchema)
  .handler(async ({ context, input }) => {
    try {
      const fn = context.dashboardReservationActions?.sendReservationEmail
      if (!fn) {
        throw new ORPCError('INTERNAL_SERVER_ERROR', {
          message: 'dashboardReservationActions.sendReservationEmail not provided',
        })
      }
      const result = await fn(input.reservationId, input.payload)
      if (result.error) {
        throw new ORPCError('BAD_REQUEST', { message: result.error })
      }
      return { success: true as const }
    } catch (error) {
      throw toORPCError(error)
    }
  })

const sendAccessLink = requirePermission('write')
  .input(dashboardReservationSendAccessLinkInputSchema)
  .handler(async ({ context, input }) => {
    try {
      const fn = context.dashboardReservationActions?.sendAccessLink
      if (!fn) {
        throw new ORPCError('INTERNAL_SERVER_ERROR', {
          message: 'dashboardReservationActions.sendAccessLink not provided',
        })
      }
      const result = await fn(input.reservationId)
      if (result.error) {
        throw new ORPCError('BAD_REQUEST', { message: result.error })
      }
      return { success: true as const }
    } catch (error) {
      throw toORPCError(error)
    }
  })

const sendAccessLinkBySms = requirePermission('write')
  .input(dashboardReservationSendAccessLinkSmsInputSchema)
  .handler(async ({ context, input }) => {
    try {
      const fn = context.dashboardReservationActions?.sendAccessLinkBySms
      if (!fn) {
        throw new ORPCError('INTERNAL_SERVER_ERROR', {
          message: 'dashboardReservationActions.sendAccessLinkBySms not provided',
        })
      }
      const result = await fn(input.reservationId)
      if (result.error) {
        throw new ORPCError('BAD_REQUEST', { message: result.error })
      }
      return result
    } catch (error) {
      throw toORPCError(error)
    }
  })

const requestPayment = requirePermission('write')
  .input(dashboardReservationRequestPaymentInputSchema)
  .handler(async ({ context, input }) => {
    try {
      const fn = context.dashboardReservationActions?.requestPayment
      if (!fn) {
        throw new ORPCError('INTERNAL_SERVER_ERROR', {
          message: 'dashboardReservationActions.requestPayment not provided',
        })
      }
      const result = await fn(input.reservationId, input.payload)
      if (result.error) {
        throw new ORPCError('BAD_REQUEST', { message: result.error })
      }
      return { success: true as const, paymentUrl: result.paymentUrl || null }
    } catch (error) {
      throw toORPCError(error)
    }
  })

const sign = dashboardProcedure
  .input(reservationSignInputSchema)
  .handler(async ({ context, input }) => {
    try {
      return await signReservationAsAdmin({
        reservationId: input.reservationId,
        storeId: context.store.id,
        headers: context.headers,
        regenerateContract: context.regenerateContract,
      })
    } catch (error) {
      throw toORPCError(error)
    }
  })

export const dashboardReservationsRouter = {
  poll,
  list,
  getById,
  getPaymentMethod,
  getAvailableUnitsForItem,
  createManualReservation,
  updateReservation,
  updateNotes,
  updateStatus,
  cancel,
  recordPayment,
  deletePayment,
  returnDeposit,
  recordDamage,
  createDepositHold,
  captureDepositHold,
  releaseDepositHold,
  assignUnitsToItem,
  sendReservationEmail,
  sendAccessLink,
  sendAccessLinkBySms,
  requestPayment,
  sign,
}
