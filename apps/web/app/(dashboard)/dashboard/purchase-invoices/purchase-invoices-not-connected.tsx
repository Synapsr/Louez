import Link from "next/link";

import { getTranslations } from "next-intl/server";

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@louez/ui";
import { CalendarCheckIcon, InfoCircleIcon } from "@louez/ui/icons";

/**
 * Without a Super PDP enrollment no supplier invoice can ever land here, so the
 * inbox shows the one thing that changes that instead of an empty table.
 */
export const PurchaseInvoicesNotConnected = async () => {
  const t = await getTranslations("dashboard.purchaseInvoices.notConnected");

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert variant="info">
          <CalendarCheckIcon />
          <AlertTitle>{t("deadlineTitle")}</AlertTitle>
          <AlertDescription>{t("deadlineDescription")}</AlertDescription>
        </Alert>

        <Alert variant="info">
          <InfoCircleIcon />
          <AlertDescription>{t("howItWorks")}</AlertDescription>
        </Alert>

        <Button className="w-fit" render={<Link href="/dashboard/settings/invoicing" />}>
          {t("connectAction")}
        </Button>
      </CardContent>
    </Card>
  );
};
