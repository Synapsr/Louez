import { getTranslations } from "next-intl/server";

import { env } from "@/env";
import { getEffectivePolicy } from "@/lib/billing/policy";
import { isSignedInStoreOwner } from "@/lib/billing/reservation-gate-owner";
import { log } from "@/lib/evlog";

type ReservationGateOwnerBannerProps = {
  storeId: string;
};

/**
 * The storefront's owner-only line while the card gate pauses new reservations
 * (README §8.4; design §4.7). Renters see nothing here: the checkout answers them
 * with generic text. The dashboard says why.
 */
export const ReservationGateOwnerBanner = async ({ storeId }: ReservationGateOwnerBannerProps) => {
  const effective = await getEffectivePolicy(storeId, new Date()).catch((error: unknown) => {
    log.error(
      "billing",
      `storefront gate banner: policy read failed for store ${storeId}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  });
  if (!effective || effective.acceptsReservations) return null;
  if (!(await isSignedInStoreOwner(storeId))) return null;

  const t = await getTranslations("dashboard.reservationGate");
  return (
    <div
      data-slot="reservation-gate-owner-banner"
      role="status"
      className="border-b border-warning/32 bg-warning/8 px-4 py-2 text-center text-sm text-balance"
    >
      <span className="font-medium">{t("pausedTitle")}</span> {t("storefrontDescription")}{" "}
      <a href={`${env.NEXT_PUBLIC_APP_URL}/dashboard`} className="underline underline-offset-4">
        {t("openDashboard")}
      </a>
    </div>
  );
};
