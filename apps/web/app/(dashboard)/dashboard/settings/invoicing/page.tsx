import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { SettingsPageShell } from "@/components/dashboard/settings-page-shell";
import { getCurrentStore } from "@/lib/store-context";

import { getStoreLegalProfile } from "./actions";
import { DevResetButton } from "./dev-reset-button";
import { InvoicingFlow } from "./invoicing-flow";
import { PdpEnrollmentResultAlert } from "./pdp-enrollment-result-alert";
import { PdpTransmissionPanel } from "./pdp-transmission-panel";
import { getSuperPdpEnrollment } from "./queries";
import { isLegalIdentityComplete, toLegalProfileFormValues } from "./util.legal-profile-form";
import { resolvePdpEnrollmentResult, resolvePdpTransmissionView } from "./util.pdp-transmission";
import type { InvoicingSetupProgress } from "./util.setup-progress";

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
  const [profileResult, enrollment, params] = await Promise.all([
    getStoreLegalProfile(),
    getSuperPdpEnrollment(store.id),
    searchParams,
  ]);
  const profile = profileResult.status === "success" ? profileResult.profile : null;
  const defaultCountry = store.settings?.billingAddress?.country ?? "FR";

  const formValues = toLegalProfileFormValues(profile, defaultCountry);
  const view = resolvePdpTransmissionView({ enrollment, profile: formValues });
  const progress: InvoicingSetupProgress = {
    identityComplete: isLegalIdentityComplete(formValues),
    invoicingActive: formValues.invoicingEnabled,
    transmissionState: view.state,
  };
  const result = resolvePdpEnrollmentResult(params);

  return (
    <SettingsPageShell
      title={t("title")}
      description={t("description")}
      actions={process.env.NODE_ENV === "development" ? <DevResetButton /> : undefined}
    >
      {result && <PdpEnrollmentResultAlert result={result} />}
      {/* Keyed on the row so only its creation (first save) or deletion (dev
          reset) remounts the flow — never a mid-wizard save. */}
      <InvoicingFlow
        key={profile?.id ?? "empty"}
        defaultCountry={defaultCountry}
        profile={profile}
        progress={progress}
        transmissionEnvironment={enrollment?.environment ?? null}
        transmissionPanel={<PdpTransmissionPanel enrollment={enrollment} view={view} />}
        verificationStatus={view.verificationStatus}
      />
    </SettingsPageShell>
  );
};

export default InvoicingSettingsPage;
