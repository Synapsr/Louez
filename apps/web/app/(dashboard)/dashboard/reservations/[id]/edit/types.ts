import type {
  PricingBreakdown,
  PricingMode,
  ProductSnapshot,
  StoreSettings,
} from '@louez/types'

export interface PricingTier {
  id: string
  minDuration: number | null
  discountPercent: string | null
  period?: number | null
  price?: string | null
}

export interface Product {
  id: string
  name: string
  price: string
  deposit: string
  quantity: number
  pricingMode: string | null
  basePeriodMinutes?: number | null
  pricingTiers: PricingTier[]
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

export interface Reservation {
  id: string
  number: string
  status: string
  startDate: Date
  endDate: Date
  subtotalAmount: string
  depositAmount: string
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
  basePeriodMinutes?: number
  productSnapshot: ProductSnapshot
  product: Product | null
}

export interface AvailabilityWarning {
  productId: string
  productName: string
  requestedQuantity: number
  availableQuantity: number
}

export interface EditReservationFormProps {
  reservation: Reservation
  availableProducts: Product[]
  existingReservations: ExistingReservation[]
  currency: string
  storeSettings: StoreSettings | null
}

export interface CalculatedEditableItem extends EditableItem {
  totalPrice: number
  duration: number
  tierLabel: string | null
  discount: number
}

export interface ReservationCalculations {
  items: CalculatedEditableItem[]
  subtotal: number
  deposit: number
  difference: number
}
