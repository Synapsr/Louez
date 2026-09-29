import type { CustomerHistoryReservation, CustomerStats } from "./customer-detail.types";

export const getCustomerStats = (
  reservations: Pick<CustomerHistoryReservation, "status" | "totalAmount">[],
): CustomerStats => ({
  totalReservations: reservations.length,
  completedReservations: reservations.filter((reservation) => reservation.status === "completed")
    .length,
  totalSpent: reservations
    .filter((reservation) => reservation.status === "completed" || reservation.status === "ongoing")
    .reduce((sum, reservation) => sum + parseFloat(reservation.totalAmount), 0),
  avgOrderValue:
    reservations.length > 0
      ? reservations.reduce((sum, reservation) => sum + parseFloat(reservation.totalAmount), 0) /
        reservations.length
      : 0,
});
