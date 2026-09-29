"use client";
import { useTranslations } from "next-intl";
import { ReservationPageView } from "@/components/storefront/account/reservation-page-view";
import { useDemoLocale } from "@/components/landing-demos/use-demo-locale";
import { createDemoPortalDetail, type DemoPortalReservation } from "@/lib/landing-demos/portal";

export const PortalReservationView = ({
  reservation,
  onAcceptQuote,
}: {
  reservation: DemoPortalReservation;
  onAcceptQuote?: () => void;
}) => {
  const locale = useDemoLocale();
  const t = useTranslations("storefront.account.depositCard");
  const detail = createDemoPortalDetail(reservation, locale);
  const kind = detail.deposit?.deposit.kind;
  return (
    <ReservationPageView
      {...detail}
      readOnly
      onAcceptQuote={onAcceptQuote}
      items={{
        ...detail.items,
        depositLabel: kind
          ? t(`states.${kind === "to_provide" ? "to_provide_online" : kind}.badge`)
          : null,
      }}
    />
  );
};
