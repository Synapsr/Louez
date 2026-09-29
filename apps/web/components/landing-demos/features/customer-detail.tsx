"use client";

import { useMemo } from "react";
import { CustomerDetailView } from "@/app/(dashboard)/dashboard/customers/[id]/customer-detail-view";
import { createDemoCustomers } from "@/lib/landing-demos/customers";
import { DashboardSceneFrame } from "@/components/landing-demos/dashboard-scene-frame";
import type { FeatureSceneProps } from "@/components/landing-demos/feature-demo.types";
import { useDemoLocale } from "@/components/landing-demos/use-demo-locale";

export const CustomerDetailScene = ({ period, booking, onOpenReservation }: FeatureSceneProps) => {
  const locale = useDemoLocale();
  const [record] = useMemo(
    () => createDemoCustomers(period, booking, locale),
    [period, booking, locale],
  );
  if (!record) return null;

  return (
    <DashboardSceneFrame
      page="customers"
      pages={["customers"]}
      pathname="/dashboard/customers/demo-customer-0"
    >
      <div data-demo-scene="customer-detail">
        <CustomerDetailView
          customer={record.customer}
          reservations={record.reservations}
          stats={record.stats}
          readOnly
          onOpenReservation={(reservation) => {
            const entry = record.history.find((item) => item.reservation.id === reservation.id);
            if (entry) onOpenReservation(entry.index, entry.booking, entry.period, entry.status);
          }}
        />
      </div>
    </DashboardSceneFrame>
  );
};
