"use client";
import { useState } from "react";
import { AccountPageView } from "@/components/storefront/account/account-page-view";
import type { FeatureSceneProps } from "@/components/landing-demos/feature-demo.types";
import { useDemoLocale } from "@/components/landing-demos/use-demo-locale";
import { createDemoPortal, createDemoPortalList } from "@/lib/landing-demos/portal";
import { PortalSceneFrame } from "./portal-scene-frame";
import { PortalReservationView } from "./portal-reservation-view";

export const PortalAccountScene = ({ period, booking }: FeatureSceneProps) => {
  const locale = useDemoLocale();
  const portal = createDemoPortal(period, booking, locale);
  const [selected, setSelected] = useState<string | null>(null);
  const reservation = portal.reservations.find(({ id }) => id === selected);
  return (
    <PortalSceneFrame key={selected ?? "list"} period={period} onBack={() => setSelected(null)}>
      {reservation ? (
        <PortalReservationView reservation={reservation} />
      ) : (
        <AccountPageView
          items={createDemoPortalList(portal.reservations, locale)}
          prefetch={false}
          onOpenReservation={setSelected}
        />
      )}
    </PortalSceneFrame>
  );
};
