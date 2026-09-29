"use client";

import { NotificationsContent } from "@/app/(dashboard)/dashboard/settings/notifications/notifications-content";
import { SmsPreview } from "@/components/dashboard/sms-preview";
import { SettingsSceneFrame } from "@/components/landing-demos/settings-scene-frame";
import type { FeatureSceneProps } from "@/components/landing-demos/feature-demo.types";
import { useDemoLocale } from "@/components/landing-demos/use-demo-locale";
import { createDemoNotificationSettings } from "@/lib/landing-demos/customer-messages";
import { getMessageDemoText } from "@/lib/landing-demos/text.messages";

export const NotificationSettingsScene = ({ period: _period }: FeatureSceneProps) => {
  const locale = useDemoLocale();
  const settings = createDemoNotificationSettings(locale);

  return (
    <SettingsSceneFrame pathname="/dashboard/settings/notifications">
      <NotificationsContent
        {...settings}
        readOnly
        renderSmsPreview={(message) => (
          <SmsPreview
            message={message}
            storeName={settings.storeInfo.name}
            labels={getMessageDemoText(locale)}
          />
        )}
      />
    </SettingsSceneFrame>
  );
};
