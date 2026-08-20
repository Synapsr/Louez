"use client";

import { useEffect } from "react";

import { useRouter } from "next/navigation";

import { useTranslations } from "next-intl";

import { Alert, AlertDescription, AlertTitle } from "@louez/ui";
import { CheckCircleIcon, WarningIcon } from "@louez/ui/icons";

import { PDP_RETURN_PATH, type PdpEnrollmentResult } from "./util.pdp-transmission";

type PdpEnrollmentResultAlertProps = {
  result: PdpEnrollmentResult;
};

/** How long the outcome stays in the URL before it is cleaned up. */
const CLEANUP_DELAY_MS = 8000;

/**
 * Feedback banner for the merchant coming back from the Super PDP OAuth flow.
 * The outcome lives in the query string, so it is dropped once it has been read.
 */
export const PdpEnrollmentResultAlert = ({ result }: PdpEnrollmentResultAlertProps) => {
  const router = useRouter();
  const t = useTranslations("dashboard.settings.invoicing.transmission");
  const tErrors = useTranslations("errors");

  useEffect(() => {
    const timeout = setTimeout(() => router.replace(PDP_RETURN_PATH), CLEANUP_DELAY_MS);
    return () => clearTimeout(timeout);
  }, [router]);

  if (result.kind === "success") {
    return (
      <Alert variant="success">
        <CheckCircleIcon />
        <AlertTitle>{t("result.successTitle")}</AlertTitle>
        <AlertDescription>{t("result.successDescription")}</AlertDescription>
      </Alert>
    );
  }

  const description =
    result.reason === "permissionDenied" || result.reason === "generic"
      ? tErrors(result.reason)
      : t(`result.errors.${result.reason}`);

  return (
    <Alert variant="error">
      <WarningIcon />
      <AlertTitle>{t("result.errorTitle")}</AlertTitle>
      <AlertDescription>{description}</AlertDescription>
    </Alert>
  );
};
