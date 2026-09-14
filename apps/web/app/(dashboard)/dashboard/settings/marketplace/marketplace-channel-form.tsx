"use client";

import { useMemo, useState, useTransition } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { useFormatter, useTranslations } from "next-intl";

import type { MarketplaceChannelState } from "@louez/api/services";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPanel,
  AlertDialogTitle,
  Badge,
  Button,
  Switch,
  toastManager,
} from "@louez/ui";
import { ArrowRightIcon, CheckIcon, ExternalLinkIcon, StoreIcon } from "@louez/ui/icons";
import { MarketplaceCohortNotice } from "@/components/dashboard/marketplace-cohort-notice";
import { DashboardIconTile } from "@/components/dashboard/shared/dashboard-icon-tile";
import { ReeentMark } from "@/components/shared/reeent-mark";
import { ReeentWordmark } from "@/components/shared/reeent-wordmark";

import { disableMarketplaceChannel, enableMarketplaceChannel } from "./actions";
import { PublicationChecklistDialog } from "./publication-checklist-dialog";
import { SalesChannelRow } from "./sales-channel-row";
import { useServiceErrorToast } from "./use-service-error-toast";

type ChannelStatus = NonNullable<MarketplaceChannelState["channel"]>["status"];

type MarketplaceChannelFormProps = {
  channelState: MarketplaceChannelState;
  /** Seats left in the "Offre reeent à vie" launch cohort (ADR 010). */
  cohortRemaining: number;
  storefrontUrl: string;
};

const MARKETPLACE_BENEFITS = ["visibility", "seo", "free"] as const;

const DISABLE_CONSEQUENCES = ["search", "redirect", "links"] as const;

const STATUS_VARIANT: Record<ChannelStatus, "warning" | "pending" | "success" | "expired"> = {
  setup_required: "warning",
  pending: "pending",
  published: "success",
  paused: "expired",
  disabled: "expired",
};

export const MarketplaceChannelForm = ({
  channelState,
  cohortRemaining,
  storefrontUrl,
}: MarketplaceChannelFormProps) => {
  const t = useTranslations("dashboard.settings.salesChannels");
  const format = useFormatter();
  const router = useRouter();
  const notifyError = useServiceErrorToast();
  const [isPending, startTransition] = useTransition();
  const [disableDialogOpen, setDisableDialogOpen] = useState(false);

  const { channel, checklist } = channelState;
  const isEnabled = channel?.enabledByOwner === true;

  const statusReasonText = useMemo(() => {
    const reason = channel?.statusReason;
    if (!reason || reason === "default_publication") {
      return null;
    }
    if (reason === "disabled_by_owner") {
      return t("status.reason.disabledByOwner");
    }
    if (reason.startsWith("missing:")) {
      return t("status.reason.missing");
    }

    return reason;
  }, [channel?.statusReason, t]);

  const handleEnable = (acceptTerms: boolean) => {
    startTransition(async () => {
      const result = await enableMarketplaceChannel({ acceptTerms });
      if ("error" in result) {
        notifyError(result.error);
        return;
      }

      toastManager.add({
        title: acceptTerms ? t("toasts.termsAccepted") : t("toasts.enabled"),
        type: "success",
      });
      router.refresh();
    });
  };

  const handleDisable = () => {
    startTransition(async () => {
      const result = await disableMarketplaceChannel();
      if ("error" in result) {
        notifyError(result.error);
        return;
      }

      toastManager.add({ title: t("toasts.disabled"), type: "success" });
      router.refresh();
    });
  };

  return (
    <section className="min-w-0 space-y-4">
      <ul className="space-y-3">
        <SalesChannelRow
          icon={<DashboardIconTile icon={StoreIcon} />}
          name={t("channels.storefront.name")}
          badge={<Badge variant="tertiary">{t("channels.storefront.alwaysOn")}</Badge>}
          description={t("channels.storefront.description")}
          aside={
            <>
              <Button
                size="sm"
                variant="ghost"
                className="max-sm:hidden"
                render={<Link href="/online-store/identity" />}
              >
                {t("channels.storefront.customizeAction")}
                <ArrowRightIcon className="size-4" />
              </Button>
              <Button
                size="sm"
                variant="outline"
                render={<a href={storefrontUrl} target="_blank" rel="noreferrer" />}
              >
                <ExternalLinkIcon className="size-4" />
                {t("channels.storefront.viewAction")}
              </Button>
            </>
          }
        />
        <SalesChannelRow
          icon={<ReeentMark className="size-9 rounded-lg" />}
          name={<ReeentWordmark>reeent</ReeentWordmark>}
          badge={<Badge variant="default">{t("channels.marketplace.recommended")}</Badge>}
          description={t("channels.marketplace.description")}
          aside={
            <Switch
              aria-label={t("channels.marketplace.enableLabel")}
              className="data-checked:bg-reeent"
              checked={isEnabled}
              disabled={isPending}
              onCheckedChange={(checked) => {
                if (checked) {
                  handleEnable(false);
                  return;
                }
                setDisableDialogOpen(true);
              }}
            />
          }
        >
          {/* The benefits are the pitch: they matter while the channel is off. */}
          {!isEnabled && (
            <ul className="space-y-1.5">
              {MARKETPLACE_BENEFITS.map((benefit) => (
                <li key={benefit} className="text-muted-foreground flex items-start gap-2 text-sm">
                  <CheckIcon className="text-reeent mt-0.5 size-4 shrink-0" />
                  <span>{t(`channels.marketplace.benefits.${benefit}`)}</span>
                </li>
              ))}
            </ul>
          )}

          {/* The waiver is the reason to publish, and once earned the reason to stay. */}
          <MarketplaceCohortNotice
            lifetimeFeeWaiverAt={channel?.lifetimeFeeWaiverAt ?? null}
            cohortRank={channel?.cohortRank ?? null}
            remaining={cohortRemaining}
          />

          {channel && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <Badge variant={STATUS_VARIANT[channel.status]}>
                {t(`status.values.${channel.status}`)}
              </Badge>
              {channel.publishedAt && (
                <span className="text-muted-foreground text-sm">
                  {t("status.publishedAt", {
                    date: format.dateTime(new Date(channel.publishedAt), { dateStyle: "medium" }),
                  })}
                </span>
              )}
              {statusReasonText && (
                <span className="text-muted-foreground text-sm">{statusReasonText}</span>
              )}
              {isEnabled && !checklist.complete && (
                <PublicationChecklistDialog
                  checklist={checklist}
                  termsAcceptedAt={channel.termsAcceptedAt ?? null}
                  isPending={isPending}
                  onAcceptTerms={() => handleEnable(true)}
                />
              )}
            </div>
          )}
        </SalesChannelRow>
      </ul>

      <AlertDialog open={disableDialogOpen} onOpenChange={setDisableDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("disable.title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("disable.description")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogPanel>
            <ul className="text-muted-foreground space-y-2 text-sm">
              {DISABLE_CONSEQUENCES.map((consequence) => (
                <li key={consequence} className="flex items-start gap-2">
                  <ArrowRightIcon className="mt-0.5 size-4 shrink-0" />
                  <span>{t(`disable.consequences.${consequence}`)}</span>
                </li>
              ))}
            </ul>
          </AlertDialogPanel>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>
              {t("disable.cancel")}
            </AlertDialogClose>
            <AlertDialogClose render={<Button variant="destructive" />} onClick={handleDisable}>
              {t("disable.confirm")}
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
};
