import type { StoreSettings } from '@louez/types'
import { validateRentalPeriod } from '@/lib/utils/business-hours'
import { getMinStartDateTime } from '@/lib/utils/duration'
import {
  formatDurationFromMinutes,
  getMaxRentalMinutes,
  getMinRentalMinutes,
  validateMaxRentalDurationMinutes,
  validateMinRentalDurationMinutes,
} from '@/lib/utils/rental-duration'

export type ReservationValidationWarningCode =
  | 'business_hours'
  | 'advance_notice'
  | 'min_duration'
  | 'max_duration'

export interface ReservationValidationWarning {
  code: ReservationValidationWarningCode
  key:
    | 'errors.businessHoursViolation'
    | 'errors.advanceNoticeViolation'
    | 'errors.minRentalDurationViolation'
    | 'errors.maxRentalDurationViolation'
  params?: Record<string, string | number>
  details?: string
}

interface EvaluateReservationRulesInput {
  startDate: Date
  endDate: Date
  storeSettings?: StoreSettings | null
}

export function evaluateReservationRules({
  startDate,
  endDate,
  storeSettings,
}: EvaluateReservationRulesInput): ReservationValidationWarning[] {
  const warnings: ReservationValidationWarning[] = []

  const businessHoursValidation = validateRentalPeriod(
    startDate,
    endDate,
    storeSettings?.businessHours,
    storeSettings?.timezone
  )
  if (!businessHoursValidation.valid) {
    warnings.push({
      code: 'business_hours',
      key: 'errors.businessHoursViolation',
      params: { reasons: businessHoursValidation.errors.join(', ') },
      details: businessHoursValidation.errors.join(', '),
    })
  }

  const advanceNoticeMinutes = storeSettings?.advanceNoticeMinutes || 0
  if (advanceNoticeMinutes > 0) {
    const minimumStartTime = getMinStartDateTime(advanceNoticeMinutes)
    if (startDate < minimumStartTime) {
      warnings.push({
        code: 'advance_notice',
        key: 'errors.advanceNoticeViolation',
        params: { duration: formatDurationFromMinutes(advanceNoticeMinutes) },
      })
    }
  }

  const minRentalMinutes = getMinRentalMinutes(storeSettings)
  if (minRentalMinutes > 0) {
    const minCheck = validateMinRentalDurationMinutes(
      startDate,
      endDate,
      minRentalMinutes
    )
    if (!minCheck.valid) {
      warnings.push({
        code: 'min_duration',
        key: 'errors.minRentalDurationViolation',
        params: { duration: formatDurationFromMinutes(minRentalMinutes) },
      })
    }
  }

  const maxRentalMinutes = getMaxRentalMinutes(storeSettings)
  if (maxRentalMinutes !== null) {
    const maxCheck = validateMaxRentalDurationMinutes(
      startDate,
      endDate,
      maxRentalMinutes
    )
    if (!maxCheck.valid) {
      warnings.push({
        code: 'max_duration',
        key: 'errors.maxRentalDurationViolation',
        params: { duration: formatDurationFromMinutes(maxRentalMinutes) },
      })
    }
  }

  return warnings
}

export function formatReservationWarningsForLog(
  warnings: ReservationValidationWarning[]
): string {
  if (warnings.length === 0) return ''

  const parts = warnings.map((warning) => {
    switch (warning.code) {
      case 'business_hours':
        return warning.details
          ? `outside business hours (${warning.details})`
          : 'outside business hours'
      case 'advance_notice':
        return `advance notice not met (${warning.params?.duration ?? '?'})`
      case 'min_duration':
        return `minimum duration not met (${warning.params?.duration ?? '?'})`
      case 'max_duration':
        return `maximum duration exceeded (${warning.params?.duration ?? '?'})`
      default:
        return warning.key
    }
  })

  return `Validation warnings: ${parts.join('; ')}`
}
