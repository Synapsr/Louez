import { redirect } from "next/navigation";

import { getTranslations } from "next-intl/server";

import { getReferralData } from "@/app/(dashboard)/dashboard/referrals/actions";
import { ReferralHowItWorks } from "@/app/(dashboard)/dashboard/referrals/referral-how-it-works";
import { ReferralHubViewedTracker } from "@/app/(dashboard)/dashboard/referrals/referral-hub-viewed-tracker";
import { ReferralLink } from "@/app/(dashboard)/dashboard/referrals/referral-link";
import { ReferralStats } from "@/app/(dashboard)/dashboard/referrals/referral-stats";
import { ReferralsList } from "@/app/(dashboard)/dashboard/referrals/referrals-list";
import { SettingsPageShell } from "@/components/dashboard/settings-page-shell";
import { requirePlatformBilling } from "@/lib/billing/require-billing";
import { getCurrentStore } from "@/lib/store-context";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

const SettingsReferralsPage = async () => {
  requirePlatformBilling();
  const store = await getCurrentStore();
  if (!store) {
    redirect("/onboarding");
  }

  const t = await getTranslations("dashboard.referrals");
  const data = await getReferralData();

  if (!data) {
    redirect("/onboarding");
  }

  return (
    <SettingsPageShell
      title={t("title")}
      description={t("description")}
      actions={
        <ReferralHowItWorks
          referrerReward={data.program.referrerReward}
          referredReward={data.program.referredReward}
          referrerRewardKind={data.program.referrerRewardKind}
          minQualifyingAmountCents={data.program.minQualifyingAmountCents}
          currency={data.program.currency}
        />
      }
    >
      <ReferralHubViewedTracker
        storeId={data.storeId}
        totalReferrals={data.stats.total}
        qualifiedReferrals={data.stats.qualified}
        freeReservationsEarned={data.stats.freeReservationsEarned}
        rewardValueCents={data.stats.rewardValueCents}
        freeReservationsRemaining={data.stats.freeReservationsRemaining}
        rewardKind={data.program.referrerRewardKind}
        referrerReward={data.program.referrerReward}
        referredReward={data.program.referredReward}
        minQualifyingAmountCents={data.program.minQualifyingAmountCents}
        currency={data.program.currency}
      />

      <ReferralLink
        storeId={data.storeId}
        referralUrl={data.referralUrl}
        referrerReward={data.program.referrerReward}
        referredReward={data.program.referredReward}
        rewardKind={data.program.referrerRewardKind}
        rewardValueCents={data.program.rewardValueCents}
        currency={data.program.currency}
      />
      <ReferralStats stats={data.stats} />
      <ReferralsList referrals={data.referrals} />
    </SettingsPageShell>
  );
};

export default SettingsReferralsPage;
