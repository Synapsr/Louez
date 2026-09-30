import { db } from "@louez/db";
import { getCurrentStore } from "@/lib/store-context";
import { customers, reservations } from "@louez/db";
import { eq, and, desc } from "drizzle-orm";
import { redirect, notFound } from "next/navigation";
import { CustomerDetailView } from "./customer-detail-view";
import { getCustomerStats } from "./util.customer-stats";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

interface CustomerPageProps {
  params: Promise<{ id: string }>;
}

const CustomerPage = async ({ params }: CustomerPageProps) => {
  const store = await getCurrentStore();

  if (!store) {
    redirect("/onboarding");
  }

  const { id } = await params;

  const customer = await db.query.customers.findFirst({
    where: and(eq(customers.id, id), eq(customers.storeId, store.id)),
    columns: {
      id: true,
      customerType: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      companyName: true,
      companyNumber: true,
      companyNumberScheme: true,
      vatNumber: true,
      address: true,
      city: true,
      postalCode: true,
      country: true,
      notes: true,
      createdAt: true,
    },
  });

  if (!customer) {
    notFound();
  }

  // Get customer reservations with items
  const customerReservations = await db.query.reservations.findMany({
    where: and(eq(reservations.customerId, customer.id), eq(reservations.storeId, store.id)),
    columns: {
      id: true,
      number: true,
      status: true,
      startDate: true,
      endDate: true,
      totalAmount: true,
      billingSnapshot: true,
    },
    with: {
      items: {
        columns: { id: true, quantity: true },
        with: {
          product: { columns: { name: true } },
        },
      },
    },
    orderBy: [desc(reservations.createdAt)],
  });

  return (
    <CustomerDetailView
      customer={customer}
      reservations={customerReservations}
      stats={getCustomerStats(customerReservations)}
    />
  );
};

export default CustomerPage;
