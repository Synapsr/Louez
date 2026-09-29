import type { ComponentProps } from "react";
import { addDays, differenceInMinutes, subDays } from "date-fns";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";

import type { Period } from "@/app/(dashboard)/dashboard/analytics/period";
import type { RevenueChart } from "@/app/(dashboard)/dashboard/analytics/revenue-chart";
import type {
  PaymentMethodKey,
  PaymentMethodTotal,
} from "@/app/(dashboard)/dashboard/analytics/sales/payment-methods-breakdown";
import type { RevenueHero } from "@/app/(dashboard)/dashboard/analytics/sales/revenue-hero";
import type { RentalActivitySection } from "@/app/(dashboard)/dashboard/analytics/sales/rental-activity-section";
import type { SalesStatStripContent } from "@/app/(dashboard)/dashboard/analytics/sales/sales-stat-strip-content";
import type { TopCustomersTable } from "@/app/(dashboard)/dashboard/analytics/sales/top-customers-table";
import type { TopProductsTable } from "@/app/(dashboard)/dashboard/analytics/top-products-table";
import {
  getSalesGrowth,
  getSalesWindow,
  roundSalesAmount,
  type SalesWindow,
} from "@/app/(dashboard)/dashboard/analytics/sales/util.sales-window";
import type { RentalPeriodValue } from "@/components/storefront/date-picker/core/types";
import type { Locale } from "@/i18n/config";
import { resolveFormatLocale } from "@/lib/i18n/format-locale";
import { createDemoPeriod, getDemoProducts } from "@/lib/landing-demos/fixtures";
import { getDemoCustomer, getDemoToday } from "@/lib/landing-demos/reservations";

export interface DemoSalesAnalytics {
  window: SalesWindow;
  stats: ComponentProps<typeof RevenueHero>["stats"];
  revenue: ComponentProps<typeof RevenueChart>["data"];
  methods: PaymentMethodTotal[];
  reservationStats: ComponentProps<typeof SalesStatStripContent>["reservationStats"];
  duration: ComponentProps<typeof SalesStatStripContent>["duration"];
  occupancy: ComponentProps<typeof RentalActivitySection>["occupancy"];
  upcoming: ComponentProps<typeof RentalActivitySection>["upcoming"];
  topProducts: Omit<ComponentProps<typeof TopProductsTable>, "readOnly">;
  customers: ComponentProps<typeof TopCustomersTable>["customers"];
}

const TIMEZONE = "Europe/Paris";
const PAYMENT_METHODS: PaymentMethodKey[] = ["stripe", "card", "cash", "stripe", "transfer"];

/**
 * Every period reads the same rental receipts. Prices are the fixture catalogue's daily
 * prices, excluding deposits. The history also covers the previous twelve-month window.
 */
