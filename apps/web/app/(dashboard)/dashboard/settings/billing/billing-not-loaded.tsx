import { getTranslations } from "next-intl/server";

import { Alert, AlertDescription } from "@louez/ui";
import { InfoCircleIcon } from "@louez/ui/icons";

import type { BillingPageFailure } from "@/lib/billing-sync/pages";

/** What the page says when the service gave nothing: billing being set up, or a failure. */
export const BillingNotLoaded = async ({ failure }: { failure: BillingPageFailure }) => {
  const t = await getTranslations("dashboard.settings.billing");
  return (
    <Alert variant="info">
      <InfoCircleIcon />
      <AlertDescription>
        {failure.reason === "store_unknown" ? t("settingUp") : t("loadFailed")}
      </AlertDescription>
    </Alert>
  );
};
