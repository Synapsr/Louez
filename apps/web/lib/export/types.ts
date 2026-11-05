import { z } from 'zod'
import type { ReservationStatus } from '@louez/validations'
import {
  isExportDateRangeWithinLimit,
  isValidExportDateRange,
} from './date-range'

export const exportTypes = ['payments', 'reservations', 'products', 'customers'] as const
export type ExportType = (typeof exportTypes)[number]

export const exportFormats = ['csv', 'json'] as const
export type ExportFormat = (typeof exportFormats)[number]

export const exportParamsSchema = z
  .object({
    type: z.enum(exportTypes),
    format: z.enum(exportFormats),
    startDate: z.iso.date().optional(),
    endDate: z.iso.date().optional(),
    /** Customers export only: sensitive custom fields are left out unless asked for. */
    includeSensitive: z.enum(['true', 'false']).optional(),
  })
  .refine(
    (data) => {
      if (data.type === 'products') return true
      // Customers: the whole list, or a creation period given in full.
      if (data.type === 'customers') return Boolean(data.startDate) === Boolean(data.endDate)
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
  'startDate' | 'endDate' | 'includeSensitive'
> & {
  startDate?: Date
  endDate?: Date
  includeSensitive?: boolean
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
