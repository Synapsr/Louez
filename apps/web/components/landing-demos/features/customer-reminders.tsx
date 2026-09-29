"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { SendEmailModal } from "@/app/(dashboard)/dashboard/reservations/[id]/send-email-modal";
import { DEFAULT_SMS_TEMPLATES } from "@/app/(dashboard)/dashboard/settings/notifications/customer-template-defaults";
import { SmsPreview, replaceSmsVariables } from "@/components/dashboard/sms-preview";
import { ReservationScene } from "@/components/landing-demos/reservation-scene";
import type { FeatureSceneProps } from "@/components/landing-demos/feature-demo.types";
import { useDemoCue } from "@/components/landing-demos/use-demo-cue";
import { useDemoLocale } from "@/components/landing-demos/use-demo-locale";
import { createDemoEmailContext } from "@/lib/landing-demos/customer-messages";
import { getDemoCustomer } from "@/lib/landing-demos/reservations";
import { getMessageDemoText } from "@/lib/landing-demos/text.messages";
import { formatStoreDate } from "@/lib/utils/store-date";

export const CustomerRemindersScene = ({ booking, period }: FeatureSceneProps) => {
  const locale = useDemoLocale();
  const t = useTranslations("dashboard.settings.notifications");
  const context = useMemo(
    () => createDemoEmailContext(booking, period, locale),
    [booking, period, locale],
  );
  const [emailOpen, setEmailOpen] = useState(false);
  const [smsVisible, setSmsVisible] = useState(false);

  useDemoCue("customer-reminders-sms", () => {
    setEmailOpen(false);
    setSmsVisible(true);
  });

  const sms = replaceSmsVariables(DEFAULT_SMS_TEMPLATES[locale].customer_reminder_pickup, {
    storeName: context.store.name,
    number: context.reservation.number,
    startDate: formatStoreDate(period.start, "Europe/Paris", "PPP", locale),
    endDate: formatStoreDate(period.end, "Europe/Paris", "PPP", locale),
  });

  return (
    <div className="relative" data-demo-target="reminder-reservation">
      <ReservationScene
        period={period}
        booking={booking}
        reservationIndex={0}
        status="confirmed"
        onPreviewEmail={() => setEmailOpen(true)}
        onNavigate={() => undefined}
      />
      <SendEmailModal
        open={emailOpen}
        onOpenChange={setEmailOpen}
        reservationId={context.reservation.id}
        reservationNumber={context.reservation.number}
        customer={getDemoCustomer(0)}
        status="confirmed"
        isFullyPaid
        previewContext={context}
        readOnly
        autoFocus={false}
        modal={false}
      />
      {smsVisible && (
        <div
          className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-6 bg-background"
          data-demo-target="customer-reminder-sms"
        >
          <h2 className="text-lg font-semibold">
            {t("customerEvents.customer_reminder_pickup.label")}
          </h2>
          <SmsPreview
            message={sms}
            storeName={context.store.name}
            labels={getMessageDemoText(locale)}
          />
        </div>
      )}
    </div>
  );
};
