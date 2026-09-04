import { getTranslations } from "next-intl/server";

import { Badge } from "@louez/ui";

import type { SuperPdpEnrollment } from "./queries";
import type { PdpVerificationStatus } from "./util.pdp-transmission";

type PdpConnectionDetailsProps = {
  directoryEntryStatus: SuperPdpEnrollment["directoryEntryStatus"];
  environment: SuperPdpEnrollment["environment"];
  verificationStatus: PdpVerificationStatus;
};

const verificationVariants = {
  failed: "error",
  pending: "pending",
  verified: "success",
} as const;

const directoryVariants = {
  created: "success",
  error: "error",
  pending: "pending",
} as const;

const environmentVariants = {
  production: "tertiary",
  sandbox: "warning",
} as const;

/** Read-only state of a live Super PDP connection: KYB, directory, environment. */
export const PdpConnectionDetails = async ({
  directoryEntryStatus,
  environment,
  verificationStatus,
}: PdpConnectionDetailsProps) => {
  const t = await getTranslations("dashboard.settings.invoicing.transmission");

  return (
    <dl className="grid gap-4 sm:grid-cols-3">
      <div className="space-y-1.5">
        <dt className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          {t("details.verification")}
        </dt>
        <dd>
          <Badge variant={verificationVariants[verificationStatus]}>
            {t(`verificationStatus.${verificationStatus}`)}
          </Badge>
        </dd>
      </div>

      <div className="space-y-1.5">
        <dt className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          {t("details.directory")}
        </dt>
        <dd>
          {directoryEntryStatus ? (
            <Badge variant={directoryVariants[directoryEntryStatus]}>
              {t(`directoryStatus.${directoryEntryStatus}`)}
            </Badge>
          ) : (
            <Badge variant="tertiary">{t("directoryStatus.missing")}</Badge>
          )}
        </dd>
      </div>

      <div className="space-y-1.5">
        <dt className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          {t("details.environment")}
        </dt>
        <dd>
          <Badge variant={environmentVariants[environment]}>
            {t(`environments.${environment}`)}
          </Badge>
        </dd>
      </div>
    </dl>
  );
};
