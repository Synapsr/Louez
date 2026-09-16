import type { RentalPeriodValue } from "@/components/storefront/date-picker/core/types";
import type { Reservation as ListReservation } from "@/app/(dashboard)/dashboard/reservations/reservations-types";
import type {
  Product,
  Reservation as CalendarReservation,
} from "@/app/(dashboard)/dashboard/reservations/calendar/types";
import { getDemoCart } from "./cart";
import { DEMO_PRODUCTS, getDemoReservationItems, type DemoBooking } from "./fixtures";

const customers = [
  ["Camille", "Martin"],
  ["Alex", "Robin"],
  ["Sam", "Laurent"],
  ["Lou", "Bernard"],
  ["Charlie", "Petit"],
  ["Morgan", "Dubois"],
];

export const getDemoCustomer = (index: number) => {
  const [firstName, lastName] = customers[index % customers.length];
  return { id: `demo-customer-${index}`, firstName, lastName, email: `client${index}@example.com` };
};

export function createDemoReservationPages(period: RentalPeriodValue, booking: DemoBooking) {
  const bookings: DemoBooking[] = [];
  const rows: ListReservation[] = Array.from({ length: 24 }, (_, index) => {
    const productIndex = index % DEMO_PRODUCTS.length;
    const product = DEMO_PRODUCTS[productIndex];
    const start = new Date(period.start);
    const end = new Date(period.end);
    const offset = index < 3 ? 0 : Math.floor((index - 3) / 3) - 2;
    start.setDate(start.getDate() + offset);
    end.setDate(end.getDate() + offset + (index < 3 ? 0 : 2 + (index % 4)));
    const selectedBooking =
      index === 0
        ? booking
        : (getDemoCart({ [product.id]: index === 1 ? 1 : 2 }, { start, end }).booking ?? {
            productIndex,
            quantity: index === 1 ? 1 : 2,
            selected: {},
            unitPrice: Number(product.price),
            period: { start, end },
          });
    bookings.push(selectedBooking);
    const display = getDemoReservationItems(selectedBooking);
    return {
      id: `demo-reservation-${index}`,
      number: String(1042 + index),
      source: "online",
      status: index % 5 === 4 ? "pending" : index % 5 === 3 ? "ongoing" : "confirmed",
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
        index % 5 === 4
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
  });
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
