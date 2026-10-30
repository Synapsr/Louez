import Link from "next/link";

import { getLocale, getTranslations } from "next-intl/server";

import { Alert, AlertAction, AlertDescription, AlertTitle, Button } from "@louez/ui";
import { InfoCircleIcon, TriangleAlertIcon } from "@louez/ui/icons";
import type { MemberRole } from "@louez/utils";

import { getEffectivePolicy } from "@/lib/billing/policy";
import { BILLING_SETTINGS_PATH } from "@/lib/billing/billing-routes";
import { canManageBilling, reservationGateBanner } from "@/lib/billing/reservation-gate-banner";
import { log } from "@/lib/evlog";

type ReservationGateBannerProps = {
  storeId: string;
  role: MemberRole;
};

/**
 * The dashboard banner of the card gate (README §8.4): when the store's policy pauses
 * new reservations or carries a notice. Outside service mode the effective policy is built in, allows
 * reservations and has no notice, so nothing renders.
 */
export const ReservationGateBanner = async ({ storeId, role }: ReservationGateBannerProps) => {
  const [effective, locale] = await Promise.all([
    // It renders on every dashboard page: a failed read hides the banner, not the page.
    getEffectivePolicy(storeId, new Date()).catch((error: unknown) => {
      log.error(
        "billing",
        `card gate banner: policy read failed for store ${storeId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }),
    getLocale(),
  ]);
  const banner = effective ? reservationGateBanner(effective, locale) : null;
  if (!banner) return null;

  const t = await getTranslations("dashboard.reservationGate");
  const paused = banner.kind === "paused";
  return (
    <Alert variant={paused ? "warning" : "info"} className="mb-4">
      {paused ? <TriangleAlertIcon /> : <InfoCircleIcon />}
      <AlertTitle>{paused ? t("pausedTitle") : t("noticeTitle")}</AlertTitle>
      <AlertDescription>
        {banner.label ?? (paused ? t("pausedDescription") : t("noticeDescription"))}
      </AlertDescription>
      {canManageBilling(role) && (
        <AlertAction>
          <Button size="sm" render={<Link href={BILLING_SETTINGS_PATH} />}>
            {t("manageBilling")}
          </Button>
        </AlertAction>
      )}
    </Alert>
  );
};
