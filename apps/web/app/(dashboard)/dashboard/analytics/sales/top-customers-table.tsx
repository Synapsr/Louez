"use client";

import Link from "next/link";

import { useTranslations } from "next-intl";

import { Badge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@louez/ui";
import { ParticipantsSolidIcon } from "@louez/ui/icons";
import { formatCurrency } from "@louez/utils";

import { DashboardEmptyState } from "@/components/dashboard/shared/dashboard-empty-state";

interface TopCustomer {
  customerId: string;
  firstName: string;
  lastName: string;
  companyName: string | null;
  customerType: "individual" | "business";
  totalRevenue: string;
  paymentCount: number;
  reservationCount: number;
}

interface TopCustomersTableProps {
  customers: TopCustomer[];
  readOnly?: boolean;
}

/** Gold / silver / bronze for the podium, muted numbers below. */
const RANK_VARIANTS = ["review", "expired", "pending"] as const;

/** Businesses go by their company name, everyone else by their own. */
const getDisplayName = (customer: TopCustomer) =>
  customer.customerType === "business" && customer.companyName
    ? customer.companyName
    : `${customer.firstName} ${customer.lastName}`;

export const TopCustomersTable = ({ customers, readOnly = false }: TopCustomersTableProps) => {
  const t = useTranslations("dashboard.statistics");

  if (customers.length === 0) {
    return <DashboardEmptyState icon={ParticipantsSolidIcon} description={t("noRevenueData")} />;
  }

  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12.5">#</TableHead>
            <TableHead>{t("topCustomers.customer")}</TableHead>
            <TableHead className="text-center">{t("topCustomers.reservations")}</TableHead>
            <TableHead className="hidden text-center md:table-cell">
              {t("topCustomers.payments")}
            </TableHead>
            <TableHead className="text-right">{t("topCustomers.revenue")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {customers.map((customer, index) => (
            <TableRow key={customer.customerId}>
              <TableCell className="font-medium">
                {index < RANK_VARIANTS.length ? (
                  <Badge variant={RANK_VARIANTS[index]} className="tabular-nums">
                    {index + 1}
                  </Badge>
                ) : (
                  <span className="text-muted-foreground tabular-nums">{index + 1}</span>
                )}
              </TableCell>
              <TableCell className="max-w-55">
                <Link
                  href={readOnly ? "#" : `/dashboard/customers/${customer.customerId}`}
                  prefetch={readOnly ? false : undefined}
                  onClick={readOnly ? (event) => event.preventDefault() : undefined}
                  aria-disabled={readOnly || undefined}
                  className="block truncate font-medium hover:underline"
                >
                  {getDisplayName(customer)}
                </Link>
              </TableCell>
              <TableCell className="text-center">
                <Badge variant="expired" className="tabular-nums">
                  {customer.reservationCount}
                </Badge>
              </TableCell>
              <TableCell className="text-muted-foreground hidden text-center tabular-nums md:table-cell">
                {customer.paymentCount}
              </TableCell>
              <TableCell className="text-right font-medium tabular-nums whitespace-nowrap">
                {formatCurrency(parseFloat(customer.totalRevenue))}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
};
