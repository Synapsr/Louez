import { DownloadIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@louez/ui";

import { AccountCard } from "@/components/storefront/account/account-card";
import { Price } from "@/components/storefront/ui/price";

export interface ReservationInvoiceView {
  id: string;
  number: string;
  type: string;
  amount: number;
  currency: string;
  /** Issue date, formatted. */
  dateLabel: string;
  /** Absolute download URL. */
  href: string;
}

interface ReservationInvoicesCardProps {
  invoices: ReservationInvoiceView[];
}

/** Invoices and credit notes, each with a plain download link. */
export const ReservationInvoicesCard = ({ invoices }: ReservationInvoicesCardProps) => {
  const t = useTranslations("storefront.account.invoiceDocuments");

  if (invoices.length === 0) return null;

  return (
    <AccountCard title={t("title")}>
      <ul className="flex flex-col divide-y">
        {invoices.map((invoice) => (
          <li
            key={invoice.id}
            className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {t(`types.${invoice.type}`)} {invoice.number}
              </p>
              <p className="text-xs text-muted-foreground">
                {invoice.dateLabel}
                <span aria-hidden> · </span>
                <Price amount={invoice.amount} size="sm" className="font-normal" />
              </p>
            </div>
            <Button
              variant="outline"
              size="icon-lg"
              className="lg:size-9"
              render={<a href={invoice.href} aria-label={t("download")} />}
            >
              <DownloadIcon />
            </Button>
          </li>
        ))}
      </ul>
    </AccountCard>
  );
};
