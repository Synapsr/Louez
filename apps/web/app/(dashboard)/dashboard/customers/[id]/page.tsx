import { notFound, redirect } from "next/navigation";

import { and, desc, eq } from "drizzle-orm";

import {
  getCustomerFieldValues,
  listCustomerFieldDefinitions,
} from "@louez/api/services/customer-fields";
import { customers, db, reservations } from "@louez/db";
import { resolveStoreCustomerFormLayout } from "@louez/validations";

import { getCurrentStore } from "@/lib/store-context";

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
      birthDate: true,
      acquisitionSource: true,
      acquisitionSourceDetail: true,
      createdVia: true,
      socialLinks: true,
    },
  });

  if (!customer) {
    notFound();
  }

  const [customerReservations, definitions, customFields] = await Promise.all([
    db.query.reservations.findMany({
      where: and(eq(reservations.customerId, customer.id), eq(reservations.storeId, store.id)),
      columns: {
        id: true,
        number: true,
        status: true,
        startDate: true,
        endDate: true,
        totalAmount: true,
        billingSnapshot: true,
        createdAt: true,
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
    }),
    listCustomerFieldDefinitions(store.id, { activeOnly: true, scope: "customer" }),
    getCustomerFieldValues(store.id, customer.id),
  ]);

  return (
    <CustomerDetailView
      customer={customer}
      reservations={customerReservations}
      stats={getCustomerStats(customerReservations)}
      currency={store.settings?.currency || "EUR"}
      timezone={store.settings?.timezone}
      storeCountry={store.settings?.country ?? "FR"}
      items={resolveStoreCustomerFormLayout({
        settings: store.settings,
        scope: "customer",
        definitions,
      })}
      customFields={customFields}
    />
  );
};

export default CustomerPage;
