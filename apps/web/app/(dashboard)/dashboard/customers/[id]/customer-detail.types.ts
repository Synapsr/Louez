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
> &
  // The profile blocks: the landing demos leave them out.
  Partial<
    Pick<
      typeof customers.$inferSelect,
      "birthDate" | "acquisitionSource" | "acquisitionSourceDetail" | "createdVia" | "socialLinks"
    >
  >;

export type CustomerHistoryReservation = Pick<
  typeof reservations.$inferSelect,
  "id" | "number" | "status" | "startDate" | "endDate" | "totalAmount" | "billingSnapshot"
> & {
  /** When the booking was made; the landing demos go by the rental start instead. */
  createdAt?: Date;
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
