import type { StoreSettings } from '@louez/types'
import { validateRentalPeriod } from '@/lib/utils/business-hours'
import { getMinStartDateTime } from '@/lib/utils/duration'
import {
  getMaxRentalHours,
  getMinRentalHours,
  validateMaxRentalDuration,
  validateMinRentalDuration,
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

  const advanceNoticeHours = storeSettings?.advanceNotice || 0
  if (advanceNoticeHours > 0) {
    const minimumStartTime = getMinStartDateTime(advanceNoticeHours)
    if (startDate < minimumStartTime) {
      warnings.push({
        code: 'advance_notice',
        key: 'errors.advanceNoticeViolation',
        params: { hours: advanceNoticeHours },
      })
    }
  }

  const minRentalHours = getMinRentalHours(storeSettings)
  if (minRentalHours > 0) {
    const minCheck = validateMinRentalDuration(startDate, endDate, minRentalHours)
    if (!minCheck.valid) {
      warnings.push({
        code: 'min_duration',
        key: 'errors.minRentalDurationViolation',
        params: { hours: minRentalHours },
      })
    }
  }

  const maxRentalHours = getMaxRentalHours(storeSettings)
  if (maxRentalHours !== null) {
    const maxCheck = validateMaxRentalDuration(startDate, endDate, maxRentalHours)
    if (!maxCheck.valid) {
      warnings.push({
        code: 'max_duration',
        key: 'errors.maxRentalDurationViolation',
        params: { hours: maxRentalHours },
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
        return `advance notice not met (${warning.params?.hours ?? '?'}h)`
      case 'min_duration':
        return `minimum duration not met (${warning.params?.hours ?? '?'}h)`
      case 'max_duration':
        return `maximum duration exceeded (${warning.params?.hours ?? '?'}h)`
      default:
        return warning.key
    }
  })

  return `Validation warnings: ${parts.join('; ')}`
}
