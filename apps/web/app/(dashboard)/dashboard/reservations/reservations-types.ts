export type ReservationStatus = 'pending' | 'confirmed' | 'ongoing' | 'completed' | 'cancelled' | 'rejected'

export interface ReservationItem {
  id: string
  quantity: number
  isCustomItem: boolean
  productSnapshot: {
    name: string
  }
  product: {
    id: string
    name: string
  } | null
  selectedAttributes?: Record<string, string> | null
}

export interface Payment {
  id: string
  amount: string
  type: 'rental' | 'deposit' | 'deposit_return' | 'damage' | 'deposit_hold' | 'deposit_capture' | 'adjustment'
  method: 'cash' | 'card' | 'transfer' | 'check' | 'other' | 'stripe'
  status: 'pending' | 'completed' | 'failed' | 'refunded' | 'authorized' | 'cancelled'
}

export interface Reservation {
  id: string
  number: string
  status: ReservationStatus | null
  startDate: Date
  endDate: Date
  subtotalAmount: string
  depositAmount: string
  totalAmount: string
  customer: {
    id: string
    firstName: string
    lastName: string
    email: string
  }
  items: ReservationItem[]
  payments: Payment[]
}

export interface ReservationCounts {
  all: number
  pending: number
  confirmed: number
  ongoing: number
  completed: number
  cancelled: number
}

export type PaymentStatusType = 'paid' | 'partial' | 'unpaid'

export type SortField = 'startDate' | 'amount' | 'status' | 'number'
export type SortDirection = 'asc' | 'desc'