export const createDemoAnalytics = (
  period: Period = "30d",
  locale: Locale = "fr",
  rentalPeriod: RentalPeriodValue = createDemoPeriod(),
): DemoSalesAnalytics => {
  const today = getDemoToday(rentalPeriod);
  const products = getDemoProducts(locale);
  const window = getSalesWindow(period, today, TIMEZONE);
  const { dateFns } = resolveFormatLocale(locale);
  const localToday = toZonedTime(today, TIMEZONE);
  const receipts = Array.from({ length: 761 }, (_, index) => {
    const daysAgo = 760 - index;
    const day = subDays(localToday, daysAgo);
    // Around ten rentals a day of one to three days: a shop whose fleet works, not an empty one.
    return Array.from({ length: 9 + (daysAgo % 5) }, (_, position) => {
      const product = products[(daysAgo + position * 3) % products.length];
      const quantity = position === 2 ? 2 : 1;
      const days = 1 + ((daysAgo + position) % 3);
      const start = new Date(day);
      start.setHours(8, position * 10, 0, 0);
      const end = addDays(start, days);
      return {
        productId: product.id,
        customerIndex: (daysAgo + position) % 6,
        start: fromZonedTime(start, TIMEZONE),
        end: fromZonedTime(end, TIMEZONE),
        quantity,
        amount: Number(product.price) * quantity * days,
        method: PAYMENT_METHODS[(daysAgo + position) % PAYMENT_METHODS.length],
      };
    });
  }).flat();

  const current = receipts.filter(
    (receipt) => receipt.start >= window.start && receipt.start < window.end,
  );
  const previous = receipts.filter(
    (receipt) => receipt.start >= window.previousStart && receipt.start < window.previousEnd,
  );
  const revenueOf = (entries: typeof receipts) =>
    entries.reduce((total, entry) => total + entry.amount, 0);
  const periodRevenue = revenueOf(current);
  const totalRevenue = revenueOf(receipts.filter((receipt) => receipt.start < window.end));
  const availableUnits = products.reduce((total, product) => total + (product.quantity ?? 0), 0);
  const occupiedMinutes = receipts.reduce((total, receipt) => {
    const overlap = Math.max(
      0,
      Math.min(receipt.end.getTime(), window.end.getTime()) -
        Math.max(receipt.start.getTime(), window.start.getTime()),
    );
    return total + (overlap / 60_000) * receipt.quantity;
  }, 0);
  const availableMinutes = availableUnits * differenceInMinutes(window.end, window.start);
  const productRows = products
    .map((product) => {
      const entries = current.filter((receipt) => receipt.productId === product.id);
      return {
        productId: product.id,
        productName: product.name,
        totalQuantity: entries.reduce((total, entry) => total + entry.quantity, 0),
        totalRevenue: revenueOf(entries).toFixed(2),
        reservationCount: entries.length,
      };
    })
    .filter((product) => product.reservationCount > 0)
    .sort((left, right) => Number(right.totalRevenue) - Number(left.totalRevenue));

  return {
    window,
    stats: {
      periodRevenue,
      periodPaymentCount: current.length,
      avgPaymentValue: current.length ? periodRevenue / current.length : 0,
      revenueGrowth: getSalesGrowth(periodRevenue, revenueOf(previous)),
      totalRevenue,
    },
    revenue: window.buckets.map((bucket) => {
      const entries = current.filter(
        (receipt) => receipt.start >= bucket.start && receipt.start < bucket.end,
      );
      return {
        label: formatInTimeZone(
          bucket.start,
          TIMEZONE,
          window.granularity === "month" ? "MMM yyyy" : "d MMM",
          { locale: dateFns },
        ),
        revenue: revenueOf(entries),
        payments: entries.length,
      };
    }),
    methods: [...new Set(PAYMENT_METHODS)].map((method) => {
      const entries = current.filter((receipt) => receipt.method === method);
      return { method, amount: revenueOf(entries), count: entries.length };
    }),
    reservationStats: {
      reservationCount: current.length,
      growth: getSalesGrowth(current.length, previous.length),
    },
    duration: {
      avgMinutes: current.length
        ? current.reduce(
            (total, receipt) => total + differenceInMinutes(receipt.end, receipt.start),
            0,
          ) / current.length
        : null,
      reservationCount: current.length,
    },
    occupancy: {
      rate: availableMinutes > 0 ? (occupiedMinutes / availableMinutes) * 100 : 0,
      availableUnits,
    },
    // Six confirmed future rentals, each two units for three days, still unpaid.
    upcoming: {
      revenue: products
        .slice(0, 6)
        .reduce((total, product) => total + Number(product.price) * 2 * 3, 0),
      reservationCount: 6,
    },
    topProducts: {
      products: productRows.slice(0, 10),
      catalogRevenue: periodRevenue,
      totalRevenue: periodRevenue,
      nonCatalogRevenue: 0,
      unallocatedRevenue: 0,
      productCount: productRows.length,
    },
    customers: Array.from({ length: 6 }, (_, index): DemoSalesAnalytics["customers"][number] => {
      const customer = getDemoCustomer(index);
      const entries = current.filter((receipt) => receipt.customerIndex === index);
      return {
        customerId: customer.id,
        firstName: customer.firstName,
        lastName: customer.lastName,
        companyName: null,
        customerType: "individual",
        totalRevenue: roundSalesAmount(revenueOf(entries)).toFixed(2),
        paymentCount: entries.length,
        reservationCount: entries.length,
      };
    })
      .filter((customer) => customer.paymentCount > 0)
      .sort((left, right) => Number(right.totalRevenue) - Number(left.totalRevenue)),
  };
};
