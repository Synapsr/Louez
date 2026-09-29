"use client";
import { useMemo, useState } from "react";
import type { FeatureSceneProps } from "@/components/landing-demos/feature-demo.types";
import { useDemoLocale } from "@/components/landing-demos/use-demo-locale";
import { useDemoCue } from "@/components/landing-demos/use-demo-cue";
import { createDemoPortal } from "@/lib/landing-demos/portal";
import { PortalAccessEmail } from "./portal-access-email";
import { PortalSceneFrame } from "./portal-scene-frame";
import { PortalReservationView } from "./portal-reservation-view";

export const PortalAccessScene = ({ period, booking }: FeatureSceneProps) => {
  const locale = useDemoLocale();
  const [opened, setOpened] = useState(false);
  const portal = useMemo(
    () => createDemoPortal(period, booking, locale),
    [period, booking, locale],
  );
  useDemoCue("portal-open-email", () => setOpened(true));
  return opened ? (
    <PortalSceneFrame period={period}>
      <PortalReservationView reservation={portal.confirmed} />
    </PortalSceneFrame>
  ) : (
    <PortalAccessEmail
      reservation={portal.confirmed}
      locale={locale}
      onOpen={() => setOpened(true)}
    />
  );
};
