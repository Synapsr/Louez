import type {
  CustomerDetail,
  CustomerHistoryReservation,
} from "@/app/(dashboard)/dashboard/customers/[id]/customer-detail.types";
import { getCustomerStats } from "@/app/(dashboard)/dashboard/customers/[id]/util.customer-stats";
import type { CustomersFilterValue } from "@/app/(dashboard)/dashboard/customers/customers-filters";
import type { Customer } from "@/app/(dashboard)/dashboard/customers/customers-table";
import type { RentalPeriodValue } from "@/components/storefront/date-picker/core/types";
import type { Locale } from "@/i18n/config";
import type { DemoBooking } from "./fixtures";
import { INDIVIDUAL_BILLING } from "@louez/utils";
import { createDemoReservationPages, getDemoCustomer, getDemoToday } from "./reservations";
import { getDemoCustomerText } from "./text.customers";

export const createDemoCustomers = (
  period: RentalPeriodValue,
  booking: DemoBooking,
  locale: Locale = "fr",
) => {
  const pages = createDemoReservationPages(period, booking, locale, true);
  const today = getDemoToday(period);
  const text = getDemoCustomerText(locale);

  return Array.from({ length: 12 }, (_, customerIndex) => {
    const identity = getDemoCustomer(customerIndex);
    const companyName =
      customerIndex === 6
        ? "Les Ateliers de Nantes"
        : customerIndex === 7
          ? "Collectif de l’Île"
          : null;
    const createdAt = new Date(today);
    createdAt.setMonth(createdAt.getMonth() - 18 + customerIndex);
    const customer: CustomerDetail = {
      ...identity,
      customerType: companyName ? "business" : "individual",
      companyName,
      companyNumber: null,
      companyNumberScheme: null,
      vatNumber: null,
      phone: `02 00 00 00 ${String(customerIndex + 10).padStart(2, "0")}`,
      address: `${18 + customerIndex} rue des Olivettes`,
      city: "Nantes",
      postalCode: "44000",
      country: "FR",
      notes: companyName ? text.businessNotes : text.notes,
      createdAt,
    };
    // The shared fixtures repeat six French names. Keep each row's original index so
    // opening its file preserves the number, customer name, products, dates and totals.
    const history = pages.rows
      .flatMap((row, index) => {
        if (index % 12 !== customerIndex) return [];
        const rowBooking = pages.bookings[index];
        if (!rowBooking) return [];
        const status = row.endDate < today ? "completed" : (row.status ?? "confirmed");
        const reservation: CustomerHistoryReservation = {
          ...row,
          status,
          billingSnapshot: INDIVIDUAL_BILLING,
        };
        return [
          {
            reservation,
            index,
            booking: rowBooking,
            period: { start: row.startDate, end: row.endDate },
            status,
          },
        ];
      })
      .sort(
        (left, right) =>
          right.reservation.startDate.getTime() - left.reservation.startDate.getTime(),
      );
    const reservations = history.map((entry) => entry.reservation);
    const stats = getCustomerStats(reservations);
    const listCustomer: Customer = {
      ...customer,
      reservationCount: stats.totalReservations,
      // The list API sums all rentals; the detail stats count only completed/ongoing ones.
      totalSpent: reservations
        .reduce((sum, reservation) => sum + Number(reservation.totalAmount), 0)
        .toFixed(2),
      lastReservation: history[0]
        ? new Date(Math.min(today.getTime(), history[0].reservation.startDate.getTime()) - 240_000)
        : null,
    };
    return { customer, listCustomer, reservations, stats, history };
  });
};

export const filterDemoCustomers = (
  customers: Customer[],
  filters: CustomersFilterValue,
  locale: Locale = "fr",
): Customer[] => {
  const search = filters.search.trim().toLocaleLowerCase(locale);
  return customers
    .filter((customer) => {
      if (filters.type !== "all" && customer.customerType !== filters.type) return false;
      return [
        customer.firstName,
        customer.lastName,
        customer.companyName,
        customer.email,
        customer.phone,
      ].some((value) => value?.toLocaleLowerCase(locale).includes(search));
    })
    .sort((left, right) => {
      if (filters.sort === "name")
        return `${left.lastName} ${left.firstName}`.localeCompare(
          `${right.lastName} ${right.firstName}`,
          locale,
        );
      if (filters.sort === "reservations") return right.reservationCount - left.reservationCount;
      if (filters.sort === "spent") return Number(right.totalSpent) - Number(left.totalSpent);
      return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
    });
};
