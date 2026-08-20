import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { SettingsPageShell } from "@/components/dashboard/settings-page-shell";
import { getCurrentStore } from "@/lib/store-context";

import { getStoreLegalProfile } from "./actions";
import { InvoicingSettingsForm } from "./invoicing-settings-form";
import { PdpTransmissionCard } from "./pdp-transmission-card";
import { getSuperPdpEnrollment } from "./queries";
import { toLegalProfileFormValues } from "./util.legal-profile-form";
import { resolvePdpEnrollmentResult } from "./util.pdp-transmission";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

type InvoicingSettingsPageProps = {
  /** Set by the Super PDP OAuth routes when they send the merchant back here. */
  searchParams: Promise<{ connected?: string; error?: string }>;
};

const InvoicingSettingsPage = async ({ searchParams }: InvoicingSettingsPageProps) => {
  const store = await getCurrentStore();

  if (!store) {
    redirect("/onboarding");
  }

  const t = await getTranslations("dashboard.settings.invoicing");
  const [{ profile }, enrollment, params] = await Promise.all([
    getStoreLegalProfile(),
    getSuperPdpEnrollment(store.id),
    searchParams,
  ]);
  const defaultCountry = store.settings?.billingAddress?.country ?? "FR";

  return (
    <SettingsPageShell title={t("title")} description={t("description")}>
      <InvoicingSettingsForm profile={profile} defaultCountry={defaultCountry} />
      <PdpTransmissionCard
        enrollment={enrollment}
        profile={toLegalProfileFormValues(profile, defaultCountry)}
        result={resolvePdpEnrollmentResult(params)}
      />
    </SettingsPageShell>
  );
};

export default InvoicingSettingsPage;
