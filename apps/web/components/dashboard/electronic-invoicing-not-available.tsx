import { getTranslations } from "next-intl/server";

import { Card, CardDescription, CardHeader, CardTitle } from "@louez/ui";

export const ElectronicInvoicingNotAvailable = async () => {
  const t = await getTranslations("dashboard.electronicInvoicingUnavailable");

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
    </Card>
  );
};
