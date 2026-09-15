import type { RentalPeriodValue } from "@/components/storefront/date-picker/core/types";
import type { ComponentProps } from "react";
import type { UIMessage } from "@ai-sdk/react";
import type { StorefrontCatalogProduct } from "@/lib/storefront/storefront.types";
import type { HomeReservation } from "@/components/dashboard/home/home-types";
import type { ActivityTimelineV2 } from "@/app/(dashboard)/dashboard/reservations/[id]/activity-timeline-v2";
import type { ReservationItemsDisplay } from "@/app/(dashboard)/dashboard/reservations/[id]/reservation-items-card";
import type { RentalPeriodRules } from "@/lib/utils/util.rental-period";

export const DEMO_PRODUCTS = [
  {
    id: "demo-city-bike",
    name: "Vélo de ville",
    price: "20",
    deposit: "150",
    images: [],
    quantity: 8,
    pricingMode: "day",
    basePeriodMinutes: 1440,
    bookingAttributeAxes: [{ key: "size", label: "Taille", position: 0 }],
  },
  {
    id: "demo-electric-bike",
    name: "Vélo électrique",
    price: "35",
    deposit: "300",
    images: [],
    quantity: 5,
    pricingMode: "day",
    basePeriodMinutes: 1440,
  },
  {
    id: "demo-child-bike",
    name: "Vélo enfant",
    price: "12",
    deposit: "75",
    images: [],
    quantity: 4,
    pricingMode: "day",
    basePeriodMinutes: 1440,
  },
] satisfies StorefrontCatalogProduct[];

export const DEMO_RULES = {
  pricingMode: "day",
  timezone: "Europe/Paris",
  minRentalMinutes: 60,
  advanceNoticeMinutes: 0,
} satisfies RentalPeriodRules;

// Rolling dates keep the real calendar usable after the landing has been deployed.
export const createDemoPeriod = () => {
  const start = new Date();
  start.setDate(start.getDate() + 7);
  start.setHours(9, 0, 0, 0);
  const end = new Date(start);
  end.setHours(18, 0, 0, 0);
  return { start, end };
};

export const createDemoReservations = (start: Date, end: Date): HomeReservation[] => [
  {
    id: "demo-camille",
    number: "1042",
    startDate: start,
    endDate: end,
    totalAmount: "40",
    customer: { firstName: "Camille", lastName: "Martin" },
    items: [
      { id: "demo-item-1", product: { name: "Vélo de ville" } },
      { id: "demo-item-2", product: { name: "Vélo de ville" } },
    ],
  },
  {
    id: "demo-alex",
    number: "1043",
    startDate: start,
    endDate: end,
    totalAmount: "35",
    customer: { firstName: "Alex", lastName: "Robin" },
    items: [{ id: "demo-item-3", product: { name: "Vélo électrique" } }],
  },
  {
    id: "demo-sam",
    number: "1044",
    startDate: start,
    endDate: end,
    totalAmount: "24",
    customer: { firstName: "Sam", lastName: "Laurent" },
    items: [{ id: "demo-item-4", product: { name: "Vélo enfant" } }],
  },
];

type TimelineProps = ComponentProps<typeof ActivityTimelineV2>;
export const createDemoActivities = (
  date: Date,
  amount = 40,
  deposit = 300,
): TimelineProps["activities"] => [
  {
    id: "demo-deposit",
    activityType: "deposit_authorized",
    description: "Empreinte bancaire enregistrée",
    metadata: { amount: deposit, method: "stripe" },
    createdAt: new Date(date.getTime() - 60_000),
    user: null,
  },
  {
    id: "demo-payment",
    activityType: "payment_received",
    description: "Paiement reçu en ligne",
    metadata: { amount, method: "stripe" },
    createdAt: new Date(date.getTime() - 120_000),
    user: null,
  },
  {
    id: "demo-confirmed",
    activityType: "confirmed",
    description: null,
    metadata: null,
    createdAt: new Date(date.getTime() - 180_000),
    user: null,
  },
  {
    id: "demo-created",
    activityType: "created",
    description: null,
    metadata: null,
    createdAt: new Date(date.getTime() - 240_000),
    user: null,
  },
];

export const demoAdvisorReply = (id: string): UIMessage => ({
  id,
  role: "assistant",
  parts: [
    {
      type: "text",
      text: "Pour une balade en ville, je vous conseille le vélo de ville : confortable et facile à prendre en main. Pour quelle date souhaitez-vous le louer ?",
    },
  ],
});

export interface DemoBooking {
  productIndex: number;
  quantity: number;
  selected: Record<string, string>;
  period: RentalPeriodValue;
  unitPrice: number;
}
export const getDemoReservationItems = (booking: DemoBooking): ReservationItemsDisplay => {
  const product = DEMO_PRODUCTS[booking.productIndex] ?? DEMO_PRODUCTS[0];
  const total = booking.unitPrice * booking.quantity;
  return {
    items: [
      {
        id: "demo-line",
        productId: null,
        quantity: booking.quantity,
        unitPrice: String(booking.unitPrice),
        totalPrice: String(total),
        product: { name: product.name, bookingAttributeAxes: product.bookingAttributeAxes },
        selectedAttributes: booking.selected,
      },
    ],
    subtotalAmount: String(total),
    depositAmount: String(Number(product.deposit) * booking.quantity),
  };
};
