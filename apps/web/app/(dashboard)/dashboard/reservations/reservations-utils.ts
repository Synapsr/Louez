import type { Reservation, ReservationStatus, PaymentStatusType } from './reservations-types'

export const STATUS_CONFIG: Record<ReservationStatus, {
  className: string
  bgClass: string
  borderClass: string
}> = {
  pending: {
    className: 'text-amber-600 dark:text-amber-400',
    bgClass: 'bg-amber-50 dark:bg-amber-950/30',
    borderClass: 'border-l-amber-500',
  },
  confirmed: {
    className: 'text-blue-600 dark:text-blue-400',
    bgClass: 'bg-blue-50 dark:bg-blue-950/30',
    borderClass: 'border-l-blue-500',
  },
  ongoing: {
    className: 'text-emerald-600 dark:text-emerald-400',
    bgClass: 'bg-emerald-50 dark:bg-emerald-950/30',
    borderClass: 'border-l-emerald-500',
  },
  completed: {
    className: 'text-gray-600 dark:text-gray-400',
    bgClass: 'bg-gray-50 dark:bg-gray-900/30',
    borderClass: 'border-l-gray-400',
  },
  cancelled: {
    className: 'text-red-600 dark:text-red-400',
    bgClass: 'bg-red-50 dark:bg-red-950/30',
    borderClass: 'border-l-red-500',
  },
  rejected: {
    className: 'text-red-600 dark:text-red-400',
    bgClass: 'bg-red-50 dark:bg-red-950/30',
    borderClass: 'border-l-red-500',
  },
}

export function getPaymentStatus(reservation: Reservation): {
  status: PaymentStatusType
  rentalPaid: number
  depositCollected: number
  totalDue: number
  totalPaid: number
} {
  const rental = parseFloat(reservation.subtotalAmount)
  const deposit = parseFloat(reservation.depositAmount)
  const totalDue = rental + deposit

  const rentalPaid = reservation.payments
    .filter((p) => p.type === 'rental' && p.status === 'completed')
    .reduce((sum, p) => sum + parseFloat(p.amount), 0)

  const depositCollected = reservation.payments
    .filter((p) => p.type === 'deposit' && p.status === 'completed')
    .reduce((sum, p) => sum + parseFloat(p.amount), 0)

  const totalPaid = rentalPaid + depositCollected

  let status: PaymentStatusType = 'unpaid'
  if (totalPaid >= totalDue) {
    status = 'paid'
  } else if (totalPaid > 0) {
    status = 'partial'
  }

  return { status, rentalPaid, depositCollected, totalDue, totalPaid }
}

export const PAYMENT_STATUS_CLASSES: Record<PaymentStatusType, string> = {
  paid: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  partial: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  unpaid: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
}
