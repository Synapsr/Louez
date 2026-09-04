import { z } from 'zod'
import type { ReservationStatus } from '@louez/validations'
import {
  isExportDateRangeWithinLimit,
  isValidExportDateRange,
} from './date-range'

export const exportTypes = ['payments', 'reservations', 'products'] as const
export type ExportType = (typeof exportTypes)[number]

export const exportFormats = ['csv', 'json'] as const
export type ExportFormat = (typeof exportFormats)[number]

export const exportParamsSchema = z
  .object({
    type: z.enum(exportTypes),
    format: z.enum(exportFormats),
    startDate: z.iso.date().optional(),
    endDate: z.iso.date().optional(),
  })
  .refine(
    (data) => {
      if (data.type === 'products') return true
      return data.startDate && data.endDate
    },
    { message: 'Date range is required for this export type' }
  )
  .refine(
    (data) => {
      if (!data.startDate || !data.endDate) return true
      return isValidExportDateRange(data.startDate, data.endDate)
    },
    { message: 'End date must be after start date' }
  )
  .refine(
    (data) => {
      if (!data.startDate || !data.endDate) return true
      return isExportDateRangeWithinLimit(data.startDate, data.endDate)
    },
    { message: 'Date range cannot exceed one year' }
  )

export type ExportRequestParams = z.infer<typeof exportParamsSchema>

export type ExportParams = Omit<
  ExportRequestParams,
  'startDate' | 'endDate'
> & {
  startDate?: Date
  endDate?: Date
}

export const contractExportStatuses = [
  'pending',
  'confirmed',
  'ongoing',
  'completed',
  'cancelled',
  'rejected',
  'quote',
  'declined',
] as const satisfies readonly ReservationStatus[]

const contractExportStatusSchema = z.enum(contractExportStatuses)

export const contractExportParamsSchema = z
  .object({
    startDate: z.iso.date(),
    endDate: z.iso.date(),
    statuses: z.array(contractExportStatusSchema).min(1),
    locale: z.enum(['fr', 'en']).default('fr'),
  })
  .refine((data) => isValidExportDateRange(data.startDate, data.endDate), {
    message: 'End date must be after start date',
  })
  .refine(
    (data) => isExportDateRangeWithinLimit(data.startDate, data.endDate),
    {
      message: 'Date range cannot exceed one year',
    }
  )

export type ContractExportParams = z.infer<typeof contractExportParamsSchema>
