import { z } from 'zod'

export const exportTypes = ['payments', 'reservations', 'products'] as const
export type ExportType = (typeof exportTypes)[number]

export const exportFormats = ['csv', 'json'] as const
export type ExportFormat = (typeof exportFormats)[number]

export const exportParamsSchema = z
  .object({
    type: z.enum(exportTypes),
    format: z.enum(exportFormats),
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
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
      return data.endDate >= data.startDate
    },
    { message: 'End date must be after start date' }
  )
  .refine(
    (data) => {
      if (!data.startDate || !data.endDate) return true
      const diffMs = data.endDate.getTime() - data.startDate.getTime()
      const oneYearMs = 365 * 24 * 60 * 60 * 1000
      return diffMs <= oneYearMs
    },
    { message: 'Date range cannot exceed one year' }
  )

export type ExportParams = z.infer<typeof exportParamsSchema>
