import { IMG } from "@/scripts/seed/demo/catalog";
import type { RentalPeriodValue } from "@/components/storefront/date-picker/core/types";
import type { ComponentProps } from "react";
import type { UIMessage } from "@ai-sdk/react";
import type { StorefrontCatalogProduct } from "@/lib/storefront/storefront.types";
import type { HomeReservation } from "@/components/dashboard/home/home-types";
import type { ActivityTimelineV2 } from "@/app/(dashboard)/dashboard/reservations/[id]/activity-timeline-v2";
import type { ReservationItemsDisplay } from "@/app/(dashboard)/dashboard/reservations/[id]/reservation-items-card";
import type { RentalPeriodRules } from "@/lib/utils/util.rental-period";

// Photos already used by the application's demonstration catalogue.
export const DEMO_PRODUCTS: (StorefrontCatalogProduct & { categoryIds: string[] })[] = [
  {
    id: "demo-city-bike",
    name: "Vélo de ville",
    price: "20",
    deposit: "150",
    images: [IMG.city],
    quantity: 8,
    categoryIds: ["bikes"],
  },
  {
    id: "demo-electric-bike",
    name: "Vélo électrique",
    price: "35",
    deposit: "300",
    images: [IMG.vaeCity],
    quantity: 5,
    categoryIds: ["electric"],
  },
  {
    id: "demo-child-bike",
    name: "Vélo enfant",
    price: "12",
    deposit: "75",
    images: [IMG.kid20],
    quantity: 4,
    categoryIds: ["family"],
  },
  {
    id: "demo-gravel",
    name: "Gravel",
    price: "28",
    deposit: "200",
    images: [IMG.gravel],
    quantity: 6,
    categoryIds: ["bikes"],
  },
  {
    id: "demo-mountain",
    name: "VTT électrique",
    price: "45",
    deposit: "300",
    images: [IMG.vttae],
    quantity: 5,
    categoryIds: ["electric"],
  },
  {
    id: "demo-cargo",
    name: "Vélo cargo",
    price: "48",
    deposit: "400",
    images: [IMG.cargoE],
    quantity: 3,
    categoryIds: ["family"],
  },
  {
    id: "demo-longtail",
    name: "Vélo longtail",
    price: "42",
    deposit: "350",
    images: [IMG.longtail],
    quantity: 4,
    categoryIds: ["family"],
  },
  {
    id: "demo-road",
    name: "Vélo de route",
    price: "30",
    deposit: "250",
    images: [IMG.route],
    quantity: 6,
    categoryIds: ["bikes"],
  },
  {
    id: "demo-trailer",
    name: "Remorque enfant",
    price: "15",
    deposit: "100",
    images: [IMG.trailerKid],
    quantity: 5,
    categoryIds: ["family"],
  },
  {
    id: "demo-panniers",
    name: "Sacoches de randonnée",
    price: "7",
    deposit: "50",
    images: [IMG.panniers],
    quantity: 10,
    categoryIds: ["accessories"],
  },
  {
    id: "demo-child-seat",
    name: "Siège enfant",
    price: "6",
    deposit: "50",
    images: [IMG.childSeat],
    quantity: 8,
    categoryIds: ["accessories"],
  },
  {
    id: "demo-touring",
    name: "Vélo de randonnée",
    price: "25",
    deposit: "200",
    images: [IMG.rando],
    quantity: 6,
    categoryIds: ["bikes"],
  },
].map((product) => ({ ...product, pricingMode: "day", basePeriodMinutes: 1440 }));

export const DEMO_CATEGORIES = [
  { id: "bikes", name: "Vélos", order: 0 },
  { id: "electric", name: "Vélos électriques", order: 1 },
  { id: "family", name: "En famille", order: 2 },
  { id: "accessories", name: "Accessoires", order: 3 },
].map((category) => ({
  ...category,
  productCount: DEMO_PRODUCTS.filter((product) => product.categoryIds.includes(category.id)).length,
}));

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

export interface DemoBookingLine {
  productIndex: number;
  quantity: number;
  selected: Record<string, string>;
  unitPrice: number;
}
export interface DemoBooking extends DemoBookingLine {
  lines?: DemoBookingLine[];
  period: RentalPeriodValue;
}
export const getDemoReservationItems = (booking: DemoBooking): ReservationItemsDisplay => {
  const lines = booking.lines ?? [booking];
  return {
    items: lines.map((line, index) => {
      const product = DEMO_PRODUCTS[line.productIndex] ?? DEMO_PRODUCTS[0];
      return {
        id: `demo-line-${index}`,
        productId: null,
        quantity: line.quantity,
        unitPrice: String(line.unitPrice),
        totalPrice: String(line.unitPrice * line.quantity),
        product: { name: product.name, bookingAttributeAxes: product.bookingAttributeAxes },
        selectedAttributes: line.selected,
      };
    }),
    subtotalAmount: String(
      lines.reduce((total, line) => total + line.unitPrice * line.quantity, 0),
    ),
    depositAmount: String(
      lines.reduce(
        (total, line) => total + Number(DEMO_PRODUCTS[line.productIndex].deposit) * line.quantity,
        0,
      ),
    ),
  };
};
