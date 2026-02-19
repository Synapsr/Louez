import type { UnitAttributes } from './store'

export interface CombinationAvailability {
  combinationKey: string
  selectedAttributes: UnitAttributes
  totalQuantity: number
  reservedQuantity: number
  availableQuantity: number
  status: 'available' | 'limited' | 'unavailable'
}

export interface ProductAvailability {
  productId: string
  totalQuantity: number
  reservedQuantity: number
  availableQuantity: number
  status: 'available' | 'limited' | 'unavailable'
  combinations?: CombinationAvailability[]
}

export interface BusinessHoursValidation {
  valid: boolean
  errors: string[]
}

export interface AdvanceNoticeValidation {
  valid: boolean
  minimumStartTime?: string
  advanceNoticeMinutes?: number
}

export interface AvailabilityResponse {
  products: ProductAvailability[]
  period: {
    startDate: string
    endDate: string
  }
  businessHoursValidation?: BusinessHoursValidation
  advanceNoticeValidation?: AdvanceNoticeValidation
}

export interface CombinationResolutionResult {
  combinationKey: string
  selectedAttributes: UnitAttributes
  availableQuantity: number
}

export interface ReservationPollResponse {
  pendingCount: number
  totalCount: number
  latestReservation: {
    id: string
    number: string
    status: string
    createdAt: string
  } | null
  timestamp: string
}
