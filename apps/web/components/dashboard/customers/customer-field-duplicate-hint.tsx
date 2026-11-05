"use client";

import Link from "next/link";

import { useQuery } from "@tanstack/react-query";
import { TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";

import { useDebounce } from "@/hooks/use-debounce";
import { orpc } from "@/lib/orpc/react";

interface CustomerFieldDuplicateHintProps {
  definitionId: string;
  value: string;
  customerId?: string;
}

const MIN_LENGTH = 4;

/** Tells the person typing an identifier that another record already carries it. */
export const CustomerFieldDuplicateHint = ({
  definitionId,
  value,
  customerId,
}: CustomerFieldDuplicateHintProps) => {
  const t = useTranslations("dashboard.customers.fields");
  const debounced = useDebounce(value.trim(), 400);

  const { data } = useQuery(
    orpc.dashboard.customerFields.duplicates.queryOptions({
      input: { definitionId, value: debounced, excludeCustomerId: customerId },
      enabled: debounced.length >= MIN_LENGTH,
    }),
  );

  const duplicate = debounced.length >= MIN_LENGTH ? data?.[0] : undefined;
  if (!duplicate) return null;

  const name = duplicate.companyName ?? `${duplicate.firstName} ${duplicate.lastName}`;

  return (
    <p className="flex items-start gap-1.5 text-sm">
      <TriangleAlert aria-hidden className="text-badge-warning-foreground mt-0.5 size-4 shrink-0" />
      <span>
        {t("duplicate", { name })}{" "}
        <Link
          href={`/dashboard/customers/${duplicate.customerId}`}
          target="_blank"
          className="underline underline-offset-2"
        >
          {t("viewCustomer")}
        </Link>
      </span>
    </p>
  );
};
