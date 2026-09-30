import type { RentalPeriodValue } from "@/components/storefront/date-picker/core/types";
import type { Reservation as ListReservation } from "@/app/(dashboard)/dashboard/reservations/reservations-types";
import type {
  Product,
  Reservation as CalendarReservation,
  StoreTimelineReservation,
} from "@/app/(dashboard)/dashboard/reservations/calendar/types";
import type { Locale } from "@/i18n/config";
import { getDemoCart } from "./cart";
import { getDemoProducts, getDemoReservationItems, type DemoBooking } from "./fixtures";

const customers = [
  ["Camille", "Martin"],
  ["Alex", "Robin"],
  ["Sam", "Laurent"],
  ["Lou", "Bernard"],
  ["Charlie", "Petit"],
  ["Morgan", "Dubois"],
  ["Maxime", "Leroy"],
  ["Dominique", "Moreau"],
  ["Claude", "Fournier"],
  ["Sacha", "Girard"],
  ["Noa", "Lambert"],
  ["Andrea", "Rousseau"],
];

export const getDemoCustomer = (index: number) => {
  const [firstName, lastName] = customers[index % customers.length];
  return {
    id: `demo-customer-${index}`,
    firstName,
    lastName,
    email: `${firstName}.${lastName}@example.com`.toLowerCase(),
  };
};

/** The demo period opens a week from now; the planning of a working shop is read from today. */
export const getDemoToday = (period: RentalPeriodValue) => {
  const today = new Date(period.start);
  today.setDate(today.getDate() - 7);
  return today;
};

type DemoSlot = {
  productIndex: number;
  quantity: number;
  start: Date;
  end: Date;
  status: ListReservation["status"];
};

// A working week on the first products: a few units each, rented back to back with a day to
// turn them around. It ends before the demo period, so it never competes with its bookings.
const createBusyWeek = (
  period: RentalPeriodValue,
  stock: (number | null | undefined)[],
): DemoSlot[] => {
  const today = getDemoToday(period);
  const slots: DemoSlot[] = [];
  for (const [productIndex, quantity] of stock.slice(0, 4).entries()) {
    const lanes = Math.min((quantity ?? 0) - 1, 4);
    for (let lane = 0; lane < lanes; lane++) {
      let day = -4 + ((lane + productIndex) % 3);
      for (let turn = 0; day < 6; turn++) {
        const days = 1 + ((lane + productIndex + turn) % 3);
        const start = new Date(today);
        start.setDate(start.getDate() + day);
        const end = new Date(start);
        end.setDate(end.getDate() + Math.min(days, 6 - day));
        end.setHours(18, 0, 0, 0);
        slots.push({
          productIndex,
          quantity: 1,
          start,
          end,
          status:
            end < today
              ? "completed"
              : start <= today
                ? "ongoing"
                : turn % 3 === 2
                  ? "pending"
                  : "confirmed",
        });
        day += days + 1;
      }
    }
  }
  return slots;
};

