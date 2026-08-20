import { getTranslations } from "next-intl/server";

import { Alert, AlertDescription, AlertTitle, Badge, Button } from "@louez/ui";
import { CalendarCheckIcon, SendIcon } from "@louez/ui/icons";

import { InvoicingStepCard } from "./invoicing-step-card";

/**
 * Step 3 placeholder. The Super PDP OAuth enrollment is wired in a later phase;
 * for now the card only states what the connection will bring and why it matters.
 */
export const PdpTransmissionCard = async () => {
  const t = await getTranslations("dashboard.settings.invoicing.transmission");
  const benefits = ["send", "receive", "reporting"] as const;

  return (
    <InvoicingStepCard
      step={3}
      title={t("title")}
      description={t("description")}
      muted
      badge={<Badge variant="tertiary">{t("statusComingSoon")}</Badge>}
    >
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

      <Button type="button" variant="outline" disabled className="w-fit">
        {t("connectAction")}
      </Button>
    </InvoicingStepCard>
  );
};
