"use client";

import type { ContractSignatureMethod } from "@louez/db";
import { Badge, Tooltip, TooltipContent, TooltipTrigger } from "@louez/ui";
import { cn } from "@louez/utils";
import { FileCheck2, FileClock } from "lucide-react";
import { useTranslations } from "next-intl";

import { useStoreTimezone } from "@/contexts/store-context";
import { useFormatLocale } from "@/hooks/use-format-locale";
import { formatStoreDate } from "@/lib/utils/store-date";

// A quote or a cancelled booking has no contract to sign.
const STATUSES_TO_SIGN = new Set(["pending", "confirmed", "ongoing"]);

/**
 * Whether a reservation shows its signature badge. A finished rental can no longer be
 * signed, so it shows only a signature it has: older manual bookings stay quiet.
 */
export const showsContractSignature = (
  status: string | null | undefined,
  signedAt: Date | string | null | undefined,
) => !!status && (STATUSES_TO_SIGN.has(status) || (status === "completed" && !!signedAt));

interface ContractSignatureBadgeProps {
  signedAt?: Date | string | null;
  signatureMethod?: ContractSignatureMethod | null;
  className?: string;
}

/** Whether the customer accepted the rental contract, with how and when on hover. */
export const ContractSignatureBadge = ({
  signedAt,
  signatureMethod,
  className,
}: ContractSignatureBadgeProps) => {
  const t = useTranslations("dashboard.reservations.contract");
  const { intl: formatLocale } = useFormatLocale();
  const timezone = useStoreTimezone();
  const Icon = signedAt ? FileCheck2 : FileClock;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Badge
            variant={signedAt ? "success" : "warning"}
            className={cn("gap-1 text-xs", className)}
          />
        }
      >
        <Icon className="h-3 w-3" />
        {signedAt ? t("signedBadge") : t("unsignedBadge")}
      </TooltipTrigger>
      <TooltipContent>
        <div className="text-xs">
          {signedAt ? (
            <>
              {signatureMethod && <p>{t(`methods.${signatureMethod}`)}</p>}
              <p>
                {t("signedOn", {
                  date: formatStoreDate(
                    new Date(signedAt),
                    timezone,
                    "SHORT_DATETIME",
                    formatLocale,
                  ),
                })}
              </p>
            </>
          ) : (
            <p className="max-w-[240px]">{t("unsignedTooltip")}</p>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
};
