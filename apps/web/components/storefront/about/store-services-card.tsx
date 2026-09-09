import type { ComponentType } from "react";

import { getLocale, getTranslations } from "next-intl/server";

import type { DeliverySettings, StoreSettings } from "@louez/types";
import { CalendarCheckIcon, CheckCircleIcon, MapPinIcon, TruckIcon } from "@louez/ui/icons";
import { formatCurrency } from "@louez/utils";

import { SectionHeader } from "@/components/storefront/ui/section-header";
import { getEffectiveReservationMode } from "@/lib/reservation-mode";

interface StoreServicesCardProps {
  settings: StoreSettings | null | undefined;
  stripeAccountId: string | null;
  stripeChargesEnabled: boolean | null;
}

interface ServiceRow {
  key: string;
  icon: ComponentType<{ className?: string }>;
  text: string;
}

const describeDelivery = (
  delivery: DeliverySettings,
  t: (key: string, values?: Record<string, string | number>) => string,
  currency: string,
  locale: string,
): string => {
  const parts: string[] = [
    delivery.mode === "included"
      ? t("deliveryIncluded")
      : delivery.mode === "required"
        ? t("deliveryRequired")
        : t("deliveryOptional"),
  ];
  if (delivery.maximumDistance) parts.push(t("deliveryRadius", { km: delivery.maximumDistance }));
  if (delivery.mode !== "included") {
    if (delivery.freeDeliveryThreshold) {
      parts.push(
        t("deliveryFree", {
          amount: formatCurrency(delivery.freeDeliveryThreshold, currency, locale),
        }),
      );
    } else if (delivery.minimumFee > 0) {
      parts.push(
        t("deliveryFrom", { amount: formatCurrency(delivery.minimumFee, currency, locale) }),
      );
    }
  }
  return parts.join(" · ");
};

/** How renting works here: confirmation mode, pickup and delivery, in three short lines. */
export const StoreServicesCard = async ({
  settings,
  stripeAccountId,
  stripeChargesEnabled,
}: StoreServicesCardProps) => {
  const [t, locale] = await Promise.all([getTranslations("storefront.about"), getLocale()]);
  const mode = getEffectiveReservationMode({ settings, stripeAccountId, stripeChargesEnabled });
  const currency = settings?.currency ?? "EUR";
  const delivery = settings?.delivery;

  const rows: ServiceRow[] = [
    mode === "payment"
      ? { key: "payment", icon: CheckCircleIcon, text: t("paymentMode") }
      : { key: "request", icon: CalendarCheckIcon, text: t("requestMode") },
    { key: "pickup", icon: MapPinIcon, text: t("pickup") },
  ];
  if (delivery?.enabled) {
    rows.push({
      key: "delivery",
      icon: TruckIcon,
      text: describeDelivery(delivery, t, currency, locale),
    });
  }

  return (
    <section aria-labelledby="about-services" className="flex flex-col gap-4">
      <SectionHeader id="about-services" level="h2" title={t("servicesTitle")} className="mb-0" />
      <ul className="flex flex-col gap-3 text-sm">
        {rows.map(({ key, icon: Icon, text }) => (
          <li key={key} className="flex items-start gap-3">
            <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span>{text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
};
