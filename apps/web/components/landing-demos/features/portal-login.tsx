"use client";
import { useState } from "react";
import { LoginForm } from "@/app/(storefront)/[slug]/account/login/login-form";
import { StorefrontSection } from "@/components/storefront/ui/storefront-section";
import { AccountPageView } from "@/components/storefront/account/account-page-view";
import type { FeatureSceneProps } from "@/components/landing-demos/feature-demo.types";
import { useDemoLocale } from "@/components/landing-demos/use-demo-locale";
import { createDemoPortal, createDemoPortalList, PORTAL_STORE } from "@/lib/landing-demos/portal";
import { PortalSceneFrame } from "./portal-scene-frame";
import { PortalReservationView } from "./portal-reservation-view";

export const PortalLoginScene = ({ period, booking }: FeatureSceneProps) => {
  const locale = useDemoLocale();
  const portal = createDemoPortal(period, booking, locale);
  const [signedIn, setSignedIn] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const reservation = portal.reservations.find(({ id }) => id === selected);
  return (
    <PortalSceneFrame
      key={signedIn ? (selected ?? "account") : "login"}
      period={period}
      signedIn={signedIn}
      onBack={() => setSelected(null)}
    >
      {signedIn ? (
        reservation ? (
          <PortalReservationView reservation={reservation} />
        ) : (
          <AccountPageView
            items={createDemoPortalList(portal.reservations, locale)}
            prefetch={false}
            onOpenReservation={setSelected}
          />
        )
      ) : (
        <StorefrontSection
          width="narrow"
          className="bg-background sm:py-16"
          contentClassName="max-w-lg"
        >
          <LoginForm
            storeSlug="maison-du-velo"
            storeName={PORTAL_STORE.storeName}
            redirectPath="/account"
            errorCode={null}
            autoFocus={false}
            prefetch={false}
            requestCode={async () => ({ ok: true })}
            verifyCode={async () => ({ ok: true })}
            onVerified={() => setSignedIn(true)}
          />
        </StorefrontSection>
      )}
    </PortalSceneFrame>
  );
};
