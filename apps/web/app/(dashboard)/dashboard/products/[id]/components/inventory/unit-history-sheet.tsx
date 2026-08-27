"use client";

import Link from "next/link";

import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";

import {
  Badge,
  Button,
  Drawer,
  DrawerDescription,
  DrawerHeader,
  DrawerPanel,
  DrawerPopup,
  DrawerTitle,
} from "@louez/ui";
import {
  ClockSolidIcon,
  PendingSolidIcon,
  ProductSolidIcon,
  RepeatSolidIcon,
  ReviewSolidIcon,
  SpinnerSolidIcon,
} from "@louez/ui/icons";

import { productUnitHistoryQueries } from "@/lib/queries/product-unit-history.queries";
import { formatDateTime, formatRelativeTime } from "@/lib/utils";
import { useFormatLocale } from "@/hooks/use-format-locale";

import type { ProductInventoryUnit } from "../../queries";
import {
  UNIT_EVENT_CONFIG,
  type UnitActivityBadgeVariant,
} from "../product-unit-activity.constants";

interface UnitHistorySheetProps {
  open: boolean;
  unit: ProductInventoryUnit | null;
  onOpenChange: (open: boolean) => void;
}

const DOWNTIME_STATUS_CONFIG: Record<
  "current" | "upcoming" | "past",
  {
    icon: typeof PendingSolidIcon;
    variant: UnitActivityBadgeVariant;
  }
> = {
  current: { icon: PendingSolidIcon, variant: "pending" },
  upcoming: { icon: ReviewSolidIcon, variant: "review" },
  past: { icon: ClockSolidIcon, variant: "expired" },
};

export const UnitHistorySheet = ({ open, unit, onOpenChange }: UnitHistorySheetProps) => {
  const t = useTranslations("dashboard.inventory.history");
  const tDowntime = useTranslations("dashboard.inventory.downtime");
  const tReasons = useTranslations("dashboard.inventory.downtimeReasons");
  const tErrors = useTranslations("errors");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const { intl: formatLocale } = useFormatLocale();
  const unitId = unit?.id ?? "";
  const historyQuery = useQuery({
    ...productUnitHistoryQueries.detail(unitId),
    enabled: open && unit !== null,
  });
  const timeline = historyQuery.data?.timeline ?? [];
  const downtimes = historyQuery.data?.downtimes ?? [];
  const hasNoHistory = historyQuery.isSuccess && timeline.length === 0 && downtimes.length === 0;

  return (
    <Drawer position="right" open={open} onOpenChange={onOpenChange}>
      <DrawerPopup variant="inset" className="max-w-xl" showCloseButton>
        <DrawerHeader>
          <DrawerTitle>{t("title")}</DrawerTitle>
          <DrawerDescription>
            {unit ? t("description", { identifier: unit.identifier }) : ""}
          </DrawerDescription>
        </DrawerHeader>

        <DrawerPanel>
          {historyQuery.isPending && open && unit ? (
            <div
              aria-label={t("loading")}
              className="text-muted-foreground flex min-h-32 items-center justify-center"
              role="status"
            >
              <SpinnerSolidIcon className="size-5 animate-spin" />
            </div>
          ) : null}

          {historyQuery.isError ? (
            <div className="flex min-h-32 flex-col items-center justify-center gap-3 text-center">
              <p className="text-muted-foreground text-sm">{tErrors("generic")}</p>
              <Button onClick={() => void historyQuery.refetch()} size="sm" variant="outline">
                <RepeatSolidIcon />
                {tCommon("refresh")}
              </Button>
            </div>
          ) : null}

          {hasNoHistory ? (
            <div className="rounded-lg border border-dashed p-6 text-center">
              <ProductSolidIcon className="text-muted-foreground mx-auto size-8" />
              <p className="mt-2 text-sm font-medium">{t("empty")}</p>
            </div>
          ) : null}

          {historyQuery.isSuccess && !hasNoHistory ? (
            <div className="space-y-8">
              <section className="space-y-3">
                <h3 className="text-sm font-semibold">{t("downtimes.title")}</h3>
                {downtimes.length === 0 ? (
                  <p className="text-muted-foreground text-sm">{t("downtimes.empty")}</p>
                ) : (
                  <div className="space-y-3">
                    {downtimes.map((downtime) => {
                      const config = DOWNTIME_STATUS_CONFIG[downtime.status];
                      const StatusIcon = config.icon;

                      return (
                        <div
                          key={downtime.id}
                          className="flex items-start gap-3 rounded-lg border p-3 text-sm"
                        >
                          <Badge
                            aria-hidden="true"
                            className="mt-0.5 size-6 min-w-0 rounded-full p-0"
                            variant={config.variant}
                          >
                            <StatusIcon />
                          </Badge>
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <p className="font-medium">{tReasons(downtime.reason)}</p>
                              <Badge variant={config.variant}>
                                {t(`downtimes.status.${downtime.status}`)}
                              </Badge>
                            </div>
                            <p className="text-muted-foreground">
                              {formatDateTime(downtime.startsAt, formatLocale)} →{" "}
                              {downtime.endsAt
                                ? formatDateTime(downtime.endsAt, formatLocale)
                                : tDowntime("openEnded")}
                            </p>
                            {downtime.note ? (
                              <p className="text-muted-foreground pt-1">{downtime.note}</p>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              <ol className="space-y-4">
                {timeline.map((entry) => {
                  const config = UNIT_EVENT_CONFIG[entry.type];
                  const Icon = config.icon;
                  const label =
                    entry.kind === "event"
                      ? t(`events.${entry.type}`)
                      : t("events.assignment", {
                          number: entry.reservationNumber,
                        });
                  const actor =
                    entry.kind === "event"
                      ? (entry.actorName ?? t("systemActor"))
                      : (entry.customerName ?? t("unknownCustomer"));

                  return (
                    <li key={`${entry.kind}-${entry.id}`} className="flex gap-3">
                      <Badge
                        aria-hidden="true"
                        className="mt-0.5 size-7 min-w-0 rounded-full p-0"
                        variant={config.variant}
                      >
                        <Icon />
                      </Badge>
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                          <p className="font-medium">{label}</p>
                          <p className="text-muted-foreground shrink-0 text-xs">
                            {formatRelativeTime(entry.createdAt, locale)}
                          </p>
                        </div>
                        <p className="text-muted-foreground text-sm">{t("byActor", { actor })}</p>
                        <p className="text-muted-foreground text-xs">
                          <ClockSolidIcon className="mr-1 inline size-3" />
                          {formatDateTime(entry.createdAt, formatLocale)}
                        </p>
                        {entry.kind === "assignment" ? (
                          <Link
                            href={`/dashboard/reservations/${entry.reservationId}`}
                            className="text-primary inline-flex text-sm hover:underline"
                          >
                            {t("viewReservation")}
                          </Link>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          ) : null}
        </DrawerPanel>
      </DrawerPopup>
    </Drawer>
  );
};
