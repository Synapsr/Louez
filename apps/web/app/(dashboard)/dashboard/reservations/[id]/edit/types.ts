import type {
  DeliverySettings,
  LegMethod,
  PricingBreakdown,
  PricingMode,
  ProductSnapshot,
  StoreSettings,
  TulipPublicMode,
} from '@louez/types'
import type { SeasonalPricingConfig } from '@louez/utils'

export interface PricingTier {
  id: string
  minDuration: number
  discountPercent: number
  period?: number | null
  price?: number | null
  displayOrder?: number
}

export interface Product {
  id: string
  name: string
  price: string
  deposit: string
  tulipInsurable?: boolean
  quantity: number
  pricingMode: string | null
  basePeriodMinutes?: number | null
  enforceStrictTiers?: boolean
  pricingTiers: PricingTier[]
  seasonalPricings?: SeasonalPricingConfig[]
}

export interface ReservationItem {
  id: string
  productId: string | null
  quantity: number
  unitPrice: string
  depositPerUnit: string
  totalPrice: string
  isCustomItem: boolean
  pricingBreakdown: PricingBreakdown | null
  productSnapshot: ProductSnapshot
  product: Product | null
}

export interface ExistingReservation {
  id: string
  startDate: Date
  endDate: Date
  status: string
  items: { productId: string | null; quantity: number }[]
}

export interface ReservationDelivery {
  outboundMethod: LegMethod
  returnMethod: LegMethod
  deliveryAddress: string | null
  deliveryCity: string | null
  deliveryPostalCode: string | null
  deliveryCountry: string | null
  deliveryLatitude: string | null
  deliveryLongitude: string | null
  deliveryDistanceKm: string | null
  deliveryFee: string | null
  returnAddress: string | null
  returnCity: string | null
  returnPostalCode: string | null
  returnCountry: string | null
  returnLatitude: string | null
  returnLongitude: string | null
  returnDistanceKm: string | null
}

export interface Reservation {
  id: string
  number: string
  status: string
  startDate: Date
  endDate: Date
  subtotalAmount: string
  depositAmount: string
  totalAmount: string
  deliveryFee: string | null
  discountAmount: string | null
  tulipInsuranceOptIn: boolean | null
  tulipInsuranceAmount: string | null
  delivery: ReservationDelivery
  items: ReservationItem[]
  customer: {
    firstName: string
    lastName: string
  }
}

export interface EditableItem {
  id: string
  productId: string | null
  quantity: number
  unitPrice: number
  depositPerUnit: number
  isManualPrice: boolean
  pricingMode: PricingMode
  basePeriodMinutes?: number | null
  enforceStrictTiers?: boolean
  productSnapshot: ProductSnapshot
  product: Product | null
}

export interface AvailabilityWarning {
  productId: string
  productName: string
  requestedQuantity: number
  availableQuantity: number
}

export interface StoreDeliveryInfo {
  settings: DeliverySettings
  latitude: number | null
  longitude: number | null
  address: string | null
}

export interface EditReservationFormProps {
  reservation: Reservation
  availableProducts: Product[]
  existingReservations: ExistingReservation[]
  currency: string
  tulipInsuranceMode: TulipPublicMode
  storeSettings: StoreSettings | null
  storeDelivery: StoreDeliveryInfo | null
}

export interface CalculatedEditableItem extends EditableItem {
  totalPrice: number
  duration: number
  effectiveUnitPrice: number
  displayPricingMode: PricingMode
  tierLabel: string | null
  discount: number
  originalSubtotal: number
  savings: number
  discountPercent: number | null
}

export interface ReservationCalculations {
  items: CalculatedEditableItem[]
  subtotal: number
  deposit: number
  difference: number
  totalSavings: number
}
