"use client";

import { useState } from "react";

import Link from "next/link";

import { ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";

import { dismissNotice } from "@/app/(dashboard)/dashboard/actions";
import { useInstanceConfig } from "@/components/instance-provider";
import { useStoreHasPermission } from "@/contexts/store-context";
import type { DismissibleNoticeId } from "@/lib/dashboard/dismissed-notices";

import type { HomeCohortNotice } from "./home-types";
import { ReeentBannerAction } from "./reeent-banner-action";
import { ReeentBannerDismiss } from "./reeent-banner-dismiss";
import { ReeentBannerShell } from "./reeent-banner-shell";
import { reeentBannerTags } from "./util.reeent-banner-tags";

interface ReeentOfferBannerProps {
  notice: HomeCohortNotice;
  /** reeent's home, the wordmark's link; null when the instance has none. */
  reeentUrl: string | null;
}

/**
 * The reeent launch offer on the home, in reeent's own voice: to a Louez
 * store, the seats still open — what reeent brings and what it costs (nothing,
 * for the first stores); to a member, that its store is on reeent for good,
 * with a way to its page. Same rules as the settings' cohort notice: only
 * where the instance bills, nothing once the seats are gone, and each state is
 * closed for good on its own.
 */
export const ReeentOfferBanner = ({ notice, reeentUrl }: ReeentOfferBannerProps) => {
  const t = useTranslations("dashboard.home.reeentBanner");
  const canManage = useStoreHasPermission("manage_settings");
  const { billingEnabled } = useInstanceConfig();
  const [closedNow, setClosedNow] = useState(false);

  const isMember = notice.lifetimeFeeWaiverAt !== null;
  const noticeId: DismissibleNoticeId = isMember ? "reeent-cohort-member" : "reeent-cohort-seats";

  if (!billingEnabled || closedNow || notice.dismissedNoticeIds.includes(noticeId)) return null;
  if (!isMember && notice.remaining <= 0) return null;

  const dismiss = (
    <ReeentBannerDismiss
      label={t("dismiss")}
      onDismiss={() => {
        // Hidden at once; a failed save only means it shows again next visit.
        setClosedNow(true);
        void dismissNotice(noticeId);
      }}
    />
  );

  if (isMember) {
    // The member's own page on reeent, when the store is listed there now.
    const tags = reeentBannerTags(notice.listingUrl ?? reeentUrl);
    return (
      <ReeentBannerShell
        badge="published"
        actions={
          <>
            {notice.listingUrl && (
              <ReeentBannerAction
                icon={<ExternalLink />}
                render={<a href={notice.listingUrl} target="_blank" rel="noreferrer" />}
              >
                {t("member.action")}
              </ReeentBannerAction>
            )}
            {dismiss}
          </>
        }
      >
        {notice.cohortRank !== null
          ? t.rich("member.textRank", { ...tags, total: notice.total, rank: notice.cohortRank })
          : t.rich("member.text", { ...tags, total: notice.total })}
      </ReeentBannerShell>
    );
  }

  return (
    <ReeentBannerShell
      actions={
        <>
          {canManage && (
            <ReeentBannerAction render={<Link href="/dashboard/settings/marketplace" />}>
              {t("seats.action")}
            </ReeentBannerAction>
          )}
          {dismiss}
        </>
      }
    >
      {t.rich("seats.text", { ...reeentBannerTags(reeentUrl), total: notice.total })}
    </ReeentBannerShell>
  );
};
