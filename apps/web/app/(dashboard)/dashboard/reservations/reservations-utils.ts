import {
  getRentalRemaining,
  getReservationRentalAmount,
} from '@/lib/reservations/util.rental-amount';

import type {
  PaymentStatusType,
  Reservation,
  ReservationStatus,
} from './reservations-types';

export const STATUS_CONFIG: Record<
  ReservationStatus,
  {
    badgeVariant: "pending" | "progress" | "submitted" | "success" | "failed" | "expired";
    className: string;
    bgClass: string;
    borderClass: string;
  }
> = {
  pending: {
    badgeVariant: 'pending',
    className: 'text-reservation-pending-text',
    bgClass: 'bg-reservation-pending-soft',
    borderClass: 'border-l-reservation-pending',
  },
  confirmed: {
    badgeVariant: 'success',
    className: 'text-reservation-confirmed-text',
    bgClass: 'bg-reservation-confirmed-soft',
    borderClass: 'border-l-reservation-confirmed',
  },
  ongoing: {
    badgeVariant: 'progress',
    className: 'text-reservation-ongoing-text',
    bgClass: 'bg-reservation-ongoing-soft',
    borderClass: 'border-l-reservation-ongoing',
  },
  completed: {
    badgeVariant: 'success',
    className: 'text-reservation-completed-text',
    bgClass: 'bg-reservation-completed-soft',
    borderClass: 'border-l-reservation-completed',
  },
  cancelled: {
    badgeVariant: 'failed',
    className: 'text-reservation-cancelled-text',
    bgClass: 'bg-reservation-cancelled-soft',
    borderClass: 'border-l-reservation-cancelled',
  },
  rejected: {
    badgeVariant: 'failed',
    className: 'text-reservation-rejected-text',
    bgClass: 'bg-reservation-rejected-soft',
    borderClass: 'border-l-reservation-rejected',
  },
  quote: {
    badgeVariant: 'submitted',
    className: 'text-reservation-quote-text',
    bgClass: 'bg-reservation-quote-soft',
    borderClass: 'border-l-reservation-quote',
  },
  declined: {
    badgeVariant: 'expired',
    className: 'text-reservation-declined-text',
    bgClass: 'bg-reservation-declined-soft',
    borderClass: 'border-l-reservation-declined',
  },
};

export function getPaymentStatus(reservation: Reservation): {
  status: PaymentStatusType;
  rentalPaid: number;
  depositCollected: number;
  totalDue: number;
  totalPaid: number;
} {
  // The rental costs its stored total, which never contains the deposit.
  const totalDue = getReservationRentalAmount(reservation);
  // The server's reading: the list's payments carry no currency.
  const rentalPaid = Number(reservation.rentalPaid);

  const depositCollected = reservation.payments
    .filter((p) => p.type === 'deposit' && p.status === 'completed')
    .reduce((sum, p) => sum + parseFloat(p.amount), 0);

  const totalPaid = rentalPaid;

  let status: PaymentStatusType = 'unpaid';
  if (getRentalRemaining(reservation, rentalPaid) === 0) {
    status = 'paid';
  } else if (totalPaid > 0) {
    status = 'partial';
  }

  return { status, rentalPaid, depositCollected, totalDue, totalPaid };
}

export const PAYMENT_STATUS_VARIANTS: Record<PaymentStatusType, 'success' | 'pending' | 'failed'> =
  {
    paid: 'success',
    partial: 'pending',
    unpaid: 'failed',
  }
