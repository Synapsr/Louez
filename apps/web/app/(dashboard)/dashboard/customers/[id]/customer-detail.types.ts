import type { customers, reservations } from "@louez/db";

export type CustomerDetail = Pick<
  typeof customers.$inferSelect,
  | "id"
  | "customerType"
  | "firstName"
  | "lastName"
  | "email"
  | "phone"
  | "companyName"
  | "companyNumber"
  | "companyNumberScheme"
  | "vatNumber"
  | "address"
  | "city"
  | "postalCode"
  | "country"
  | "notes"
  | "createdAt"
>;

export type CustomerHistoryReservation = Pick<
  typeof reservations.$inferSelect,
  "id" | "number" | "status" | "startDate" | "endDate" | "totalAmount" | "billingSnapshot"
> & {
  items: {
    id: string;
    quantity: number;
    product: { name: string } | null;
  }[];
};

export type CustomerStats = {
  totalReservations: number;
  completedReservations: number;
  totalSpent: number;
  avgOrderValue: number;
};
