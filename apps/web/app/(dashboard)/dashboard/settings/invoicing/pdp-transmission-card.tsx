import { getTranslations } from "next-intl/server";

import { Alert, AlertDescription, AlertTitle, Badge } from "@louez/ui";
import { CalendarCheckIcon, InfoCircleIcon, SendIcon, WarningIcon } from "@louez/ui/icons";
import type { StoreLegalProfileInput } from "@louez/validations";

import { InvoicingStepCard } from "./invoicing-step-card";
import { PdpConnectionDetails } from "./pdp-connection-details";
import { PdpEnrollmentButton } from "./pdp-enrollment-button";
import { PdpEnrollmentResultAlert } from "./pdp-enrollment-result-alert";
import type { SuperPdpEnrollment } from "./queries";
import { resolvePdpTransmissionView, type PdpEnrollmentResult } from "./util.pdp-transmission";

type PdpTransmissionCardProps = {
  enrollment: SuperPdpEnrollment | null;
  profile: StoreLegalProfileInput;
  /** Outcome of the OAuth round trip, when the merchant just came back. */
  result: PdpEnrollmentResult | null;
};

const stateBadgeVariants = {
  actionRequired: "error",
  connected: "success",
  notConnected: "tertiary",
  pending: "pending",
} as const;

const benefits = ["send", "receive", "reporting"] as const;

/** Step 3: enroll the store with Super PDP and show the state of that enrollment. */
export const PdpTransmissionCard = async ({
  enrollment,
  profile,
  result,
}: PdpTransmissionCardProps) => {
  const t = await getTranslations("dashboard.settings.invoicing.transmission");
  const tIntegrations = await getTranslations("dashboard.settings.integrationsHub");

  const view = resolvePdpTransmissionView({ enrollment, profile });
  const isLocked = view.lockReason !== null;

  const stateLabel =
    view.state === "connected"
      ? tIntegrations("statusLabels.connected")
      : view.state === "pending"
        ? t("statusPending")
        : view.state === "actionRequired"
          ? t("statusActionRequired")
          : tIntegrations("statusLabels.notConnected");

  return (
    <InvoicingStepCard
      step={3}
      title={t("title")}
      description={t("description")}
      muted={isLocked && view.state === "notConnected"}
      badge={<Badge variant={stateBadgeVariants[view.state]}>{stateLabel}</Badge>}
    >
      {result && <PdpEnrollmentResultAlert result={result} />}

      {view.lockReason && (
        <Alert variant="info">
          <InfoCircleIcon />
          <AlertTitle>{t("lockedTitle")}</AlertTitle>
          <AlertDescription>{t(`lockedReasons.${view.lockReason}`)}</AlertDescription>
        </Alert>
      )}

      {view.state === "notConnected" && (
        <>
          <Alert variant="info">
            <CalendarCheckIcon />
            <AlertTitle>{t("deadlineTitle")}</AlertTitle>
            <AlertDescription>{t("deadlineDescription")}</AlertDescription>
          </Alert>

          <ul className="text-muted-foreground space-y-2 text-sm">
            {benefits.map((benefit) => (
              <li key={benefit} className="flex items-start gap-2">
                <SendIcon className="mt-0.5 size-4 shrink-0" />
                <span>{t(`benefits.${benefit}`)}</span>
              </li>
            ))}
          </ul>

          <PdpEnrollmentButton labelKey="connectAction" disabled={isLocked} />
        </>
      )}

      {view.state === "pending" && (
        <>
          <Alert variant="info">
            <InfoCircleIcon />
            <AlertTitle>{t("pendingTitle")}</AlertTitle>
            <AlertDescription>{t("pendingDescription")}</AlertDescription>
          </Alert>

          <PdpEnrollmentButton labelKey="resumeAction" disabled={isLocked} variant="outline" />
        </>
      )}

      {view.state === "connected" && enrollment && (
        <>
          <PdpConnectionDetails
            directoryEntryStatus={enrollment.directoryEntryStatus}
            environment={enrollment.environment}
            verificationStatus={view.verificationStatus}
          />

          {view.verificationStatus === "pending" && (
            <p className="text-muted-foreground text-sm">{t("verificationPendingNote")}</p>
          )}
        </>
      )}

      {view.state === "actionRequired" && view.errorHint && (
        <>
          <Alert variant="error">
            <WarningIcon />
            <AlertTitle>{t("errorTitle")}</AlertTitle>
            <AlertDescription>{t(`errorHints.${view.errorHint}`)}</AlertDescription>
          </Alert>

          <PdpEnrollmentButton labelKey="reconnectAction" disabled={isLocked} />
        </>
      )}
    </InvoicingStepCard>
  );
};
