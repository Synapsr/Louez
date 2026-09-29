"use client";

import type { ComponentType } from "react";

import { DeliverySettingsContent } from "@/app/(dashboard)/dashboard/settings/delivery/delivery-settings-content";
import type { FeatureSceneProps } from "@/components/landing-demos/feature-demo.types";
import { SettingsSceneFrame } from "@/components/landing-demos/settings-scene-frame";
import { DEMO_DELIVERY_STORE } from "@/lib/landing-demos/delivery";

export const DeliverySettingsScene: ComponentType<FeatureSceneProps> = () => (
  <SettingsSceneFrame pathname="/dashboard/settings/delivery">
    <div data-demo-scene="delivery-settings">
      <DeliverySettingsContent
        store={DEMO_DELIVERY_STORE}
        hasCoordinates
        locations={[]}
        readOnly
        addressTestingEnabled={false}
      />
    </div>
  </SettingsSceneFrame>
);
