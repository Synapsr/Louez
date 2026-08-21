import Link from "next/link";

import { getTranslations } from "next-intl/server";

import { Button, Card, CardContent } from "@louez/ui";
import { FileTextIcon } from "@louez/ui/icons";

/** Connected, but nothing has arrived yet — reception is passive, so say so. */
export const PurchaseInvoicesEmptyState = async () => {
  const t = await getTranslations("dashboard.purchaseInvoices.empty");

  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center py-16 text-center">
        <div className="bg-muted mb-4 flex size-14 items-center justify-center rounded-full">
          <FileTextIcon className="text-muted-foreground size-7" />
        </div>
        <h3 className="text-lg font-semibold">{t("title")}</h3>
        <p className="text-muted-foreground mt-1 max-w-sm text-sm">{t("description")}</p>
        <Button
          className="mt-4"
          variant="outline"
          render={<Link href="/dashboard/settings/invoicing" />}
        >
          {t("settingsAction")}
        </Button>
      </CardContent>
    </Card>
  );
};
