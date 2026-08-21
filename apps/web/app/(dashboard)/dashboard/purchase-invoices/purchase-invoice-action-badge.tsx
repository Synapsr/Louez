import { getTranslations } from "next-intl/server";

import { Badge } from "@louez/ui";

import {
  resolveReceivedInvoiceActionVariant,
  type ReceivedInvoiceAction,
} from "./util.purchase-invoices";

type PurchaseInvoiceActionBadgeProps = {
  ourAction: ReceivedInvoiceAction;
};

/** What the store itself has already declared to the PDP network. */
export const PurchaseInvoiceActionBadge = async ({
  ourAction,
}: PurchaseInvoiceActionBadgeProps) => {
  const t = await getTranslations("dashboard.purchaseInvoices.ourActions");

  return <Badge variant={resolveReceivedInvoiceActionVariant(ourAction)}>{t(ourAction)}</Badge>;
};
