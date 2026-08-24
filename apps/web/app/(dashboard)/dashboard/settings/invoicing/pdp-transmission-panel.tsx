import { getTranslations } from "next-intl/server";

import { Alert, AlertDescription, AlertTitle, Button } from "@louez/ui";
import { CalendarCheckIcon, InfoCircleIcon, SendIcon, WarningIcon } from "@louez/ui/icons";

import { PdpConnectionDetails } from "./pdp-connection-details";
import { PdpEnrollmentButton } from "./pdp-enrollment-button";
import type { SuperPdpEnrollment } from "./queries";
import type { PdpTransmissionView } from "./util.pdp-transmission";

type PdpTransmissionPanelProps = {
  enrollment: SuperPdpEnrollment | null;
  view: PdpTransmissionView;
};

const benefits = ["send", "receive", "reporting"] as const;

/**
 * Body of the transmission step: the Super PDP enrollment and its state.
 * Rendered bare inside the setup wizard and wrapped in a card by the manage view.
 */
export const PdpTransmissionPanel = async ({ enrollment, view }: PdpTransmissionPanelProps) => {
  const t = await getTranslations("dashboard.settings.invoicing.transmission");

  const isLocked = view.lockReason !== null;

  return (
    <div className="space-y-6">
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

          <Button
            variant="outline"
            size="sm"
            render={<a href="/dashboard/purchase-invoices" />}
          >
            {t("purchaseInvoicesAction")}
          </Button>
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
    </div>
  );
};
