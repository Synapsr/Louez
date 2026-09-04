import { getFormatter, getTranslations } from "next-intl/server";

import {
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@louez/ui";
import { formatCurrency } from "@louez/utils";

import type { ReceivedInvoiceListItem } from "./queries";
import { PurchaseInvoiceActionBadge } from "./purchase-invoice-action-badge";
import { PurchaseInvoiceActions } from "./purchase-invoice-actions";
import { PurchaseInvoiceStatusBadge } from "./purchase-invoice-status-badge";
import { parseReceivedInvoiceIssueDate } from "./util.purchase-invoices";

type PurchaseInvoicesTableProps = {
  invoices: ReceivedInvoiceListItem[];
};

/** The inbox itself: one row per supplier invoice received through Super PDP. */
export const PurchaseInvoicesTable = async ({ invoices }: PurchaseInvoicesTableProps) => {
  const t = await getTranslations("dashboard.purchaseInvoices.columns");
  const format = await getFormatter();

  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("seller")}</TableHead>
                <TableHead>{t("number")}</TableHead>
                <TableHead>{t("issueDate")}</TableHead>
                <TableHead className="text-right">{t("totalInclTax")}</TableHead>
                <TableHead>{t("status")}</TableHead>
                <TableHead>{t("ourAction")}</TableHead>
                <TableHead className="text-right">{t("actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((invoice) => (
                <TableRow key={invoice.id}>
                  <TableCell>
                    <div className="min-w-0">
                      <div className="truncate font-medium">{invoice.sellerName}</div>
                      <div className="text-muted-foreground truncate text-sm">
                        {invoice.sellerIdentifier}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="font-medium">{invoice.number}</TableCell>
                  <TableCell className="text-muted-foreground whitespace-nowrap">
                    {format.dateTime(parseReceivedInvoiceIssueDate(invoice.issueDate), {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })}
                  </TableCell>
                  <TableCell className="text-right font-medium whitespace-nowrap">
                    {formatCurrency(Number(invoice.totalInclTax), invoice.currency)}
                  </TableCell>
                  <TableCell>
                    <PurchaseInvoiceStatusBadge latestStatus={invoice.latestStatus} />
                  </TableCell>
                  <TableCell>
                    <PurchaseInvoiceActionBadge ourAction={invoice.ourAction} />
                  </TableCell>
                  <TableCell>
                    <PurchaseInvoiceActions
                      invoiceNumber={invoice.number}
                      ourAction={invoice.ourAction}
                      receivedInvoiceId={invoice.id}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
};
