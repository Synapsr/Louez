"use client";

import { useMemo, useState } from "react";
import { CustomerDetailView } from "@/app/(dashboard)/dashboard/customers/[id]/customer-detail-view";
import {
  CustomersFilters,
  type CustomersFilterValue,
} from "@/app/(dashboard)/dashboard/customers/customers-filters";
import { CustomersPageHeading } from "@/app/(dashboard)/dashboard/customers/customers-page-heading";
import { CustomersTable } from "@/app/(dashboard)/dashboard/customers/customers-table";
import { DashboardSceneFrame } from "@/components/landing-demos/dashboard-scene-frame";
import type { FeatureSceneProps } from "@/components/landing-demos/feature-demo.types";
import { useDemoLocale } from "@/components/landing-demos/use-demo-locale";
import { KeyboardShortcutsProvider } from "@/components/shared/keyboard-shortcuts-provider";
import { createDemoCustomers, filterDemoCustomers } from "@/lib/landing-demos/customers";

export const CustomersSearchScene = ({ period, booking, onOpenReservation }: FeatureSceneProps) => {
  const locale = useDemoLocale();
  const customers = useMemo(
    () => createDemoCustomers(period, booking, locale),
    [period, booking, locale],
  );
  const [filters, setFilters] = useState<CustomersFilterValue>({
    search: "",
    type: "all",
    sort: "recent",
  });
  const [customerId, setCustomerId] = useState<string | null>(null);
  const selected = customers.find((record) => record.customer.id === customerId);
  const visibleCustomers = filterDemoCustomers(
    customers.map((record) => record.listCustomer),
    filters,
    locale,
  );

  return (
    <DashboardSceneFrame
      key={selected?.customer.id ?? "list"}
      page="customers"
      pages={["customers"]}
      pathname={selected ? `/dashboard/customers/${selected.customer.id}` : undefined}
      onNavigate={() => setCustomerId(null)}
    >
      <div data-demo-scene="customers-search">
        {selected ? (
          <CustomerDetailView
            customer={selected.customer}
            reservations={selected.reservations}
            stats={selected.stats}
            readOnly
            onBack={() => setCustomerId(null)}
            onOpenReservation={(reservation) => {
              const entry = selected.history.find((item) => item.reservation.id === reservation.id);
              if (entry) onOpenReservation(entry.index, entry.booking, entry.period, entry.status);
            }}
          />
        ) : (
          <div className="space-y-6">
            <CustomersPageHeading />
            <KeyboardShortcutsProvider initialShortcuts={{}}>
              <CustomersFilters
                totalCount={customers.length}
                localFilters={{ value: filters, onChange: setFilters }}
                readOnly
              />
            </KeyboardShortcutsProvider>
            <CustomersTable
              customers={visibleCustomers}
              readOnly
              onOpenCustomer={(customer) => setCustomerId(customer.id)}
              getCustomerHref={() => "#"}
            />
          </div>
        )}
      </div>
    </DashboardSceneFrame>
  );
};
