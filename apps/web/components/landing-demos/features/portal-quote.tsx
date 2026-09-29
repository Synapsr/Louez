"use client";
import { useState } from "react";
import type { FeatureSceneProps } from "@/components/landing-demos/feature-demo.types";
import { useDemoLocale } from "@/components/landing-demos/use-demo-locale";
import { acceptDemoPortalQuote, createDemoPortal } from "@/lib/landing-demos/portal";
import { PortalSceneFrame } from "./portal-scene-frame";
import { PortalReservationView } from "./portal-reservation-view";

export const PortalQuoteScene = ({ period, booking }: FeatureSceneProps) => {
  const locale = useDemoLocale();
  const [reservation, setReservation] = useState(
    () => createDemoPortal(period, booking, locale).quote,
  );
  return (
    <PortalSceneFrame period={period}>
      <PortalReservationView
        reservation={reservation}
        onAcceptQuote={() => setReservation(acceptDemoPortalQuote)}
      />
    </PortalSceneFrame>
  );
};
