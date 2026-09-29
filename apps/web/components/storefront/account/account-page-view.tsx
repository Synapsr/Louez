import { PackageIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@louez/ui";
import { ReservationListSection } from "@/components/storefront/account/reservation-list-section";
import type { ReservationListItem } from "@/components/storefront/account/reservation-list-card";
import { isCurrentReservationStatus } from "@/components/storefront/account/reservation-status.constants";
import { EmptyState } from "@/components/storefront/ui/empty-state";
import { StorefrontLink } from "@/components/storefront/ui/storefront-link";
import { StorefrontSection } from "@/components/storefront/ui/storefront-section";

interface AccountPageViewProps {
  items: ReservationListItem[];
  prefetch?: boolean;
  onOpenReservation?: (id: string) => void;
}

export const AccountPageView = ({ items, prefetch, onOpenReservation }: AccountPageViewProps) => {
  const t = useTranslations("storefront.account");
  const ongoing = items.filter((item) => item.status === "ongoing");
  const current = items.filter(
    (item) => isCurrentReservationStatus(item.status) && item.status !== "ongoing",
  );
  const past = items.filter((item) => !isCurrentReservationStatus(item.status));

  return (
    <StorefrontSection contentClassName="flex max-w-5xl flex-col gap-6 sm:gap-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-balance text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">
            {t("myReservations")}
          </h1>
        </div>
      </header>

      {items.length === 0 ? (
        <EmptyState
          icon={<PackageIcon />}
          title={t("noReservations")}
          description={t("noReservationsDescription")}
          tone="card"
          action={
            <Button size="lg" render={<StorefrontLink href="/catalog" prefetch={prefetch} />}>
              {t("viewCatalog")}
            </Button>
          }
        />
      ) : (
        <>
          <ReservationListSection
            title={t("status.ongoing")}
            reservations={ongoing}
            prefetch={prefetch}
            onOpenReservation={onOpenReservation}
          />
          <ReservationListSection
            title={t("currentReservations")}
            reservations={current}
            prefetch={prefetch}
            onOpenReservation={onOpenReservation}
          />
          <ReservationListSection
            title={t("pastReservations")}
            reservations={past}
            prefetch={prefetch}
            onOpenReservation={onOpenReservation}
          />
        </>
      )}
    </StorefrontSection>
  );
};
