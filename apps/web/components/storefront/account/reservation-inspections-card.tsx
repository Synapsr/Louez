import { CameraIcon, DownloadIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Badge, Button } from "@louez/ui";

import { AccountCard } from "@/components/storefront/account/account-card";
import { Price } from "@/components/storefront/ui/price";

export interface ReservationInspectionView {
  id: string;
  type: "departure" | "return";
  /** Formatted in the store timezone. */
  dateLabel: string;
  /** Set once the customer signed it. */
  signedLabel: string | null;
  hasDamage: boolean;
  estimatedDamageCost: number | null;
  photoCount: number;
  /** Absolute PDF URL. */
  href: string;
}

interface ReservationInspectionsCardProps {
  inspections: ReservationInspectionView[];
}

/**
 * The condition reports written with the store at pickup and at return,
 * each downloadable as the PDF with its photos.
 */
export const ReservationInspectionsCard = ({ inspections }: ReservationInspectionsCardProps) => {
  const t = useTranslations("storefront.account.inspections");

  if (inspections.length === 0) return null;

  return (
    <AccountCard title={t("title")}>
      <ul className="flex flex-col divide-y">
        {inspections.map((inspection) => (
          <li
            key={inspection.id}
            className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
          >
            <div className="flex min-w-0 flex-col gap-1">
              <p className="text-sm font-medium">{t(inspection.type)}</p>
              <p className="text-xs text-muted-foreground">
                {inspection.signedLabel
                  ? t("signed", { date: inspection.signedLabel })
                  : t("completed", { date: inspection.dateLabel })}
              </p>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant={inspection.hasDamage ? "warning" : "success"} size="sm">
                  {t(inspection.hasDamage ? "damage" : "noDamage")}
                </Badge>
                {inspection.photoCount > 0 ? (
                  <Badge variant="tertiary" size="sm">
                    <CameraIcon aria-hidden />
                    {t("photoCount", { count: inspection.photoCount })}
                  </Badge>
                ) : null}
              </div>
              {inspection.hasDamage && inspection.estimatedDamageCost !== null ? (
                <p className="text-xs text-muted-foreground">
                  {t("estimatedCost")}{" "}
                  <Price
                    amount={inspection.estimatedDamageCost}
                    size="sm"
                    className="font-normal"
                  />
                </p>
              ) : null}
            </div>
            <Button
              variant="outline"
              size="icon-lg"
              className="lg:size-9"
              render={<a href={inspection.href} aria-label={t("download")} />}
            >
              <DownloadIcon />
            </Button>
          </li>
        ))}
      </ul>
    </AccountCard>
  );
};
