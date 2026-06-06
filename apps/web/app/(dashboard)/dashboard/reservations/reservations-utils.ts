import type {
  PaymentStatusType,
  Reservation,
  ReservationStatus,
} from './reservations-types';

export const STATUS_CONFIG: Record<
  ReservationStatus,
  {
    className: string;
    bgClass: string;
    borderClass: string;
  }
> = {
  pending: {
    className: 'text-reservation-pending-text',
    bgClass: 'bg-reservation-pending-soft',
    borderClass: 'border-l-reservation-pending',
  },
  confirmed: {
    className: 'text-reservation-confirmed-text',
    bgClass: 'bg-reservation-confirmed-soft',
    borderClass: 'border-l-reservation-confirmed',
  },
  ongoing: {
    className: 'text-reservation-ongoing-text',
    bgClass: 'bg-reservation-ongoing-soft',
    borderClass: 'border-l-reservation-ongoing',
  },
  completed: {
    className: 'text-reservation-completed-text',
    bgClass: 'bg-reservation-completed-soft',
    borderClass: 'border-l-reservation-completed',
  },
  cancelled: {
    className: 'text-reservation-cancelled-text',
    bgClass: 'bg-reservation-cancelled-soft',
    borderClass: 'border-l-reservation-cancelled',
  },
  rejected: {
    className: 'text-reservation-rejected-text',
    bgClass: 'bg-reservation-rejected-soft',
    borderClass: 'border-l-reservation-rejected',
  },
  quote: {
    className: 'text-reservation-quote-text',
    bgClass: 'bg-reservation-quote-soft',
    borderClass: 'border-l-reservation-quote',
  },
  declined: {
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
  const subtotal = parseFloat(reservation.subtotalAmount || '0');
  const deposit = parseFloat(reservation.depositAmount || '0');
  const total = parseFloat(reservation.totalAmount || '0');
  const totalDue =
    Number.isFinite(total) && total > 0
      ? deposit > 0 && total - subtotal >= deposit - 0.01
        ? Math.max(0, total - deposit)
        : total
      : subtotal;

  const rentalPaid = reservation.payments
    .filter((p) => p.type === 'rental' && p.status === 'completed')
    .reduce((sum, p) => sum + parseFloat(p.amount), 0);

  const depositCollected = reservation.payments
    .filter((p) => p.type === 'deposit' && p.status === 'completed')
    .reduce((sum, p) => sum + parseFloat(p.amount), 0);

  const totalPaid = rentalPaid;

  let status: PaymentStatusType = 'unpaid';
  if (totalPaid >= totalDue) {
    status = 'paid';
  } else if (totalPaid > 0) {
    status = 'partial';
  }

  return { status, rentalPaid, depositCollected, totalDue, totalPaid };
}

export const PAYMENT_STATUS_CLASSES: Record<PaymentStatusType, string> = {
  paid: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  partial:
    'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  unpaid: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
};
