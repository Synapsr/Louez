import { getTranslations } from "next-intl/server";

import { Badge } from "@louez/ui";

import { resolveReceivedInvoiceStatus } from "./util.purchase-invoices";

type PurchaseInvoiceStatusBadgeProps = {
  /** Raw Super PDP lifecycle code, `null` until the first event lands. */
  latestStatus: string | null;
};

/** Where the invoice stands in the PDP network's lifecycle. */
export const PurchaseInvoiceStatusBadge = async ({
  latestStatus,
}: PurchaseInvoiceStatusBadgeProps) => {
  const t = await getTranslations("dashboard.purchaseInvoices.statuses");
  const status = resolveReceivedInvoiceStatus(latestStatus);

  // An unnamed provider code is printed verbatim: guessing a label for a legal
  // lifecycle status would be worse than showing the code itself.
  return <Badge variant={status.variant}>{status.slug ? t(status.slug) : status.code}</Badge>;
};