export function createDemoReservationPages(
  period: RentalPeriodValue,
  booking: DemoBooking,
  locale?: Locale,
  busy = false,
) {
  const DEMO_PRODUCTS = getDemoProducts(locale);
  const bookings: DemoBooking[] = [];
  const slots: DemoSlot[] = Array.from({ length: 24 }, (_, index) => {
    const start = new Date(period.start);
    const end = new Date(period.end);
    const offset = index < 3 ? 0 : Math.floor((index - 3) / 3) - 2;
    start.setDate(start.getDate() + offset);
    end.setDate(end.getDate() + offset + (index < 3 ? 0 : 2 + (index % 4)));
    return {
      productIndex: index % DEMO_PRODUCTS.length,
      quantity: index === 1 ? 1 : 2,
      start,
      end,
      status: index % 5 === 4 ? "pending" : index % 5 === 3 ? "ongoing" : "confirmed",
    };
  });
  if (busy) {
    slots.push(
      ...createBusyWeek(
        period,
        DEMO_PRODUCTS.map((product) => product.quantity),
      ),
    );
  }
  const rows: ListReservation[] = slots.map(
    ({ productIndex, quantity, start, end, status }, index) => {
      const product = DEMO_PRODUCTS[productIndex];
      const selectedBooking =
        index === 0
          ? booking
          : (getDemoCart({ [product.id]: quantity }, { start, end }, locale).booking ?? {
              productIndex,
              quantity,
              selected: {},
              unitPrice: Number(product.price),
              period: { start, end },
            });
      bookings.push(selectedBooking);
      const display = getDemoReservationItems(selectedBooking, locale);
      return {
        id: `demo-reservation-${index}`,
        number: String(1042 + index),
        source: "online",
        status,
        startDate: start,
        endDate: end,
        subtotalAmount: display.subtotalAmount,
        depositAmount: display.depositAmount,
        totalAmount: display.subtotalAmount,
        customer: getDemoCustomer(index),
        items: (display.items ?? []).map((item, lineIndex) => ({
          id: item.id,
          quantity: item.quantity,
          isCustomItem: false,
          productSnapshot: { name: item.product?.name ?? product.name },
          product: {
            id:
              DEMO_PRODUCTS[(selectedBooking.lines ?? [selectedBooking])[lineIndex].productIndex]
                ?.id ?? product.id,
            name: item.product?.name ?? product.name,
          },
        })),
        payments:
          status === "pending"
            ? []
            : [
                {
                  id: `demo-payment-${index}`,
                  amount: display.subtotalAmount,
                  type: "rental",
                  method: "stripe",
                  status: "completed",
                },
              ],
      };
    },
  );
  const calendar: CalendarReservation[] = rows.map((row) => ({
    ...row,
    outboundMethod: "pickup",
    returnMethod: "pickup",
    deliveryAddress: null,
    deliveryCity: null,
    deliveryPostalCode: null,
    deliveryCountry: null,
    returnAddress: null,
    returnCity: null,
    returnPostalCode: null,
    returnCountry: null,
    items: row.items.map((item) => {
      const product = DEMO_PRODUCTS.find((entry) => entry.id === item.product?.id);
      return {
        ...item,
        product: item.product
          ? { ...item.product, images: product?.images ?? [], displayOrder: null }
          : null,
      };
    }),
  }));
  const products: Product[] = DEMO_PRODUCTS.map((product) => ({
    id: product.id,
    name: product.name,
    quantity: product.quantity ?? 0,
    images: product.images,
    stockKind: "returnable",
    categoryId: product.categoryIds[0],
  }));
  return { rows, calendar, products, bookings };
}

/** One planning bar per reservation and product, as the planning timeline service returns them. */
export const createDemoPlanningEntries = (
  calendar: CalendarReservation[],
): StoreTimelineReservation[] => {
  const byPair = new Map<string, StoreTimelineReservation>();
  for (const reservation of calendar) {
    for (const item of reservation.items) {
      if (!item.product) continue;
      const key = `${reservation.id}_${item.product.id}`;
      const existing = byPair.get(key);
      if (existing) {
        existing.quantity += item.quantity;
        if (existing.items?.[0]) existing.items[0].quantity += item.quantity;
        continue;
      }
      byPair.set(key, {
        id: reservation.id,
        productId: item.product.id,
        number: reservation.number,
        status: reservation.status,
        startDate: new Date(reservation.startDate),
        endDate: new Date(reservation.endDate),
        customerId: reservation.customer?.id ?? null,
        customerName:
          [reservation.customer?.firstName, reservation.customer?.lastName]
            .filter(Boolean)
            .join(" ") || "—",
        subtotalAmount: reservation.subtotalAmount,
        depositAmount: reservation.depositAmount,
        totalAmount: reservation.totalAmount,
        quantity: item.quantity,
        assignedUnitIds: [],
        items: [
          {
            productId: item.product.id,
            name: item.product.name,
            quantity: item.quantity,
            imageUrl: item.product.images?.[0] ?? null,
          },
        ],
        outboundDeliveryAddress: null,
        returnDeliveryAddress: null,
      });
    }
  }
  return Array.from(byPair.values());
};
