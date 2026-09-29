"use client";

import { useLayoutEffect, useRef, type ComponentType } from "react";

import { DeliverySettingsContent } from "@/app/(dashboard)/dashboard/settings/delivery/delivery-settings-content";
import type { FeatureSceneProps } from "@/components/landing-demos/feature-demo.types";
import { SettingsSceneFrame } from "@/components/landing-demos/settings-scene-frame";
import { DEMO_DELIVERY_STORE } from "@/lib/landing-demos/delivery";

export const DeliverySimulatorScene: ComponentType<FeatureSceneProps> = () => {
  const sceneRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const scene = sceneRef.current;
    const simulator = scene?.querySelector('[data-demo-target="delivery-simulator"]');
    const content = scene?.closest<HTMLElement>("[data-dashboard-content]");
    if (!simulator || !content) return;
    content.scrollTop +=
      simulator.getBoundingClientRect().top - content.getBoundingClientRect().top - 24;
  }, []);

  return (
    <SettingsSceneFrame pathname="/dashboard/settings/delivery">
      <div ref={sceneRef} data-demo-scene="delivery-simulator">
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
};
